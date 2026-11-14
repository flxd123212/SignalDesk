import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { DeviceHub } from '../server/devices.mjs';
import { AgentRegistry } from '../server/ai/registry.mjs';
import { ProjectValidation } from '../server/validation.mjs';
import { parseDiagnostics, validationResult } from '../server/diagnostics.mjs';
import { buildPlan, findExecutable } from '../server/ai/build.mjs';
import { startServer } from '../server/index.mjs';
import { sourceFingerprint } from '../server/validation-sources.mjs';

const cmake = 'cmake_minimum_required(VERSION 3.20)\nproject(SignalDeskValidation C)\nenable_testing()\nadd_executable(sample src/main.c)\nadd_test(NAME arithmetic COMMAND sample)\n';
async function fixture(t, files = { 'CMakeLists.txt': cmake, 'src/main.c': 'int main(void) { return 0; }\n' }) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'signaldesk-validation-')), root = path.join(directory, 'project');
  for (const [filename, value] of Object.entries(files)) { await fs.mkdir(path.dirname(path.join(root, filename)), { recursive: true }); await fs.writeFile(path.join(root, filename), value); }
  const hub = new DeviceHub({ directory: path.join(directory, 'sessions') }), registry = new AgentRegistry(hub, root), logs = [];
  await registry.configure({ buildPreset: 'cmake' });
  const validation = new ProjectValidation(hub, registry, { write: entry => logs.push(entry) });
  t.after(async () => { registry.dispose(); await validation.dispose(); await hub.dispose(); await fs.rm(directory, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }); });
  return { root, directory, hub, registry, validation, logs };
}

test('compiler diagnostics parse GCC, MSVC, Keil and IAR and prevent outside-file jumps', () => {
  const root = path.resolve('fixture'), file = path.join(root, 'src', 'main.c');
  const output = `${file}:12:7: error: missing declaration\n${file}(20,4): warning C4101: unused variable\n"${file}", 31 Error[Pe020]: undefined identifier\n*** ERROR C141 IN LINE 40 OF src/main.c: syntax error\n../external.c:2: error: outside\n${file}:12:7: error: missing declaration`;
  const entries = parseDiagnostics(output, root); assert.equal(entries.length, 5);
  assert.deepEqual(entries.map(entry => entry.line), [12, 20, 31, 40, 2]);
  assert.equal(entries[0].path, 'src/main.c'); assert.equal(entries[1].severity, 'warning'); assert.equal(entries[4].path, '');
});

test('verification distinguishes compilation, executed tests, no tests and cancellation', () => {
  const job = { status: 'succeeded', startedAt: new Date().toISOString(), output: '', diagnostics: [] };
  assert.match(validationResult({ ...job, validation: { kind: 'build' } }).summary, /尚未验证设备/);
  assert.match(validationResult({ ...job, validation: { kind: 'test-build' } }).summary, /未执行测试用例/);
  const ctest = validationResult({ ...job, output: '50% tests passed, 1 tests failed out of 2', status: 'failed', validation: { kind: 'test' } });
  assert.deepEqual(ctest.tests, { total: 2, passed: 1, failed: 1 }); assert.match(ctest.summary, /1 个失败/);
  assert.match(validationResult({ ...job, output: 'No tests were found!!!', validation: { kind: 'test' } }).summary, /不能判定通过/);
  assert.match(validationResult({ ...job, output: '100% tests passed, 0 tests failed out of 2', status: 'cancelled', validation: { kind: 'test' } }).summary, /已取消/);
  assert.match(validationResult({ ...job, validation: { kind: 'build', sourceState: 'changed' } }).summary, /需要重新验证/);
});

test('test command plans separate native execution from board test compilation', () => {
  const plan = runner => buildPlan({ buildPreset: 'test', testRunner: runner, platformioEnvironment: 'unit.native' }, '.');
  assert.deepEqual(plan('platformio-native').args, ['test', '-e', 'unit.native', '--without-uploading']);
  assert.ok(plan('platformio-compile').args.includes('--without-testing'));
  const ctest = buildPlan({ buildPreset: 'test', testRunner: 'ctest', buildConfiguration: 'Release' }, '.');
  assert.ok(ctest.args.includes('--no-tests=error')); assert.ok(ctest.args.includes('Release'));
  assert.throws(() => buildPlan({ buildPreset: 'test', testRunner: 'platformio-native', platformioEnvironment: '--upload' }, '.'));
  assert.throws(() => buildPlan({ buildPreset: 'cmake', buildConfiguration: 'untrusted' }, '.'));
});

test('validation discovers CTest and PlatformIO native or compile-only targets', async t => {
  const { validation } = await fixture(t, { 'platformio.ini': '[env:host]\nplatform = native\n[env:board]\nplatform = espressif32\nboard = esp32dev\n', 'test/test_main.cpp': 'int main(){}', 'build/CTestTestfile.cmake': 'add_test(ok sample)' });
  const caps = await validation.capabilities({}); assert.equal(caps.choices.length, 3);
  assert.equal(caps.choices.find(item => item.id === 'pio:host').kind, 'test');
  assert.equal(caps.choices.find(item => item.id === 'pio:board').kind, 'test-build');
});

test('validation rejects changed source, configuration, device, session and read-only execution', async t => {
  const { root, validation, registry, hub } = await fixture(t);
  let plan = await validation.prepare({ kind: 'build' });
  await fs.appendFile(path.join(root, 'src/main.c'), '// changed\n');
  await assert.rejects(validation.execute({ id: plan.id, confirm: true }), /源码已变化/);
  plan = await validation.prepare({ kind: 'build' }); await registry.configure({ buildPreset: 'none' });
  await assert.rejects(validation.execute({ id: plan.id, confirm: true }), /配置已变化/);
  await registry.configure({ buildPreset: 'cmake' }); plan = await validation.prepare({ kind: 'build' });
  const parent = registry.active.id, child = registry.create({ parent, readOnly: true }); registry.select(child);
  await assert.rejects(validation.prepare({ kind: 'build' }), /只读/);
  await assert.rejects(validation.execute({ id: plan.id, confirm: true }), /不一致/);
  registry.select(parent); const device = hub.activeId; hub.select(hub.add('other'));
  await assert.rejects(validation.execute({ id: plan.id, confirm: true, deviceId: device }), /设备已切换/);
  assert.equal(registry.builder.child, null);
});

test('missing test entries cannot produce a successful run', async t => {
  const { validation } = await fixture(t);
  assert.equal((await validation.capabilities({})).choices.length, 0);
  await assert.rejects(validation.prepare({ kind: 'test', choiceId: 'ctest' }), /有效的测试目标/);
  assert.equal(validation.state({}).job, null);
});

test('validation fingerprint includes drivers, headers and CMake scripts but not generated builds', async t => {
  const { root } = await fixture(t, { 'src/main.c': 'int main(){}', 'Drivers/HAL/inc/device.h': '#define CLOCK 1', 'cmake/options.cmake': 'set(X 1)', 'build/generated.c': 'generated' });
  const initial = await sourceFingerprint(root); assert.equal(initial.files, 3);
  await fs.writeFile(path.join(root, 'build/generated.c'), 'changed generated');
  assert.equal((await sourceFingerprint(root)).fingerprint, initial.fingerprint);
  await fs.writeFile(path.join(root, 'Drivers/HAL/inc/device.h'), '#define CLOCK 2');
  assert.notEqual((await sourceFingerprint(root)).fingerprint, initial.fingerprint);
});

test('ordinary toolchain output is not mislabeled as a verified compilation', async t => {
  const { root, registry, validation } = await fixture(t);
  registry.builder.job = { status: 'succeeded', cwd: root, command: 'git status --short', output: '', startedAt: new Date().toISOString() };
  assert.equal(validation.state({}).job, null);
  const plan = await validation.prepare({ kind: 'build' });
  const original = registry.builder.job;
  registry.builder.start = async () => { registry.builder.child = {}; throw new Error('已有构建正在运行'); };
  await assert.rejects(validation.execute({ id: plan.id, confirm: true }), /已有构建/);
  assert.equal(registry.builder.job, original); registry.builder.child = null;
});

test('real C compiler and CTest report passing builds, failing tests and source diagnostics over HTTP', { timeout: 180000 }, async t => {
  try { await findExecutable('cmake'); await findExecutable('ctest'); } catch { t.skip('CMake/CTest are not installed'); return; }
  const { root, directory } = await fixture(t), runtime = await startServer({ port: 0, autoDemo: false, directory: path.join(directory, 'http', 'sessions'), listPorts: async () => [] });
  const call = async (route, data) => { const response = await fetch(`${runtime.address}/api${route}`, data ? { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data) } : {}); const result = await response.json(); if (!response.ok) throw new Error(result.error); return result; };
  const results = [];
  const run = async (kind, choiceId) => {
    const plan = await call('/validation/prepare', { kind, choiceId }), started = await call('/validation/execute', { id: plan.id, confirm: true });
    let state = started;
    for (let attempt = 0; attempt < 600; attempt++) {
      state = await call('/validation/state');
      if (state.job?.validation?.id === plan.id && !['running', 'checking'].includes(state.job.validation.sourceState)) { results.push(state.job); return state.job; }
      await delay(150);
    }
    throw new Error(`Validation timed out: ${JSON.stringify(state)}`);
  };
  try {
    await call('/ai/config', { root, buildPreset: 'cmake' });
    let job = await run('configure'); assert.equal(job.status, 'succeeded', job.output);
    job = await run('build'); assert.equal(job.status, 'succeeded', job.output); assert.equal(job.validation.sourceState, 'unchanged');
    job = await run('test', 'ctest'); assert.equal(job.tests.total, 1); assert.equal(job.tests.passed, 1); assert.equal(job.status, 'succeeded');
    await fs.writeFile(path.join(root, 'src/main.c'), 'int main(void) { return 1; }\n');
    await assert.rejects(call('/validation/prepare', { kind: 'test', choiceId: 'ctest' }), /不能用旧程序/);
    job = await run('build'); assert.equal(job.status, 'succeeded', job.output);
    job = await run('test', 'ctest'); assert.equal(job.status, 'failed'); assert.equal(job.tests.failed, 1);
    await fs.writeFile(path.join(root, 'src/main.c'), 'int main(void) {\n  return missing_value;\n}\n');
    job = await run('build'); assert.equal(job.status, 'failed'); assert.ok(job.diagnostics.some(item => item.path === 'src/main.c' && item.line === 2), job.output);
    assert.equal((await call('/validation/state')).history.length, 6);
    await fs.mkdir('artifacts', { recursive: true }); await fs.writeFile('artifacts/validation-compiler-results.json', JSON.stringify(results, null, 2));
  } finally { await runtime.close(); }
});
