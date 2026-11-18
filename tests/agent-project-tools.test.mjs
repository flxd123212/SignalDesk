import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { AgentService } from '../server/ai/agent.mjs';
import { SerialEngine } from '../server/engine.mjs';
import { AGENT_TOOLS, READ_ONLY_TOOLS } from '../server/ai/tools.mjs';

async function fixture(t) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'signaldesk-tools-'));
  await fs.writeFile(path.join(root, 'main.c'), 'int value = 1;\r\nint main(void) { return value; }\r\n');
  const engine = new SerialEngine({ directory: path.join(root, 'sessions') }), agent = new AgentService(engine, root, { historyDirectory: path.join(root, 'changes') });
  t.after(async () => { agent.dispose(); await engine.dispose(); await fs.rm(root, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 }); });
  return { root, engine, agent };
}

test('new project tools find files, return line ranges and reject escapes and excessive reads', async t => {
  const { agent } = await fixture(t);
  const overview = await agent.tool('get_project_overview', {}, {}); assert.equal(overview.fileCount, 1); assert.equal(overview.buildExecuted, false);
  assert.equal((await agent.tool('find_firmware_files', { query: 'MAIN.C' }, {})).files[0].path, 'main.c');
  const range = await agent.tool('read_firmware_lines', { path: 'main.c', startLine: 2, endLine: 2 }, {});
  assert.equal(range.lines[0].line, 2); assert.equal(range.partial, true); assert.match(range.hash, /^[\da-f]{64}$/);
  await assert.rejects(agent.tool('read_firmware_lines', { path: '../secret.c', startLine: 1, endLine: 2 }, {}), /之外/);
  await assert.rejects(agent.tool('read_firmware_lines', { path: 'main.c', startLine: 1, endLine: 201 }, {}), /200/);
  assert.equal((await agent.tool('get_build_diagnostics', {}, {})).status, 'not_run');
  agent.builder.job = { status: 'failed', exitCode: 1, output: 'main.c:2:4: error: missing identifier', diagnostics: undefined };
  assert.equal((await agent.tool('get_build_diagnostics', {}, {})).diagnostics[0].line, 2);
});

test('surgical patch proposals require unique text, hash and confirmation, preserve CRLF and expose change history', async t => {
  const { agent } = await fixture(t); const original = await agent.workspace.read('main.c');
  const args = { path: original.path, expectedHash: original.hash, oldText: 'int value = 1;', newText: 'int value = 2;', reason: 'fixture edit' };
  await assert.rejects(agent.tool('propose_source_patch', args, { readOnly: true }), /只读/);
  await assert.rejects(agent.tool('propose_source_patch', { ...args, oldText: 'int' }, {}), /不唯一/);
  await assert.rejects(agent.tool('propose_source_patch', { ...args, expectedHash: 'bad' }, {}), /已经变化/);
  const proposal = await agent.tool('propose_source_patch', args, {});
  assert.equal(proposal.status, 'pending_user_action'); assert.equal((await agent.workspace.read('main.c')).content, original.content);
  await agent.execute(proposal.id); assert.equal((await agent.workspace.read('main.c')).content, original.content.replace('= 1;', '= 2;'));
  const history = await agent.tool('get_recent_changes', {}, {}); assert.equal(history.changes[0].status, 'applied');
  const detail = await agent.tool('get_change_detail', { id: proposal.id }, {}); assert.match(detail.diff, /\+int value = 2;/);
  await assert.rejects(agent.tool('get_change_detail', { id: '../../bad' }, {}), /无效/);
});

test('serial packet access requires log opt-in and plan updates enforce bounded valid steps', async t => {
  const { agent, engine } = await fixture(t);
  engine.recentPackets = [{ time: 123, dir: 'RX', data: Buffer.from('TEMP:42').toString('base64') }, { time: 124, dir: 'TX', data: Buffer.from('SET:1').toString('base64') }];
  await assert.rejects(agent.tool('get_serial_logs', { query: 'temp', direction: 'rx' }, {}), /附带原始日志/);
  assert.equal((await agent.tool('get_serial_logs', { query: 'temp', direction: 'rx' }, { includeLogs: true })).packets[0].text, 'TEMP:42');
  assert.equal(engine.txBytes, 0);
  const steps = [{ title: 'Inspect source', status: 'in_progress' }, { title: 'Propose fix', status: 'pending' }];
  await agent.tool('update_task_plan', { steps }, { readOnly: true }); assert.deepEqual(agent.state().taskPlan, steps);
  await assert.rejects(agent.tool('update_task_plan', { steps: steps.map(step => ({ ...step, status: 'in_progress' })) }, {}), /只能有一个/);
  agent.clear(); assert.deepEqual(agent.state().taskPlan, []);
  assert.equal(AGENT_TOOLS.length, 19); assert.ok(READ_ONLY_TOOLS.has('inspect_development_environment')); assert.equal(READ_ONLY_TOOLS.has('propose_source_patch'), false);
});

test('tool activity exposes bounded results, file links and elapsed time without credentials', async t => {
  const { agent } = await fixture(t); await agent.configure({ apiStyle: 'chat', model: 'fixture', apiKey: 'activity-secret' });
  let calls = 0; const statuses = [];
  agent.provider = async ({ tools }) => {
    assert.ok(!tools.some(tool => tool.name === 'get_serial_logs'));
    return ++calls === 1 ? { content: '', toolCalls: [{ id: 'lines', name: 'read_firmware_lines', arguments: JSON.stringify({ path: 'main.c', startLine: 1, endLine: 2 }) }] } : { content: 'done', toolCalls: [] };
  };
  agent.on('state', state => { const event = state.messages.find(message => message.tool)?.tool; if (event) statuses.push(event.status); });
  await agent.run({ mode: 'ai', message: 'Inspect code' });
  assert.ok(statuses.includes('running')); assert.ok(statuses.includes('completed'));
  const event = agent.state().messages.find(message => message.tool).tool;
  assert.equal(event.locations[0].path, 'main.c'); assert.ok(event.durationMs >= 0); assert.match(event.output, /int value/);
  assert.ok(!JSON.stringify(agent.state()).includes('activity-secret'));
});
