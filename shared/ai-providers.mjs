export const API_STYLES = [
  { id: 'chat', name: 'Chat Completions' },
  { id: 'responses', name: 'OpenAI Responses' },
  { id: 'anthropic', name: 'Anthropic Messages' },
  { id: 'gemini', name: 'Gemini generateContent' },
];

export const AI_PROVIDERS = [
  { id: 'deepseek', name: 'DeepSeek', baseUrl: 'https://api.deepseek.com', apiStyle: 'chat', model: 'deepseek-flash' },
  { id: 'openai', name: 'OpenAI', baseUrl: 'https://api.openai.com/v1', apiStyle: 'responses', model: '' },
  { id: 'anthropic', name: 'Anthropic / Claude', baseUrl: 'https://api.anthropic.com/v1', apiStyle: 'anthropic', model: '' },
  { id: 'gemini', name: 'Google Gemini', baseUrl: 'https://generativelanguage.googleapis.com/v1beta', apiStyle: 'gemini', model: '' },
  { id: 'qwen', name: '阿里云百炼 / Qwen', baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1', apiStyle: 'chat', model: '' },
  { id: 'siliconflow', name: '硅基流动', baseUrl: 'https://api.siliconflow.cn/v1', apiStyle: 'chat', model: '' },
  { id: 'moonshot', name: 'Moonshot / Kimi', baseUrl: 'https://api.moonshot.cn/v1', apiStyle: 'chat', model: '' },
  { id: 'zhipu', name: '智谱 / GLM', baseUrl: 'https://open.bigmodel.cn/api/paas/v4', apiStyle: 'chat', model: '' },
  { id: 'ark', name: '火山方舟 / 豆包', baseUrl: 'https://ark.cn-beijing.volces.com/api/v3', apiStyle: 'chat', model: '' },
  { id: 'openrouter', name: 'OpenRouter', baseUrl: 'https://openrouter.ai/api/v1', apiStyle: 'chat', model: '' },
  { id: 'ollama', name: 'Ollama 本地', baseUrl: 'http://127.0.0.1:11434/v1', apiStyle: 'chat', model: '' },
  { id: 'lmstudio', name: 'LM Studio 本地', baseUrl: 'http://127.0.0.1:1234/v1', apiStyle: 'chat', model: '' },
];

export function supportsDeepSeekThinking(config) {
  try { return config.apiStyle === 'chat' && new URL(config.baseUrl).hostname === 'api.deepseek.com'; }
  catch { return false; }
}

export function aiDefaults(config) {
  const deepseek = supportsDeepSeekThinking(config);
  return { maxOutputTokens: deepseek ? 8192 : 2400, timeoutSeconds: deepseek ? 120 : 60, thinkingMode: 'auto', reasoningEffort: 'low' };
}

export function normalizeBaseUrl(value) {
  const url = new URL(String(value).trim());
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.search || url.hash) throw new Error('AI Base URL 格式无效');
  // Accept pasted request URLs without doubling the endpoint suffix.
  url.pathname = url.pathname.replace(/\/(responses|chat\/completions|messages|models(?:\/[^/]+:generateContent)?)\/?$/, '').replace(/\/+$/, '');
  if (url.hostname === 'api.deepseek.com' && url.pathname === '/anthropic') url.pathname = '/anthropic/v1';
  if (!url.pathname || url.pathname === '/') {
    if (url.hostname === 'generativelanguage.googleapis.com') url.pathname = '/v1beta';
    else if (['api.openai.com', 'api.anthropic.com'].includes(url.hostname)) url.pathname = '/v1';
  }
  return url.href.replace(/\/+$/, '');
}

export function protocolProblem(baseUrl, apiStyle) {
  let url;
  try { url = new URL(baseUrl); } catch { return 'Base URL 不是有效地址'; }
  if (url.hostname === 'api.deepseek.com') {
    const expected = url.pathname.startsWith('/anthropic') ? 'anthropic' : 'chat';
    if (apiStyle !== expected) return `DeepSeek 此地址需要 ${expected === 'chat' ? 'Chat Completions' : 'Anthropic Messages'} 格式，不是 ${apiStyle}`;
  }
  if (url.hostname === 'api.anthropic.com' && apiStyle !== 'anthropic') return 'Anthropic 官方地址需要 Anthropic Messages 格式';
  if (url.hostname === 'generativelanguage.googleapis.com') {
    const expected = url.pathname.includes('/openai') ? 'chat' : 'gemini';
    if (apiStyle !== expected) return `Gemini 此地址需要 ${expected === 'chat' ? 'Chat Completions' : 'Gemini generateContent'} 格式`;
  }
  return '';
}

export function providerFor(baseUrl) {
  try { const normalized = normalizeBaseUrl(baseUrl); return AI_PROVIDERS.find(item => normalizeBaseUrl(item.baseUrl) === normalized)?.id || 'custom'; }
  catch { return 'custom'; }
}
