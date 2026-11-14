import test from 'node:test';
import assert from 'node:assert/strict';
import { StreamParser, crc16Modbus, encodePayload, encodeSample, importSSCOM, parseHex } from '../server/protocol.mjs';

test('CRC16 matches the Modbus check vector and little-endian wire order', () => {
  assert.equal(crc16Modbus(Buffer.from('123456789')), 0x4b37);
  assert.equal(encodePayload({ text: '01 03 00 00 00 02', format: 'hex', checksum: 'modbus' }).toString('hex'), '010300000002c40b');
});

test('text endings are explicit and hex input rejects truncated or invalid bytes', () => {
  assert.equal(encodePayload({ text: 'AT', ending: 'crlf' }).toString(), 'AT\r\n');
  assert.equal(encodePayload({ text: '01 02', format: 'hex', ending: 'crlf' }).toString('hex'), '0102');
  assert.deepEqual([...parseHex('0x01 0xFF')], [1, 255]);
  for (const invalid of ['F', 'GG', '12.34', '']) assert.throws(() => parseHex(invalid));
  assert.equal(encodePayload({ text: 'ab'.repeat(65536), format: 'hex' }).length, 65536);
});

test('FireWater handles fragmented lines, named frames and interleaved log messages', () => {
  const parser = new StreamParser('firewater');
  assert.deepEqual(parser.push(Buffer.from('sensor:1.25,2')), []);
  assert.deepEqual(parser.push(Buffer.from('.5,-3e-2\r\nBoot ready\n2,3,4,\n')), [[1.25, 2.5, -0.03], [2, 3, 4]]);
  assert.equal(parser.errors, 1);
});

test('JustFloat works at every possible packet split and rejects non-finite samples', () => {
  const bytes = Buffer.concat([encodeSample([1.25, -7.5, 0], 'justfloat'), encodeSample([3.5, 4.25], 'justfloat')]);
  for (let split = 0; split <= bytes.length; split++) {
    const parser = new StreamParser('justfloat');
    assert.deepEqual([...parser.push(bytes.subarray(0, split)), ...parser.push(bytes.subarray(split))], [[1.25, -7.5, 0], [3.5, 4.25]]);
  }
  const parser = new StreamParser('justfloat');
  assert.deepEqual(parser.push(encodeSample([NaN], 'justfloat')), []);
  assert.equal(parser.errors, 1);
});

test('oversized text frames are dropped as a whole and parser recovers', () => {
  const parser = new StreamParser('firewater');
  parser.push(Buffer.from('1'.repeat(17000)));
  assert.deepEqual(parser.push(Buffer.from('2,3\n4,5\n')), [[4, 5]]);
  assert.equal(parser.buffer.length, 0);
});

test('JSON values keep channel order and exclude timestamp metadata', () => {
  const parser = new StreamParser('json');
  assert.deepEqual(parser.push(Buffer.from('[1,2]\n{"t":123,"voltage":3.3,"current":0.2}\n')), [[1, 2], [3.3, 0.2]]);
  assert.deepEqual(parser.push(Buffer.from('{"state":"ready"}\n')), []);
});

test('raw mode never interprets arbitrary bytes as samples', () => {
  assert.deepEqual(new StreamParser('raw').push(Buffer.from('1,2,3\n')), []);
});

test('SSCOM import excludes settings and preserves ASCII / HEX commands', () => {
  const commands = importSSCOM('; config\r\nN1=A,AT\r\nN2=H,01 03\r\nN3=A,\r\nN33=,not a preset\r\nN80=,COM6');
  assert.equal(commands.length, 2);
  assert.equal(commands[0].text, 'AT');
  assert.equal(commands[1].format, 'hex');
});
