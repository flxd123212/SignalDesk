import test from 'node:test';
import assert from 'node:assert/strict';
import { parseMemoryUsage, validationResult } from '../server/diagnostics.mjs';

test('capacity reports retain tool units, overflow and repeated builds without inferring missing capacity', () => {
  const report = parseMemoryUsage([
    'Memory region         Used Size  Region Size  %age Used',
    ' SRAM1: 1.5 KB 1 KB 150.0%',
    ' UNUSED: 0 GB 2 MB 0.00%', '', ' Unrelated: 2 B 3 KB 0.1%',
    'RAM:   [=         ]   9.9% (used 8,123 bytes from 81920 bytes)',
    'Flash: [=         ]  11.1% (used 116736 bytes from 1048576 bytes)',
    'Sketch uses 2,048 bytes (6%) of program storage space. Maximum is 32256 bytes.',
    'Global variables use 24 bytes (1%) of dynamic memory, leaving 2024 bytes for local variables. Maximum is 2048 bytes.',
    'Sketch uses 0 bytes (0%) of program storage space. Maximum is 0 bytes.',
  ].join('\r\n'));
  assert.deepEqual(report.map(row => [row.source, row.region, row.used, row.capacity]), [
    ['GNU ld','SRAM1',1536,1024], ['GNU ld','UNUSED',0,2097152], ['PlatformIO','RAM',8123,81920],
    ['PlatformIO','Flash',116736,1048576], ['Arduino','Flash',2048,32256], ['Arduino','RAM',24,2048],
  ]);
  const job = { output: 'RAM: [ ] 1% (used 1 bytes from 100 bytes)', startedAt: new Date().toISOString(), status: 'succeeded' };
  assert.deepEqual(validationResult({ ...job, validation: { kind: 'test' } }).memoryRegions, []);
  assert.deepEqual(parseMemoryUsage('Program size: 12048 bytes'), []);
});
