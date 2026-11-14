import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { prepareExamples } from '../desktop/resources.cjs';
import { startServer } from '../server/index.mjs';

test('desktop example provisioning preserves user modifications and adds missing templates', async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'signaldesk-resources-'));
  try {
    const source = path.join(directory, 'templates'), data = path.join(directory, 'data');
    await fs.mkdir(source); await fs.writeFile(path.join(source, 'probe.c'), 'original');
    const dest = await prepareExamples(source, data);
    await fs.writeFile(path.join(dest, 'probe.c'), 'user edited'); await fs.writeFile(path.join(source, 'new.c'), 'new template');
    await prepareExamples(source, data);
    assert.equal(await fs.readFile(path.join(dest, 'probe.c'), 'utf8'), 'user edited');
    assert.equal(await fs.readFile(path.join(dest, 'new.c'), 'utf8'), 'new template');
  } finally { await fs.rm(directory, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }); }
});

test('settings cannot accidentally change another device or session after a switch', async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'signaldesk-settings-'));
  const runtime = await startServer({ port: 0, autoDemo: false, directory: path.join(directory, 'sessions'), listPorts: async () => [] });
  const call = (route, body) => fetch(runtime.address + '/api' + route, body ? { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) } : {});
  try {
    const state = await (await call('/ai/state')).json();
    assert.equal((await call('/ai/config', { deviceId: state.deviceId, sessionId: 'stale', model: 'must-not-save' })).status, 400);
    assert.equal((await call('/ai/config', { deviceId: 'other-device', sessionId: state.sessionId, model: 'must-not-save' })).status, 400);
    assert.equal((await call('/ai/config', { deviceId: state.deviceId, sessionId: state.sessionId, expectedRoot: 'wrong-root', model: 'must-not-save' })).status, 400);
    assert.equal((await (await call('/ai/state')).json()).config.model, state.config.model);
  } finally { await runtime.close(); await fs.rm(directory, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }); }
});
