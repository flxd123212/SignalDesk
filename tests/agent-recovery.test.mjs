import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { AgentService } from '../server/ai/agent.mjs';
import { SerialEngine } from '../server/engine.mjs';
import { callModel } from '../server/ai/provider.mjs';
import { canonicalToolCall, completeCheckpoint, normalizeMemory, resumeRequest } from '../server/ai/context.mjs';

const answer = { content: 'Checked evidence; no writes or hardware tests performed.', toolCalls: [] };
const call = (id, name, args = {}) => ({ id, name, arguments: JSON.stringify(args) });
async function fixture(t, provider) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'signaldesk-recovery-'));
  await fs.writeFile(path.join(root, 'main.c'), 'int main(void) { return 0; }\n');
  const engine = new SerialEngine({ directory: path.join(root, 'recordings') }), agent = new AgentService(engine, root, { provider });
  t.after(async () => { agent.dispose(); await engine.dispose(); await fs.rm(root, { recursive: true, force: true }); });
  await agent.configure({ baseUrl: 'https://example.test/v1', apiStyle: 'chat', model: 'fixture-model' });
  return agent;
}

test('provider interruption retains tool evidence and read-only policy on manual continuation', async t => {
  let count = 0;
  const agent = await fixture(t, async ({ messages, tools }) => {
    count++;
    if (count === 1) return { content: '', toolCalls: [call('read-1', 'read_firmware_file', { path: 'main.c' })] };
    if (count === 2) throw new Error('fixture disconnect');
    assert.ok(tools.length); assert.ok(messages.some(message => message.role === 'tool' && message.tool_call_id === 'read-1'));
    assert.match(messages.at(-1).content, /原任务：Review timing/); return answer;
  });
  await assert.rejects(agent.run({ mode: 'ai', message: 'Review timing', maxSteps: 2, agentMode: 'review' }), /disconnect/);
  assert.equal(count, 2); assert.equal(agent.state().progress.phase, 'error'); assert.equal(agent.state().canResume, true);
  await agent.resume({ maxSteps: 4, agentMode: 'propose' });
  assert.equal(agent.lastRequest.agentMode, 'review'); assert.equal(count, 3); assert.equal(agent.state().canResume, false);
  assert.equal(agent.progress.phase, 'complete'); assert.equal(agent.engine.txBytes, 0);
  assert.equal((await agent.workspace.read('main.c')).content, 'int main(void) { return 0; }\n');
});

test('unfinished plan never appears as overall completion and resume does not enable raw log access', async t => {
  let count = 0;
  const agent = await fixture(t, async ({ tools }) => {
    assert.ok(!tools.some(tool => tool.name === 'get_serial_logs'));
    if (++count === 1) return { content: '', toolCalls: [call('plan', 'update_task_plan', { steps: [{ title: 'Check pins', status: 'pending' }] })] };
    return answer;
  });
  await agent.run({ mode: 'ai', message: 'Check board' });
  assert.equal(agent.progress.phase, 'paused'); assert.equal(agent.progress.reason, 'plan_pending');
  await agent.resume({ includeLogs: true, agentMode: 'review' }); assert.equal(agent.lastRequest.includeLogs, false);
  agent.resetContext(); assert.equal(agent.state().canResume, false); assert.deepEqual(agent.contextMemory, []);
  await assert.rejects(agent.resume(), /没有可继续/);
});

test('provider errors retain completed tool pairs for continuation, including private protocol state only in native history', async t => {
  let count = 0;
  const agent = await fixture(t, async ({ messages }) => {
    count++;
    if (count === 1) return { content: '', continuation: { reasoning_content: 'private-fixture' }, toolCalls: [call('read', 'read_firmware_file', { path: 'main.c' })] };
    if (count === 2) throw new Error('Fixture transport failure');
    assert.ok(messages.some(message => message.role === 'tool' && message.tool_call_id === 'read'));
    assert.ok(messages.some(message => message.reasoning_content === 'private-fixture')); return answer;
  });
  await assert.rejects(agent.run({ mode: 'ai', message: 'Review current source' }), /transport/);
  assert.equal(agent.state().canResume, true); assert.ok(!JSON.stringify(agent.state()).includes('private-fixture'));
  await agent.resume(); assert.equal(count, 3); assert.equal(agent.messages.filter(message => message.tool?.name === 'read_firmware_file').length, 1);
});

test('incomplete tool batches are not replayed as orphan calls after cancellation', async t => {
  let count = 0;
  const agent = await fixture(t, async () => ({ content: '', toolCalls: ++count === 1 ? [call('first', 'list_firmware_files')]
    : [call('second', 'list_firmware_files'), call('third', 'get_project_overview')] }));
  const tool = agent.tool.bind(agent);
  agent.tool = async (...args) => { const result = await tool(...args); if (count === 2) agent.cancel(); return result; };
  await assert.rejects(agent.run({ mode: 'ai' }), /停止/);
  assert.ok(agent.modelTurns[0].some(message => message.tool_call_id === 'first'));
  assert.ok(agent.modelTurns[0].some(message => message.tool_call_id === 'second'));
  assert.match(agent.modelTurns[0].find(message => message.tool_call_id === 'third').content, /unverified_after_interrupt/);
});

test('paused requests and bounded attributed handoff excerpts survive restore without automatically running', async t => {
  const agent = await fixture(t, async () => answer);
  for (let i = 0; i < 10; i++) await agent.run({ mode: 'ai', message: `Task ${i}` });
  assert.equal(agent.modelTurns.length, 8); assert.equal(agent.contextMemory[0].request, 'Task 0');
  assert.ok(!JSON.stringify(agent.contextMemory).includes('Observed context')); assert.ok(!JSON.stringify(agent.contextMemory).includes('snapshot'));
  agent.taskPlan = [{ title: 'Check pending source', status: 'pending' }];
  await agent.run({ mode: 'ai', message: 'Resume this after restart', agentMode: 'review' });
  const saved = agent.savedState(true), restored = await fixture(t, async () => { throw new Error('Must not run during restore'); });
  await restored.restoreState(saved, true);
  assert.equal(restored.busy, false); assert.equal(restored.state().canResume, true); assert.equal(restored.progress.phase, 'paused');
  assert.deepEqual(restored.contextMemory, agent.contextMemory);
  let received;
  restored.provider = async options => { received = options.messages; return answer; };
  await restored.resume(); assert.ok(received.some(message => message.content?.includes('Historical handoff excerpts')));
  await restored.configure({ model: 'new-model' }); assert.deepEqual(restored.contextMemory, []); assert.equal(restored.state().canResume, false);
});

test('legacy sessions with unfinished plans recover into read-only continuation rather than remaining stuck', async t => {
  const agent = await fixture(t, async () => answer);
  const saved = { config: { ...agent.config }, messages: [{ id: 'old-user', role: 'user', kind: 'ai', content: 'Review serial timing', time: new Date().toISOString() }],
    taskPlan: [{ title: 'Check loop', status: 'in_progress' }], modelTurns: [], interrupted: false };
  await agent.restoreState(saved, true);
  assert.equal(agent.state().canResume, true); assert.equal(agent.resumeRequest.agentMode, 'review');
  await agent.resume({ agentMode: 'propose' }); assert.equal(agent.lastRequest.agentMode, 'review');
  agent.resetContext();
  await agent.restoreState(agent.savedState(true), true); assert.equal(agent.state().canResume, false);
  agent.lastRequest = { message: 'Interrupted review', mode: 'ai', selectedFile: '', includeLogs: false, continuous: false, agentMode: 'review', maxSteps: 8 };
  agent.busy = true; const interrupted = agent.savedState(true); agent.busy = false;
  await agent.restoreState(interrupted, true); assert.equal(agent.busy, false); assert.equal(agent.state().canResume, true);
});

test('memory normalization, checkpoints, canonical tool arguments and resume parameters are bounded and defensive', () => {
  assert.equal(canonicalToolCall('read', { z: { b: 1, a: 2 }, a: [1, 2] }), canonicalToolCall('read', { a: [1, 2], z: { a: 2, b: 1 } }));
  const memory = normalizeMemory(Array.from({ length: 50 }, () => ({ request: 'u'.repeat(5000), conclusion: 'a'.repeat(5000), tools: ['read_firmware_file', '<bad>'], reasoning_content: 'private' })));
  assert.ok(JSON.stringify(memory).length <= 12000); assert.ok(!JSON.stringify(memory).includes('private')); assert.ok(!JSON.stringify(memory).includes('<bad>'));
  assert.equal(resumeRequest({ mode: 'local', message: 'bad' }), null);
  const checkpoint = completeCheckpoint([{ role: 'user', content: 'read' }, { role: 'assistant', tool_calls: [{ id: 'missing' }] }]);
  assert.equal(checkpoint.at(-1).tool_call_id, 'missing'); assert.match(checkpoint.at(-1).content, /unverified_after_interrupt/);
});

test('DSML in prose is rejected without interpreting it as executable tools; quoted examples remain text', async () => {
  const config = { baseUrl: 'https://api.deepseek.com', apiStyle: 'chat', model: 'deepseek-flash' };
  for (const content of ['<｜DSML｜function_calls><｜DSML｜invoke name="propose_build">', '</｜DSML｜calls>', '<|DSML|invoke name="read_firmware_file">']) {
    await assert.rejects(callModel({ config, messages: [], fetcher: async () => new Response(JSON.stringify({ choices: [{ message: { content }, finish_reason: 'stop' }] })) }), /DSML.*未执行/);
  }
  const content = 'Example:\n```text\n<｜DSML｜calls>\n```';
  const result = await callModel({ config, messages: [], fetcher: async () => new Response(JSON.stringify({ choices: [{ message: { content }, finish_reason: 'stop' }] })) });
  assert.equal(result.content, content);
});
