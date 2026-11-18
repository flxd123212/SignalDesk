import assert from 'node:assert/strict';
import test from 'node:test';
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs/promises';
import { EventEmitter } from 'node:events';
import {
  BoardMatrix,
  compareFirmware,
  dbcSignals,
  decodeCapture,
  makeExample,
  replayDbcSignal,
} from '../server/engineering.mjs';
import { DeviceHub } from '../server/devices.mjs';

const root = path.resolve('firmware-examples/Stm32Oled');
const i2c = { protocol: 'i2c', pins: { scl: 'SCL', sda: 'SDA' } };
test('templates create independent projects; OLED sample reconstructs the seven-bit address and ACK', async (t) => {
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'sdlab-'));
  t.after(() => fs.rm(tmp, { recursive: true, force: true }));
  for (const id of ['stm32', 'ch32', 'stc', 'stm8']) {
    const project = await makeExample(id, path.dirname(root), tmp);
    assert.ok((await fs.readFile(path.join(project.root, 'main.c'), 'utf8')).includes('void'));
    assert.ok(JSON.parse(await fs.readFile(path.join(project.root, 'signaldesk.json'), 'utf8')).chip);
  }
  const report = await decodeCapture(root, { ...i2c, file: 'oled-address.csv' });
  assert.deepEqual(
    report.rows.map((r) => r.slice(1)),
    [
      ['START', ''],
      ['0x3C W', 'ACK'],
      ['STOP', ''],
    ],
  );
  await assert.rejects(decodeCapture(root, { ...i2c, file: '../other.csv' }), /工程内/);
  await assert.rejects(
    decodeCapture(root, { ...i2c, file: 'oled-address.csv', pins: { scl: 'SCL', sda: 'SCL' } }),
    /通道映射/,
  );
  const spi = ['time,CLK,MOSI,CS', '0,0,0,1'];
  let n = 0;
  for (const bit of '10100101') {
    spi.push(`${++n},0,${bit},0`, `${++n},1,${bit},0`);
  }
  await fs.writeFile(path.join(tmp, 'spi.csv'), spi.join('\n'));
  const s = await decodeCapture(tmp, {
    protocol: 'spi',
    file: 'spi.csv',
    pins: { clk: 'CLK', mosi: 'MOSI', cs: 'CS' },
    mode: 0,
  });
  assert.deepEqual(s.rows[0].slice(1), ['0xA5', 'MOSI']);
  const uart = [
    'time,RX',
    '0,1',
    '0.001,0',
    ...Array.from('10100101', (bit, i) => `${(i + 2) / 1000},${bit}`),
    '0.010,1',
    '0.012,1',
  ];
  await fs.writeFile(path.join(tmp, 'uart.csv'), uart.join('\n'));
  assert.deepEqual(
    (
      await decodeCapture(tmp, { protocol: 'uart', file: 'uart.csv', pins: { rx: 'RX' }, baud: 1000 })
    ).rows[0].slice(1),
    ['0xA5', '8N1'],
  );
});

test('DBC scaling and endianness survive decoding and timed replay in a separate device', async (t) => {
  if (!process.env.SIGNALDESK_LAB_PYTHON) return t.skip('requires cantools');
  const dbc =
    'VERSION ""\nNS_ :\nBS_:\nBU_: ECU\nBO_ 291 Sensors: 4 ECU\n SG_ Temp : 0|16@1- (0.1,-40) [-40|150] "C" ECU\n SG_ Speed : 23|16@0+ (0.5,0) [0|1000] "rpm" ECU\n';
  const result = await dbcSignals({
    dbc,
    format: 'candump',
    text: '(1.000) can0 123#F4010014\n(1.010) can0 123#58020028',
  });
  assert.deepEqual(
    result.rows.map((r) => r[4]),
    [10, 10, 20, 20],
  );
  const hub = new DeviceHub({ directory: os.tmpdir() });
  t.after(() => hub.dispose());
  const original = hub.activeId;
  const { id } = replayDbcSignal(hub, {
    signal: 'Temp',
    points: [
      [1, 10],
      [1.01, 20],
    ],
  });
  assert.notEqual(id, original);
  await new Promise((resolve) => setTimeout(resolve, 100));
  assert.equal(hub.active.source, 'replay');
  assert.deepEqual(hub.active.latest, [20]);
  assert.deepEqual(hub.active.names, ['Temp']);
  assert.ok(Math.abs(hub.active.history.at(-1).time - 0.01) < 1e-6);
});

test('matrix records measurements per device and labels missing fixtures and offline targets', async () => {
  function entry(id, connected = true) {
    const engine = Object.assign(new EventEmitter(), {
      connected,
      source: 'serial',
      config: { path: id },
      generation: 1,
      validSamples: 1,
      latest: [21],
    });
    return { id, name: id, engine };
  }
  const hub = { devices: new Map(['A', 'B', 'C'].map((id) => [id, entry(id, id !== 'B')])) };
  const batch = new BoardMatrix();
  batch.start(hub, {
    targets: [
      { id: 'A', fixtureReady: true },
      { id: 'B', fixtureReady: true },
      { id: 'C', fixtureReady: false },
    ],
    plan: { steps: [{ type: 'assert', channel: 0, min: 20, max: 22 }] },
  });
  await batch.completion;
  assert.equal(batch.job.status, 'incomplete');
  assert.deepEqual(
    batch.job.results.map((r) => r.status),
    ['passed', 'skipped', 'skipped'],
  );
  assert.equal(batch.job.results[0].results[0].detail, '21');
});

test('ELF comparison rejects foreign paths before invoking optional tools', async () => {
  await assert.rejects(compareFirmware(root, { before: '../other.elf', after: 'main.c' }), /工程内/);
});
