import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import os from 'node:os';
import fs from 'node:fs/promises';
import { once } from 'node:events';
import { spawn } from 'node:child_process';
import { SerialPortMock } from 'serialport';
import { toolDirectories, executableNames, portPathKey, serialError, isExecutable, stopProcessTree } from '../server/platform.mjs';
import { electronExecutable, packagedExecutable, windowChrome } from '../desktop/platform.cjs';
import { DeviceHub } from '../server/devices.mjs';
import { findExecutable } from '../server/ai/build.mjs';
import { startServer } from '../server/index.mjs';

test('GUI tool discovery includes POSIX install paths and platform-specific aliases', () => {
  const mac = toolDirectories('darwin', { PATH: '/usr/bin', SIGNALDESK_TOOLCHAIN_PATH: '/opt/embedded/bin:/usr/bin' }, '/Users/fixture');
  assert.equal(mac[0], '/opt/embedded/bin'); assert.equal(mac.filter(item => item === '/usr/bin').length, 1);
  for (const folder of ['/opt/homebrew/bin', '/usr/local/bin', '/Users/fixture/.cargo/bin', '/Users/fixture/.platformio/penv/bin']) assert.ok(mac.includes(folder));
  assert.ok(toolDirectories('linux', {}, '/home/fixture').includes('/home/fixture/.local/bin'));
  assert.deepEqual(executableNames('python', 'linux'), ['python3', 'python']);
  assert.deepEqual(executableNames('IarBuild', 'linux'), ['iarbuild', 'IarBuild']);
  assert.deepEqual(executableNames('cmake', 'win32'), ['cmake.exe']);
  assert.throws(() => executableNames('../tool'));
});

test('desktop launch and package paths match all three OS layouts', () => {
  const root = path.resolve('fixture');
  assert.equal(electronExecutable(root, 'darwin'), path.join(root, 'node_modules/electron/dist/Electron.app/Contents/MacOS/Electron'));
  assert.equal(electronExecutable(root, 'linux'), path.join(root, 'node_modules/electron/dist/electron'));
  assert.equal(packagedExecutable(root, 'darwin', 'arm64'), path.join(root, 'release/mac-arm64/SignalDesk.app/Contents/MacOS/SignalDesk'));
  assert.equal(packagedExecutable(root, 'linux', 'x64'), path.join(root, 'release/linux-unpacked/signaldesk'));
  assert.equal(windowChrome('darwin').titleBarStyle, 'hiddenInset');
  assert.equal(windowChrome('linux').titleBarOverlay.height, 40);
});

test('serial device names preserve Unix case and expose actionable permission errors', async t => {
  assert.equal(portPathKey('com7'), portPathKey('COM7'));
  assert.notEqual(portPathKey('/dev/ttyUSB0'), portPathKey('/dev/ttyusb0'));
  assert.match(serialError(new Error('EACCES: permission denied'), '/dev/ttyUSB0', 'linux'), /dialout/);
  assert.match(serialError(new Error('ENOENT'), '/dev/cu.usbmodem1', 'darwin'), /cu/);
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'signaldesk-posix-ports-'));
  const hub = new DeviceHub({ directory, Port: SerialPortMock }); t.after(async () => { await hub.dispose(); await fs.rm(directory, { recursive: true, force: true }); });
  for (const name of ['/dev/ttyUSB0', '/dev/ttyusb0', '/dev/cu.usbmodem14101', '/dev/rfcomm0']) SerialPortMock.binding.createPort(name, { echo: false, record: true });
  for (const [index, name] of ['/dev/ttyUSB0', '/dev/ttyusb0', '/dev/cu.usbmodem14101', '/dev/rfcomm0'].entries()) {
    const id = index ? hub.add('port ' + index) : hub.activeId;
    await hub.connectDevice(id, { path: name, transport: name.includes('rfcomm') ? 'bluetooth' : 'serial' });
    await hub.devices.get(id).engine.send({ text: 'AT', ending: 'none' });
    assert.equal(hub.devices.get(id).engine.txBytes, 2);
  }
  await assert.rejects(hub.connectDevice(hub.add('duplicate'), { path: '/dev/ttyUSB0' }), /另一个设备/);
});

test('explicit tool directories resolve executables and enforce POSIX execute permissions', async t => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'signaldesk-tool-path-')), previous = process.env.SIGNALDESK_TOOLCHAIN_PATH;
  t.after(async () => { if (previous === undefined) delete process.env.SIGNALDESK_TOOLCHAIN_PATH; else process.env.SIGNALDESK_TOOLCHAIN_PATH = previous; await fs.rm(directory, { recursive: true, force: true }); });
  const file = path.join(directory, executableNames('fixture-tool')[0]); await fs.writeFile(file, '#!/bin/sh\nexit 0\n');
  if (process.platform !== 'win32') { assert.equal(await isExecutable(file), false); await fs.chmod(file, 0o755); }
  process.env.SIGNALDESK_TOOLCHAIN_PATH = directory; assert.equal(await findExecutable('fixture-tool'), file);
});

test('hardware routes reject stale device/project context without changing mappings', async t => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'signaldesk-hardware-http-'));
  const runtime = await startServer({ port: 0, directory: path.join(directory, 'sessions'), autoDemo: false, listPorts: async () => [] });
  t.after(async () => { await runtime.close(); await fs.rm(directory, { recursive: true, force: true }); });
  const get = route => fetch(runtime.address + '/api' + route).then(response => response.json());
  const state = await get('/state'), hardware = await get('/hardware');
  const response = await fetch(runtime.address + '/api/hardware/save', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ deviceId: 'device-stale', root: hardware.root, version: 0, bindings: [] }) });
  assert.equal(response.ok, false); assert.deepEqual(await get('/hardware'), hardware); assert.equal((await get('/state')).activeDevice, state.activeDevice);
});

test('POSIX cancellation stops a job and its child process', { skip: process.platform === 'win32', timeout: 10000 }, async () => {
  const child = spawn(process.execPath, ['-e', 'const {spawn}=require("node:child_process"); const c=spawn(process.execPath,["-e","setInterval(()=>{},1000)"],{stdio:"inherit"}); console.log(c.pid); setInterval(()=>{},1000)'], { detached: true, stdio: ['ignore', 'pipe', 'pipe'] });
  const closed = once(child, 'close'); let output = ''; const ready = new Promise(resolve => child.stdout.on('data', data => { output += data; if (/\d+/.test(output)) resolve(); }));
  try { await ready; stopProcessTree(child); await closed; assert.ok(child.signalCode); }
  finally { if (child.exitCode === null && !child.signalCode) stopProcessTree(child); }
});

test('POSIX cancellation escalates when a descendant outlives its parent', { skip: process.platform === 'win32', timeout: 10000 }, async () => {
  const descendant = 'process.on("SIGTERM",()=>{}); process.send("ready"); setInterval(()=>{},1000)';
  const script = `const {spawn}=require('node:child_process'); const c=spawn(process.execPath,['-e',${JSON.stringify(descendant)}],{stdio:['ignore','ignore','ignore','ipc']}); c.on('message',()=>console.log(c.pid)); setInterval(()=>{},1000)`;
  const child = spawn(process.execPath, ['-e', script], { detached: true, stdio: ['ignore', 'pipe', 'pipe'] });
  const closed = once(child, 'close'); let output = '';
  const ready = new Promise(resolve => child.stdout.on('data', data => { output += data; if (/\d+/.test(output)) resolve(); }));
  try {
    await ready; const descendantPid = Number(output.trim()); stopProcessTree(child); await closed;
    await new Promise(resolve => setTimeout(resolve, 2500));
    try {
      process.kill(descendantPid, 0);
      // Linux may retain an adopted zombie briefly; it is no longer executing.
      assert.equal(process.platform, 'linux');
      assert.match(await fs.readFile(`/proc/${descendantPid}/stat`, 'utf8'), /\) Z /);
    } catch (error) { if (error.code !== 'ESRCH' && error.code !== 'ENOENT') throw error; }
  } finally { try { process.kill(-child.pid, 'SIGKILL'); } catch {} }
});
