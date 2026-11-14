import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { AgentService } from '../server/ai/agent.mjs';
import { SerialEngine } from '../server/engine.mjs';
import { callModel } from '../server/ai/provider.mjs';

const reply = data => new Response(JSON.stringify(data));
const config = { baseUrl: 'https://api.deepseek.com', apiStyle: 'chat', model: 'deepseek-flash', apiKey: 'fixture-secret' };
const toolResult = (name = 'list_firmware_files', args = {}) => ({ content: '', toolCalls: [{ id: 'call-1', name, arguments: JSON.stringify(args) }] });
const answer = { content: 'Verified fixture answer', toolCalls: [] };

async function fixture(context, provider) {
  const directory = path.resolve('.data/tests'); await fs.mkdir(directory, { recursive: true });
  const root = await fs.mkdtemp(path.join(directory, 'runtime-'));
  await fs.writeFile(path.join(root, 'main.ino'), 'void setup() { Serial.begin(115200); }\nvoid loop() {}\n');
  const engine = new SerialEngine({ directory: path.join(root, 'recordings') }), agent = new AgentService(engine, root, { provider });
  context.after(async () => { agent.dispose(); await engine.dispose(); await fs.rm(root, { recursive: true, force: true }); });
  await agent.configure(config); return agent;
}

test('DeepSeek defaults explicitly disable thinking, retain configured limits, and support opt-in thinking', async () => {
  for (const mode of [undefined, 'auto', 'disabled', 'enabled']) {
    await callModel({ config: { ...config, thinkingMode: mode }, messages: [], fetcher: async (_url, options) => {
      const body = JSON.parse(options.body);
      assert.deepEqual(body.thinking, { type: mode === 'enabled' ? 'enabled' : 'disabled' });
      assert.equal(body.max_tokens, 8192);
      assert.equal(body.reasoning_effort, mode === 'enabled' ? 'low' : undefined);
      return reply({ choices: [{ message: { content: 'OK' }, finish_reason: 'stop' }] });
    } });
  }
  await callModel({ config: { ...config, maxOutputTokens: 2560 }, messages: [], fetcher: async (_url, options) => { assert.equal(JSON.parse(options.body).max_tokens, 2560); return reply({ choices: [{ message: { content: 'OK' } }] }); } });
  await callModel({ config: { ...config, baseUrl: 'https://example.test/v1', thinkingMode: 'enabled' }, messages: [], fetcher: async (_url, options) => { assert.equal(JSON.parse(options.body).thinking, undefined); return reply({ choices: [{ message: { content: 'OK' } }] }); } });
});

test('reasoning-only output gives an actionable error and truncated tool calls are never returned for execution', async () => {
  await assert.rejects(callModel({ config, messages: [], fetcher: async () => reply({ choices: [{ message: { content: '', reasoning_content: 'private reasoning' }, finish_reason: 'length' }] }) }), error => /快速回答/.test(error.message) && !error.message.includes('private reasoning'));
  await assert.rejects(callModel({ config, messages: [], fetcher: async () => reply({ choices: [{ message: { tool_calls: [{ id: 'c1', function: { name: 'propose_build', arguments: '{}' } }] }, finish_reason: 'length' }] }) }), /截断/);
});

test('provider exposes retryable HTTP status and Retry-After while redacting credentials', async () => {
  for (const status of [401, 429, 503]) await assert.rejects(callModel({ config, messages: [], fetcher: async () => new Response(JSON.stringify({ error: { message: 'fixture-secret rejected' } }), { status, headers: { 'Retry-After': '2' } }) }), error => {
    assert.equal(error.status, status); assert.equal(error.retryable, status !== 401); assert.equal(error.retryAfterMs, 2000); assert.ok(!error.message.includes('fixture-secret')); return true;
  });
});

test('runtime retries transient model requests and reports progress without replaying tools', async context => {
  let calls = 0; const phases = [];
  const agent = await fixture(context, async () => { calls++; if (calls === 1) { const error = new Error('Rate limited'); error.retryable = true; throw error; } return answer; });
  agent.on('state', state => phases.push(state.progress.phase));
  await agent.run({ mode: 'ai', message: 'Analyze' });
  assert.equal(calls, 2); assert.ok(phases.includes('retrying')); assert.equal(agent.progress.phase, 'complete'); assert.equal(agent.busy, false);
  assert.equal(agent.messages.filter(message => message.role === 'user').length, 1);
});

test('authentication errors are not retried automatically and retry uses a fresh device snapshot', async context => {
  let calls = 0;
  const agent = await fixture(context, async ({ messages }) => { if (++calls === 1) throw new Error('HTTP 401'); assert.match(messages.at(-1).content, /Analyze original/); assert.match(messages.at(-1).content, /snapshot/); return answer; });
  await assert.rejects(agent.run({ mode: 'ai', message: 'Analyze original' }), /401/);
  assert.equal(calls, 1); assert.equal(agent.state().canRetry, true);
  await agent.retry(); assert.equal(calls, 2); assert.equal(agent.state().canRetry, false);
  await assert.rejects(agent.retry(), /没有可重试/);
});

test('stop cancels retry waiting promptly without another provider request', async context => {
  let calls = 0;
  const agent = await fixture(context, async () => { calls++; const error = new Error('Service busy'); error.retryable = true; error.retryAfterMs = 30000; throw error; });
  agent.on('state', state => { if (state.progress.phase === 'retrying') agent.cancel(); });
  await assert.rejects(agent.run({ mode: 'ai' }), /停止/);
  assert.equal(calls, 1); assert.equal(agent.progress.phase, 'cancelled'); assert.equal(agent.busy, false);
});

test('a retry after tool execution preserves the tool result and never executes it twice', async context => {
  let calls = 0;
  const agent = await fixture(context, async ({ messages }) => {
    if (++calls === 1) return toolResult();
    assert.equal(messages.at(-1).role, 'tool');
    if (calls === 2) { const error = new Error('Overloaded'); error.retryable = true; throw error; }
    return answer;
  });
  await agent.run({ mode: 'ai' });
  assert.equal(calls, 3); assert.equal(agent.messages.filter(message => message.role === 'tool').length, 1);
});

test('long Retry-After returns control to the user and settings changes retain the failed task', async context => {
  let calls = 0;
  const agent = await fixture(context, async () => { if (++calls === 1) { const error = new Error('Wait 60 seconds'); error.retryable = true; error.retryAfterMs = 60000; throw error; } return answer; });
  await assert.rejects(agent.run({ mode: 'ai', message: 'Keep original task' }), /Wait/);
  assert.equal(calls, 1); await agent.configure({ thinkingMode: 'disabled' }); assert.equal(agent.state().canRetry, true);
  await agent.retry(); assert.equal(agent.lastRequest.message, 'Keep original task');
});

test('manual retry retains continuous-analysis tool restrictions', async context => {
  let calls = 0;
  const agent = await fixture(context, async ({ tools }) => { assert.deepEqual(tools.map(tool => tool.name), ['get_device_snapshot']); if (++calls === 1) throw new Error('Fixture unavailable'); return answer; });
  await assert.rejects(agent.run({ mode: 'ai', continuous: true }), /unavailable/);
  await agent.retry(); assert.equal(calls, 2); assert.equal(agent.lastRequest.continuous, true);
});

test('read-only mode limits advertised and executed tools even when a provider invents a write request', async context => {
  let calls = 0;
  const agent = await fixture(context, async ({ tools, messages }) => {
    assert.ok(!tools.some(tool => tool.name.startsWith('propose_')));
    if (++calls === 1) return toolResult('propose_build', { reason: 'Should not be allowed' });
    assert.match(messages.at(-1).content, /不允许/); return answer;
  });
  await agent.run({ mode: 'ai', agentMode: 'review' });
  assert.equal(agent.actions.size, 0); assert.equal(agent.builder.job, null);
  await assert.rejects(agent.tool('propose_build', {}, { readOnly: true }), /只读/);
});

test('three identical tool requests stop the loop before the third execution', async context => {
  let calls = 0;
  const agent = await fixture(context, async () => { calls++; return toolResult(); });
  await assert.rejects(agent.run({ mode: 'ai' }), /相同工具/);
  assert.equal(calls, 3); assert.equal(agent.messages.filter(message => message.role === 'tool').length, 2); assert.equal(agent.progress.phase, 'error');
});

test('last permitted step disables tools and requests an honest completion summary', async context => {
  let calls = 0;
  const agent = await fixture(context, async ({ tools, messages }) => { if (++calls === 1) return toolResult(); assert.deepEqual(tools, []); assert.match(messages[0].content, /Step budget reached/); return answer; });
  await agent.run({ mode: 'ai', maxSteps: 2 }); assert.equal(calls, 2); assert.equal(agent.progress.phase, 'complete'); assert.match(agent.progress.detail, /步骤上限/);
  await assert.rejects(agent.run({ mode: 'ai', maxSteps: 99 }), /上限/);
});

test('DeepSeek keeps private reasoning and complete tool turns across questions, clearing on model changes', async context => {
  let calls = 0;
  const agent = await fixture(context, async ({ messages }) => {
    if (++calls === 1) return { ...toolResult(), continuation: { reasoning_content: 'private-tool-state' } };
    if (calls === 2) { assert.equal(messages.at(-2).reasoning_content, 'private-tool-state'); return { ...answer, continuation: { reasoning_content: 'private-final-state' } }; }
    assert.ok(messages.some(message => message.reasoning_content === 'private-tool-state'));
    assert.ok(messages.some(message => message.reasoning_content === 'private-final-state')); return answer;
  });
  await agent.run({ mode: 'ai', message: 'First' }); await agent.run({ mode: 'ai', message: 'Second' });
  assert.equal(JSON.stringify(agent.state()).includes('private-tool-state'), false);
  assert.equal(JSON.stringify(agent.state()).includes('private-final-state'), false);
  await agent.configure({ model: 'another-model' }); assert.deepEqual(agent.modelTurns, []);
  await assert.rejects(agent.configure({ thinkingMode: 'invalid' }), /无效/);
  agent.clear(); assert.equal(agent.progress.phase, 'idle');
});

test('project search returns source locations and build status reports actual bounded output', async context => {
  const agent = await fixture(context, async () => answer);
  const result = await agent.tool('search_firmware', { query: 'serial.BEGIN' }, { readOnly: true });
  assert.equal(result.matches[0].path, 'main.ino'); assert.equal(result.matches[0].line, 1); assert.equal(result.scannedFiles, 1);
  await assert.rejects(agent.tool('search_firmware', { query: '' }, {}), /搜索/);
  assert.equal((await agent.tool('get_build_status', {}, { readOnly: true })).status, 'not_run');
  agent.builder.job = { status: 'failed', exitCode: 1, command: 'fixture', output: 'x'.repeat(13000) };
  const build = await agent.tool('get_build_status', {}, { readOnly: true });
  assert.equal(build.exitCode, 1); assert.equal(build.output.length, 12000); assert.equal(build.outputTruncated, true);
});
