import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { SerialPortMock } from 'serialport';
import { PortDiscovery } from '../server/identification.mjs';
import { DeviceHub } from '../server/devices.mjs';
import { startServer } from '../server/index.mjs';

const usb = { path: 'COM83', vendorId: '303a', productId: '1001', serialNumber: 'discovery-s3', friendlyName: 'ESP32-S3' };
async function fixture(t) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'signaldesk-discovery-'));
  const hub = new DeviceHub({ directory, Port: SerialPortMock });
  let ports = [], failure = false;
  const discovery = new PortDiscovery(hub, async () => { if (failure) throw new Error('Enumeration unavailable'); return ports; });
  t.after(async () => { await discovery.dispose(); await hub.dispose(); await fs.rm(directory, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }); });
  return { hub, discovery, set: value => { ports = value; }, fail: value => { failure = value; }, directory };
}
test('discovery polling reports insert/remove/reinsert once, retains last good list on error, and stops', async t => {
  const ctx = await fixture(t), events = []; ctx.discovery.on('change', value => events.push(value));
  await ctx.discovery.start(20); assert.equal(events[0].added.length, 0);
  const changed = () => new Promise(resolve => ctx.discovery.once('change', resolve));
  const inserted = changed(); ctx.set([usb]); assert.equal((await inserted).added[0].path, 'COM83');
  await ctx.discovery.scan(); assert.equal(events.length, 2); assert.equal(ctx.hub.connected, false);
  ctx.fail(true); await assert.rejects(ctx.discovery.scan()); assert.equal(ctx.discovery.snapshot.ports.length, 1); assert.equal(events.at(-1).removed.length, 0);
  ctx.fail(false); await ctx.discovery.scan(); assert.equal(events.at(-1).added.length, 0); assert.equal(ctx.discovery.snapshot.error, '');
  ctx.set([]); await ctx.discovery.scan(); assert.equal(events.at(-1).removed.length, 1);
  ctx.set([usb]); await ctx.discovery.scan(); assert.equal(events.at(-1).added.length, 1);
  const revision = ctx.discovery.snapshot.revision; await ctx.discovery.dispose(); assert.equal(ctx.discovery.snapshot.revision, revision);
  await assert.rejects(ctx.discovery.scan(), /停止/);
});
test('discovery attach uses explicit target, raw protocol, stable identity and never transmits probe bytes', async t => {
  const ctx = await fixture(t); SerialPortMock.binding.createPort(usb.path, { record: true }); ctx.set([usb]);
  const input = { path: usb.path, identity: ctx.discovery.identity(usb), baudRate: 115200, protocol: 'raw', connect: true };
  const original = ctx.hub.activeId; await ctx.hub.connect({ path: 'demo' });
  const id = await ctx.discovery.attach(input), device = ctx.hub.devices.get(id);
  assert.notEqual(id, original); assert.equal(ctx.hub.devices.get(original).engine.connected, true); assert.equal(device.engine.connected, true);
  assert.equal(device.chip, 'ESP32-S3'); assert.equal(device.engine.txBytes, 0); assert.equal(device.engine.port.port.recording.length, 0);
  assert.equal(device.portBinding.autoMatch, true);
  await assert.rejects(ctx.discovery.attach(input), /其他/); assert.equal(ctx.hub.devices.size, 2);
  await device.engine.disconnect(); ctx.set([{ ...usb, path: 'COM84' }]); await ctx.discovery.scan(); assert.equal(device.engine.config.path, 'COM84');
  await assert.rejects(ctx.discovery.attach(input), /移除|身份/);
});
test('attach rejects stale contexts and invalid configuration before creating or rebinding devices', async t => {
  const ctx = await fixture(t); ctx.set([usb]); const input = { path: usb.path, identity: ctx.discovery.identity(usb), baudRate: 115200, protocol: 'raw' };
  await assert.rejects(ctx.discovery.attach({ ...input, baudRate: 0 }), /波特率/); assert.equal(ctx.hub.devices.size, 1);
  await assert.rejects(ctx.discovery.attach(input, () => { throw new Error('Stale selection'); }), /Stale/);
  await assert.rejects(ctx.discovery.attach({ ...input, deviceId: ctx.hub.activeId, expectedRoot: 'changed' }), /工程/);
  ctx.hub.devices.get(ctx.hub.activeId).projectRoot = 'project';
  const id = await ctx.discovery.attach({ ...input, deviceId: ctx.hub.activeId, expectedRoot: 'project' });
  assert.equal(id, ctx.hub.activeId); assert.equal(ctx.hub.connected, false); assert.equal(ctx.hub.config.protocol, 'raw');
  assert.equal(ctx.hub.devices.get(id).projectRoot, 'project');
});
test('server starts offline and discovery snapshot/attach endpoints reject stale selection', async t => {
  const ctx = await fixture(t), runtime = await startServer({ port: 0, directory: path.join(ctx.directory, 'server', 'sessions'), listPorts: async () => [usb], Port: SerialPortMock });
  t.after(() => runtime.close()); assert.equal(runtime.engine.connected, false); assert.equal(runtime.engine.config.path, 'unassigned');
  const snapshot = await (await fetch(runtime.address + '/api/ports/state')).json(); assert.equal(snapshot.ports.length, 1); assert.equal(snapshot.initialized, true);
  const input = { path: usb.path, identity: runtime.discovery.identity(usb), baudRate: 115200, protocol: 'raw', expectedActiveDevice: 'missing' };
  const post = body => fetch(runtime.address + '/api/ports/attach', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  assert.equal((await post(input)).status, 400); assert.equal(runtime.engine.devices.size, 1);
  const response = await post({ ...input, expectedActiveDevice: runtime.engine.activeId }); assert.equal(response.status, 200);
  const result = await response.json(); assert.equal(result.state.config.path, usb.path); assert.equal(result.state.connected, false);
});
