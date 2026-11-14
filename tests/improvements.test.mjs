import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { identifyPort, portKey, matchBinding, PortDiscovery, inspectProject, identifyBootLog } from '../server/identification.mjs';
import { DeviceHub } from '../server/devices.mjs';
import { WorkspaceStore } from '../server/workspace.mjs';
import { AlarmMonitor, AlarmService, validateAlarmRules } from '../server/alarms.mjs';
import { EventLog } from '../server/logs.mjs';
import { compileGraph } from '../server/processing.mjs';
import { graphTest } from '../server/testing.mjs';
import { nodeKinds } from '../shared/nodes.mjs';
import { chipCatalog } from '../server/catalog.mjs';
import { flashPlan } from '../server/chips.mjs';
import { ExternalAccess } from '../server/external/access.mjs';
import { AgentRegistry } from '../server/ai/registry.mjs';
import { startServer } from '../server/index.mjs';

const temporary = async t => { const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'signaldesk-improved-')); t.after(() => fs.rm(directory, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })); return directory; };
const usb = { path: 'COM7', vendorId: '10C4', productId: 'EA60', serialNumber: 'board-001' };
const rule = patch => ({ id: 'test-rule', name: 'Voltage', kind: 'range', enabled: true, channel: 0, min: 0, max: 3.3, delta: 1, holdMs: 100, cooldownMs: 500, timeoutMs: 1000, ...patch });
const samples = values => values.map(value => ({ time: 0, values: [value] }));
const chain = (kind, data = {}) => ({ nodes: [{ id: 'source', data: { kind: 'source' } }, { id: 'node', data: { kind, ...data } }, { id: 'out', data: { kind: 'display', label: 'Sensor', unit: 'V' } }], edges: [...Array.from({ length: nodeKinds[kind].inputs }, (_, index) => ({ source: 'source', sourceHandle: `ch${index + 1}`, target: 'node', targetHandle: ['a', 'b', 'c'][index] })), { source: 'node', sourceHandle: 'out', target: 'out', targetHandle: 'a' }] });

test('USB recognizer distinguishes UART adapters, debug probes, families and board descriptor hints', () => {
  assert.equal(identifyPort(usb).chip, ''); assert.match(identifyPort(usb).interface, /CP210/);
  assert.equal(identifyPort({ vendorId: '1a86', productId: '7523' }).family, '');
  assert.equal(identifyPort({ vendorId: '0483', productId: '374b', manufacturer: 'STMicroelectronics' }).chip, '');
  assert.equal(identifyPort({ vendorId: '303a', productId: '1001' }).chip, '');
  assert.equal(identifyPort({ vendorId: '303a', productId: '1001', friendlyName: 'ESP32-S3' }).chip, 'ESP32-S3');
  const arduino = identifyPort({ vendorId: '2341', productId: '0043' }); assert.equal(arduino.board, 'Arduino Uno R3'); assert.equal(arduino.confidence, 'descriptor');
});

test('stable bindings survive COM changes, refuse duplicate identity and never auto-open a port', async t => {
  const directory = await temporary(t), hub = new DeviceHub({ directory }); t.after(() => hub.dispose());
  let ports = [{ ...usb }]; const discovery = new PortDiscovery(hub, async () => ports), id = hub.activeId;
  await discovery.bind(id, { path: 'COM7', autoMatch: true });
  ports = [{ ...usb, path: 'COM19' }]; await discovery.scan(); assert.equal(hub.config.path, 'COM19'); assert.equal(hub.connected, false);
  assert.equal(matchBinding(hub.devices.get(id).portBinding, ports).status, 'matched');
  const store = new WorkspaceStore(path.join(directory, 'devices.json'), hub); store.save(); await store.queue;
  const restored = new DeviceHub({ directory }); t.after(() => restored.dispose()); await new WorkspaceStore(store.filename, restored).load(); assert.equal(restored.devices.get(restored.activeId).portBinding.key, portKey(usb));
  ports.push({ ...usb, path: 'COM20' }); assert.equal(matchBinding(hub.devices.get(id).portBinding, ports).status, 'ambiguous');
  await assert.rejects(discovery.checkConnection(id, { path: 'COM19' }), /身份/);
  await assert.rejects(discovery.bind(id, { path: 'COM20', autoMatch: true }), /唯一绑定/);
});

test('serial-less adapters require fixed-port confirmation and bindings cannot claim another device', async t => {
  const directory = await temporary(t), hub = new DeviceHub({ directory }); t.after(() => hub.dispose());
  const ports = [{ ...usb, serialNumber: '' }], discovery = new PortDiscovery(hub, async () => ports);
  await assert.rejects(discovery.bind(hub.activeId, { path: 'COM7', autoMatch: true }), /序列号/);
  await discovery.bind(hub.activeId, { path: 'COM7', autoMatch: false });
  const second = hub.add(); await assert.rejects(discovery.bind(second, { path: 'COM7' }), /其他/);
  assert.equal(matchBinding(hub.devices.get(hub.activeId).portBinding, [{ ...ports[0], path: 'COM8' }]).status, 'missing');
});

test('project and passive boot-log identification retain evidence without sending probes', async t => {
  const directory = await temporary(t);
  await fs.writeFile(path.join(directory, 'demo.uvprojx'), '<Project><Targets><Target><TargetName>Debug</TargetName><TargetOption><TargetCommonOption><Device>STM32F407VG</Device></TargetCommonOption></TargetOption></Target></Targets></Project>');
  const report = await inspectProject(directory); assert.equal(report.candidates[0].chip, 'STM32F407VG'); assert.equal(report.candidates[0].confidence, 'configured');
  const packets = [{ dir: 'RX', data: Buffer.from('ESP-ROM:esp32s').toString('base64') }, { dir: 'RX', data: Buffer.from('3-20210327\r\n').toString('base64') }];
  assert.equal(identifyBootLog(packets)[0].chip, 'ESP32S3'); assert.equal(identifyBootLog([{ dir: 'TX', text: 'ESP-ROM:esp32s3-123' }]).length, 0);
});

test('catalog distinguishes supported download adapters; new ESP8266 and AVR plans use fixed arguments', () => {
  assert.equal(chipCatalog.length, 18); assert.ok(chipCatalog.reduce((count, item) => count + item.chips.length, 0) > 100);
  const image = { extension: '.bin', address: '0x0', bytes: 256, path: 'D:\\firmware\\app.bin' };
  const esp = flashPlan({ family: 'esp8266', chip: 'ESP8285', port: 'COM7', baudRate: 115200 }, [image]); assert.equal(esp.args[1], 'esp8266');
  const avr = flashPlan({ family: 'avr', chip: 'ATmega328P', programmer: 'arduino', port: 'COM7', baudRate: 115200 }, [{ ...image, extension: '.hex' }]); assert.equal(avr.command, 'avrdude'); assert.ok(avr.args.includes('m328p')); assert.ok(!avr.args.includes('-F'));
  assert.throws(() => flashPlan({ family: 'avr', chip: 'ATmega328P', programmer: 'anything', port: 'COM7', baudRate: 115200 }, [image]));
  assert.throws(() => flashPlan({ family: 'stc' }, [image]), /外部下载器/);
});

test('sensor and arithmetic nodes execute correct units and bounded window operations', () => {
  assert.deepEqual(compileGraph(chain('adc')).run([4095]), [3.3]);
  assert.deepEqual(compileGraph(chain('linear', { value: 2, offset: -1 })).run([10]), [19]);
  assert.deepEqual(compileGraph(chain('magnitude')).run([3, 4, 12]), [13]);
  assert.deepEqual(compileGraph(chain('clamp', { value: 0, max: 3 })).run([5]), [3]);
  assert.deepEqual(compileGraph(chain('celsius')).run([25]), [77]);
  assert.deepEqual(compileGraph(chain('subtract')).run([3, 2]), [1]);
  const division = compileGraph(chain('divide')); assert.deepEqual(division.run([3, 2]), [1.5]); assert.deepEqual(division.latestInputs.node, [3, 2]); assert.deepEqual(division.latestInputs.source, [3, 2]);
  assert.deepEqual(compileGraph(chain('multiply')).run([3, 2]), [6]);
  assert.throws(() => compileGraph(chain('divide')).run([3, 0]), /无效/);
  const average = compileGraph(chain('average', { value: 2 })); assert.deepEqual(average.run([2]), [2]); assert.deepEqual(average.run([4]), [3]); assert.deepEqual(average.run([8]), [6]);
  const rms = compileGraph(chain('rms', { value: 2 })); rms.run([3]); assert.deepEqual(rms.run([4]), [Math.sqrt(12.5)]);
  assert.throws(() => compileGraph(chain('average', { value: 129 })), /窗口/);
});

test('synthetic nodes and generated test code share the validated graph and do not touch hardware', () => {
  const result = graphTest({ graph: chain('sequence', { sequence: '20, 20, 40, 20' }), sampleRate: 10, duration: 1 });
  assert.equal(result.samples.length, 10); assert.deepEqual(result.samples.slice(0, 4).map(sample => sample.values[0]), [20, 20, 40, 20]);
  assert.match(result.code, /Serial.begin\(115200\)/); assert.match(result.code, /seq_v1\[sample_index % 4u\]/);
  assert.match(graphTest({ graph: chain('sine'), format: 'c' }).code, /int signaldesk_next/);
  for (const [kind, definition] of Object.entries(nodeKinds).filter(([kind]) => !['source', 'display', 'output'].includes(kind))) {
    const result = graphTest({ graph: chain(kind, definition), raw: [2, 4, 8], format: 'c' }); assert.equal(result.samples.length, 200, kind); assert.ok(!/undefined|NaN/.test(result.code), kind);
  }
  assert.throws(() => graphTest({ graph: chain('sine', { frequency: 50 }), sampleRate: 100 }), /一半/);
  assert.throws(() => graphTest({ graph: chain('sequence', { sequence: '1, nope' }) }), /序列/);
  assert.throws(() => graphTest({ graph: chain('constant'), sampleRate: 1000, duration: 10 }), /4000/);
});

test('range alarms debounce, recover and suppress repeated notifications until a new excursion', () => {
  let time = 0; const events = [], monitor = new AlarmMonitor([rule({})], event => events.push(event), () => time);
  monitor.samples(samples([4])); time = 99; monitor.samples(samples([4])); assert.equal(events.length, 0);
  time = 100; monitor.samples(samples([4])); assert.equal(events.length, 1);
  time = 10000; monitor.samples(samples([4])); assert.equal(events.length, 1);
  monitor.samples(samples([2])); assert.equal(events[1].kind, 'recovered');
  time = 10100; monitor.samples(samples([5])); time = 10200; monitor.samples(samples([5])); assert.equal(events.length, 3);
});

test('jump, missing data and disconnect alarms are independent and can be disabled', () => {
  let time = 0; const events = [], monitor = new AlarmMonitor([rule({ id: 'jump', kind: 'jump' }), rule({ id: 'stale', kind: 'stale', holdMs: 0 }), rule({ id: 'connection', kind: 'connection' })], event => events.push(event), () => time);
  monitor.samples(samples([1, 3])); assert.equal(events[0].kind, 'jump');
  time = 999; monitor.tick(); assert.equal(events.length, 1); time = 1000; monitor.tick(); assert.equal(events[1].kind, 'stale');
  monitor.disconnected(); assert.equal(events[2].kind, 'connection'); monitor.reset();
  const disabled = new AlarmMonitor([rule({ enabled: false })], event => events.push(event), () => time); disabled.samples(samples([100])); assert.equal(events.length, 3);
  assert.throws(() => validateAlarmRules([rule({ min: 10, max: 2 })]), /下限/);
});

test('alarm service monitors inactive devices, persists rules and exports acknowledgements', async t => {
  const directory = await temporary(t), hub = new DeviceHub({ directory }); t.after(() => hub.dispose());
  const logs = new EventLog(path.join(directory, 'logs')); await logs.init(); t.after(() => logs.queue);
  const service = new AlarmService(hub, logs); t.after(() => service.dispose());
  const first = hub.activeId; service.configure({ deviceId: first, rules: [rule({ holdMs: 0 })] }); const second = hub.add(); hub.select(second);
  const engine = hub.devices.get(first).engine; engine.connected = true; engine.receive(Buffer.from('4\n')); assert.equal(service.events[0].device, first);
  service.acknowledge(service.events[0].id); assert.equal(service.events[0].acknowledged, true);
  assert.match(await logs.export({ category: 'alarm' }), /报警已确认/);
  const store = new WorkspaceStore(path.join(directory, 'devices.json'), hub); store.save(); await store.queue;
  const other = new DeviceHub({ directory }); t.after(() => other.dispose()); await new WorkspaceStore(store.filename, other).load(); assert.equal(other.devices.get(other.activeId).alarmRules.length, 1);
});

test('external Agent access has no expiry and can disconnect/reconnect without changing the token', async t => {
  const directory = await temporary(t), hub = new DeviceHub({ directory }); t.after(() => hub.dispose());
  const registry = new AgentRegistry(hub, directory); t.after(() => registry.dispose()); const logs = new EventLog(path.join(directory, 'logs')); await logs.init(); t.after(() => logs.queue);
  const access = new ExternalAccess(hub, registry, logs), created = access.create({}), header = `Bearer ${created.token}`;
  assert.equal('expiresAt' in created.connection, false); access.tokens.get(created.connection.id).createdAt = '2000-01-01'; assert.ok(access.tools(header).length);
  access.update({ id: created.connection.id, connected: false }); assert.throws(() => access.tools(header), error => error.status === 401);
  access.update({ id: created.connection.id, connected: true }); assert.ok(access.tools(header).length); assert.equal(access.list()[0].connected, true);
});

test('discovery and alarm HTTP endpoints remain explicit and graph previews never send bytes', async t => {
  const directory = await temporary(t), runtime = await startServer({ port: 0, autoDemo: true, directory: path.join(directory, 'sessions'), listPorts: async () => [usb] }); t.after(() => runtime.close());
  const post = async (route, body) => fetch(runtime.address + '/api' + route, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  assert.equal((await (await fetch(runtime.address + '/api/ports')).json())[0].identification.interface, 'CP210x USB-UART');
  const initial = runtime.engine.txBytes; assert.equal((await post('/testing/graph', { graph: chain('constant') })).status, 200); assert.equal(runtime.engine.txBytes, initial);
  const result = await post('/alarms/config', { deviceId: runtime.engine.activeId, rules: [rule({ max: 0.1, holdMs: 0 })] }); assert.equal(result.status, 200);
  await new Promise(resolve => setTimeout(resolve, 80)); const report = await (await fetch(runtime.address + '/api/alarms')).json(); assert.ok(report.events.some(event => event.kind === 'range'));
});
