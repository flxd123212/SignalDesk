import { API_STYLES, aiDefaults, normalizeBaseUrl, protocolProblem, supportsDeepSeekThinking } from '../../shared/ai-providers.mjs';

export function toResponsesInput(messages) {
  return messages.filter(message => message.role !== 'system').flatMap(message => {
    if (message.responseOutput) return message.responseOutput;
    if (message.role === 'tool') return [{ type: 'function_call_output', call_id: message.tool_call_id, output: message.content }];
    return [{ role: message.role, content: message.content }];
  });
}

const redact = (value, config) => String(value).replaceAll(config.apiKey || '\0', '[redacted]').slice(0, 1000);
const textContent = value => typeof value === 'string' ? value : Array.isArray(value) ? value.filter(part => ['text', 'output_text'].includes(part.type)).map(part => part.text || '').join('\n') : '';

function connection(config) {
  const base = normalizeBaseUrl(config.baseUrl), problem = protocolProblem(base, config.apiStyle);
  if (!API_STYLES.some(item => item.id === config.apiStyle)) throw new Error('不支持的 AI API 格式');
  if (problem) throw new Error(problem);
  const headers = { 'Content-Type': 'application/json' };
  if (config.apiStyle === 'anthropic') { headers['anthropic-version'] = '2023-06-01'; if (config.apiKey) headers['x-api-key'] = config.apiKey; }
  else if (config.apiStyle === 'gemini') { if (config.apiKey) headers['x-goog-api-key'] = config.apiKey; }
  else if (config.apiKey) headers.Authorization = `Bearer ${config.apiKey}`;
  return { base, headers };
}

async function requestJson(endpoint, config, options, signal, fetcher) {
  const seconds = config.timeoutSeconds || aiDefaults(config).timeoutSeconds;
  const timeout = AbortSignal.timeout(seconds * 1000);
  const combined = signal ? AbortSignal.any([signal, timeout]) : timeout;
  try {
    const response = await fetcher(endpoint, { ...options, redirect: 'error', signal: combined });
    let text = '';
    if (response.body) {
      const reader = response.body.getReader(), decoder = new TextDecoder(); let size = 0;
      try {
        while (true) { const { done, value } = await reader.read(); if (done) break; size += value.byteLength; if (size > 4 * 1024 * 1024) { await reader.cancel(); throw new Error('AI 接口响应超过 4 MiB'); } text += decoder.decode(value, { stream: true }); }
        text += decoder.decode();
      } finally { reader.releaseLock(); }
    }
    let data;
    try { data = JSON.parse(text); } catch { throw new Error(`AI 接口返回非 JSON（HTTP ${response.status}），请检查 Base URL 是否指向 API 而不是网页`); }
    if (!response.ok || data.error) {
      const hint = ({ 401: '检查 API Key', 403: '检查账户和模型权限', 404: '检查接口路径和模型 ID', 429: '检查额度或降低请求频率' })[response.status] || '';
      const error = new Error(`AI 接口 HTTP ${response.status}：${redact(data.error?.message || data.message || data.error || response.statusText, config)}${hint ? `；${hint}` : ''}`);
      error.status = response.status;
      error.retryable = [429, 500, 502, 503, 504, 529].includes(response.status);
      const after = response.headers.get('retry-after');
      if (after !== null) { const delay = /^\d+(\.\d+)?$/.test(after.trim()) ? Number(after) * 1000 : Date.parse(after) - Date.now(); if (Number.isFinite(delay)) error.retryAfterMs = Math.max(0, delay); }
      throw error;
    }
    return { data, requestId: safeField(response.headers.get('x-request-id') || response.headers.get('request-id') || response.headers.get('x-goog-request-id'), config) };
  } catch (error) {
    if (signal?.aborted) throw new Error('分析已停止');
    if (timeout.aborted || error.name === 'TimeoutError') throw new Error(`AI 接口超时（${seconds}s），串口采集仍在继续`);
    const safe = new Error(redact(error.message, config));
    if (error.status) safe.status = error.status;
    safe.retryable = error.retryable === true;
    if (error.retryAfterMs !== undefined) safe.retryAfterMs = error.retryAfterMs;
    throw safe;
  }
}

const safeField = (value, config) => typeof value === 'string' ? redact(value, config).replace(/[\x00-\x1f\x7f]/g, '').slice(0, 500) : '';
const tokenCount = value => Number.isSafeInteger(value) && value >= 0 ? value : null;

function anthropicMessages(messages) {
  const result = [];
  for (const message of messages.filter(item => item.role !== 'system')) {
    const role = message.role === 'assistant' ? 'assistant' : 'user';
    const content = message.anthropicContent || (message.role === 'tool'
      ? [{ type: 'tool_result', tool_use_id: message.tool_call_id, content: message.content }]
      : [...(message.content ? [{ type: 'text', text: message.content }] : []), ...(message.tool_calls || []).map(call => ({ type: 'tool_use', id: call.id, name: call.function.name, input: JSON.parse(call.function.arguments) }))]);
    if (result.at(-1)?.role === role) result.at(-1).content.push(...content); else result.push({ role, content: [...content] });
  }
  return result;
}

function geminiMessages(messages) {
  const calls = new Map(), result = [];
  for (const message of messages.filter(item => item.role !== 'system')) {
    for (const call of message.tool_calls || []) calls.set(call.id, { name: call.function.name, nativeId: message.geminiParts?.some(part => part.functionCall?.id === call.id) });
    const role = message.role === 'assistant' ? 'model' : 'user';
    const parts = message.geminiParts || (message.role === 'tool'
      ? [{ functionResponse: { ...(calls.get(message.tool_call_id)?.nativeId ? { id: message.tool_call_id } : {}), name: calls.get(message.tool_call_id)?.name, response: { result: JSON.parse(message.content) } } }]
      : [...(message.content ? [{ text: message.content }] : []), ...(message.tool_calls || []).map(call => ({ functionCall: { id: call.id, name: call.function.name, args: JSON.parse(call.function.arguments) } }))]);
    if (result.at(-1)?.role === role) result.at(-1).parts.push(...parts); else result.push({ role, parts: [...parts] });
  }
  return result;
}

export async function callModel({ config, messages, tools = [], responseInput, signal, fetcher = fetch }) {
  if (!config.model.trim()) throw new Error('请先设置 AI 模型名称');
  const { base, headers } = connection(config), style = config.apiStyle, maxTokens = config.maxOutputTokens || aiDefaults(config).maxOutputTokens;
  const deepseek = supportsDeepSeekThinking(config);
  const system = messages.filter(message => message.role === 'system').map(message => message.content).join('\n');
  let endpoint, body;
  if (style === 'responses') {
    endpoint = `${base}/responses`;
    body = { model: config.model, instructions: system, input: responseInput || toResponsesInput(messages), store: false, ...(deepseek ? {} : { include: ['reasoning.encrypted_content'] }), max_output_tokens: maxTokens, tools: tools.map(tool => ({ type: 'function', ...tool, strict: true })) };
  } else if (style === 'anthropic') {
    endpoint = `${base}/messages`;
    body = { model: config.model, system, max_tokens: maxTokens, messages: anthropicMessages(messages), ...(tools.length ? { tools: tools.map(tool => ({ name: tool.name, description: tool.description, input_schema: tool.parameters })) } : {}) };
  } else if (style === 'gemini') {
    endpoint = `${base}/models/${encodeURIComponent(config.model.replace(/^models\//, ''))}:generateContent`;
    body = { systemInstruction: { parts: [{ text: system }] }, contents: geminiMessages(messages), generationConfig: { maxOutputTokens: maxTokens }, ...(tools.length ? { tools: [{ functionDeclarations: tools.map(tool => ({ name: tool.name, description: tool.description, parametersJsonSchema: tool.parameters })) }] } : {}) };
  } else {
    endpoint = `${base}/chat/completions`;
    body = { model: config.model, stream: false, messages: messages.map(({ anthropicContent, geminiParts, responseOutput, ...message }) => message), ...(new URL(base).hostname === 'api.openai.com' ? { max_completion_tokens: maxTokens } : { max_tokens: maxTokens }), ...(tools.length ? { tools: tools.map(tool => ({ type: 'function', function: tool })), tool_choice: 'auto' } : {}) };
  }
  if (deepseek) {
    const enabled = config.thinkingMode === 'enabled', effort = config.reasoningEffort || 'low';
    if (style === 'responses') body.reasoning = { effort: enabled ? effort === 'max' ? 'xhigh' : effort : 'none' };
    else if (style === 'anthropic') {
      body.thinking = { type: enabled ? 'adaptive' : 'disabled' };
      if (enabled) body.output_config = { effort };
    } else {
      body.thinking = { type: enabled ? 'enabled' : 'disabled' };
      if (enabled) body.reasoning_effort = effort;
    }
  }
  const started = Date.now();
  const { data, requestId } = await requestJson(endpoint, config, { method: 'POST', headers, body: JSON.stringify(body) }, signal, fetcher);
  let result, reason, reasoningOnly = false;
  if (style === 'responses') {
    if (data.choices) throw new Error('返回的是 Chat Completions 结构，请将 API 格式切换为 Chat Completions');
    const output = Array.isArray(data.output) ? data.output : [];
    result = { content: output.filter(item => item.type === 'message').map(item => textContent(item.content)).join('\n'), toolCalls: output.filter(item => item.type === 'function_call').map(item => ({ id: item.call_id, name: item.name, arguments: item.arguments })), rawOutput: output };
    reason = data.incomplete_details?.reason || data.status;
    reasoningOnly = !result.content.trim() && !result.toolCalls.length && output.some(item => item.type === 'reasoning');
  } else if (style === 'anthropic') {
    const content = Array.isArray(data.content) ? data.content : [];
    result = { content: textContent(content), toolCalls: content.filter(item => item.type === 'tool_use').map(item => ({ id: item.id, name: item.name, arguments: JSON.stringify(item.input) })), continuation: { anthropicContent: content } };
    reason = data.stop_reason;
    reasoningOnly = !result.content.trim() && !result.toolCalls.length && content.some(item => item.type === 'thinking');
  } else if (style === 'gemini') {
    const candidate = data.candidates?.[0], parts = candidate?.content?.parts || [];
    result = { content: parts.filter(part => !part.thought && typeof part.text === 'string').map(part => part.text).join('\n'), toolCalls: parts.filter(part => part.functionCall).map((part, index) => ({ id: part.functionCall.id || `gemini-${index}`, name: part.functionCall.name, arguments: JSON.stringify(part.functionCall.args || {}) })), continuation: { geminiParts: parts } };
    reason = candidate?.finishReason || data.promptFeedback?.blockReason;
  } else {
    if (data.output) throw new Error('返回的是 Responses 结构，请将 API 格式切换为 OpenAI Responses');
    const message = data.choices?.[0]?.message;
    result = { content: textContent(message?.content) || message?.refusal || '', toolCalls: (message?.tool_calls || []).map(call => ({ id: call.id, name: call.function?.name, arguments: call.function?.arguments })), continuation: message?.reasoning_content ? { reasoning_content: message.reasoning_content } : {} };
    reason = data.choices?.[0]?.finish_reason;
    reasoningOnly = !result.content.trim() && !result.toolCalls.length && !!message?.reasoning_content;
  }
  const truncated = ['length', 'max_tokens', 'max_output_tokens', 'MAX_TOKENS'].includes(reason);
  const reasoningField = style === 'chat' ? 'reasoning_content' : style === 'anthropic' ? 'thinking' : 'reasoning';
  if (reasoningOnly && truncated) throw new Error(`AI 推理达到输出上限（${maxTokens} tokens），仅返回 ${reasoningField}，尚未生成正文。${deepseek ? '在 AI 接口设置中选择“快速回答”，或提高输出上限并延长超时后重试' : '请提高输出上限后重试'}；本次未执行不完整的工具调用`);
  if (!result.content.trim() && !result.toolCalls.length) throw new Error(`AI 未返回可用正文或工具调用（${style}，结束原因：${reason || '未知'}${reasoningOnly ? ` / 仅返回 ${reasoningField}` : ''}）。检查模型 ID、API 格式；推理模型可增加输出上限`);
  if (result.toolCalls.some(call => !call.id || !call.name || typeof call.arguments !== 'string')) throw new Error('AI 工具调用结构不完整，未执行任何动作');
  if (truncated && result.toolCalls.length) throw new Error(`AI 工具调用因输出上限被截断（${maxTokens} tokens），本轮工具未执行。请提高输出上限，或切换快速回答后重试`);
  const usage = data.usage || data.usageMetadata;
  const inputParts = style === 'anthropic' ? [usage?.input_tokens, usage?.cache_read_input_tokens ?? 0, usage?.cache_creation_input_tokens ?? 0] : [usage?.prompt_tokens ?? usage?.input_tokens ?? usage?.promptTokenCount];
  const provenance = {
    requestedModel: safeField(config.model, config), reportedModel: safeField(style === 'gemini' ? data.modelVersion : data.model, config),
    endpoint: redact(endpoint, config), apiStyle: style, responseId: safeField(data.id || data.responseId, config), requestId,
    finishReason: safeField(reason, config), latencyMs: Date.now() - started, time: new Date().toISOString(),
    inputTokens: inputParts.every(value => tokenCount(value) !== null) ? tokenCount(inputParts.reduce((sum, value) => sum + value, 0)) : null,
    outputTokens: tokenCount(usage?.completion_tokens ?? usage?.output_tokens ?? usage?.candidatesTokenCount),
  };
  return { ...result, content: result.content + (truncated ? '\n\n[回复达到输出上限，内容可能不完整]' : ''), usage, endpoint, apiStyle: style, finishReason: reason, provenance };
}

export async function listModels(config, { signal, fetcher = fetch } = {}) {
  const discoveryConfig = supportsDeepSeekThinking(config) ? { ...config, baseUrl: 'https://api.deepseek.com', apiStyle: 'chat' } : config;
  const { base, headers } = connection(discoveryConfig);
  const { data } = await requestJson(`${base}/models`, config, { method: 'GET', headers }, signal, fetcher);
  const entries = config.apiStyle === 'gemini' ? data.models : data.data;
  if (!Array.isArray(entries)) throw new Error('此接口未返回标准模型列表，请手动填写模型 ID');
  const models = entries.filter(item => config.apiStyle !== 'gemini' || item.supportedGenerationMethods?.includes('generateContent')).map(item => ({ id: String(item.id || item.name || '').replace(/^models\//, ''), name: String(item.display_name || item.displayName || item.id || item.name || '') })).filter(item => item.id && item.id.length <= 500).slice(0, 500);
  return { models, hasMore: !!(data.has_more || data.nextPageToken) || entries.length > 500 };
}
