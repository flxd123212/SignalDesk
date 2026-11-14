import { crc16Modbus, parseHex } from './protocol.mjs';

const types = { u8: [1, 'readUInt8'], i8: [1, 'readInt8'], u16: [2, 'readUInt16'], i16: [2, 'readInt16'], u32: [4, 'readUInt32'], i32: [4, 'readInt32'], f32: [4, 'readFloat'], f64: [8, 'readDouble'] };
export function validateSchema(input) {
  const schema = structuredClone(input);
  if (!schema || !Number.isInteger(schema.length) || schema.length < 2 || schema.length > 4096) throw new Error('帧长度应为 2..4096 字节');
  const header = parseHex(schema.header);
  if (header.length > 16 || header.length >= schema.length) throw new Error('帧头长度无效');
  if (!['none', 'modbus', 'sum8'].includes(schema.checksum) || !['LE', 'BE'].includes(schema.endian)) throw new Error('校验或字节序无效');
  const end = schema.length - (schema.checksum === 'modbus' ? 2 : schema.checksum === 'sum8' ? 1 : 0);
  if (header.length > end || !Array.isArray(schema.fields) || !schema.fields.length || schema.fields.length > 16) throw new Error('帧字段无效');
  const names = new Set();
  for (const field of schema.fields) {
    if (!/^[a-zA-Z_][a-zA-Z0-9_]{0,31}$/.test(field.name) || names.has(field.name)) throw new Error('字段名必须唯一，使用英文、数字、下划线');
    names.add(field.name);
    if (!types[field.type] || !Number.isInteger(field.offset) || field.offset < header.length || field.offset + types[field.type][0] > end) throw new Error(`字段越界：${field.name}`);
    field.scale ??= 1; field.bias ??= 0;
    if (!Number.isFinite(field.scale) || !Number.isFinite(field.bias)) throw new Error('字段缩放无效');
  }
  return schema;
}

export function inspectFrame(bytes, schema) {
  if (bytes.length !== schema.length) throw new Error(`需要 ${schema.length} 字节，实际 ${bytes.length}`);
  const crcLength = schema.checksum === 'modbus' ? 2 : schema.checksum === 'sum8' ? 1 : 0;
  const body = bytes.subarray(0, bytes.length - crcLength);
  const expected = schema.checksum === 'modbus' ? crc16Modbus(body) : schema.checksum === 'sum8' ? body.reduce((sum, byte) => (sum + byte) & 255, 0) : null;
  const actual = schema.checksum === 'modbus' ? bytes.readUInt16LE(bytes.length - 2) : schema.checksum === 'sum8' ? bytes.at(-1) : null;
  const headerValid = bytes.subarray(0, Buffer.from(schema.header.replace(/0x|\s/gi, ''), 'hex').length).equals(parseHex(schema.header));
  const fields = schema.fields.map(field => {
    const [length, method] = types[field.type];
    const raw = bytes[method + (length === 1 ? '' : schema.endian)](field.offset);
    return { ...field, raw, value: raw * field.scale + field.bias };
  });
  return { valid: headerValid && expected === actual && fields.every(field => Number.isFinite(field.value)), headerValid, checksum: { expected, actual, valid: expected === actual }, fields };
}

export class BinaryParser {
  constructor(input) { this.schema = validateSchema(input); this.header = parseHex(this.schema.header); this.buffer = Buffer.alloc(0); this.errors = 0; this.crcErrors = 0; this.resyncBytes = 0; this.lastFrame = null; }
  push(chunk) {
    this.buffer = Buffer.concat([this.buffer, chunk]); const samples = [];
    while (this.buffer.length >= this.header.length) {
      const start = this.buffer.indexOf(this.header);
      if (start < 0) { const keep = this.header.length - 1; this.resyncBytes += this.buffer.length - keep; this.buffer = keep ? this.buffer.subarray(-keep) : Buffer.alloc(0); break; }
      if (start) { this.resyncBytes += start; this.buffer = this.buffer.subarray(start); }
      if (this.buffer.length < this.schema.length) break;
      const frame = this.buffer.subarray(0, this.schema.length);
      this.lastFrame = { ...inspectFrame(frame, this.schema), hex: frame.toString('hex') };
      if (this.lastFrame.valid) { samples.push(this.lastFrame.fields.map(field => field.value)); this.buffer = this.buffer.subarray(this.schema.length); }
      else { this.errors++; if (!this.lastFrame.checksum.valid) this.crcErrors++; this.resyncBytes++; this.buffer = this.buffer.subarray(1); }
    }
    return samples;
  }
}

export function inspectModbus(text, direction = 'response') {
  const bytes = parseHex(text);
  if (bytes.length < 5 || bytes.length > 256) throw new Error('Modbus RTU 帧长度无效');
  const expected = crc16Modbus(bytes.subarray(0, -2)), actual = bytes.readUInt16LE(bytes.length - 2);
  const result = { slave: bytes[0], function: bytes[1], crcValid: expected === actual, expected, actual, registers: [], valid: true };
  if (bytes[1] & 128) { result.exception = bytes[2]; result.valid = bytes.length === 5; }
  else if (direction === 'response' && [3, 4].includes(bytes[1])) {
    result.byteCount = bytes[2]; result.valid = bytes[2] % 2 === 0 && bytes.length === bytes[2] + 5;
    if (result.valid) for (let offset = 3; offset < bytes.length - 2; offset += 2) result.registers.push({ index: (offset - 3) / 2, unsigned: bytes.readUInt16BE(offset), signed: bytes.readInt16BE(offset), hex: bytes.subarray(offset, offset + 2).toString('hex').toUpperCase() });
  } else if ([3, 4, 6].includes(bytes[1])) {
    result.valid = bytes.length === 8;
    if (result.valid) { result.address = bytes.readUInt16BE(2); result.value = bytes.readUInt16BE(4); }
  } else result.valid = false;
  result.valid &&= result.crcValid && result.slave >= 1 && result.slave <= 247;
  return result;
}
