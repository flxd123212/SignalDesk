import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { BenchRuns, benchTest } from '../server/bench.mjs';
import { encodePayload } from '../server/protocol.mjs';
import { FirmwareWorkspace } from '../server/ai/firmware.mjs';
import { program } from '../server/engineering.mjs';
import { clangQuery, ProbeSession } from '../server/source-tooling.mjs';

function target() {
  return Object.assign(new EventEmitter(), {
    config: { path: 'COM-test' },
    connected: true,
    source: 'serial',
    generation: 7,
    send(payload, token) {
      assert.equal(token, this.automationLock);
      assert.equal(encodePayload(payload).toString(), 'ADC\n');
      this.emit('samples', [{ values: [1.5] }]);
    },
  });
}
for (const [value, expected] of [
  [1.505, 'complete'],
  [1.63, 'failed'],
])
  test(`ADC calibration ${expected} retains both measurements and releases supply`, async () => {
    const device = target(),
      outputs = [];
    const runs = new BenchRuns(async (action, opts, row) => {
      if (action === 'visa.output') outputs.push(opts.on);
      else row([Date.now() / 1000, value, 'V', opts.resource]);
    });
    runs.start('scope', device, 'bench.test', {
      resource: 'DMM',
      supply: 'PSU',
      command: 'ADC',
      adcChannel: 0,
      tolerance: 0.01,
    });
    await runs.jobs.get('scope').done;
    const result = runs.state('scope');
    assert.equal(result.status, expected);
    assert.ok(result.rows.some((r) => r[1] === '固件 ADC / V' && r[2] === 1.5));
    assert.deepEqual(outputs, [true, false]);
    assert.equal(device.automationLock, null);
    assert.equal(device.listenerCount('packet'), 0);
  });
test('cancel during startup releases supply, does not accept a previous sample', async () => {
  const device = target(),
    ctl = new AbortController(),
    outputs = [];
  device.latest = [1.5];
  const job = benchTest(
    device,
    { resource: 'DMM', supply: 'PSU', ready: 'READY', adcChannel: 0, tolerance: 1 },
    () => {},
    ctl.signal,
    async (_, o) => {
      outputs.push(o.on);
      if (o.on) ctl.abort();
    },
  );
  await assert.rejects(job);
  assert.deepEqual(outputs, [true, false]);
  assert.equal(device.automationLock, null);
});
test('test cannot run against demo or replay', async () => {
  const device = target();
  device.source = 'demo';
  await assert.rejects(
    benchTest(device, {}, () => {}, new AbortController().signal),
    /实际设备/,
  );
});
test('custom rig sequence consumes a fresh ACK and checks the external instrument range',async()=>{
  const device=target();device.send=async()=>device.emit('packet',{dir:'RX',data:Buffer.from('ACK').toString('base64')});
  const rows=[];await benchTest(device,{resource:'DMM',adcChannel:0,tolerance:0,sequence:[{type:'send',text:'READ'},{type:'expect',text:'ACK'},{type:'measure',unit:'A',min:0.1,max:0.3}]},r=>rows.push(r),new AbortController().signal,async(_a,o,r)=>{assert.equal(o.unit,'A');r([1,0.2,'A','DMM']);});
  assert.deepEqual(rows.map(r=>r[1]),['发送','收到','测量 / A']);
});
test('capture handles are scoped, cancellable and keep partial results', async () => {
  const runs = new BenchRuns(async (_, o, row, signal) => {
    row([1, '001', 'FD', 12, '00', 0, 1]);
    await new Promise((_, reject) => signal.addEventListener('abort', () => reject(Error('stopped'))));
  });
  const job = runs.start('a', target(), 'can.capture', {});
  assert.equal(runs.state('b'), null);
  assert.throws(() => runs.start('a', target(), 'ble.scan', {}));
  assert.throws(() => runs.stop('a', 'old'));
  runs.stop('a', job.id);
  await runs.dispose();
  assert.equal(runs.state('a').count, 1);
  assert.equal(runs.state('a').status, 'cancelled');
});
test('clangd returns diagnostics and symbols from a bound compilation database', async (t) => {
  try {
    await program('clangd');
  } catch {
    t.skip('clangd unavailable');
    return;
  }
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'signaldesk-clangd-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const file = path.join(root, 'main.c'),
    other = path.join(root, 'other.c');
  await fs.writeFile(path.join(root, 'sensor.h'), 'int sample(void);\n');
  await fs.writeFile(other, '#include "sensor.h"\nint sample(void){return 7;}\n');
  await fs.writeFile(file, '#include "sensor.h"\nint main(void){return sample();}\nint b=MISSING;\n');
  await fs.writeFile(
    path.join(root, 'compile_commands.json'),
    JSON.stringify(
      [file, other].map((f) => ({ directory: root, file: f, arguments: ['clang', '-c', f] })),
    ),
  );
  const w = new FirmwareWorkspace(root),
    options = { path: 'main.c', database: 'compile_commands.json', line: 2, column: 25 };
  assert.ok(
    (await clangQuery(w, { ...options, mode: 'diagnostics' })).some(
      (d) => d.line === 3 && /MISSING/.test(d.text),
    ),
  );
  const locations = await clangQuery(w, { ...options, mode: 'definition' });
  assert.ok(
    locations.some((d) => ['other.c', 'sensor.h'].includes(d.path)),
    JSON.stringify(locations),
  );
  assert.ok((await clangQuery(w, { ...options, mode: 'references' })).some((d) => d.path === 'other.c'));
});
test('probe rejects invalid target and commands without an active session', async () => {
  const p = new ProbeSession();
  await assert.rejects(p.attach('a', '.', { arch: 'invalid', port: 3333 }));
  await assert.rejects(p.act('stale', {}, { action: 'continue' }));
  assert.equal(p.snapshot().state, 'disconnected');
});
