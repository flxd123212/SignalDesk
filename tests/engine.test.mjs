import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { once } from 'node:events';
import { SerialPortMock } from 'serialport';
import { SerialEngine, validateConfig } from '../server/engine.mjs';
import { parseSession } from '../server/sessions.mjs';

async function setup(context) {
  const base = path.resolve('.data', 'tests'); await fs.mkdir(base, { recursive: true });
  const directory = await fs.mkdtemp(path.join(base, 'session-'));
  const engine = new SerialEngine({ directory, Port: SerialPortMock });
  context.after(() => engine.dispose()); return engine;
}

test('serial mock exercises open, binary write, fragmented receive, DTR/RTS and close', async context => {
  const engine = await setup(context);
  SerialPortMock.binding.createPort('TEST-UART', { echo: false, record: true });
  await engine.connect({ path: 'TEST-UART' });
  assert.equal(engine.source, 'serial');
  await engine.setSignals({ dtr: true, rts: false });
  await engine.send({ text: '01 03 00 00 00 02', format: 'hex', checksum: 'modbus' });
  assert.equal(engine.port.port.recording.toString('hex'), '010300000002c40b');
  const received = once(engine, 'samples');
  engine.port.port.emitData(Buffer.from('1.2,'));
  engine.port.port.emitData(Buffer.from('2.3,3.4\n'));
  assert.deepEqual((await received)[0][0].values, [1.2, 2.3, 3.4]);
  assert.equal(engine.txBytes, 8);
  await engine.disconnect(); assert.equal(engine.connected, false);
  await assert.rejects(engine.send({ text: 'AT' }), /先连接/);
});

test('recording preserves raw bytes and replay reproduces the numeric frames', async context => {
  const engine = await setup(context);
  SerialPortMock.binding.createPort('RECORD-UART', { echo: false, record: true });
  await engine.connect({ path: 'RECORD-UART', sampleRate: 100 });
  const id = await engine.startRecording();
  engine.receive(Buffer.from('1,2\n3,')); engine.receive(Buffer.from('4\n'));
  await engine.send({ text: 'AT', ending: 'crlf' });
  await engine.store.stop();
  const recorded = await engine.store.load(id);
  assert.equal(recorded.packets.length, 3);
  assert.equal(recorded.packets[2].dir, 'TX');
  assert.equal(Buffer.from(recorded.packets[0].data, 'base64').toString(), '1,2\n3,');
  await engine.loadReplay(id);
  assert.equal(engine.connected, false); assert.equal(engine.source, 'replay');
  const samples = []; engine.on('samples', batch => samples.push(...batch));
  engine.controlReplay({ action: 'play', speed: 4 });
  await new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error('Replay did not finish')), 1500);
    engine.on('state', state => { if (state.replay && !state.replay.playing && state.frames === 2) { clearTimeout(timeout); resolve(); } });
  });
  assert.deepEqual(samples.map(sample => sample.values), [[1, 2], [3, 4]]);
  assert.equal(engine.config.sampleRate, 100);
});

test('disconnect cancels timed sending and invalid settings do not open a device', async context => {
  const engine = await setup(context);
  SerialPortMock.binding.createPort('TIMER-UART', { echo: false, record: true });
  await engine.connect({ path: 'TIMER-UART' });
  await engine.startTimedSend({ text: 'AT' }, 20);
  await engine.disconnect();
  assert.equal(engine.sendInterval, null);
  assert.throws(() => validateConfig({ baudRate: -1 }));
  assert.throws(() => validateConfig({ sampleRate: 0 }));
  assert.throws(() => validateConfig({ protocol: 'unknown' }));
  assert.throws(() => validateConfig({ path: 'demo', sampleRate: 2001 }));
});

test('a disconnect during recorder startup closes the pending file', async context => {
  const engine = await setup(context);
  await engine.connect({ path: 'demo' });
  const recording = engine.startRecording();
  const assertion = assert.rejects(recording, /已断开/);
  await engine.disconnect(); await assertion;
  assert.equal(engine.store.recording, null);
  assert.equal(engine.store.pendingStart, null);
});

test('recording import rejects invalid timestamps and malformed base64', () => {
  const header = JSON.stringify({ kind: 'signaldesk', version: 1, config: {} });
  assert.throws(() => parseSession(`${header}\n{"time":-1,"dir":"RX","data":"YQ=="}`));
  assert.throws(() => parseSession(`${header}\n{"time":1,"dir":"RX","data":"!"}`));
  assert.throws(() => parseSession(`${header}\n{"time":2,"dir":"RX","data":"YQ=="}\n{"time":1,"dir":"RX","data":"YQ=="}`));
});
