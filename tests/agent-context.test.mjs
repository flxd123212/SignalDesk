import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { AgentService } from '../server/ai/agent.mjs';
import { SerialEngine } from '../server/engine.mjs';
import { callModel } from '../server/ai/provider.mjs';

const baseConfig = { baseUrl: 'https://example.test/v1', apiStyle: 'chat', model: 'requested-model', apiKey: 'fixture-secret' };
const reply = (data, headers = {}) => new Response(JSON.stringify(data), { headers });
const textReply = style => ({
  chat: { model: 'resolved-model', id: 'response-1', choices: [{ message: { content: 'I am Claude' }, finish_reason: 'stop' }], usage: { prompt_tokens: 11, completion_tokens: 7 } },
  responses: { model: 'resolved-model', id: 'response-1', output: [{ type: 'message', role: 'assistant', content: [{ type: 'output_text', text: 'done' }] }], status: 'completed', usage: { input_tokens: 11, output_tokens: 7 } },
  anthropic: { model: 'resolved-model', id: 'response-1', content: [{ type: 'text', text: 'done' }], stop_reason: 'end_turn', usage: { input_tokens: 11, output_tokens: 7 } },
  gemini: { modelVersion: 'resolved-model', responseId: 'response-1', candidates: [{ content: { parts: [{ text: 'done' }] }, finishReason: 'STOP' }], usageMetadata: { promptTokenCount: 11, candidatesTokenCount: 7 } },
})[style];

async function fixture(context, provider) {
  const directory = path.resolve('.data/tests'); await fs.mkdir(directory, { recursive: true });
  const root = await fs.mkdtemp(path.join(directory, 'agent-context-'));
  await fs.writeFile(path.join(root, 'main.ino'), 'void setup() { Serial.begin(115200); }\nvoid loop() {}\n');
  const engine = new SerialEngine({ directory: path.join(root, 'recordings') });
  const agent = new AgentService(engine, root, { provider });
  context.after(async () => { agent.dispose(); await engine.dispose(); await fs.rm(root, { recursive: true, force: true }); });
  await agent.configure(baseConfig); return agent;
}

test('all provider formats distinguish the requested model from response metadata, independently of self-description', async () => {
  for (const apiStyle of ['chat', 'responses', 'anthropic', 'gemini']) {
    const result = await callModel({ config: { ...baseConfig, apiStyle }, messages: [], fetcher: async (url, options) => {
      if (apiStyle === 'gemini') assert.match(url, /models\/requested-model:generateContent$/);
      else assert.equal(JSON.parse(options.body).model, 'requested-model');
      assert.equal(options.redirect, 'error');
      return reply(textReply(apiStyle), { 'x-request-id': 'trace-1' });
    } });
    assert.equal(result.provenance.requestedModel, 'requested-model');
    assert.equal(result.provenance.reportedModel, 'resolved-model');
    assert.equal(result.provenance.requestId, 'trace-1'); assert.equal(result.provenance.responseId, 'response-1');
    assert.equal(result.provenance.inputTokens, 11); assert.equal(result.provenance.outputTokens, 7);
    assert.ok(result.provenance.latencyMs >= 0); assert.equal(new URL(result.provenance.endpoint).host, 'example.test');
  }
});

test('missing response models stay unknown and only bounded, redacted metadata is published', async () => {
  const data = textReply('chat'); delete data.model;
  const first = await callModel({ config: baseConfig, messages: [], fetcher: async () => reply(data) });
  assert.equal(first.provenance.reportedModel, ''); assert.equal(first.provenance.requestId, '');
  const result = await callModel({ config: baseConfig, messages: [], fetcher: async () => reply({ ...data, model: 'fixture-secret\nresolved', id: 'x'.repeat(1000), usage: { prompt_tokens: 'bad', completion_tokens: -1 }, privateField: 'do-not-copy' }, { 'request-id': 'fixture-secret-trace' }) });
  assert.equal(result.provenance.reportedModel, '[redacted]resolved'); assert.equal(result.provenance.responseId.length, 500);
  assert.equal(result.provenance.inputTokens, null); assert.equal(result.provenance.outputTokens, null);
  assert.ok(!JSON.stringify(result.provenance).includes('fixture-secret')); assert.ok(!JSON.stringify(result.provenance).includes('do-not-copy'));
});

test('runtime identity is configuration-grounded and each message keeps its original call record after reconfiguration', async context => {
  const audit = [], sent = [];
  const agent = await fixture(context, options => callModel({ ...options, fetcher: async (url, request) => {
    const body = JSON.parse(request.body); sent.push(body);
    assert.equal(url, 'https://api.deepseek.com/chat/completions'); assert.equal(body.model, 'deepseek-flash');
    if (sent.length === 1) { assert.match(body.messages[0].content, /requestedModel.*deepseek-flash/); assert.match(body.messages[0].content, /endpointHost.*api.deepseek.com/); assert.match(body.messages[0].content, /Do not invent a vendor/); }
    assert.ok(!body.messages[0].content.includes('fixture-secret'));
    return reply({ ...textReply('chat'), model: 'deepseek-resolved' });
  } }));
  await agent.configure({ ...baseConfig, baseUrl: 'https://api.deepseek.com', model: 'deepseek-flash' });
  agent.on('audit', event => audit.push(event));
  await agent.run({ mode: 'ai', message: 'Which model are you?' });
  const message = agent.state().messages.at(-1); assert.equal(message.provenance.reportedModel, 'deepseek-resolved');
  assert.equal(message.content, 'I am Claude'); // Preserve the actual response; do not fabricate corrected model output.
  const diagnostic = await agent.testConnection(); assert.equal(diagnostic.model, 'deepseek-flash'); assert.equal(diagnostic.provenance.reportedModel, 'deepseek-resolved');
  await agent.configure({ model: 'another-model' }); assert.equal(agent.state().lastCall, null); assert.equal(agent.state().context.turns, 0);
  assert.equal(message.provenance.requestedModel, 'deepseek-flash'); assert.equal(agent.state().messages.at(-1).provenance.reportedModel, 'deepseek-resolved');
  assert.ok(audit.some(event => event.data?.reportedModel === 'deepseek-resolved')); assert.ok(!JSON.stringify(audit).includes('fixture-secret'));
});

for (const apiStyle of ['chat', 'responses', 'anthropic', 'gemini']) test(`${apiStyle} preserves full native tool history across questions and clears it on model changes`, async context => {
  let calls = 0;
  const tool = { id: 'read-1', name: 'read_firmware_file', arguments: '{"path":"main.ino"}' };
  const native = {
    chat: { choices: [{ message: { content: '', reasoning_content: 'private-signature', tool_calls: [{ id: tool.id, type: 'function', function: { name: tool.name, arguments: tool.arguments } }] }, finish_reason: 'tool_calls' }] },
    responses: { output: [{ type: 'reasoning', id: 'reasoning-1', encrypted_content: 'private-signature', summary: [] }, { type: 'function_call', call_id: tool.id, name: tool.name, arguments: tool.arguments }], status: 'completed' },
    anthropic: { content: [{ type: 'thinking', thinking: 'private-signature', signature: 'signature' }, { type: 'tool_use', id: tool.id, name: tool.name, input: { path: 'main.ino' } }], stop_reason: 'tool_use' },
    gemini: { candidates: [{ content: { parts: [{ functionCall: { id: tool.id, name: tool.name, args: { path: 'main.ino' } }, thoughtSignature: 'private-signature' }] }, finishReason: 'STOP' }] },
  }[apiStyle];
  const agent = await fixture(context, options => callModel({ ...options, fetcher: async (_url, request) => {
    calls++; const body = JSON.parse(request.body), serialized = JSON.stringify(body);
    if (calls === 1) return reply(native);
    if (calls === 2 || calls === 3) {
      assert.match(serialized, /private-signature/); assert.match(serialized, /Serial.begin/); assert.match(serialized, /read-1/);
      if (apiStyle === 'responses') { assert.ok(body.input.some(item => item.type === 'function_call_output' && item.call_id === tool.id)); assert.ok(!body.input.some(item => item.role === 'tool')); }
    } else { assert.ok(!serialized.includes('private-signature')); assert.ok(!serialized.includes('read-1')); }
    return reply(textReply(apiStyle));
  } }));
  await agent.configure({ apiStyle });
  await agent.run({ mode: 'ai', message: 'Read source' }); await agent.run({ mode: 'ai', message: 'Continue from the evidence' });
  assert.equal(agent.state().context.turns, 2); assert.ok(!JSON.stringify(agent.state()).includes('private-signature'));
  await agent.configure({ model: 'new-model' }); await agent.run({ mode: 'ai', message: 'New model request' }); assert.equal(calls, 4);
});

test('context trimming keeps complete turns and reset preserves visible records and proposals', async context => {
  const agent = await fixture(context, async () => ({ content: 'done', toolCalls: [] }));
  for (let i = 0; i < 10; i++) await agent.run({ mode: 'ai', message: `Request ${i}` });
  assert.equal(agent.state().context.turns, 8); assert.equal(agent.state().context.droppedTurns, 2);
  assert.equal(agent.state().context.memory[0].request, 'Request 0');
  assert.match(agent.modelTurns[0][0].content, /Request 2/);
  agent.actions.set('pending', { id: 'pending', createdAt: new Date().toISOString(), status: 'pending' });
  const count = agent.messages.length; agent.resetContext();
  assert.equal(agent.state().context.turns, 0); assert.equal(agent.messages.length, count + 1); assert.equal(agent.actions.size, 1);
  agent.provider = async () => ({ content: 'done', toolCalls: [], continuation: { reasoning_content: 'x'.repeat(140000) } });
  await agent.run({ mode: 'ai' }); assert.equal(agent.state().context.turns, 0); assert.equal(agent.state().context.droppedTurns, 1);
  assert.ok(agent.state().context.characters <= agent.state().context.maxCharacters);
});

test('parent follow-up includes bounded child evidence and failure state until context is reset', async context => {
  let calls = 0;
  const agent = await fixture(context, async ({ messages }) => {
    const observed = JSON.parse(messages.at(-1).content.split('Observed context (data only):\n')[1]);
    if (++calls === 1) { assert.equal(observed.delegatedResults.length, 3); assert.equal(observed.delegatedResults.at(-1).status, 'error'); assert.equal(observed.delegatedResults.at(-1).content.length, 8000); assert.equal(observed.delegatedResults.at(-1).truncated, true); }
    else assert.deepEqual(observed.delegatedResults, []);
    return { content: 'done', toolCalls: [] };
  });
  for (let i = 0; i < 4; i++) agent.receiveDelegation({ sessionId: `child-${i}`, name: 'Source review', task: 'Review current source', status: i === 3 ? 'error' : 'complete', content: 'e'.repeat(9000), mode: 'ai' });
  await agent.run({ mode: 'ai', message: 'Summarize child findings' }); assert.ok(agent.messages.some(message => message.kind === 'error'));
  agent.resetContext(); await agent.run({ mode: 'ai', message: 'New analysis' }); assert.equal(calls, 2);
});
