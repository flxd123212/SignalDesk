import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { randomBytes, createCipheriv, createDecipheriv } from 'node:crypto';
import { DeviceHub } from '../server/devices.mjs';
import { WorkspaceStore } from '../server/workspace.mjs';
import { AgentRegistry } from '../server/ai/registry.mjs';
import { AgentStore } from '../server/ai/storage.mjs';
import { startServer } from '../server/index.mjs';

function encryption() {
  const key = randomBytes(32);
  return {
    async encrypt(text) { const iv = randomBytes(12), cipher = createCipheriv('aes-256-gcm', key, iv); const data = Buffer.concat([cipher.update(text, 'utf8'), cipher.final()]); return Buffer.concat([iv, cipher.getAuthTag(), data]); },
    async decrypt(bytes) { const decipher = createDecipheriv('aes-256-gcm', key, bytes.subarray(0, 12)); decipher.setAuthTag(bytes.subarray(12, 28)); return Buffer.concat([decipher.update(bytes.subarray(28)), decipher.final()]).toString('utf8'); },
  };
}
async function fixture(t, encrypted = true) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'signaldesk-agent-save-')), codec = encrypted ? encryption() : null;
  await fs.writeFile(path.join(root, 'main.c'), 'int main(void) { return 0; }\n');
  const filename = path.join(root, 'agent-state.json'); let current;
  const stop = async () => { if (current) { await current.registry.shutdown(); current.workspace.save(); await current.workspace.queue; await current.hub.dispose(); current = null; } };
  const start = async () => {
    await stop();
    const hub = new DeviceHub({ directory: path.join(root, 'sessions') });
    const workspace = new WorkspaceStore(path.join(root, 'devices.json'), hub); await workspace.load();
    const registry = new AgentRegistry(hub, root, path.join(root, 'changes')); await registry.restore(filename, codec);
    current = { hub, registry, workspace }; return current;
  };
  t.after(async () => { await stop(); await fs.rm(root, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 }); });
  return { root, filename, codec, start, stop };
}
const config = { baseUrl: 'https://example.test/v1', apiStyle: 'chat', model: 'saved-model', apiKey: 'saved-secret-fixture', thinkingMode: 'enabled', reasoningEffort: 'high', maxOutputTokens: 16384, timeoutSeconds: 180 };
const answer = { content: 'Persisted coding advice', toolCalls: [], continuation: { reasoning_content: 'private-continuation-fixture' } };

test('encrypted restart restores keys, multiple sessions and complete tools without repeating execution', async t => {
  const f = await fixture(t); let { registry, hub } = await f.start();
  await registry.configure(config); const primary = registry.active.id;
  let calls = 0;
  registry.active.agent.provider = async () => ++calls === 1 ? { content: '', continuation: { reasoning_content: 'private-tool-reasoning' }, toolCalls: [{ id: 'read-1', name: 'read_firmware_file', arguments: '{"path":"main.c"}' }] } : answer;
  await registry.run({ mode: 'ai', message: 'Review the source and retain context' });
  const originalTurn = structuredClone(registry.active.agent.modelTurns);
  registry.create({ name: 'Second task' }); registry.message('user', 'A separate conversation');
  const secondary = registry.active.id;
  registry.select(primary);
  await registry.tool('update_task_plan', { steps: [{ title: 'Inspect code', status: 'completed' }, { title: 'Apply reviewed change', status: 'pending' }] }, {});
  const file = await registry.workspace.read('main.c');
  await registry.workspace.propose({ path: file.path, expectedHash: file.hash, content: file.content.replace('0', '1'), reason: 'fixture' });
  registry.active.agent.busy = true; registry.changed();
  ({ registry, hub } = await f.start());
  assert.equal(registry.active.id, primary); assert.equal(registry.config.apiKey, config.apiKey);
  assert.equal(registry.config.maxOutputTokens, 16384); assert.equal(registry.config.reasoningEffort, 'high');
  assert.equal(registry.state().sessions.length, 2); assert.equal(registry.busy, false); assert.equal(registry.continuous, null);
  assert.equal(registry.state().actions.length, 0); assert.equal(registry.builder.child, null); assert.equal(hub.connected, false);
  assert.deepEqual(registry.active.agent.modelTurns, originalTurn);
  assert.equal(registry.state().taskPlan[1].title, 'Apply reviewed change');
  assert.match(registry.messages.at(-1).content, /需要重新生成/);
  assert.equal((await registry.workspace.history()).length, 1);
  let observed;
  registry.active.agent.provider = async options => { observed = options.messages; return answer; };
  await registry.run({ mode: 'ai', message: 'Continue improving the previous code' });
  assert.ok(observed.some(message => message.role === 'tool' && message.tool_call_id === 'read-1'));
  assert.ok(observed.some(message => message.reasoning_content === 'private-tool-reasoning'));
  assert.ok(observed.some(message => message.content?.includes('Review the source')));
  registry.select(secondary); assert.equal(registry.messages[0].content, 'A separate conversation'); assert.equal(registry.state().context.turns, 0);
  await registry.flush();
  const disk = await fs.readFile(f.filename, 'utf8');
  for (const text of [config.apiKey, 'private-continuation-fixture', 'A separate conversation']) assert.ok(!disk.includes(text));
  assert.ok(!JSON.stringify(registry.state()).includes(config.apiKey));
});

test('stable device identifiers and selected sessions survive removed devices and restart', async t => {
  const f = await fixture(t); let { registry, hub } = await f.start();
  const removed = hub.activeId, second = hub.add('second'); hub.select(second);
  await registry.configure({ ...config, model: 'device-two' }); registry.message('user', 'second device only');
  const third = hub.add('third'); hub.select(third); await registry.configure({ ...config, model: 'device-three', apiKey: 'third-secret' });
  registry.message('user', 'third device only'); const session = registry.active.id;
  await hub.remove(removed);
  ({ registry, hub } = await f.start());
  assert.equal(hub.activeId, third); assert.equal(registry.active.id, session); assert.equal(registry.config.apiKey, 'third-secret');
  assert.equal(registry.messages[0].content, 'third device only');
  hub.select(second); assert.equal(registry.config.model, 'device-two'); assert.equal(registry.messages[0].content, 'second device only');
  assert.equal(hub.add('fourth'), 'device-4');
});

test('key removal, cleared conversations, context reset and closed sessions persist', async t => {
  const f = await fixture(t); let { registry } = await f.start();
  await registry.configure(config); registry.active.agent.provider = async () => answer;
  await registry.run({ mode: 'ai', message: 'First question' }); registry.resetContext();
  ({ registry } = await f.start()); assert.equal(registry.state().context.turns, 0); assert.ok(registry.messages.length > 0);
  const extra = registry.create({ name: 'Temporary' }); registry.closeSession(extra); registry.clear();
  await registry.configure({ clearKey: true });
  ({ registry } = await f.start());
  assert.equal(registry.config.apiKey, ''); assert.equal(registry.messages.length, 0); assert.equal(registry.state().sessions.length, 1);
  const saved = JSON.parse(await fs.readFile(f.filename, 'utf8'));
  assert.ok(!(await f.codec.decrypt(Buffer.from(saved.payload, 'base64'))).includes(config.apiKey));
});

test('standalone service preserves settings and text history but never keys or native reasoning', async t => {
  const f = await fixture(t, false); let { registry } = await f.start(); await registry.configure(config);
  registry.active.agent.provider = async () => answer; await registry.run({ mode: 'ai', message: 'Continue this text-only discussion' });
  registry.message('tool', `Sensitive fixture ${config.apiKey}`);
  ({ registry } = await f.start());
  assert.equal(registry.config.model, config.model); assert.equal(registry.config.apiKey, '');
  assert.ok(registry.messages.some(message => message.content.includes('Persisted coding advice')));
  assert.equal(registry.state().context.turns, 1);
  const disk = await fs.readFile(f.filename, 'utf8'); assert.ok(!disk.includes(config.apiKey)); assert.ok(!disk.includes('private-continuation-fixture'));
  assert.ok(!JSON.stringify(registry.active.agent.modelTurns).includes('reasoning_content'));
});

test('broken or undecryptable stores remain untouched and expose a recovery error', async t => {
  const f = await fixture(t); let { registry } = await f.start(); await registry.configure(config); await f.stop();
  const before = await fs.readFile(f.filename);
  const bad = new AgentStore(f.filename, encryption()); assert.equal(await bad.load(), null);
  bad.schedule(() => ({ version: 1, sessions: [] })); await assert.rejects(bad.flush(), /原文件已保留/);
  assert.deepEqual(await fs.readFile(f.filename), before);
  await fs.writeFile(f.filename, '{broken');
  ({ registry } = await f.start()); assert.equal(registry.state().config.storage.state, 'error');
  await f.stop(); assert.equal(await fs.readFile(f.filename, 'utf8'), '{broken');
});

test('write failures are visible, retries recover and rapid changes save the final state', async t => {
  const f = await fixture(t); const blocker = path.join(f.root, 'blocker'); await fs.writeFile(blocker, 'file');
  const store = new AgentStore(path.join(blocker, 'state.json'));
  store.schedule(() => ({ version: 1, sessions: [] })); await assert.rejects(store.flush(), /保存失败/);
  assert.equal(store.status.state, 'error'); await fs.unlink(blocker);
  for (let i = 0; i < 50; i++) store.schedule(() => ({ version: 1, sessions: [], final: i }));
  await store.flush(); assert.equal(JSON.parse(await fs.readFile(store.filename, 'utf8')).data.final, 49); assert.equal(store.status.state, 'saved');
});

test('external transcripts survive as read-only sessions without recreating an authorization', async t => {
  const f = await fixture(t); let { registry } = await f.start();
  const id = registry.create({ name: 'External review', external: true }); registry.message('assistant', 'External advice', 'external');
  ({ registry } = await f.start());
  assert.equal(registry.active.id, id); assert.equal(registry.active.readOnly, true); assert.equal(registry.messages[0].content, 'External advice');
  await assert.rejects(registry.execute('any'), /没有执行权限/);
});

test('HTTP server restart restores AI settings and local conversations with no hardware reconnect', async t => {
  const f = await fixture(t); let runtime;
  t.after(() => runtime?.close());
  const start = async () => runtime = await startServer({ port: 0, directory: path.join(f.root, 'http', 'sessions'), listPorts: async () => [], agentEncryption: f.codec });
  const call = async (route, body) => { const response = await fetch(runtime.address + '/api' + route, body === undefined ? {} : { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }); const data = await response.json(); assert.ok(response.ok, JSON.stringify(data)); return data; };
  await start(); await call('/ai/config', config); await call('/ai/run', { mode: 'local', message: 'Persistent local inspection' });
  const previous = await call('/ai/state'); await runtime.close(); await start();
  const restored = await call('/ai/state');
  assert.equal(restored.sessionId, previous.sessionId); assert.equal(restored.config.hasApiKey, true);
  assert.deepEqual(restored.messages, previous.messages); assert.equal((await call('/state')).connected, false);
  await call('/ai/config', { clearKey: true }); await runtime.close(); await start();
  assert.equal((await call('/ai/state')).config.hasApiKey, false);
});
