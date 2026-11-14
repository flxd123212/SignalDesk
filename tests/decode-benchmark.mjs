import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { StreamParser, encodeSample, crc16Modbus } from '../server/protocol.mjs';
import { BinaryParser } from '../server/frames.mjs';
import { SerialEngine } from '../server/engine.mjs';

const count = 200000, rows = [], directory = await fs.mkdtemp(path.join(os.tmpdir(), 'signaldesk-throughput-'));
const schema = { header: 'AA 55', length: 20, endian: 'LE', checksum: 'modbus', fields: Array.from({ length: 4 }, (_, i) => ({ name: `ch${i}`, type: 'f32', offset: 2 + i * 4 })) };
try {
  for (const protocol of ['firewater', 'json', 'justfloat', 'custom']) {
    const frames = Array.from({ length: count }, (_, i) => {
      const values = [i, i / 4, -i, 3.25];
      if (protocol !== 'custom') return encodeSample(values, protocol);
      const bytes = Buffer.alloc(20); bytes[0] = 0xaa; bytes[1] = 0x55; values.forEach((value, channel) => bytes.writeFloatLE(value, 2 + channel * 4)); bytes.writeUInt16LE(crc16Modbus(bytes.subarray(0, 18)), 18); return bytes;
    });
    const bytes = Buffer.concat(frames), parser = protocol === 'custom' ? new BinaryParser(schema) : new StreamParser(protocol);
    let parsed = 0, previous = -1; const begin = performance.now();
    for (let offset = 0; offset < bytes.length; offset += 16384) for (const sample of parser.push(bytes.subarray(offset, offset + 16384))) { assert.equal(sample[0], previous + 1); previous = sample[0]; parsed++; }
    const parserMs = performance.now() - begin; assert.equal(parsed, count); assert.equal(parser.errors, 0); assert.equal(parser.buffer.length, 0);
    const engine = new SerialEngine({ directory }); engine.config = { ...engine.config, path: 'BENCHMARK-NO-HARDWARE', protocol, sampleRate: 100000, ...(protocol === 'custom' ? { schema } : {}) }; engine.reset();
    const started = performance.now(); for (let offset = 0; offset < bytes.length; offset += 16384) engine.receive(bytes.subarray(offset, offset + 16384), 'RX', false); const engineMs = performance.now() - started;
    assert.equal(engine.sampleIndex, count); assert.equal(engine.parser.errors, 0); await engine.dispose();
    rows.push({ protocol, frames: count, bytes: bytes.length, parserMs: +parserMs.toFixed(2), parserMBps: +(bytes.length / parserMs / 1000).toFixed(2), engineMs: +engineMs.toFixed(2), engineMBps: +(bytes.length / engineMs / 1000).toFixed(2), sequenceErrors: 0, parseErrors: 0 });
  }
  const report = { at: new Date().toISOString(), node: process.version, platform: process.platform, cpu: os.cpus()[0]?.model, chunkBytes: 16384, scope: 'CPU-only parser and engine benchmark. No physical UART, Bluetooth, disk recording, WebSocket or browser load. Not a hardware throughput guarantee.', rows };
  await fs.mkdir('artifacts', { recursive: true }); await fs.writeFile('artifacts/decode-benchmark.json', JSON.stringify(report, null, 2)); console.table(rows);
} finally { await fs.rm(directory, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }); }
