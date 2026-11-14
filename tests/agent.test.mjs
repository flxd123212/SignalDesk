import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { AgentService } from '../server/ai/agent.mjs';
import { FirmwareWorkspace } from '../server/ai/firmware.mjs';
import { SerialEngine } from '../server/engine.mjs';
import { callModel } from '../server/ai/provider.mjs';
import { buildPlan } from '../server/ai/build.mjs';

async function fixture(context, provider) {
  const base = path.resolve('.data', 'tests'); await fs.mkdir(base, { recursive: true });
  const root = await fs.mkdtemp(path.join(base, 'agent-'));
  await fs.writeFile(path.join(root, 'main.ino'), 'void loop() { delay(1000); }\n');
  const engine = new SerialEngine({ directory: path.join(root, 'recordings') });
  const agent = new AgentService(engine, root, { provider });
  context.after(async () => { agent.dispose(); await engine.dispose(); });
  return { root, engine, agent };
}

test('local analysis uses actual bounded samples and never calls a model', async context => {
  const { engine, agent } = await fixture(context, () => { throw new Error('Unexpected remote call'); });
  engine.receive(Buffer.from('1,2\n3,4\n'));
  await agent.run({ mode: 'local' });
  assert.match(agent.messages.at(-1).content, /均值 2.0000/);
  assert.match(agent.messages.at(-1).content, /未调用模型/);
  assert.equal(agent.busy, false);
});

test('tool loop reads code, creates a diff, and only edits when executed', async context => {
  let round = 0;
  const provider = async ({ messages }) => {
    round++;
    if (round === 1) return { content: '', toolCalls: [{ id: 'read1', name: 'read_firmware_file', arguments: JSON.stringify({ path: 'main.ino' }) }] };
    if (round === 2) {
      const file = JSON.parse(messages.at(-1).content);
      return { content: '', toolCalls: [{ id: 'write1', name: 'propose_file_change', arguments: JSON.stringify({ path: file.path, expectedHash: file.hash, content: file.content.replace('1000', '10'), reason: 'Fixture-only change for exercising review and apply.' }) }] };
    }
    return { content: '修改提案已生成，尚未写入文件。', toolCalls: [] };
  };
  const { root, agent } = await fixture(context, provider);
  await agent.configure({ model: 'fixture-model', apiStyle: 'chat', apiKey: 'test-secret-never-return' });
  await agent.run({ mode: 'ai', message: 'Create a small change proposal.' });
  assert.equal(round, 3);
  assert.equal(await fs.readFile(path.join(root, 'main.ino'), 'utf8'), 'void loop() { delay(1000); }\n');
  const action = agent.state().actions[0];
  assert.match(action.diff, /-void loop/);
  assert.equal(JSON.stringify(agent.state()).includes('test-secret-never-return'), false);
  await agent.execute(action.id);
  assert.equal(await fs.readFile(path.join(root, 'main.ino'), 'utf8'), 'void loop() { delay(10); }\n');
  const saved = agent.workspace.proposals.get(action.id);
  assert.equal(await fs.readFile(saved.backup, 'utf8'), 'void loop() { delay(1000); }\n');
  await assert.rejects(agent.execute(action.id), /失效/);
});

test('file proposals reject stale edits and paths outside the selected project', async context => {
  const { root } = await fixture(context);
  const workspace = new FirmwareWorkspace(root), file = await workspace.read('main.ino');
  const proposal = await workspace.propose({ path: file.path, expectedHash: file.hash, content: 'void loop() {}\n', reason: 'test' });
  await fs.writeFile(path.join(root, 'main.ino'), 'user edit\n');
  await assert.rejects(workspace.apply(proposal.id), /未覆盖/);
  assert.equal(await fs.readFile(path.join(root, 'main.ino'), 'utf8'), 'user edit\n');
  await assert.rejects(workspace.read('../main.ino'));
  await assert.rejects(workspace.read('.env'));
  await assert.rejects(workspace.read(path.join(root, 'main.ino')));
});

test('serial proposals do not send automatically and cannot be replayed on a changed connection', async context => {
  const { agent, engine } = await fixture(context);
  await engine.connect({ path: 'demo' });
  const first = await agent.tool('propose_serial_command', { text: 'AT', format: 'text', ending: 'crlf', checksum: 'none', reason: 'Handshake' }, {});
  assert.equal(engine.txBytes, 0);
  await agent.execute(first.id); assert.equal(engine.txBytes, 4);
  await assert.rejects(agent.execute(first.id), /失效/);
  const second = await agent.tool('propose_serial_command', { text: 'AT', format: 'text', ending: 'crlf', checksum: 'none', reason: 'Handshake' }, {});
  await engine.connect({ path: 'demo' });
  await assert.rejects(agent.execute(second.id), /连接已变化/);
  assert.equal(engine.txBytes, 0);
});

test('Responses adapter keeps tool call ids and disables server-side storage', async () => {
  let request;
  const result = await callModel({ config: { baseUrl: 'https://api.openai.com/v1', model: 'fixture-model', apiStyle: 'responses', apiKey: 'secret' }, messages: [{ role: 'system', content: 'system' }, { role: 'user', content: 'user' }], tools: [{ name: 'snapshot', parameters: { type: 'object', properties: {}, additionalProperties: false, required: [] } }], fetcher: async (url, options) => { request = { url, ...options }; return new Response(JSON.stringify({ output: [{ type: 'function_call', call_id: 'call-7', name: 'snapshot', arguments: '{}' }] }), { status: 200 }); } });
  const body = JSON.parse(request.body);
  assert.equal(request.url, 'https://api.openai.com/v1/responses');
  assert.equal(body.store, false); assert.equal(body.tools[0].strict, true);
  assert.equal(result.toolCalls[0].id, 'call-7');
});

test('Chat Completions adapter sends standard tool messages and redacts key errors', async () => {
  const config = { baseUrl: 'http://127.0.0.1:11434/v1', model: 'fixture-model', apiStyle: 'chat', apiKey: 'test-key' };
  let request;
  const result = await callModel({ config, messages: [{ role: 'user', content: 'hello' }], fetcher: async (url, options) => { request = { url, ...options }; return new Response(JSON.stringify({ choices: [{ message: { content: 'answer' } }] }), { status: 200 }); } });
  assert.equal(result.content, 'answer'); assert.match(request.url, /chat\/completions$/);
  assert.equal(JSON.parse(request.body).max_tokens, 2400);
  await assert.rejects(callModel({ config, messages: [], fetcher: async () => new Response(JSON.stringify({ error: { message: 'invalid test-key' } }), { status: 401 }) }), error => error.message.includes('[redacted]') && !error.message.includes('test-key'));
});

test('build plans only expose fixed compile commands, never upload or arbitrary shell', () => {
  assert.deepEqual(buildPlan({ buildPreset: 'platformio' }, 'project').args, ['run']);
  assert.deepEqual(buildPlan({ buildPreset: 'cmake' }, 'project').args, ['--build', 'build']);
  assert.throws(() => buildPlan({ buildPreset: 'shell', command: 'anything' }, 'project'));
  assert.throws(() => buildPlan({ buildPreset: 'arduino', fqbn: 'esp32; anything' }, 'project'));
  assert.equal(buildPlan({ buildPreset: 'arduino', fqbn: 'esp32:esp32:esp32' }, 'project').args[0], 'compile');
});

test('provider settings protect keys across hosts and connection tests are cancellable', async context => {
  const { agent } = await fixture(context, async ({ signal }) => new Promise((resolve, reject) => signal.addEventListener('abort', () => reject(new Error('stopped')), { once: true })));
  await agent.configure({ apiKey: 'old-secret', model: 'fixture' });
  await agent.configure({ baseUrl: 'https://api.deepseek.com', apiStyle: 'chat' }); assert.equal(agent.config.apiKey, '');
  await agent.configure({ apiKey: 'new-secret', maxOutputTokens: 8192, timeoutSeconds: 120 });
  await agent.configure({ apiStyle: 'responses' }); assert.equal(agent.config.apiKey, 'new-secret');
  await assert.rejects(agent.configure({ apiStyle: 'gemini' }), /Chat Completions/);
  await assert.rejects(agent.configure({ timeoutSeconds: 0 }), /整数/);
  const pending = agent.testConnection(); assert.equal(agent.busy, true); agent.cancel(); await assert.rejects(pending, /停止/); assert.equal(agent.busy, false);
  assert.equal(JSON.stringify(agent.publicConfig()).includes('new-secret'), false);
});
