import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { DeviceHub } from '../server/devices.mjs';
import { AgentRegistry } from '../server/ai/registry.mjs';
import { EventLog } from '../server/logs.mjs';
import { ExternalAccess } from '../server/external/access.mjs';
import { readKeilProject, keilPlan } from '../server/keil.mjs';
import { commandPlan, buildPlan } from '../server/ai/build.mjs';
import { WorkspaceStore } from '../server/workspace.mjs';
import { startServer } from '../server/index.mjs';
import { readIarProject, iarPlan } from '../server/iar.mjs';

const temporary = async t => { const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'signaldesk-access-')); t.after(() => fs.rm(directory, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })); return directory; };
const xml = '<?xml version="1.0"?><Project><Targets><Target><TargetName>STM32 Debug</TargetName><TargetOption><TargetCommonOption><Device>STM32F407VG</Device><Vendor>STMicroelectronics</Vendor><OutputDirectory>.\\Objects\\</OutputDirectory><OutputName>demo</OutputName><CreateHexFile>1</CreateHexFile></TargetCommonOption></TargetOption><Groups><Group><GroupName>Application</GroupName><Files><File><FileName>main.c</FileName><FilePath>.\\main.c</FilePath></File></Files></Group></Groups></Target></Targets></Project>';

test('Keil project parser reads Target, chip, source files and option hashes', async t => {
  const directory = await temporary(t); await fs.writeFile(path.join(directory, 'demo.uvprojx'), xml); await fs.writeFile(path.join(directory, 'demo.uvoptx'), '<ProjectOpt/>');
  const project = await readKeilProject(directory, 'demo.uvprojx');
  assert.equal(project.targets[0].name, 'STM32 Debug'); assert.equal(project.targets[0].chip, 'STM32F407VG'); assert.equal(project.targets[0].hexEnabled, true); assert.equal(project.targets[0].files[0].name, 'main.c'); assert.equal(project.optionsHash.length, 64);
  await assert.rejects(readKeilProject(directory, '../outside.uvprojx'));
  await fs.writeFile(path.join(directory, 'bad.uvprojx'), '<!DOCTYPE x><Project/>'); await assert.rejects(readKeilProject(directory, 'bad.uvprojx'), /XML/);
});

test('Keil compile and flash plans use distinct fixed flags and reject arbitrary CLI switches', () => {
  const root = path.resolve('fixture'), config = { buildPreset: 'keil', keilProject: 'MDK/demo.uvprojx', keilTarget: 'STM32 Debug' };
  const build = buildPlan(config, root), flash = keilPlan(config, root, true);
  assert.equal(build.command, 'UV4'); assert.equal(build.args[0], '-b'); assert.equal(flash.args[0], '-f'); assert.ok(build.args.includes('-j0')); assert.equal(flash.confirmation, 'WRITE KEIL:STM32 Debug');
  assert.equal(commandPlan('UV4 -b "MDK/demo.uvprojx" -t "STM32 Debug"', root).command, 'UV4');
  assert.throws(() => commandPlan('UV4 -f demo.uvprojx -t target', root));
  assert.throws(() => keilPlan({ ...config, keilProject: '../outside.uvprojx' }, root));
});

test('IAR parser reads project configurations and builds using the installed utility argument format', async t => {
  const directory = await temporary(t);
  await fs.writeFile(path.join(directory, 'app.ewp'), '<project><configuration><name>Debug</name><toolchain><name>8051</name></toolchain></configuration><group><name>App</name><file><name>$PROJ_DIR$/main.c</name></file></group></project>');
  const project = await readIarProject(directory, 'app.ewp'); assert.equal(project.configurations[0].toolchain, '8051'); assert.equal(project.files.length, 1);
  const plan = iarPlan({ iarProject: 'app.ewp', iarConfig: 'Debug' }, directory); assert.deepEqual(plan.args.slice(1), ['-build', 'Debug', '-log', 'all']);
  assert.equal(commandPlan('IarBuild app.ewp -build Debug', directory).command, 'IarBuild');
  assert.throws(() => commandPlan('IarBuild app.ewp -clean Debug', directory));
});

test('external permissions deny writes by default, enable audited edits explicitly, then revoke access', async t => {
  const directory = await temporary(t); await fs.writeFile(path.join(directory, 'main.c'), 'int x = 1;\n');
  const hub = new DeviceHub({ directory: path.join(directory, 'sessions') }); t.after(() => hub.dispose());
  const registry = new AgentRegistry(hub, directory, path.join(directory, 'changes')); t.after(() => registry.dispose());
  const logs = new EventLog(path.join(directory, 'logs')); await logs.init(); t.after(() => logs.queue);
  const external = new ExternalAccess(hub, registry, logs), created = external.create({ name: 'Test Agent' }), header = `Bearer ${created.token}`;
  const file = (await external.call(header, { tool: 'read_firmware_file', arguments: { path: 'main.c' } })).result;
  const change = { path: 'main.c', expectedHash: file.hash, content: 'int x = 2;\n', reason: 'authorized test' };
  await assert.rejects(external.call(header, { tool: 'write_project_file', arguments: change }), error => error.status === 403);
  assert.equal(await fs.readFile(path.join(directory, 'main.c'), 'utf8'), 'int x = 1;\n');
  assert.equal(external.tools(header).some(tool => tool.name === 'write_project_file'), false);
  external.update({ id: created.connection.id, permissions: ['read', 'propose', 'write'] });
  const result = (await external.call(header, { tool: 'write_project_file', arguments: change })).result;
  assert.equal(result.status, 'applied'); assert.ok(result.backup); assert.match(result.diff, /\+int x = 2/);
  external.update({ id: created.connection.id, permissions: ['read'] });
  await assert.rejects(external.call(header, { tool: 'submit_advice', arguments: { message: 'not allowed' } }), error => error.status === 403);
  external.update({ id: created.connection.id, revoke: true }); assert.throws(() => external.tools(header), error => error.status === 401);
  assert.doesNotMatch(JSON.stringify(logs.list()), new RegExp(created.token));
});

test('external serial permission is bound to the original connection and denies after reconnect', async t => {
  const directory = await temporary(t), hub = new DeviceHub({ directory }); t.after(() => hub.dispose()); await hub.connect({ path: 'demo' });
  const registry = new AgentRegistry(hub, directory); t.after(() => registry.dispose());
  const logs = new EventLog(path.join(directory, 'logs')); await logs.init(); t.after(() => logs.queue);
  const external = new ExternalAccess(hub, registry, logs), { token } = external.create({ permissions: ['read', 'serial'] }), header = `Bearer ${token}`;
  const args = { text: '*IDN?', format: 'text', ending: 'lf', checksum: 'none', reason: 'identify simulated target' };
  assert.equal((await external.call(header, { tool: 'send_serial', arguments: args })).result.sent, true);
  assert.equal(hub.txBytes, 6);
  await hub.connect({ path: 'demo' }); await assert.rejects(external.call(header, { tool: 'send_serial', arguments: args }), /连接已变化/);
});

test('external tokens cannot follow a changed project root or run toolchains without permission', async t => {
  const directory = await temporary(t), other = path.join(directory, 'other'); await fs.mkdir(other);
  const hub = new DeviceHub({ directory }); t.after(() => hub.dispose());
  const registry = new AgentRegistry(hub, directory); t.after(() => registry.dispose());
  const logs = new EventLog(path.join(directory, 'logs')); await logs.init(); t.after(() => logs.queue);
  const external = new ExternalAccess(hub, registry, logs), created = external.create({ permissions: ['read'] }), header = `Bearer ${created.token}`;
  await assert.rejects(external.call(header, { tool: 'run_toolchain', arguments: { commandLine: 'cmake --build build' } }), error => error.status === 403);
  external.update({ id: created.connection.id, permissions: ['read', 'toolchain'] });
  await assert.rejects(external.call(header, { tool: 'run_toolchain', arguments: { commandLine: 'powershell Get-Process' } }), /支持/);
  await registry.configure({ root: other }); assert.throws(() => external.tools(header), /绑定/);
});

test('device names, chips and project bindings restore without reopening real ports', async t => {
  const directory = await temporary(t), filename = path.join(directory, 'devices.json'), hub = new DeviceHub({ directory }); t.after(() => hub.dispose());
  hub.devices.get(hub.activeId).chip = 'STM32F407'; hub.devices.get(hub.activeId).projectRoot = directory; hub.active.config.path = 'COM77';
  const store = new WorkspaceStore(filename, hub); store.save(); await store.queue;
  const second = new DeviceHub({ directory }); t.after(() => second.dispose()); await new WorkspaceStore(filename, second).load();
  assert.equal(second.list()[0].chip, 'STM32F407'); assert.equal(second.config.path, 'COM77'); assert.equal(second.connected, false);
});

test('MCP stdio client lists scoped tools and reads a live bound device end to end', async t => {
  const directory = await temporary(t), runtime = await startServer({ port: 0, autoDemo: true, directory: path.join(directory, 'sessions') }); t.after(() => runtime.close());
  const response = await fetch(runtime.address + '/api/external/create', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: 'MCP test', permissions: ['read', 'propose'] }) });
  const { token } = await response.json();
  const transport = new StdioClientTransport({ command: process.execPath, args: [path.resolve('server/external/mcp.mjs')], env: { ...process.env, SIGNALDESK_URL: runtime.address, SIGNALDESK_TOKEN: token }, stderr: 'pipe' });
  const client = new Client({ name: 'signaldesk-test-client', version: '1.0' });
  t.after(() => client.close()); await client.connect(transport);
  const tools = await client.listTools(); assert.ok(tools.tools.some(tool => tool.name === 'get_device_snapshot')); assert.equal(tools.tools.some(tool => tool.name === 'write_project_file'), false);
  const snapshot = await client.callTool({ name: 'get_device_snapshot', arguments: {} }); assert.equal(snapshot.isError, undefined); assert.equal(JSON.parse(snapshot.content[0].text).source, 'demo');
  const advice = await client.callTool({ name: 'submit_advice', arguments: { message: 'MCP integration verified with simulated data.' } }); assert.equal(advice.isError, undefined);
  const state = await (await fetch(runtime.address + '/api/ai/state')).json(); assert.match(state.messages.at(-1).content, /MCP integration/);
});
