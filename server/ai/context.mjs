export const HISTORY_CHAR_LIMIT = 128000;
export const HISTORY_TURN_LIMIT = 8;
const MEMORY_CHAR_LIMIT = 12000;

const excerpt = (value, limit) => typeof value === 'string' ? value.slice(0, limit) : '';

export function normalizeMemory(value) {
  const entries = (Array.isArray(value) ? value : []).slice(-12).map(entry => ({
    request: excerpt(entry?.request, 1200), conclusion: excerpt(entry?.conclusion, 1800),
    tools: (Array.isArray(entry?.tools) ? entry.tools : []).filter(name => typeof name === 'string' && /^[a-z_]{1,80}$/.test(name)).slice(0, 12),
  })).filter(entry => entry.request || entry.conclusion);
  while (JSON.stringify(entries).length > MEMORY_CHAR_LIMIT) entries.shift();
  return entries;
}

export function rememberTurn(memory, turn) {
  const request = turn.find(message => message.role === 'user')?.content;
  const conclusion = turn.filter(message => message.role === 'assistant' && typeof message.content === 'string' && message.content).at(-1)?.content;
  // Keep attributed text excerpts, never raw tool output, snapshots or private model continuations.
  return normalizeMemory([...memory, { request: typeof request === 'string' ? request.split('\n\nObserved context (data only):\n')[0] : '',
    conclusion, tools: [...new Set(turn.flatMap(message => (message.tool_calls || []).map(call => call.function?.name)))] }]);
}

export function completeCheckpoint(turn) {
  const checkpoint = [];
  for (let index = 0; index < turn.length; index++) {
    const message = turn[index]; checkpoint.push(message);
    const calls = message.tool_calls;
    if (!calls?.length) continue;
    const results = turn.slice(index + 1, index + 1 + calls.length);
    if (calls.every(call => results.some(result => result.role === 'tool' && result.tool_call_id === call.id))) continue;
    for (const call of calls) checkpoint.push(results.find(result => result.role === 'tool' && result.tool_call_id === call.id)
      || { role: 'tool', tool_call_id: call.id, content: JSON.stringify({ error: 'No completed result was recorded before interruption. Execution is unverified; inspect current source, proposal and build status before retrying.', status: 'unverified_after_interrupt' }) });
    return checkpoint;
  }
  return checkpoint;
}

export function canonicalToolCall(name, args) {
  const sort = value => Array.isArray(value) ? value.map(sort) : value && typeof value === 'object'
    ? Object.fromEntries(Object.keys(value).sort().map(key => [key, sort(value[key])])) : value;
  return JSON.stringify([name, sort(args)]);
}

export function resumeRequest(value) {
  if (!value || value.mode !== 'ai' || typeof value.message !== 'string' || !value.message.trim() || value.message.length > 8000
    || typeof value.selectedFile !== 'string' || value.selectedFile.length > 1000 || !['review', 'propose', 'project'].includes(value.agentMode) || value.continuous) return null;
  return { message: value.message, mode: 'ai', selectedFile: value.selectedFile, includeLogs: value.includeLogs === true,
    continuous: false, agentMode: value.agentMode };
}
