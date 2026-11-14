import test from 'node:test';
import assert from 'node:assert/strict';
import { compileGraph, compileScript } from '../server/processing.mjs';

test('formula outputs can depend on earlier outputs and whitelisted functions', () => {
  const script = compileScript('voltage = ch1 * 2\ncurrent = abs(ch2)\npower = voltage * current\nwave = sin(pi / 2)');
  assert.deepEqual(script.names, ['voltage', 'current', 'power', 'wave']);
  assert.deepEqual(script.run([3, -2]), [6, 2, 12, 1]);
});

test('formula parser rejects object access, execution and unsupported control flow', () => {
  for (const source of ['result = globalThis.process', 'result = ch1.constructor()', 'result = Math.random()', 'while (true) {}', 'result = [1,2]', 'result = 2 ** 99999999', 'result = "text"']) assert.throws(() => compileScript(source));
  assert.throws(() => compileScript('x = ch1 / 0').run([1]), /非有限/);
  assert.throws(() => compileScript('x = ch9').run([1]), /非有限/);
});

const graph = () => ({
  nodes: [{ id: 'source', data: { kind: 'source' } }, { id: 'gain', data: { kind: 'gain', value: 2 } }, { id: 'filter', data: { kind: 'lowpass', value: 0.25 } }, { id: 'out', data: { kind: 'output', label: 'filtered' } }],
  edges: [{ source: 'source', sourceHandle: 'ch1', target: 'gain', targetHandle: 'a' }, { source: 'gain', sourceHandle: 'out', target: 'filter', targetHandle: 'a' }, { source: 'filter', sourceHandle: 'out', target: 'out', targetHandle: 'a' }],
});

test('graph executes in dependency order and maintains low-pass filter state', () => {
  const compiled = compileGraph(graph());
  assert.deepEqual(compiled.run([2]), [4]);
  assert.deepEqual(compiled.run([4]), [5]);
});

test('graph rejects cycles, duplicate inputs, absent ports and invalid parameters', () => {
  const cycle = graph(); cycle.edges[0] = { source: 'filter', sourceHandle: 'out', target: 'gain', targetHandle: 'a' };
  assert.throws(() => compileGraph(cycle), /环路/);
  const duplicate = graph(); duplicate.edges.push(duplicate.edges[0]);
  assert.throws(() => compileGraph(duplicate), /一条线/);
  const missing = graph(); missing.edges.shift();
  assert.throws(() => compileGraph(missing), /尚未连接/);
  const invalid = graph(); invalid.nodes[2].data.value = 2;
  assert.throws(() => compileGraph(invalid), /低通系数/);
});
