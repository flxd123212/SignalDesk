import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { parseKiCadNetlist, HardwareStore, validateHardware, hardwareChecks, readProjectNetlist } from '../server/hardware.mjs';
import { createGraphPreset, connectionError, normalizeGraph, layoutGraph } from '../shared/graph-workbench.mjs';
import { compileGraph } from '../server/processing.mjs';
import { hardwareTestPlan } from '../shared/hardware-test.mjs';
import { FirmwareWorkspace } from '../server/ai/firmware.mjs';
import { graphTest } from '../server/testing.mjs';
import { execFileSync } from 'node:child_process';
import { buildPlan, commandPlan, findExecutable } from '../server/ai/build.mjs';
import { SerialEngine } from '../server/engine.mjs';
import { TestRunner } from '../server/automation.mjs';
import { sourceFingerprint } from '../server/validation-sources.mjs';
import { scanProject } from '../server/project-profile.mjs';

const netlistXml = '<export><components><comp ref="U1"><value>MCU</value></comp><comp ref="J1"><value>Header</value></comp></components><nets><net code="1" name="ADC_IN"><node ref="U1" pin="12" pinfunction="PA0"/><node ref="J1" pin="1"/></net></nets></export>';
const binding = { id: 'signal', name: 'voltage', ref: 'U1', pin: '12', gpio: 'PA0', net: 'ADC_IN', unit: 'V', channel: 0, source: 'main.py', line: 2, min: 0, max: 3.3 };

test('KiCad XML preserves physical pins and rejects ambiguous or entity-bearing input', () => {
  const netlist = parseKiCadNetlist(netlistXml, 'board.xml');
  assert.equal(netlist.nets[0].pins[0].pin, '12'); assert.equal(netlist.nets[0].pins[0].name, 'PA0');
  assert.equal(netlist.components.length, 2); assert.equal(netlist.hash.length, 64);
  assert.throws(() => parseKiCadNetlist('<!DOCTYPE export [<!ENTITY secret SYSTEM "file:///test">]>' + netlistXml), /DTD/);
  assert.throws(() => parseKiCadNetlist(netlistXml.replace('<node ref="J1" pin="1"/>', '<node ref="U1" pin="12"/>')), /多个连接/);
  assert.throws(() => parseKiCadNetlist(netlistXml.replace('ref="J1" pin="1"', 'ref="UNKNOWN" pin="1"')), /未知器件/);
});

test('hardware records persist per project/device and reject concurrent stale saves', async context => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'signaldesk-hardware-')); context.after(() => fs.rm(directory, { recursive: true, force: true }));
  const store = new HardwareStore(directory), root = path.join(directory, 'project');
  const patch = validateHardware({ board: 'Fixture', revision: 'A', bindings: [binding] });
  const writes = await Promise.allSettled([store.save(root, 'one', 0, patch), store.save(root, 'one', 0, patch)]);
  assert.equal(writes.filter(result => result.status === 'fulfilled').length, 1);
  assert.equal((await new HardwareStore(directory).load(root, 'one')).bindings[0].source, 'main.py');
  assert.equal((await store.load(root, 'two')).bindings.length, 0);
  assert.throws(() => validateHardware({ bindings: [{ ...binding, source: '../secret.py' }] }), /相对路径/);
  assert.throws(() => validateHardware({ bindings: [{ ...binding, channel: 16 }] }), /通道/);
  assert.equal(hardwareChecks(patch, parseKiCadNetlist(netlistXml)).length, 0);
  assert.match(hardwareChecks({ bindings: [{ ...binding, pin: '99' }] }, parseKiCadNetlist(netlistXml))[0].message, /未在导入网表/);
});

test('netlist importer cannot traverse outside the project', async context => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'signaldesk-netlist-')); context.after(() => fs.rm(directory, { recursive: true, force: true }));
  await fs.writeFile(path.join(directory, 'board.xml'), netlistXml);
  assert.equal((await readProjectNetlist(directory, 'board.xml')).components.length, 2);
  await assert.rejects(readProjectNetlist(directory, '../board.xml'));
  await assert.rejects(readProjectNetlist(directory, '.private.xml'));
});

test('all one-click node presets execute and stay within graph limits', () => {
  for (const name of ['channels', 'smooth', 'adc', 'ratio', 'magnitude', 'sensor', 'spike']) {
    const graph = createGraphPreset(name, ['x', 'y', 'z']);
    const result = compileGraph(graph).run([2, 4, 6]); assert.ok(result.every(Number.isFinite));
    assert.deepEqual(layoutGraph(graph), graph); assert.equal(normalizeGraph(graph).nodes.length, graph.nodes.length);
  }
  assert.equal(createGraphPreset('smooth', Array(16).fill('signal')).nodes.length, 33);
  assert.throws(() => createGraphPreset('ratio', ['one']), /至少两个/);
  const graph = createGraphPreset('smooth', ['signal']);
  assert.match(connectionError(graph, graph.edges[0]), /已连接/);
  assert.match(connectionError(graph, { source: 'source', sourceHandle: 'ch9', target: 'process0', targetHandle: 'a' }), /输出端口/);
  assert.throws(() => normalizeGraph({ nodes: [{ id: 'bad', data: { kind: 'unknown' } }], edges: [] }));
});

test('feedback test drafts require expected limits and new post-command data', () => {
  const plan = hardwareTestPlan({ command: 'SET 10', ack: 'OK', delay: 200, binding, board: 'Fixture', revision: 'A' });
  assert.deepEqual(plan.steps.map(step => step.type), ['send', 'expect', 'wait', 'assert']);
  assert.equal(plan.steps.at(-1).fresh, true);
  assert.throws(() => hardwareTestPlan({ command: 'SET 10', ack: 'OK', delay: 200, binding: { ...binding, min: null } }), /上下限/);
});

test('multilanguage source access preserves project isolation and excluded secrets', async context => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'signaldesk-languages-')); context.after(() => fs.rm(directory, { recursive: true, force: true }));
  for (const name of ['main.py', 'lib.rs', 'main.go', 'sensor.lua', 'logic.sv', 'index.ts', '.env', 'credential.pem']) await fs.writeFile(path.join(directory, name), 'fixture');
  const workspace = new FirmwareWorkspace(directory), files = await workspace.list();
  assert.equal(files.length, 6); assert.equal((await workspace.read('logic.sv')).content, 'fixture');
  await assert.rejects(workspace.read('.env')); await assert.rejects(workspace.read('credential.pem'));
});

test('generated JavaScript and Python graph programs reproduce local test samples', async context => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'signaldesk-graph-export-')); context.after(() => fs.rm(directory, { recursive: true, force: true }));
  const compare = (output, result) => { const actual = output.trim().split(/\r?\n/).map(row => row.split(',').map(Number)); assert.equal(actual.length, result.samples.length); actual.forEach((row, i) => row.forEach((value, channel) => assert.ok(Math.abs(value - result.samples[i].values[channel]) < 1e-9))); };
  let python; try { python = await findExecutable('python'); } catch { try { python = execFileSync('py', ['-3', '-c', 'import sys; print(sys.executable)'], { encoding: 'utf8', timeout: 10000 }).trim(); } catch { context.diagnostic('Python executable unavailable: generated Python not executed'); } }
  for (const preset of ['sensor', 'spike', 'magnitude', 'ratio', 'adc', 'smooth']) for (const format of ['javascript', 'python']) {
    const result = graphTest({ graph: createGraphPreset(preset, ['x', 'y', 'z']), format, duration: 0.2 });
    const filename = path.join(directory, result.filename); await fs.writeFile(filename, result.code);
    if (format === 'javascript') compare(execFileSync(process.execPath, [filename], { encoding: 'utf8', timeout: 10000 }), result);
    else if (python) compare(execFileSync(python, [filename], { encoding: 'utf8', timeout: 10000 }), result);
  }
});

test('fresh-feedback assertions reject old values even when new frames fail processing', async context => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'signaldesk-feedback-')); context.after(() => fs.rm(directory, { recursive: true, force: true }));
  const engine = new SerialEngine({ directory }); context.after(() => engine.dispose());
  engine.connected = true; engine.source = 'serial'; engine.receive(Buffer.from('2,4\n')); const runner = new TestRunner();
  engine.send = async () => { engine.processing = { names: ['value'], run() { throw new Error('bad sample'); } }; engine.receive(Buffer.from('3,5\n')); return 1; };
  await runner.start(engine, { steps: [{ type: 'send', text: 'X' }, { type: 'assert', channel: 0, min: 0, max: 3.3, fresh: true }] }); await runner.completion;
  assert.equal(runner.job.status, 'failed'); assert.match(runner.job.error, /新的有效采样/);
});

test('language tools have bounded plans and Rust/Go project detection', async context => {
  assert.deepEqual(commandPlan('cargo check --offline --locked', '.').args, ['check', '--offline', '--locked']);
  assert.throws(() => commandPlan('node -e "process.exit()"', '.'));
  assert.throws(() => commandPlan('cargo run', '.'));
  assert.deepEqual(buildPlan({ buildPreset: 'test', testRunner: 'python-unittest' }, '.').args, ['-B', '-m', 'unittest', 'discover', '-s', 'tests']);
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'signaldesk-project-languages-')); context.after(() => fs.rm(directory, { recursive: true, force: true }));
  await fs.mkdir(path.join(directory, 'src')); await fs.writeFile(path.join(directory, 'Cargo.toml'), '[package]\nname="fixture"\nversion="0.1.0"\n'); await fs.writeFile(path.join(directory, 'src/main.rs'), 'fn main() {}');
  assert.equal((await scanProject(directory)).targets[0].kind, 'cargo');
  const before = await sourceFingerprint(directory); await fs.writeFile(path.join(directory, 'src/main.rs'), 'fn main() { panic!("changed"); }'); assert.notEqual((await sourceFingerprint(directory)).fingerprint, before.fingerprint);
  await fs.writeFile(path.join(directory, 'go.mod'), 'module fixture\ngo 1.22\n'); assert.ok((await scanProject(directory)).targets.some(target => target.kind === 'go'));
});
