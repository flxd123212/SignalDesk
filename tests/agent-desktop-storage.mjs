import { _electron as electron } from 'playwright';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import http from 'node:http';

const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'signaldesk-secure-restart-'));
const environment = { ...process.env, SIGNALDESK_USER_DATA: directory };
delete environment.ELECTRON_RUN_AS_NODE; delete environment.SIGNALDESK_AI_API_KEY;
const requests = [], secret = 'desktop-persistence-fixture-key';
const model = http.createServer((request, response) => {
  let body = ''; request.on('data', chunk => body += chunk);
  request.on('end', () => {
    requests.push({ body: JSON.parse(body), authenticated: request.headers.authorization === `Bearer ${secret}` });
    const message = requests.length === 1
      ? { reasoning_content: 'private-native-continuation', tool_calls: [{ id: 'fixture-list', type: 'function', function: { name: 'list_firmware_files', arguments: '{}' } }] }
      : { content: '已记录源码检查结果，可以继续处理上一轮的代码。', reasoning_content: 'private-native-continuation' };
    response.setHeader('Content-Type', 'application/json');
    response.end(JSON.stringify({ model: 'restart-fixture', choices: [{ message, finish_reason: message.tool_calls ? 'tool_calls' : 'stop' }] }));
  });
});
await new Promise(resolve => model.listen(0, '127.0.0.1', resolve));
const executablePath = path.resolve(process.env.SIGNALDESK_TEST_EXE || 'node_modules/electron/dist/electron.exe');
let desktop, window;
const launch = async () => {
  desktop = await electron.launch({ executablePath, args: process.env.SIGNALDESK_TEST_EXE ? [] : ['.'], cwd: process.cwd(), env: environment, timeout: 60000 });
  window = await desktop.firstWindow(); await window.locator('.app-shell').waitFor();
};
const call = async (route, body) => {
  const response = await fetch(new URL(window.url()).origin + '/api' + route, body === undefined ? {} : { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  const data = await response.json(); assert.ok(response.ok, data.error || String(response.status)); return data;
};
const closeWindow = async () => {
  const closed = desktop.waitForEvent('close'); await window.close(); await closed; desktop = null;
};
try {
  await launch();
  const saved = await call('/ai/config', { baseUrl: `http://127.0.0.1:${model.address().port}/v1`, model: 'restart-fixture', apiStyle: 'chat', apiKey: secret });
  assert.equal(saved.storage.mode, 'encrypted'); assert.equal(saved.storage.state, 'saved');
  const first = await call('/ai/run', { mode: 'ai', message: '检查源码并记录本次修改方向' });
  assert.equal(first.context.turns, 1); const primary = first.sessionId;
  const second = await call('/ai/sessions/create', { name: '第二个项目任务' });
  await call('/ai/run', { mode: 'local', message: '另一段需要恢复的会话' }); await call('/ai/sessions/select', { id: primary });
  await closeWindow();
  const raw = await fs.readFile(path.join(directory, 'agent-state.json'), 'utf8');
  assert.equal(JSON.parse(raw).mode, 'encrypted'); assert.ok(!raw.includes(secret)); assert.ok(!raw.includes('private-native-continuation'));
  await launch();
  const restored = await call('/ai/state');
  assert.equal(restored.sessionId, primary, JSON.stringify({ storage: restored.config.storage, sessions: restored.sessions, root: restored.config.root })); assert.equal(restored.config.hasApiKey, true); assert.equal(restored.context.turns, 1);
  assert.deepEqual(restored.messages, first.messages); assert.equal(restored.sessions.length, 2); assert.equal(restored.busy, false);
  assert.equal((await call('/state')).connected, false);
  await call('/ai/run', { mode: 'ai', message: '沿用上次的检查继续修改建议' });
  assert.ok(requests.every(request => request.authenticated));
  assert.ok(requests.at(-1).body.messages.some(message => message.role === 'tool' && message.tool_call_id === 'fixture-list'));
  assert.ok(requests.at(-1).body.messages.some(message => message.reasoning_content === 'private-native-continuation'));
  await call('/ai/sessions/select', { id: second.sessionId });
  assert.ok((await call('/ai/state')).messages.some(message => message.content === '另一段需要恢复的会话'));
  await call('/ai/sessions/select', { id: primary });
  await window.getByRole('button', { name: 'AI 与 Agent', exact: true }).click();
  await window.getByLabel('Agent 会话', { exact: true }).waitFor();
  await window.waitForFunction(() => document.querySelector('[aria-label="会话保存状态"]')?.textContent?.includes('已保存'));
  await window.screenshot({ path: path.resolve('artifacts/agent-restored-desktop.png') });
  await window.getByRole('button', { name: 'AI 接口设置', exact: true }).click();
  await window.getByText('密钥与会话在本机加密保存，重启后恢复', { exact: true }).waitFor();
  await window.screenshot({ path: path.resolve('artifacts/agent-encrypted-settings.png') });
  await call('/ai/config', { clearKey: true }); await call('/ai/clear', {});
  await closeWindow(); await launch();
  const cleared = await call('/ai/state'); assert.equal(cleared.config.hasApiKey, false); assert.equal(cleared.messages.length, 0); assert.equal(cleared.context.turns, 0);
  assert.equal(cleared.sessions.length, 2);
  console.log('Desktop restart passed: OS encryption, API credentials, multi-session history, native tool context, last-window shutdown flush, cleared key and conversation, offline restart.');
} finally {
  await desktop?.close(); model.closeAllConnections(); await new Promise(resolve => model.close(resolve));
  await fs.rm(directory, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
}
