import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { SerialPortMock } from 'serialport';
import { scanProject, rankProjectPorts } from '../server/project-profile.mjs';
import { ProjectSetup, projectCommand } from '../server/project-setup.mjs';
import { DeviceHub } from '../server/devices.mjs';
import { PortDiscovery, identifyPort } from '../server/identification.mjs';
import { AgentRegistry } from '../server/ai/registry.mjs';
import { WorkspaceStore } from '../server/workspace.mjs';
import { buildPlan, commandPlan } from '../server/ai/build.mjs';
import { startServer } from '../server/index.mjs';

const firmware = '#include <Arduino.h>\nconstexpr uint32_t kSamplePeriodUs = 5000;\nvoid setup(){ Serial.begin(230400); }\nvoid loop(){ Serial.print(1); Serial.print(","); Serial.println(2); }\n';
async function fixture(t, files = { 'platformio.ini': '[platformio]\ndefault_envs = sensor\n[env:sensor]\nboard = esp32-s3-devkitc-1\nmonitor_speed = 230400\n', 'src/main.cpp': firmware }) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'signaldesk-project-')), root = path.join(directory, 'firmware');
  for (const [file, text] of Object.entries(files)) { await fs.mkdir(path.dirname(path.join(root, file)), { recursive: true }); await fs.writeFile(path.join(root, file), text); }
  const hub = new DeviceHub({ directory: path.join(directory, 'sessions'), Port: SerialPortMock }), registry = new AgentRegistry(hub, root), workspace = new WorkspaceStore(path.join(directory, 'devices.json'), hub);
  let ports = [];
  const discovery = new PortDiscovery(hub, async () => ports), records = [], projects = new ProjectSetup(hub, registry, discovery, workspace, { write: record => records.push(record) });
  t.after(async () => { registry.dispose(); await hub.dispose(); await workspace.queue; await fs.rm(directory, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }); });
  return { root, directory, hub, registry, projects, workspace, records, ports: next => { ports = next; } };
}
const usb = (port = 'PROJECT-UART') => ({ path: port, vendorId: '303a', productId: '1001', serialNumber: 'project-s3', friendlyName: 'ESP32-S3' });

test('project scanner reads PlatformIO targets, inherited values and actual source hints', async t => {
  const { root } = await fixture(t, { 'platformio.ini': '[platformio]\ndefault_envs = sensor.debug\n[common]\nspeed = 230400\n[env]\nmonitor_speed = ${common.speed}\n[base]\nboard = esp32-s3-devkitc-1\n[env:sensor.debug]\nextends = base\nmonitor_port = COM9\n[env:other]\nboard = uno\n', 'src/main.cpp': firmware });
  const report = await scanProject(root), target = report.targets.find(target => target.label === 'sensor.debug');
  assert.equal(report.targets.length, 2); assert.equal(report.recommendedTarget, target.id);
  assert.equal(target.chip, 'ESP32-S3'); assert.equal(target.entryFile, 'src/main.cpp');
  assert.equal(target.serial.baudRate, 230400); assert.equal(target.serial.protocol, 'firewater'); assert.equal(target.serial.sampleRate, 200);
  assert.equal(target.portHint, 'COM9'); assert.equal(target.toolchain.platformioEnvironment, 'sensor.debug');
  assert.equal(projectCommand(target.toolchain), 'platformio run -e "sensor.debug"');
});

test('Arduino YAML, CubeMX and ESP-IDF supply distinct project targets', async t => {
  const arduino = await fixture(t, { 'sketch.yaml': 'default_profile: dev\nprofiles:\n  dev:\n    fqbn: esp32:esp32:esp32s3\n  release:\n    fqbn: arduino:avr:uno\n', 'firmware.ino': firmware });
  const report = await scanProject(arduino.root); assert.equal(report.targets.length, 2); assert.equal(report.targets[0].chip, 'ESP32-S3'); assert.equal(report.targets[0].toolchain.fqbn, 'esp32:esp32:esp32s3');
  const cube = await fixture(t, { 'board.ioc': 'Mcu.UserName=STM32F407VGT6\n', 'Core/Src/main.c': 'int main(){}' });
  assert.equal((await scanProject(cube.root)).targets[0].chip, 'STM32F407VGT6');
  const idf = await fixture(t, { 'CMakeLists.txt': 'include($ENV{IDF_PATH}/tools/cmake/project.cmake)\nproject(sensor)', 'sdkconfig.defaults': 'CONFIG_IDF_TARGET="esp32s3"\n', 'main/main.c': 'void app_main(){}' });
  const target = (await scanProject(idf.root)).targets[0]; assert.equal(target.kind, 'esp-idf'); assert.equal(target.chip, 'ESP32S3'); assert.equal(target.entryFile, 'main/main.c');
});

test('port ranking does not invent MCU identity from generic bridges and rejects conflicts/duplicates', () => {
  const target = { chip: 'ESP32-S3', family: 'esp32' }, describe = port => ({ ...port, identification: identifyPort(port) });
  const generic = describe({ path: 'COM1', vendorId: '1a86', productId: '7523' }), matched = describe(usb('COM2'));
  const matches = rankProjectPorts(target, [generic, matched], []); assert.equal(matches[0].path, 'COM2'); assert.equal(matches[1].chip, ''); assert.equal(matches[1].score, 0);
  assert.ok(rankProjectPorts(target, [matched, describe(usb('COM3'))], []).every(item => item.blocked));
  assert.match(rankProjectPorts(target, [matched], [{ id: 'old', name: 'Other', connected: true, path: 'COM2' }])[0].blocked, /占用/);
});

test('one-step setup binds mock hardware, project, toolchain and isolated Agent without persisting secrets', async t => {
  const ctx = await fixture(t); ctx.ports([usb()]); SerialPortMock.binding.createPort('PROJECT-UART', { echo: false, record: true });
  await ctx.registry.configure({ model: 'fixture-only', apiKey: 'project-secret-do-not-persist', apiStyle: 'chat' });
  ctx.registry.message('user', 'original conversation'); const original = ctx.hub.activeId;
  const plan = await ctx.projects.prepare(ctx.root); assert.equal(ctx.hub.devices.size, 1); assert.equal(ctx.hub.connected, false);
  const target = plan.targets[0]; assert.equal(target.recommendedPort, 'PROJECT-UART');
  const result = await ctx.projects.apply({ id: plan.id, targetId: target.id, port: target.recommendedPort, connect: true });
  assert.equal(result.connected, true); assert.equal(ctx.hub.config.baudRate, 230400); assert.equal(ctx.hub.config.protocol, 'firewater');
  assert.equal(ctx.registry.workspace.root, ctx.root); assert.equal(ctx.registry.config.platformioEnvironment, 'sensor'); assert.equal(ctx.registry.config.model, 'fixture-only');
  assert.equal(ctx.registry.state().messages.length, 0); assert.equal(ctx.hub.txBytes, 0); assert.equal(ctx.hub.active.port.port.recording.length, 0);
  assert.equal(ctx.hub.active.projectContext.entryFile, 'src/main.cpp'); assert.equal(ctx.hub.devices.get(result.deviceId).portBinding.autoMatch, true);
  await ctx.projects.health(result.deviceId); assert.match(ctx.registry.state().messages.at(-1).content, /项目体检/);
  assert.equal(JSON.stringify({ state: ctx.hub.state(), agent: ctx.registry.state(), plan, records: ctx.records }).includes('project-secret'), false);
  await ctx.workspace.queue; assert.equal((await fs.readFile(ctx.workspace.filename, 'utf8')).includes('project-secret'), false);
  ctx.hub.select(original); assert.equal(ctx.registry.state().messages[0].content, 'original conversation');
  const again = await ctx.projects.prepare(ctx.root), reused = await ctx.projects.apply({ id: again.id, targetId: again.targets[0].id });
  assert.equal(reused.deviceId, result.deviceId); assert.equal(reused.reused, true); assert.equal(ctx.hub.devices.size, 2);
});

test('offline imports never become a demo connection, and workspace restoration keeps project context', async t => {
  const ctx = await fixture(t), plan = await ctx.projects.prepare(ctx.root);
  const result = await ctx.projects.apply({ id: plan.id, targetId: plan.targets[0].id, reuseAI: false });
  assert.equal(result.connected, false); assert.equal(ctx.hub.config.path, 'unassigned'); await assert.rejects(ctx.hub.connect(ctx.hub.config), /尚未匹配/);
  const restored = new DeviceHub({ directory: path.join(ctx.directory, 'restored') }); t.after(() => restored.dispose());
  const store = new WorkspaceStore(ctx.workspace.filename, restored); await store.load(); assert.equal(store.failure, '');
  const entry = [...restored.devices.values()].find(item => item.projectProfile); assert.equal(entry.engine.config.path, 'unassigned'); assert.equal(entry.projectProfile.aiInherited, false); assert.equal(entry.engine.connected, false);
});

test('stale scans, changed selection and unplugged ports cannot create partial devices', async t => {
  const ctx = await fixture(t); ctx.ports([usb()]);
  let plan = await ctx.projects.prepare(ctx.root);
  await fs.appendFile(path.join(ctx.root, 'src/main.cpp'), '// edit\n');
  await assert.rejects(ctx.projects.apply({ id: plan.id, targetId: plan.targets[0].id }), /发生变化/); assert.equal(ctx.hub.devices.size, 1);
  plan = await ctx.projects.prepare(ctx.root); ctx.ports([]);
  await assert.rejects(ctx.projects.apply({ id: plan.id, targetId: plan.targets[0].id, port: 'PROJECT-UART' }), /移除/); assert.equal(ctx.hub.devices.size, 1);
  plan = await ctx.projects.prepare(ctx.root); ctx.hub.select(ctx.hub.activeId);
  await assert.rejects(ctx.projects.apply({ id: plan.id, targetId: plan.targets[0].id }), /切换/);
});

test('ambiguous ports require selection, while a unique USB identity survives renumbering', async t => {
  const ctx = await fixture(t); ctx.ports([usb('OLD'), { ...usb('OTHER'), serialNumber: 'different-board' }]);
  let plan = await ctx.projects.prepare(ctx.root); assert.equal(plan.targets[0].recommendedPort, '');
  await assert.rejects(ctx.projects.apply({ id: plan.id, targetId: plan.targets[0].id, connect: true }), /没有匹配/);
  ctx.ports([usb('OLD')]); plan = await ctx.projects.prepare(ctx.root);
  ctx.ports([usb('NEW')]); SerialPortMock.binding.createPort('NEW', { echo: false, record: true });
  const result = await ctx.projects.apply({ id: plan.id, targetId: plan.targets[0].id, port: 'OLD', connect: true });
  assert.equal(result.connected, true); assert.equal(ctx.hub.config.path, 'NEW');
});

test('project commands preserve build-only validation and explicit target selection', () => {
  assert.deepEqual(buildPlan({ buildPreset: 'platformio', platformioEnvironment: 's3.debug' }, '.').args, ['run', '-e', 's3.debug']);
  assert.throws(() => buildPlan({ buildPreset: 'platformio', platformioEnvironment: 's3;anything' }, '.'));
  assert.equal(buildPlan({ buildPreset: 'esp-idf' }, '.').command, 'idf.py');
  assert.equal(commandPlan('idf.py build', '.').command, 'idf.py'); assert.throws(() => commandPlan('idf.py flash', '.'));
  assert.throws(() => buildPlan({ buildPreset: 'none' }, '.'));
});

test('workspace requests reject stale device/root targets and read-only sessions cannot build', async t => {
  const ctx = await fixture(t), runtime = await startServer({ port: 0, autoDemo: false, directory: path.join(ctx.directory, 'http', 'sessions'), listPorts: async () => [] });
  const call = async (route, data) => { const response = await fetch(`${runtime.address}/api${route}`, data ? { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data) } : {}); return { status: response.status, body: await response.json() }; };
  try {
    const original = (await call('/state')).body.activeDevice;
    const root = (await call('/ai/state')).body.config.root;
    assert.equal((await call('/ai/command/preview', { commandLine: 'git status --short', deviceId: original, root })).status, 200);
    await call('/devices/add', {});
    for (const route of ['/ai/command/preview', '/ai/command/run', '/ai/build', '/connect', '/disconnect']) {
      const result = await call(route, { commandLine: 'git status --short', confirm: true, deviceId: original, root, path: 'demo' });
      assert.equal(result.status, 400); assert.match(result.body.error, /设备已切换/);
    }
    const invalidRoot = await call('/ai/command/run', { commandLine: 'git status --short', confirm: true, root: ctx.root });
    assert.equal(invalidRoot.status, 400); assert.match(invalidRoot.body.error, /工程已变化/);
    const sessions = (await call('/ai/delegate', { mode: 'local', task: 'Local fixture only' })).body.sessions;
    await call('/ai/sessions/select', { id: sessions.find(session => session.readOnly).id });
    const denied = await call('/ai/build', {}); assert.equal(denied.status, 400); assert.match(denied.body.error, /子代理/);
    assert.equal((await call('/state')).body.connected, false);
  } finally { await runtime.close(); }
});
