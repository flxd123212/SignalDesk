import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { execFileSync } from 'node:child_process';
import assert from 'node:assert/strict';
import { nodeKinds } from '../shared/nodes.mjs';
import { graphTest } from '../server/testing.mjs';

const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'signaldesk-codegen-'));
try {
  let count = 0;
  for (const [kind, definition] of Object.entries(nodeKinds).filter(([kind]) => !['source', 'display', 'output'].includes(kind))) {
    const graph = {
      nodes: [{ id: 'source', data: { kind: 'source' } }, { id: 'node', data: { ...definition, kind } }, { id: 'out', data: { kind: 'display' } }],
      edges: [...Array.from({ length: definition.inputs }, (_, index) => ({ source: 'source', sourceHandle: `ch${index + 1}`, target: 'node', targetHandle: ['a', 'b', 'c'][index] })), { source: 'node', sourceHandle: 'out', target: 'out', targetHandle: 'a' }],
    };
    const result = graphTest({ graph, raw: [2, 4, 8], format: 'c', duration: 0.32 });
    const filename = path.join(directory, `${kind}.c`), executable = path.join(directory, `${kind}.exe`);
    await fs.writeFile(filename, result.code + '\n#include <stdio.h>\nint main(void) { float values[SIGNALDESK_CHANNELS]; for (int i = 0; i < 32; ++i) { if (!signaldesk_next(values)) return 2; printf("%.9g\\n", (double)values[0]); } return 0; }\n');
    try { execFileSync('cl.exe', ['/nologo', '/W4', '/WX', '/std:c11', '/TC', filename, `/Fo${path.join(directory, kind + '.obj')}`, `/Fe${executable}`], { cwd: directory, windowsHide: true, stdio: 'pipe' }); }
    catch (error) { console.error(error.stdout?.toString(), error.stderr?.toString()); throw error; }
    const actual = execFileSync(executable, [], { windowsHide: true, encoding: 'utf8' }).trim().split(/\s+/).map(Number);
    result.samples.forEach((sample, index) => assert.ok(Math.abs(sample.values[0] - actual[index]) < 0.0001 * Math.max(1, Math.abs(sample.values[0])), `${kind} sample ${index}`));
    count++;
  }
  console.log(`MSVC /W4 /WX: ${count} generated C graphs compiled and matched preview samples.`);
} finally { await fs.rm(directory, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }); }
