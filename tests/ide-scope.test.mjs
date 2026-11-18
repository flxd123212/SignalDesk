import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import net from 'node:net';
import { once } from 'node:events';
import { startServer } from '../server/index.mjs';

async function fixture(t) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'signaldesk-ide-scope-'));
  const runtime = await startServer({ port: 0, autoDemo: false, directory: path.join(directory, 'sessions'), listPorts: async () => [] });
  t.after(async () => { await runtime.close(); await fs.rm(directory, { recursive: true, force: true, maxRetries: 5 }); });
  async function call(route, body) {
    const res = await fetch(`${runtime.address}/api${route}`, body === undefined ? undefined : { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    const value = await res.json();
    if (!res.ok) throw new Error(value.error);
    return value;
  }
  return { call, directory, runtime };
}

test('workbench shutdown releases a browser preconnection with no HTTP request', { timeout: 5000 }, async t => {
  const { runtime } = await fixture(t);
  const socket = net.connect(Number(new URL(runtime.address).port), '127.0.0.1');
  try {
    await once(socket, 'connect');
    const closed = once(socket, 'close');
    await runtime.close(); await closed;
  } finally { socket.destroy(); }
});

test('device tests, recording and transport controls reject stale window targets', async t => {
  const { call } = await fixture(t);
  const a = (await call('/state')).activeDevice;
  const run = deviceId => call('/automation/start', { deviceId, steps: [{ type: 'wait', ms: 30000 }] });
  await call('/connect', { deviceId: a, path: 'demo' });
  const first = await run(a);
  assert.equal(first.source, 'demo'); assert.equal(first.deviceId, a);
  const b = (await call('/devices/add', { name: 'Second' })).activeDevice;
  assert.notEqual(b, a);
  assert.equal(await call(`/automation?deviceId=${b}`), null);
  await call('/connect', { deviceId: b, path: 'demo' });
  const second = await run(b);
  for (const route of ['/signals', '/record/start', '/record/stop', '/replay/load', '/replay/control', '/automation/start', '/automation/stop']) {
    await assert.rejects(call(route, { deviceId: a }), /当前设备已切换/);
  }
  await assert.rejects(call('/automation/stop', { deviceId: b, jobId: first.id }), /测试任务已变化/);
  assert.equal((await call('/automation')).id, second.id);
  await call('/automation/stop', { deviceId: b, jobId: second.id });
  await call('/devices/select', { id: a });
  assert.equal((await call('/automation')).status, 'running');
  await call('/automation/stop', { deviceId: a, jobId: first.id });
  const recording = await call('/record/start', { deviceId: a });
  await assert.rejects(call('/record/stop', { deviceId: a, recordingId: 'old' }), /录制任务已变化/);
  assert.equal((await call('/record/stop', { deviceId: a, recordingId: recording.id })).id, recording.id);
});

test('project search skips oversized files, shows the matched text and checks project scope', async t => {
  const { call, directory } = await fixture(t);
  const root = path.join(directory, 'code'); await fs.mkdir(root);
  await fs.writeFile(path.join(root, 'a.c'), 'x'.repeat(2 * 1024 * 1024 + 1));
  await fs.writeFile(path.join(root, 'z.c'), `// data\n${' '.repeat(400)}return ADC_READY;\n`);
  const deviceId = (await call('/state')).activeDevice;
  await call('/ai/config', { deviceId, root });
  const report = await call('/project/search', { deviceId, root, query: 'adc_ready' });
  assert.equal(report.scannedFiles, 1); assert.equal(report.skippedFiles, 1); assert.equal(report.truncated, true);
  assert.equal(report.matches.length, 1); assert.equal(report.matches[0].path, 'z.c'); assert.equal(report.matches[0].line, 2);
  assert.match(report.matches[0].text, /ADC_READY/);
  await assert.rejects(call('/project/search', { deviceId, root: directory, query: 'adc' }), /工程已变化/);
});
