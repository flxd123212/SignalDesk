import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeTutorialState, tutorialForPage, tutorials } from '../shared/tutorials.mjs';
import { mixedBytes } from '../shared/mixed-payload.mjs';

test('tutorial catalog covers all workspaces with bounded, navigation-only actions', () => {
  assert.equal(new Set(tutorials.map(item => item.id)).size, tutorials.length);
  assert.equal(tutorials.length, 12);
  const actions = new Set(['project', 'discovery', 'connect', 'files', 'nodes', 'simple', 'settings:build', 'settings:ai']);
  const pages = new Set(['terminal', 'validation', 'workspace', 'hardware', 'circuit', 'automation', 'alarms', 'sessions', 'agent', 'external', 'logs', 'commands', 'frames', 'instruments', 'can', 'script', 'widgets', 'graph', 'attitude', 'tooling', 'display']);
  for (const guide of tutorials) {
    assert.ok(guide.title && guide.summary && guide.group); assert.ok(guide.steps.length >= 3 && guide.steps.length <= 5);
    for (const step of guide.steps) {
      assert.ok(step.title && step.body && step.expected && step.label);
      assert.ok(actions.has(step.action) || step.action.startsWith('page:') && pages.has(step.action.slice(5)), step.action);
      assert.ok(!/^(https?:|\/api\/|send:|run:)/.test(step.action));
    }
  }
  assert.equal(tutorialForPage('editor').id, 'project-build');
  assert.equal(tutorialForPage('hardware').id, 'hardware');
  assert.equal(tutorialForPage('workspace').id, 'signals');
  assert.equal(tutorialForPage('alarms').id, 'testing');
  assert.equal(tutorialForPage('agent').id, 'agent');
  assert.equal(tutorialForPage('can').id, 'instruments');
  assert.equal(tutorialForPage('attitude').id, 'models');
  assert.equal(tutorialForPage('unknown').id, 'first-device');
});

test('tutorial progress is bounded, defensive and safe to restore from older preferences', () => {
  for (const input of [null, [], true, 'invalid', undefined]) {
    const state = normalizeTutorialState(input);
    assert.equal(state.dismissed, false); assert.equal(state.lastGuide, 'first-device');
    assert.deepEqual(state.completed, []); assert.equal(Object.keys(state.positions).length, tutorials.length);
  }
  const input = { dismissed: 'yes', lastGuide: 'malformed', apiKey: 'never-save', completed: ['agent', 'agent', 'nonexistent'], positions: { agent: 999999, 'first-device': -2, models: '2', testing: Infinity } };
  const state = normalizeTutorialState(input);
  assert.equal(state.dismissed, false); assert.equal(state.lastGuide, 'first-device');
  assert.deepEqual(state.completed, ['agent']); assert.equal(state.positions.agent, 3);
  assert.equal(state.positions['first-device'], 0); assert.equal(state.positions.models, 0); assert.equal(state.positions.testing, 0);
  assert.equal(input.positions.agent, 999999); assert.ok(!JSON.stringify(state).includes('never-save'));
  const restored = normalizeTutorialState({ ...state, dismissed: true, lastGuide: 'agent' });
  assert.equal(restored.dismissed, true); assert.equal(restored.lastGuide, 'agent');
  assert.deepEqual(restored.positions, state.positions);
});

test('mixed-payload tutorial example uses the actual supported syntax and exact bytes', () => {
  const example = tutorials.find(item => item.id === 'commands').steps.find(step => step.code).code;
  assert.deepEqual([...mixedBytes(example)], [0x41, 0x54, 0x00, 0xff, 0x45, 0x4e, 0x44]);
});
