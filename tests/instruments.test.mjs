import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { WidgetSandbox } from '../server/widgets.mjs';
import { widgetTemplates } from '../shared/widget-templates.mjs';
import { analyzeCan } from '../server/can-analysis.mjs';
import { dominantFrequency, spectrumData, nearestSample } from '../src/scope-math.mjs';
import { orientation } from '../src/pose-math.mjs';
import { mixedBytes } from '../shared/mixed-payload.mjs';
import { encodePayload, crc16Modbus, StreamParser, encodeSample } from '../server/protocol.mjs';
import { BinaryParser } from '../server/frames.mjs';
import { validateConfig, SerialEngine } from '../server/engine.mjs';
import { BAUD_RATES } from '../shared/baud-rates.mjs';
import { identifyPort } from '../server/identification.mjs';
import { findPacketMatches } from '../src/terminal-search.mjs';
import { CommandQueues } from '../server/command-queue.mjs';
import { DeviceHub } from '../server/devices.mjs';
import { runCli } from '../server/external/cli.mjs';
import { startServer } from '../server/index.mjs';
import { SerialPortMock } from 'serialport';
import { inspectGlb } from '../src/model-validation.mjs';

const temp = async t => { const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'signaldesk-instruments-')); t.after(() => fs.rm(directory, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })); return directory; };
const sine = (frequency = 123.4, amplitude = 2) => Array.from({ length: 4096 }, (_, index) => ({ time: index / 2048, values: [4 + amplitude * Math.sin(2 * Math.PI * frequency * index / 2048)] }));

test('FFT dominant peak is interpolated with calibrated Hann amplitude and rejects irregular timing', () => {
  const peak = dominantFrequency(sine(), 0, 2048); assert.ok(Math.abs(peak.frequency - 123.4) < 0.03); assert.ok(Math.abs(peak.amplitude - 2) < 0.05); assert.equal(peak.resolution, 0.5);
  assert.throws(() => dominantFrequency(sine(0), 0, 2048), /交流/);
  const bad = sine(); bad[8].time += 0.01; assert.throws(() => spectrumData(bad, 0, 2048), /不均匀/);
  assert.throws(() => spectrumData(sine().slice(0, 10), 0, 2048), /64/);
  assert.equal(nearestSample(sine(), 0.01).time, 20 / 2048);
});

test('attitude uses ZYX Euler conventions and normalizes WXYZ without accepting missing axes', () => {
  const yaw = orientation([0, 0, 90], 'euler', [0, 1, 2]); assert.ok(Math.abs(yaw.z - Math.SQRT1_2) < 1e-10);
  const quaternion = orientation([2, 0, 0, 2], 'quaternion', [0, 1, 2, 3]); assert.ok(quaternion.angleTo(yaw) < 1e-7);
  assert.equal(orientation([0, 0, 0, 0], 'quaternion', [0, 1, 2, 3]), null);
  assert.equal(orientation([0], 'euler', [0, 1, 2]), null);
});

test('CAN load includes arbitration overhead, IFS, bounded stuffing, ID periods and payload', () => {
  const result = analyzeCan({ text: 'time,id,data\n0,123,0000000000000000\n0.1,123,FFFFFFFFFFFFFFFF', bitrate: 500000, duration: 1 });
  assert.equal(result.count, 2); assert.equal(result.load.lower, 222 / 5000); assert.ok(result.load.upper > result.load.lower); assert.equal(result.ids[0].meanPeriod, 0.1);
  assert.equal(result.timeline.reduce((sum, entry) => sum + entry.count, 0), 2);
  const remote = analyzeCan({ text: '(0.000000) can0 00000123#R8', format: 'candump', duration: 1 }); assert.equal(remote.load.lower, 67 / 5000); assert.equal(remote.load.payload, 0); assert.equal(remote.ids[0].extended, true);
});

test('CAN rejects FD, malformed frames, invalid bitrate, reverse clocks and insufficient observation', () => {
  assert.throws(() => analyzeCan({ format: 'candump', text: '(0.0) can0 123##10000', duration: 1 }), /CAN FD/);
  assert.throws(() => analyzeCan({ text: 'time,id,data\n1,123,00\n0,123,00' }), /单调/);
  assert.throws(() => analyzeCan({ text: 'time,id,data\n0,123,0', duration: 1 }), /数据无效/);
  assert.throws(() => analyzeCan({ text: 'time,id,data\n0,123,00' }), /观察时长/);
  assert.throws(() => analyzeCan({ text: 'time,id,data\n0,123,00', bitrate: 2000000, duration: 1 }), /CAN FD/);
});

test('QuickJS widgets execute all templates and retain only explicit serialized state', async t => {
  const sandbox = new WidgetSandbox(); t.after(() => sandbox.dispose());
  for (const [kind, template] of Object.entries(widgetTemplates)) { const result = await sandbox.run({ code: template.code, inputs: [25], settings: { color: '#abcdef', unit: 'V' } }); assert.equal(result.view.kind, kind); assert.equal(result.view.color, '#abcdef'); }
  const first = await sandbox.run({ code: widgetTemplates.chart.code, inputs: [1] }); const second = await sandbox.run({ code: widgetTemplates.chart.code, inputs: [2], state: first.state }); assert.deepEqual(second.view.series, [1, 2]);
});

test('QuickJS cannot access host APIs and interrupts infinite code then recovers', async t => {
  const sandbox = new WidgetSandbox(); t.after(() => sandbox.dispose());
  const isolated = await sandbox.run({ code: '({render(){return {kind:"number",value:[typeof process,typeof require,typeof fetch,typeof window].every(x=>x==="undefined")?1:0}}})', inputs: [] }); assert.equal(isolated.view.value, 1);
  await assert.rejects(sandbox.run({ code: '({render(){while(true){}}})', inputs: [] }), /interrupt|超时/i);
  await assert.rejects(sandbox.run({ code: '({render(){const a=[];while(true)a.push("x".repeat(100000));}})', inputs: [] }));
  assert.equal((await sandbox.run({ code: widgetTemplates.number.code, inputs: [4] })).view.value, 4);
  await assert.rejects(sandbox.run({ code: '({render(){return {kind:"html",value:1}}})', inputs: [] }), /视图/);
});

test('ASCII/HEX mixing produces exact bytes and CRC after endings, rejecting ambiguous or oversized input', () => {
  assert.equal(Buffer.from(mixedBytes('AT[HEX:00 0xFF]END')).toString('hex'), '415400ff454e44');
  assert.equal(Buffer.from(mixedBytes('[[HEX:AA]')).toString('ascii'), '[HEX:AA]');
  const bytes = encodePayload({ text: 'A[HEX:00 FF]', format: 'mixed', ending: 'crlf', checksum: 'modbus' }); assert.equal(bytes.subarray(0, -2).toString('hex'), '4100ff0d0a'); assert.equal(bytes.readUInt16LE(bytes.length - 2), crc16Modbus(bytes.subarray(0, -2)));
  for (const text of ['[HEX:A]', '[HEX:GG]', '[HEX:00', '中文', 'A'.repeat(65537)]) assert.throws(() => mixedBytes(text));
});

test('terminal search crosses packet splits within the same direction without combining RX and TX', () => {
  const packets = [{ id: 1, dir: 'RX', text: 'te', hex: '74 65' }, { id: 2, dir: 'TX', text: 'not', hex: '6E 6F 74' }, { id: 3, dir: 'RX', text: 'st test', hex: '73 74 20 74 65 73 74' }];
  const result = findPacketMatches(packets, 'TEST'); assert.deepEqual(result.hits, [[1, 3], [3]]); assert.deepEqual(result.ranges.get(1), [[0, 2]]);
  assert.equal(findPacketMatches(packets, 'tenot').hits.length, 0); assert.deepEqual(findPacketMatches(packets, '65 73', true).hits, [[1, 3], [3]]);
});

test('all baud presets plus custom baud validate but invalid rates cannot claim hardware support', () => {
  for (const baudRate of [...BAUD_RATES, 123456]) assert.equal(validateConfig({ path: 'COM9', baudRate }).baudRate, baudRate);
  for (const baudRate of [0, 49, 12000001, 9600.5, NaN]) assert.throws(() => validateConfig({ baudRate }));
  assert.match(identifyPort({ path: 'COM8', pnpId: 'BTHENUM\\DEV_1234' }).interface, /Bluetooth/);
  assert.equal(validateConfig({ transport: 'bluetooth', path: 'COM8' }).transport, 'bluetooth');
  assert.throws(() => validateConfig({ transport: 'bluetooth', path: 'demo' }), /虚拟串口/);
});

test('stream parsers retain all 20000 frames through randomized high-volume chunk boundaries', () => {
  for (const protocol of ['firewater', 'justfloat', 'json']) {
    const data = Buffer.concat(Array.from({ length: 20000 }, (_, i) => encodeSample([i, i / 4, -i, 3.25], protocol))), parser = new StreamParser(protocol);
    let offset = 0, count = 0;
    while (offset < data.length) { const length = 1 + (offset * 17 + 31) % 16384; for (const sample of parser.push(data.subarray(offset, offset + length))) { assert.deepEqual(sample.map(value => value || 0), [count, count / 4, -count || 0, 3.25]); count++; } offset += length; }
    assert.equal(count, 20000); assert.equal(parser.errors, 0); assert.equal(parser.buffer.length, 0);
  }
});

test('binary CRC diagnostics count corrupt candidates separately from resynchronization bytes', () => {
  const parser = new BinaryParser({ header: 'AA', length: 5, endian: 'LE', checksum: 'modbus', fields: [{ name: 'value', type: 'u16', offset: 1 }] });
  const good = Buffer.from([0xaa, 1, 0, 0, 0]); good.writeUInt16LE(crc16Modbus(good.subarray(0, 3)), 3); const bad = Buffer.from(good); bad[1] = 2;
  const bytes = Buffer.concat([Buffer.from([0, 1, 2]), bad, good]); const values = [];
  for (const byte of bytes) values.push(...parser.push(Buffer.from([byte])));
  assert.deepEqual(values, [[1]]); assert.equal(parser.errors, 1); assert.equal(parser.crcErrors, 1); assert.equal(parser.resyncBytes, 8); assert.equal(parser.buffer.length, 0);
});

test('command queues stay on the captured device after UI selection changes and stop between commands', async t => {
  const hub = new DeviceHub({ directory: await temp(t) }); t.after(() => hub.dispose()); await hub.connect({ path: 'demo' });
  const first = hub.activeId, second = hub.add(), engine = hub.active;
  const queues = new CommandQueues(hub, { write() {} }); t.after(() => queues.dispose());
  const command = { name: 'mixed', text: 'AT[HEX:00]', format: 'mixed', ending: 'none', checksum: 'none' };
  await queues.start({ deviceId: first, commands: [command, command, command], interval: 100 }); hub.select(second);
  await new Promise(resolve => setTimeout(resolve, 30)); queues.stop(first); await queues.dispose();
  assert.equal(queues.state(first).status, 'cancelled'); assert.equal(engine.txBytes, 3); assert.equal(hub.active.txBytes, 0); assert.equal(engine.automationLock, null);
  await assert.rejects(queues.start({ deviceId: first, commands: [command] }), /切换/);
});

test('CLI uses real HTTP scoped tools, denies serial without permission and disconnects immediately', async t => {
  const runtime = await startServer({ port: 0, autoDemo: true, directory: path.join(await temp(t), 'sessions'), listPorts: async () => [] }); t.after(() => runtime.close());
  const post = async (route, body) => (await fetch(runtime.address + '/api' + route, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })).json();
  const access = await post('/external/create', { name: 'CLI test' }), env = { SIGNALDESK_URL: runtime.address, SIGNALDESK_TOKEN: access.token };
  assert.ok(await runCli(['status'], env)); await assert.rejects(runCli(['send', 'AT'], env), /授权/);
  await post('/external/update', { id: access.connection.id, connected: false }); await assert.rejects(runCli(['tools'], env), /连接|断开/);
  await assert.rejects(runCli(['status'], { ...env, SIGNALDESK_URL: 'https://example.com' }), /local/);
});

test('quality reports separate parse failures, processing, recording and display counters', async t => {
  const engine = new SerialEngine({ directory: await temp(t) }); t.after(() => engine.dispose()); engine.receive(Buffer.from('1,2\nOK\n'));
  engine.dropped = 10; const state = engine.state(); assert.equal(state.frames, 1); assert.equal(state.parseErrors, 1); assert.equal(state.processingErrors, 0); assert.equal(state.quality.recordingErrors, 0); assert.ok(state.quality.decodeMs > 0); assert.equal(state.dropped, 10);
});

test('Bluetooth SPP uses the virtual COM transport without requiring unsupported modem control', async t => {
  class BluetoothPort extends SerialPortMock { set() { throw new Error('SPP modem controls unavailable'); } }
  SerialPortMock.binding.createPort('BT-SPP-TEST', { echo: false, record: true });
  const engine = new SerialEngine({ directory: await temp(t), Port: BluetoothPort }); t.after(() => engine.dispose());
  await engine.connect({ path: 'BT-SPP-TEST', transport: 'bluetooth' }); assert.equal(engine.connected, true);
  await engine.send({ text: 'AT[HEX:00 FF]', format: 'mixed', ending: 'none' }); assert.equal(engine.port.port.recording.toString('hex'), '415400ff');
  await assert.rejects(engine.setSignals({ dtr: true, rts: false }), /SPP/);
  await engine.disconnect(); assert.equal(engine.connected, false);
});

test('GLB import requires embedded resources and bounded mesh data', () => {
  const glb = data => { const json = Buffer.from(JSON.stringify(data)), padded = Buffer.alloc(Math.ceil(json.length / 4) * 4, 32); json.copy(padded); const bytes = Buffer.alloc(20 + padded.length); bytes.writeUInt32LE(0x46546c67, 0); bytes.writeUInt32LE(2, 4); bytes.writeUInt32LE(bytes.length, 8); bytes.writeUInt32LE(padded.length, 12); bytes.writeUInt32LE(0x4e4f534a, 16); padded.copy(bytes, 20); return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.length); };
  assert.equal(inspectGlb(glb({ asset: { version: '2.0' } })).asset.version, '2.0');
  assert.throws(() => inspectGlb(glb({ images: [{ uri: 'https://example.com/track.png' }] })), /外部/);
  assert.throws(() => inspectGlb(glb({ buffers: [{ uri: 'file:///private.bin' }] })), /外部/);
  assert.throws(() => inspectGlb(glb({ accessors: [{ count: 3000001 }] })), /300 万/);
  assert.throws(() => inspectGlb(glb({ extensionsRequired: ['KHR_draco_mesh_compression'] })), /扩展/);
});
