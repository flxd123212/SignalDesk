import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { setTimeout as delay } from 'node:timers/promises';
import { gccDirectory, gccPlan, discoverGcc } from '../server/gcc.mjs';
import { buildPlan } from '../server/ai/build.mjs';
import { scanProject } from '../server/project-profile.mjs';
import { startServer } from '../server/index.mjs';

test('GCC plans isolate configurations and validate project-local toolchain files', () => {
  const root = path.resolve('fixture'), config = { buildPreset: 'gcc', gccToolchainFile: 'cmake/arm-none-eabi.cmake' };
  assert.equal(gccPlan(config, root).command, 'cmake');
  assert.ok(gccPlan({ ...config, buildPreset: 'gcc-configure' }, root).args.includes('Ninja'));
  assert.notEqual(gccDirectory(config), gccDirectory({ ...config, buildConfiguration: 'Release' }));
  assert.throws(() => gccPlan({ ...config, gccToolchainFile: '../other.cmake' }, root));
  assert.throws(() => gccPlan({ ...config, gccCompiler: path.join(root, 'gcc.exe') }, root));
  assert.throws(() => buildPlan({ ...config, buildConfiguration: '--untrusted' }, root));
});

test('project scanner recognizes both ARM and RISC-V GCC toolchain targets', async () => {
  const report = await scanProject(path.resolve('firmware-examples/CrossCompileCheck'));
  assert.equal(report.targets.filter(item => item.kind === 'gcc').length, 2);
  assert.ok(report.targets.some(item => item.toolchain.gccToolchainFile === 'cmake/riscv32-unknown-elf.cmake'));
});

test('installed RISC-V GCC produces a real ELF and MAP through the validation API', { timeout: 120000 }, async t => {
  const compiler = (await discoverGcc()).find(item => item.name.startsWith('riscv32-unknown-elf-gcc'));
  if (!compiler) { t.skip('RISC-V cross compiler is not installed'); return; }
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'signaldesk-gcc-')), root = path.join(directory, 'CrossCompileCheck');
  await fs.cp('firmware-examples/CrossCompileCheck', root, { recursive: true });
  const runtime = await startServer({ port: 0, autoDemo: false, directory: path.join(directory, 'data', 'sessions'), listPorts: async () => [] });
  const call = async (route, data) => { const response = await fetch(`${runtime.address}/api${route}`, data ? { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data) } : {}); const result = await response.json(); if (!response.ok) throw new Error(result.error); return result; };
  const run = async kind => {
    const plan = await call('/validation/prepare', { kind }); await call('/validation/execute', { id: plan.id, confirm: true });
    for (let index = 0; index < 500; index++) { const { job } = await call('/validation/state'); if (job && !['running', 'checking'].includes(job.validation.sourceState)) return job; await delay(100); }
    throw new Error('GCC job timed out');
  };
  try {
    await call('/ai/config', { root, buildPreset: 'gcc', gccCompiler: compiler.path, gccToolchainFile: 'cmake/riscv32-unknown-elf.cmake' });
    assert.equal((await call('/validation/capabilities')).choices.length, 0);
    let job = await run('configure'); assert.equal(job.status, 'succeeded', job.output);
    job = await run('build'); assert.equal(job.status, 'succeeded', job.output);
    assert.equal(job.validation.sourceState, 'unchanged');
    assert.deepEqual(job.memoryRegions.map(({ region, capacity }) => [region, capacity]), [['FLASH', 65536], ['RAM', 16384]]);
    assert.ok(job.memoryRegions.every(item => item.used > 0 && item.used < item.capacity));
    const elf = job.artifacts.find(item => item.path.endsWith('.elf')); assert.match(elf.architecture, /RISC-V.*32 bit/);
    const bytes = await fs.readFile(path.join(root, elf.path)); assert.equal(bytes.readUInt16LE(18), 243); assert.equal(bytes.readUInt16LE(16), 2);
    assert.ok(job.artifacts.some(item => item.path.endsWith('.map')));
    assert.equal((await call('/state')).connected, false);
    await fs.mkdir('artifacts', { recursive: true }); await fs.writeFile('artifacts/gcc-cross-compile-result.json', JSON.stringify(job, null, 2));
  } finally { await runtime.close(); await fs.rm(directory, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }); }
});
