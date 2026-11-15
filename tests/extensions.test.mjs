import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import net from 'node:net';
import { EventEmitter } from 'node:events';
import { DeviceHub } from '../server/devices.mjs';
import { SerialEngine } from '../server/engine.mjs';
import { crc16Modbus, encodePayload } from '../server/protocol.mjs';
import { BinaryParser, inspectFrame, inspectModbus, validateSchema } from '../server/frames.mjs';
import { TestRunner, validateTest } from '../server/automation.mjs';
import { flashPlan, ChipService } from '../server/chips.mjs';
import { AgentRegistry } from '../server/ai/registry.mjs';
import { FirmwareWorkspace } from '../server/ai/firmware.mjs';
import { commandPlan } from '../server/ai/build.mjs';
import { EventLog } from '../server/logs.mjs';
import { TriggerCapture } from '../src/trigger.mjs';
import { startServer } from '../server/index.mjs';

const temporary = async t => { const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'signaldesk-ext-')); t.after(() => fs.rm(directory, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 })); return directory; };
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
const schema = { header: 'AA 55', length: 8, endian: 'LE', checksum: 'modbus', fields: [{ name: 'voltage', offset: 2, type: 'u16', scale: .001 }, { name: 'current', offset: 4, type: 'i16', scale: .001 }] };
const binary = () => encodePayload({ text: 'AA 55 E8 03 9C FF', format: 'hex', checksum: 'modbus' });

test('GB18030 and UTF16 encoding produce exact serial bytes', () => {
  assert.equal(encodePayload({ text: '中文', encoding: 'gb18030', ending: 'none' }).toString('hex'), 'd6d0cec4');
  assert.equal(encodePayload({ text: 'A', encoding: 'utf16le', ending: 'lf' }).toString('hex'), '41000a00');
  assert.throws(() => encodePayload({ text: 'A', encoding: 'unsupported' }));
});

test('custom binary frames handle every split, checksums and resynchronization', () => {
  const frame = binary();
  for (let index = 0; index < frame.length; index++) {
    const parser = new BinaryParser(schema);
    assert.deepEqual([...parser.push(frame.subarray(0, index)), ...parser.push(frame.subarray(index))], [[1, -.1]]);
  }
  const parser = new BinaryParser(schema), bad = Buffer.from(frame); bad[7] ^= 1;
  assert.deepEqual(parser.push(Buffer.concat([Buffer.from([9, 2]), bad, frame])), [[1, -.1]]);
  assert.equal(parser.errors, 1);
  assert.equal(inspectFrame(bad, validateSchema(schema)).valid, false);
  assert.throws(() => validateSchema({ ...schema, fields: [{ name: 'x', offset: 7, type: 'f32' }] }), /越界/);
});

test('Modbus inspection validates CRC, byte count, registers and exception frames', () => {
  const frame = encodePayload({ text: '01 03 04 FF FF 00 02', format: 'hex', checksum: 'modbus' });
  const result = inspectModbus(frame.toString('hex'));
  assert.equal(result.valid, true); assert.equal(result.registers[0].signed, -1); assert.equal(result.registers[1].unsigned, 2);
  frame[2] = 6; assert.equal(inspectModbus(frame.toString('hex')).valid, false);
  const exception = encodePayload({ text: '01 83 02', format: 'hex', checksum: 'modbus' });
  assert.equal(inspectModbus(exception.toString('hex')).exception, 2);
});

test('multiple device engines keep counters, histories and selection separate', async t => {
  const directory = await temporary(t), hub = new DeviceHub({ directory }); t.after(() => hub.dispose());
  const first = hub.activeId; await hub.connect({ path: 'demo' });
  const second = hub.add('STM32'); hub.select(second); await hub.connect({ path: 'demo' });
  await hub.send({ text: '*IDN?', ending: 'lf' }); await delay(50);
  assert.equal(hub.txBytes, 6); assert.equal(hub.state().devices.length, 2);
  hub.select(first); assert.equal(hub.txBytes, 0); assert.ok(hub.history.length > 0);
  const before = hub.generation; hub.select(second); assert.notEqual(before, hub.generation);
  assert.equal(hub.txBytes, 6); await hub.remove(second); assert.equal(hub.activeId, first);
});

test('TCP transport exchanges SCPI and numeric samples through a local instrument server', async t => {
  const directory = await temporary(t), sockets = new Set();
  const server = net.createServer(socket => { sockets.add(socket); socket.on('close', () => sockets.delete(socket)); socket.on('data', data => { if (data.toString().trim() === '*IDN?') socket.write('ACME,DMM,123,1.0\n1.2,3.4\n'); }); });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(async () => { for (const socket of sockets) socket.destroy(); await new Promise(resolve => server.close(resolve)); });
  const engine = new SerialEngine({ directory }); t.after(() => engine.dispose());
  await engine.connect({ path: `tcp://127.0.0.1:${server.address().port}`, protocol: 'firewater' });
  await engine.send({ text: '*IDN?', ending: 'lf' }); await delay(40);
  assert.equal(engine.source, 'tcp'); assert.deepEqual(engine.latest, [1.2, 3.4]);
  assert.ok(engine.recentPackets.some(packet => Buffer.from(packet.data, 'base64').toString().includes('ACME')));
});

test('automatic tests capture synchronous replies, assert samples and lock manual sends', async t => {
  const directory = await temporary(t), engine = new SerialEngine({ directory }); t.after(() => engine.dispose());
  await engine.connect({ path: 'demo' }); const runner = new TestRunner();
  await runner.start(engine, { steps: [{ type: 'send', text: '*IDN?', ending: 'lf' }, { type: 'expect', contains: 'SIMULATOR', timeout: 500 }, { type: 'wait', ms: 50 }, { type: 'assert', channel: 0, min: 0, max: 4 }] });
  await assert.rejects(engine.send({ text: 'AT' }), /自动测试/);
  await runner.completion; assert.equal(runner.job.status, 'passed'); assert.equal(engine.automationLock, null);
  await runner.start(engine, { steps: [{ type: 'expect', contains: 'NEVER', timeout: 500 }] });
  runner.stop(); await runner.completion; assert.equal(runner.job.status, 'cancelled');
  assert.throws(() => validateTest({ steps: [{ type: 'exec', command: 'cmd' }] }));
});

test('single trigger captures an edge and holds the completed window', () => {
  const trigger = new TriggerCapture({ channel: 0, level: .5, edge: 'rising', mode: 'single', span: 1 });
  const samples = Array.from({ length: 30 }, (_, index) => ({ time: index / 10, values: [index < 5 ? 0 : 1] }));
  assert.equal(trigger.push(samples.slice(0, 10)), null);
  const captured = trigger.push(samples); assert.ok(captured.length >= 10); assert.equal(trigger.status, 'captured');
  assert.strictEqual(trigger.push([...samples, { time: 4, values: [0] }]), captured);
});

test('flash plans reject overlap, wrong formats, arbitrary ports and out-of-range STM32 addresses', () => {
  const image = { path: 'firmware.bin', bytes: 4096, extension: '.bin', address: '0x10000' };
  const config = { family: 'esp32', chip: 'esp32s3', port: 'COM3', baudRate: 115200 };
  assert.ok(flashPlan(config, [image]).args.includes('write_flash'));
  assert.equal(flashPlan(config, [image]).confirmation, 'WRITE COM3');
  assert.throws(() => flashPlan(config, [image, image]), /重叠/);
  assert.throws(() => flashPlan({ ...config, port: '--evil' }, [image]));
  assert.throws(() => flashPlan({ family: 'stm32', interface: 'SWD' }, [image]), /Flash/);
  assert.ok(flashPlan({ family: 'stm32', interface: 'SWD' }, [{ ...image, address: '0x08000000' }]).args.includes('-v'));
});

test('firmware library hashes bytes and requires a target-bound confirmation before invoking a mocked tool', async t => {
  const directory = await temporary(t), hub = new DeviceHub({ directory }); t.after(() => hub.dispose());
  let calls = 0;
  const service = new ChipService(path.join(directory, 'firmware'), hub, { spawnProcess: () => { calls++; const child = new EventEmitter(); child.stdout = new EventEmitter(); child.stderr = new EventEmitter(); setTimeout(() => child.emit('close', 0), 10); return child; } });
  const executable = path.join(directory, process.platform === 'win32' ? 'esptool.exe' : 'esptool'); await fs.writeFile(executable, 'MOCK', { mode: 0o755 });
  const image = await service.upload({ name: 'app.bin', data: Buffer.from([1, 2, 3]).toString('base64'), version: 'test' });
  assert.equal((await service.list()).length, 1);
  const plan = await service.prepare({ family: 'esp32', chip: 'esp32', port: 'COM3', baudRate: 115200, executable, images: [{ id: image.id, address: '0x10000' }] });
  await assert.rejects(service.execute({ id: plan.id, confirmation: 'WRITE COM4' })); assert.equal(calls, 0);
  await service.execute({ id: plan.id, confirmation: 'WRITE COM3' }); assert.equal(calls, 1); assert.ok(hub.reserved.has('com3'));
  await delay(25); assert.equal(service.job.status, 'succeeded'); assert.equal(hub.reserved.size, 0);
  await assert.rejects(service.execute({ id: plan.id, confirmation: 'WRITE COM3' }));
});

test('toolchain command lines use parsed argv and reject flashing, installation and unknown programs', () => {
  assert.deepEqual(commandPlan('platformio run -e "esp32 debug"', 'ROOT').args, ['run', '-e', 'esp32 debug']);
  assert.equal(commandPlan('cmake --build build', 'ROOT').cwd, 'ROOT');
  assert.throws(() => commandPlan('platformio run -t upload', 'ROOT'));
  assert.throws(() => commandPlan('arduino-cli core install esp32:esp32', 'ROOT'));
  assert.throws(() => commandPlan('powershell Get-Process', 'ROOT'));
});

test('device projects and multiple Agent sessions stay isolated; subagents cannot write or send', async t => {
  const directory = await temporary(t); await fs.writeFile(path.join(directory, 'main.c'), 'int main(void) { return 0; }\n');
  const hub = new DeviceHub({ directory: path.join(directory, 'sessions') }); t.after(() => hub.dispose());
  const registry = new AgentRegistry(hub, directory, path.join(directory, 'changes')); t.after(() => registry.dispose());
  await hub.connect({ path: 'demo' }); const firstSession = registry.state().sessionId, firstDevice = hub.activeId;
  await registry.run({ mode: 'local' }); registry.create({ name: 'second' }); assert.equal(registry.state().messages.length, 0);
  registry.select(firstSession); assert.ok(registry.state().messages.length);
  const second = hub.add(); hub.select(second); assert.equal(registry.state().messages.length, 0); assert.notEqual(registry.state().sessionId, firstSession);
  hub.select(firstDevice); assert.equal(registry.state().sessionId, firstSession);
  await registry.delegate({ task: 'read only checks', mode: 'local' }); await registry.delegation;
  const child = [...registry.sessions.values()].find(entry => entry.parent);
  await assert.rejects(child.agent.tool('propose_serial_command', { text: 'AT' }, {}), /读取权限/);
  assert.equal(child.agent.messages.filter(message => message.role === 'assistant').length, 1);
});

test('before/after code, line hunks and modification history survive a new workspace instance', async t => {
  const directory = await temporary(t), history = path.join(directory, 'history'); await fs.writeFile(path.join(directory, 'main.c'), 'int value = 1;\n');
  const workspace = new FirmwareWorkspace(directory, history), file = await workspace.read('main.c');
  const proposal = await workspace.propose({ path: 'main.c', expectedHash: file.hash, content: 'int value = 2;\n', reason: 'test change' });
  assert.equal(proposal.hunks[0].oldStart, 1); assert.match(proposal.beforeContent, /= 1/);
  await workspace.apply(proposal.id);
  const reopened = new FirmwareWorkspace(directory, history), stored = await reopened.change(proposal.id);
  assert.equal(stored.status, 'applied'); assert.match(stored.content, /= 2/); assert.equal((await reopened.history()).length, 1);
  assert.match(await fs.readFile(stored.backup, 'utf8'), /= 1/);
});

test('audit logs redact keys, persist and export device-filtered records', async t => {
  const directory = await temporary(t), logs = new EventLog(directory); await logs.init(); logs.secrets.add('private-secret');
  logs.write({ level: 'error', category: 'agent', device: 'd1', message: 'private-secret failed', data: { apiKey: 'raw-key', count: 2 } });
  logs.write({ device: 'd2', message: 'other device' }); await logs.queue;
  const exported = await logs.export({ device: 'd1' }); assert.doesNotMatch(exported, /private-secret|raw-key|other device/); assert.match(exported, /REDACTED/);
  const reopened = new EventLog(directory); await reopened.init(); assert.equal(reopened.list({ level: 'error' }).entries.length, 1);
});

test('HTTP API exposes multi-device, schemas, Agent sessions and exportable errors', async t => {
  const directory = await temporary(t), server = await startServer({ port: 0, autoDemo: true, directory: path.join(directory, 'sessions') }); t.after(() => server.close());
  const request = async (url, body) => { const response = await fetch(server.address + '/api' + url, body === undefined ? undefined : { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }); return { status: response.status, data: await response.json() }; };
  const initial = (await request('/state')).data; assert.equal(initial.devices.length, 1);
  assert.equal((await request('/frames/validate', { schema })).status, 200);
  const added = (await request('/devices/add', {})).data; assert.equal(added.devices.length, 2);
  const wrongTarget = await request('/timer', { deviceId: initial.activeDevice, active: true, interval: 1000, payload: { text: 'AT', format: 'text', ending: 'crlf' } });
  assert.equal(wrongTarget.status, 400); assert.match(wrongTarget.data.error, /设备已切换/);
  assert.equal((await request('/state')).data.timedSend, null);
  await request('/ai/sessions/create', { name: 'test' }); assert.equal((await request('/ai/state')).data.sessions.length, 2);
  await request('/devices/select', { id: initial.activeDevice }); assert.equal((await request('/ai/state')).data.sessions.length, 1);
  assert.equal((await request('/send', { text: 'bad hex', format: 'hex' })).status, 400);
  assert.ok((await request('/logs?level=error')).data.entries.length >= 1);
});
