import test from 'node:test';
import assert from 'node:assert/strict';
import { callModel, listModels } from '../server/ai/provider.mjs';
import { normalizeBaseUrl, protocolProblem, AI_PROVIDERS, providerFor } from '../shared/ai-providers.mjs';

const messages = [{ role: 'system', content: 'system' }, { role: 'user', content: 'read' }];
const tools = [{ name: 'snapshot', description: 'Read data', parameters: { type: 'object', properties: {}, additionalProperties: false, required: [] } }];
const config = (apiStyle, baseUrl = 'http://127.0.0.1:9999/v1') => ({ baseUrl, apiStyle, model: 'fixture', apiKey: 'fixture-secret' });
const reply = data => new Response(JSON.stringify(data));

test('presets use supported protocol and complete endpoint input is normalized', () => {
  for (const preset of AI_PROVIDERS) assert.equal(protocolProblem(preset.baseUrl, preset.apiStyle), '');
  assert.equal(normalizeBaseUrl('https://api.deepseek.com/chat/completions/'), 'https://api.deepseek.com');
  assert.equal(normalizeBaseUrl('https://api.openai.com'), 'https://api.openai.com/v1');
  assert.equal(protocolProblem('https://api.deepseek.com', 'responses'), '');
  assert.equal(providerFor('https://api.deepseek.com/anthropic/v1'), 'deepseek');
  assert.throws(() => normalizeBaseUrl('https://key:pass@example.com'), /格式/);
});

test('DeepSeek protocol mismatch fails before network and detects wrong response shape', async () => {
  await assert.rejects(callModel({ config: config('anthropic', 'https://api.deepseek.com'), messages, fetcher: () => { throw new Error('must not send'); } }), /anthropic/);
  await assert.rejects(callModel({ config: config('responses'), messages, fetcher: async () => reply({ choices: [{ message: { content: 'hello' } }] }) }), /切换为 Chat Completions/);
  await assert.rejects(callModel({ config: config('chat'), messages, fetcher: async () => reply({ choices: [{ message: { content: '', reasoning_content: 'thinking' }, finish_reason: 'length' }] }) }), /reasoning_content/);
});

test('Chat text blocks, reasoning continuation, custom limits and redaction work', async () => {
  let sent;
  const result = await callModel({ config: { ...config('chat'), maxOutputTokens: 8192 }, messages, fetcher: async (url, options) => { sent = options; return reply({ choices: [{ message: { content: [{ type: 'text', text: 'answer' }], reasoning_content: 'private-state' }, finish_reason: 'stop' }] }); } });
  assert.equal(result.content, 'answer'); assert.equal(result.continuation.reasoning_content, 'private-state');
  assert.equal(JSON.parse(sent.body).max_tokens, 8192); assert.equal(sent.redirect, 'error');
  await assert.rejects(callModel({ config: config('chat'), messages, fetcher: async () => { throw new Error('bad fixture-secret'); } }), error => !error.message.includes('fixture-secret') && error.message.includes('[redacted]'));
});

test('Anthropic preserves content blocks and combines parallel tool results', async () => {
  let sent;
  const content = [{ type: 'text', text: 'reading' }, { type: 'tool_use', id: 'c1', name: 'snapshot', input: {} }, { type: 'tool_use', id: 'c2', name: 'snapshot', input: {} }];
  const result = await callModel({ config: config('anthropic'), messages, tools, fetcher: async (url, options) => { sent = { url, ...options }; return reply({ content, stop_reason: 'tool_use' }); } });
  assert.match(sent.url, /\/messages$/); assert.equal(sent.headers['x-api-key'], 'fixture-secret'); assert.equal(sent.headers.Authorization, undefined);
  assert.deepEqual(JSON.parse(sent.body).tools[0].input_schema, tools[0].parameters);
  const continuation = [...messages, { role: 'assistant', content: result.content, ...result.continuation, tool_calls: result.toolCalls.map(call => ({ id: call.id, function: { name: call.name, arguments: call.arguments } })) }, ...result.toolCalls.map(call => ({ role: 'tool', tool_call_id: call.id, content: '{"samples":1}' }))];
  await callModel({ config: config('anthropic'), messages: continuation, fetcher: async (url, options) => { const body = JSON.parse(options.body); assert.deepEqual(body.messages[1].content, content); assert.equal(body.messages[2].content.length, 2); assert.equal(body.messages[2].content[1].tool_use_id, 'c2'); return reply({ content: [{ type: 'text', text: 'done' }] }); } });
});

test('Gemini keeps thought signatures on tool turn and parses function responses', async () => {
  const parts = [{ thought: true, text: 'internal' }, { functionCall: { id: 'gc1', name: 'snapshot', args: {} }, thoughtSignature: 'opaque-signature' }];
  const result = await callModel({ config: config('gemini'), messages, tools, fetcher: async (url, options) => { const body = JSON.parse(options.body); assert.match(url, /models\/fixture:generateContent$/); assert.equal(options.headers['x-goog-api-key'], 'fixture-secret'); assert.ok(body.tools[0].functionDeclarations[0].parametersJsonSchema); return reply({ candidates: [{ content: { parts }, finishReason: 'STOP' }] }); } });
  assert.equal(result.content, ''); assert.equal(result.toolCalls[0].id, 'gc1');
  await callModel({ config: config('gemini'), messages: [...messages, { role: 'assistant', ...result.continuation, tool_calls: [{ id: 'gc1', function: { name: 'snapshot', arguments: '{}' } }] }, { role: 'tool', tool_call_id: 'gc1', content: '{"samples":2}' }], fetcher: async (url, options) => { const body = JSON.parse(options.body); assert.deepEqual(body.contents[1].parts, parts); assert.equal(body.contents[2].parts[0].functionResponse.name, 'snapshot'); return reply({ candidates: [{ content: { parts: [{ text: 'done' }] } }] }); } });
});

test('model discovery supports standard, Anthropic and Gemini lists', async () => {
  for (const style of ['chat', 'responses', 'anthropic']) { const result = await listModels(config(style), { fetcher: async () => reply({ data: [{ id: 'm1' }] }) }); assert.equal(result.models[0].id, 'm1'); }
  const result = await listModels(config('gemini'), { fetcher: async () => reply({ models: [{ name: 'models/g1', supportedGenerationMethods: ['generateContent'] }, { name: 'models/embed', supportedGenerationMethods: ['embedContent'] }], nextPageToken: 'next' }) });
  assert.deepEqual(result.models.map(item => item.id), ['g1']); assert.equal(result.hasMore, true);
});

test('empty replies and truncated replies never silently pass as complete success', async () => {
  for (const style of ['chat', 'responses', 'anthropic', 'gemini']) await assert.rejects(callModel({ config: config(style), messages, fetcher: async () => reply({}) }), /未返回可用正文/);
  const result = await callModel({ config: config('chat'), messages, fetcher: async () => reply({ choices: [{ message: { content: 'partial' }, finish_reason: 'length' }] }) }); assert.match(result.content, /输出上限/);
});

test('DeepSeek supports Chat, Responses and Anthropic endpoints with protocol-specific thinking controls', async () => {
  const fixtures = {
    chat: { model: 'deepseek-flash', choices: [{ message: { content: 'OK' }, finish_reason: 'stop' }] },
    responses: { model: 'deepseek-flash', output: [{ type: 'message', content: [{ type: 'output_text', text: 'OK' }] }], status: 'completed' },
    anthropic: { model: 'deepseek-flash', content: [{ type: 'text', text: 'OK' }], stop_reason: 'end_turn', usage: { input_tokens: 10, cache_read_input_tokens: 5, cache_creation_input_tokens: 3, output_tokens: 2 } },
  };
  for (const style of ['chat', 'responses', 'anthropic']) for (const thinkingMode of ['auto', 'disabled', 'enabled']) {
    const enabled = thinkingMode === 'enabled';
    const result = await callModel({ config: { ...config(style, `https://api.deepseek.com${style === 'anthropic' ? '/anthropic' : ''}`), model: 'deepseek-flash', thinkingMode, reasoningEffort: 'max' }, messages, fetcher: async (url, options) => {
      const body = JSON.parse(options.body);
      assert.equal(url, `https://api.deepseek.com/${{ chat: 'chat/completions', responses: 'responses', anthropic: 'anthropic/v1/messages' }[style]}`);
      assert.equal(body.model, 'deepseek-flash');
      if (style === 'responses') { assert.deepEqual(body.reasoning, { effort: enabled ? 'xhigh' : 'none' }); assert.equal(body.include, undefined); assert.equal(body.thinking, undefined); assert.equal(body.max_output_tokens, 8192); }
      else if (style === 'anthropic') { assert.deepEqual(body.thinking, { type: enabled ? 'adaptive' : 'disabled' }); assert.deepEqual(body.output_config, enabled ? { effort: 'max' } : undefined); assert.equal(options.headers['x-api-key'], 'fixture-secret'); assert.equal(body.max_tokens, 8192); }
      else { assert.deepEqual(body.thinking, { type: enabled ? 'enabled' : 'disabled' }); assert.equal(body.reasoning_effort, enabled ? 'max' : undefined); }
      return reply(fixtures[style]);
    } });
    assert.equal(result.content, 'OK'); if (style === 'anthropic') assert.equal(result.provenance.inputTokens, 18);
  }
});

test('DeepSeek uses its standard model catalog for every protocol and reports non-Chat reasoning exhaustion', async () => {
  const result = await listModels(config('anthropic', 'https://api.deepseek.com/anthropic'), { fetcher: async (url, options) => {
    assert.equal(url, 'https://api.deepseek.com/models'); assert.equal(options.headers.Authorization, 'Bearer fixture-secret'); assert.equal(options.headers['x-api-key'], undefined);
    return reply({ data: [{ id: 'deepseek-flash', object: 'model' }, { id: 'deepseek-v4-pro', object: 'model' }] });
  } });
  assert.equal(result.models.length, 2);
  for (const style of ['responses', 'anthropic']) await assert.rejects(callModel({ config: config(style, `https://api.deepseek.com${style === 'anthropic' ? '/anthropic' : ''}`), messages, fetcher: async () => reply(style === 'responses' ? { output: [{ type: 'reasoning', summary: [{ type: 'summary_text', text: 'private' }] }], status: 'incomplete', incomplete_details: { reason: 'max_output_tokens' } } : { content: [{ type: 'thinking', thinking: 'private' }], stop_reason: 'max_tokens' }) }), error => /快速回答/.test(error.message) && !error.message.includes('private'));
});
