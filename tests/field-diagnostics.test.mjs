import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { EventEmitter } from 'node:events';
import { AlarmService } from '../server/alarms.mjs';
import { IncidentStore } from '../server/incident-store.mjs';
import { tuneParameter } from '../server/device-readback.mjs';
import { SoakRuns } from '../server/soak.mjs';
import {
  bootCheck,
  buildFlashPlan,
  flashVerification,
  validateHandshake,
} from '../server/firmware-check.mjs';

const packet = (data, dir = 'RX', time = Date.now()) => ({
  dir,
  time,
  data: Buffer.from(data).toString('base64'),
  length: Buffer.byteLength(data),
});
const fixture = () => {
  const engine = Object.assign(new EventEmitter(), {
    connected: true,
    source: 'serial',
    generation: 1,
    config: { path: 'COM9' },
    names: ['CH1'],
    send: async () => {},
  });
  const item = { id: 'device-1', projectRoot: 'root', name: 'board', engine };
  const hub = Object.assign(new EventEmitter(), {
    devices: new Map([[item.id, item]]),
    activeId: item.id,
    emitState() {
      this.emit('state');
    },
  });
  return { engine, item, hub };
};
async function tmp(t) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'signaldesk-field-'));
  t.after(() => fs.rm(dir, { recursive: true, force: true, maxRetries: 5 }));
  return dir;
}

test('unplug captures last command and sample; later reconnect is persisted even after post-window closed', async (t) => {
  const dir = await tmp(t),
    { hub, engine, item } = fixture();
  const logs = { entries: [], write() {} };
  const alarms = new AlarmService(hub, logs);
  const store = new IncidentStore(dir, hub, alarms);
  t.after(() => alarms.dispose());
  alarms.configure({
    deviceId: item.id,
    rules: [
      {
        id: 'unplug',
        name: 'disconnect',
        kind: 'connection',
        enabled: true,
        channel: 0,
        holdMs: 0,
        cooldownMs: 500,
        timeoutMs: 100,
      },
    ],
  });
  engine.emit('packet', packet('GET', 'TX'));
  engine.emit('samples', [{ time: 1, values: [4.2] }]);
  engine.connected = false;
  engine.source = 'none';
  engine.emit('notice', { level: 'error' });
  engine.emit('state');
  const id = alarms.events[0].id;
  engine.emit('packet', packet('AFTER'));
  store.finish(store.open.get(id), 'complete');
  engine.connected = true;
  engine.source = 'serial';
  engine.emit('state');
  await store.dispose();
  const r = await store.get(id);
  assert.equal(Buffer.from(r.lastTx.data, 'base64').toString(), 'GET');
  assert.deepEqual(r.lastSample.values, [4.2]);
  assert.ok(r.reconnectedAt >= r.at);
  assert.ok(r.after.some((r) => r.type === 'disconnected'));
  assert.equal(r.status, 'complete');
  assert.equal(r.source, 'serial');
});
test('write/read respects ranges, ignores old packets and echo, accepts fragmented JSON and reports disagreement', async () => {
  const { engine } = fixture();
  const calls = [];
  engine.send = async ({ text }, owner) => {
    assert.equal(owner, engine.automationLock);
    calls.push(text);
    if (calls.length === 1) engine.emit('packet', packet('{"cfg":{"target":45}}\n'));
    else {
      engine.emit('packet', packet('GET\n{"cfg":'));
      engine.emit('packet', packet('{"target":44}}\n'));
    }
  };
  const options = {
    name: 'temp',
    min: 10,
    max: 60,
    value: 45,
    unit: 'C',
    writeCommand: 'SET {value}',
    readCommand: 'GET',
    field: 'cfg.target',
  };
  await assert.rejects(tuneParameter(engine, { ...options, value: 100 }), /范围/);
  const result = await tuneParameter(engine, options);
  assert.deepEqual(calls, ['SET 45', 'GET']);
  assert.equal(result.status, 'different');
  assert.equal(result.reported, 44);
  assert.equal(engine.automationLock, null);
  engine.send = async () => {};
  await assert.rejects(tuneParameter(engine, { ...options, timeout: 100 }), /超时/);
  assert.equal(engine.listenerCount('packet'), 0);
});
test('version handshake checks only new boot data and separates tool verification from reported version', async () => {
  const { hub, engine, item } = fixture(),
    plan = {
      deviceId: item.id,
      root: item.projectRoot,
      handshake: { expected: '2.0', field: 'FW=', format: 'prefix', port: 'COM9', command: 'VER?' },
    };
  engine.connected = false;
  hub.connectDevice = async () => {
    engine.connected = true;
    engine.generation++;
    engine.emit('packet', packet('FW=1.0\r\n'));
  };
  const job = { id: 'flash', evidence: {} };
  await bootCheck(hub, plan, job);
  assert.equal(job.evidence.runtime, 'different');
  assert.equal(item.runningFirmware.version, '1.0');
  assert.equal(flashVerification('stm32', 'operation done', 1, true), 'unconfirmed');
  assert.equal(flashVerification('esp32', 'Hash of data verified', 2, true), 'unconfirmed');
  assert.equal(flashVerification('avr', '32768 bytes of flash verified', 1, true), 'verified');
  assert.throws(() => validateHandshake(plan.handshake, item, 'COM8'));
});
test('project build stages exact binary bytes into the confirmed flash plan', async (t) => {
  const directory = await tmp(t),
    { hub, item } = fixture();
  item.projectRoot = directory;
  await fs.writeFile(path.join(directory, 'image.bin'), Buffer.from([1, 2, 3]));
  const now = new Date().toISOString();
  const validation = {
    prepare: async () => ({ id: 'job', fingerprint: 'source-hash' }),
    execute: async () => ({
      sessionId: 'main',
      job: {
        startedAt: now,
        finishedAt: now,
        status: 'succeeded',
        validation: { id: 'job', sourceState: 'unchanged' },
      },
    }),
  };
  let staged;
  const chips = {
    hub,
    upload: async (i) => {
      staged = i;
      return { id: 'image' };
    },
    prepare: async (input) => ({ confirmation: 'WRITE COM9', images: input.images }),
  };
  const result = await buildFlashPlan(
    validation,
    chips,
    {
      deviceId: item.id,
      root: directory,
      port: 'COM9',
      family: 'esp32',
      sources: [{ path: 'image.bin', address: '0x0' }],
      handshake: { expected: 'v1', field: 'ver', format: 'json' },
    },
    () => {},
  );
  assert.equal(result.build.fingerprint, 'source-hash');
  assert.equal(staged.data, 'AQID');
  assert.equal(result.confirmation, 'WRITE COM9');
});
test('soak holds device between repeats, measures reply timing and persists comparable version reports', async (t) => {
  const directory = await tmp(t),
    { engine } = fixture();
  const service = new SoakRuns(directory, () => ({ id: 'fault-id' })),
    scope = 'unit';
  const options = {
    mode: 'count',
    cycles: 3,
    hours: 8,
    interval: 10,
    adcChannel: 0,
    tolerance: 0,
    sequence: [
      { type: 'send', text: 'PING' },
      { type: 'expect', text: 'OK' },
    ],
  };
  engine.send = async (data, owner) => {
    assert.equal(owner, engine.automationLock);
    engine.emit('packet', packet('OK\n'));
  };
  service.start(scope, engine, { ...options, firmware: 'a' });
  await service.jobs.get(scope).done;
  let state = await service.state(scope);
  assert.equal(state.current.passed, 3);
  assert.equal(state.current.response.count, 3);
  assert.equal(engine.automationLock, null);
  engine.send = async () => {
    throw Object.assign(Error('timeout'), { code: 'REPLY_TIMEOUT' });
  };
  service.start(scope, engine, { ...options, firmware: 'b' });
  await service.jobs.get(scope).done;
  state = await new SoakRuns(directory).state(scope);
  assert.equal(state.current.status, 'failed');
  assert.equal(state.current.timeouts, 1);
  assert.equal(state.current.firstFailure.incident, 'fault-id');
  assert.equal(state.history.find((r) => r.firmware === 'a').status, 'passed');
});
