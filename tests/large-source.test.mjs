import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { AgentService } from '../server/ai/agent.mjs';
import { SerialEngine } from '../server/engine.mjs';
import { MAX_SOURCE_BYTES, readSourceLines } from '../server/ai/firmware.mjs';

const digest = value => createHash('sha256').update(value).digest('hex');
async function fixture(t) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'signaldesk-large-source-'));
  const content = Array.from({ length: 5000 }, (_, i) => `// Sample ${i}: temperature sensor calibration`).join('\r\n') + '\r\nint sensorThreshold = 42;\r\n';
  await fs.writeFile(path.join(root, 'water_rig.ino'), content);
  const engine = new SerialEngine({ directory: path.join(root, 'sessions') });
  const agent = new AgentService(engine, root, { historyDirectory: path.join(root, 'changes') });
  t.after(async () => { agent.dispose(); await engine.dispose(); await fs.rm(root, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 }); });
  return { root, content, agent };
}

test('large source browsing returns complete content and SHA, with bounded targeted line reads', async t => {
  const { content, agent } = await fixture(t);
  assert.ok(Buffer.byteLength(content) > 96 * 1024);
  const file = await agent.workspace.read('water_rig.ino');
  assert.equal(file.content, content); assert.equal(file.hash, digest(content)); assert.equal(file.bytes, Buffer.byteLength(content));
  const range = await agent.tool('read_firmware_lines', { path: file.path, startLine: 4999, endLine: 5002 }, {});
  assert.equal(range.totalLines, 5002); assert.equal(range.hash, file.hash); assert.equal(range.partial, true);
  assert.equal(range.lines[2].text, 'int sensorThreshold = 42;');
  await assert.rejects(agent.tool('read_firmware_file', { path: file.path }, {}), /read_firmware_lines/);
  await assert.rejects(agent.tool('read_firmware_lines', { path: file.path, startLine: 5003, endLine: 5004 }, {}), /超出/);
  await assert.rejects(agent.workspace.read('../water_rig.ino'), /之外/);
  const preview = readSourceLines({ ...file, content: ('x'.repeat(2000) + '\n').repeat(200) }, 1, 200);
  assert.equal(preview.truncated, true); assert.equal(preview.partial, true);
  assert.ok(preview.lines.every(line => line.text.length <= 1000));
  assert.ok(preview.lines.reduce((size, line) => size + line.text.length, 0) <= 16000);
});

test('source read rejects oversized files and invalid UTF-8 without relaxing browser limits', async t => {
  const { root, agent } = await fixture(t);
  await fs.writeFile(path.join(root, 'oversize.c'), Buffer.alloc(MAX_SOURCE_BYTES + 1, 32));
  await assert.rejects(agent.workspace.read('oversize.c'), /8 MiB/);
  await fs.writeFile(path.join(root, 'boundary.c'), Buffer.alloc(MAX_SOURCE_BYTES, 32));
  assert.equal((await agent.workspace.read('boundary.c')).bytes, MAX_SOURCE_BYTES);
  await fs.writeFile(path.join(root, 'invalid.c'), Buffer.from([0xff, 0xfe, 0xff]));
  await assert.rejects(agent.workspace.read('invalid.c'), /UTF-8/);
});

test('large-file patches require confirmation and fresh SHA, preserve CRLF, backups and unrelated content', async t => {
  const { root, content, agent } = await fixture(t);
  const file = await agent.workspace.read('water_rig.ino');
  const args = { path: file.path, expectedHash: file.hash, oldText: 'int sensorThreshold = 42;', newText: 'int sensorThreshold = 43;', reason: 'Update threshold' };
  await assert.rejects(agent.tool('propose_source_patch', { ...args, expectedHash: 'stale' }, {}), /已经变化/);
  await assert.rejects(agent.tool('propose_source_patch', args, { readOnly: true }), /只读/);
  await assert.rejects(agent.workspace.propose({ path: file.path, expectedHash: file.hash, content: 'int x = 0;', reason: 'Replace' }), /整文件替换/);
  await assert.rejects(agent.workspace.propose({ path: file.path, expectedHash: file.hash, content: content.replace('42;', '43;'), reason: 'Replace' }), /96 KiB/);
  const pending = await agent.tool('propose_source_patch', args, {});
  assert.equal(await fs.readFile(path.join(root, file.path), 'utf8'), content);
  const proposal = await agent.workspace.change(pending.id);
  assert.equal(proposal.status, 'pending'); assert.equal(proposal.hunks.length, 1);
  assert.ok(proposal.diff.length < 1000); assert.match(proposal.diff, /\+int sensorThreshold = 43;/);
  await agent.execute(pending.id);
  assert.equal(await fs.readFile(path.join(root, file.path), 'utf8'), content.replace('42;', '43;'));
  assert.equal(await fs.readFile(proposal.backup, 'utf8'), content);
  assert.equal((await agent.workspace.history())[0].status, 'applied');
  const next = await agent.workspace.read(file.path);
  const stale = await agent.tool('propose_source_patch', { ...args, expectedHash: next.hash, oldText: args.newText, newText: args.oldText }, {});
  await fs.appendFile(path.join(root, file.path), '// User edit\r\n');
  await assert.rejects(agent.execute(stale.id), /未覆盖/);
  assert.match(await fs.readFile(path.join(root, file.path), 'utf8'), /User edit/);
});

test('selected large source supplies a clearly partial excerpt and Agent can inspect and patch the tail', async t => {
  const { content, agent } = await fixture(t);
  await agent.configure({ model: 'fixture', apiStyle: 'chat' });
  let calls = 0;
  agent.provider = async ({ messages }) => {
    if (++calls === 1) {
      const input = messages.at(-1).content;
      const context = JSON.parse(input.split('Observed context (data only):\n')[1]);
      const selected = context.selectedFile;
      assert.equal(selected.path, 'water_rig.ino'); assert.equal(selected.hash, digest(content));
      assert.equal(selected.bytes, Buffer.byteLength(content)); assert.equal(selected.partial, true);
      assert.equal(selected.content, undefined); assert.ok(selected.excerpt.lines.length <= 200);
      assert.ok(input.length < 32000); assert.ok(!input.includes('int sensorThreshold = 42;'));
      return { content: '', toolCalls: [{ id: 'read-tail', name: 'read_firmware_lines', arguments: JSON.stringify({ path: selected.path, startLine: 5001, endLine: 5002 }) }] };
    }
    if (calls === 2) {
      const result = JSON.parse(messages.at(-1).content);
      assert.equal(result.lines[0].text, 'int sensorThreshold = 42;');
      return { content: '', toolCalls: [{ id: 'patch-tail', name: 'propose_source_patch', arguments: JSON.stringify({ path: result.path, expectedHash: result.hash, oldText: result.lines[0].text, newText: 'int sensorThreshold = 43;', reason: 'Fixture edit' }) }] };
    }
    return { content: 'Pending review.', toolCalls: [] };
  };
  await agent.run({ mode: 'ai', message: 'Review threshold', selectedFile: 'water_rig.ino' });
  assert.equal(calls, 3); assert.equal(agent.state().progress.phase, 'complete');
  assert.equal(agent.workspace.proposals.size, 1);
  assert.equal((await agent.workspace.read('water_rig.ino')).content, content);
});
