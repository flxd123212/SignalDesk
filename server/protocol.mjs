import iconv from 'iconv-lite';
import { mixedBytes } from '../shared/mixed-payload.mjs';
const FLOAT_TAIL = Buffer.from([0, 0, 128, 127]);
export const PROTOCOLS = ['firewater', 'justfloat', 'json', 'raw', 'custom'];
export const ENCODINGS = ['utf8', 'gb18030', 'utf16le', 'latin1'];

export function crc16Modbus(bytes) {
  let crc = 0xffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ ((crc & 1) ? 0xa001 : 0);
  }
  return crc;
}

export function parseHex(text) {
  const value = String(text).replace(/0x/gi, '').replace(/\s/g, '');
  if (!value || !/^[\da-f]+$/i.test(value) || value.length % 2) {
    throw new Error('HEX 数据必须为完整的十六进制字节，例如 01 03 00 00');
  }
  if (value.length > 131072) throw new Error('单次发送不能超过 64 KiB');
  return Buffer.from(value, 'hex');
}

export function encodePayload({ text, format = 'text', ending = 'crlf', checksum = 'none', encoding = 'utf8' }) {
  if (typeof text !== 'string' || text.length > (format === 'text' ? 65536 : 327680) || !text.length) throw new Error('发送内容为空或超过 64 KiB');
  if (!['text', 'hex', 'mixed'].includes(format)) throw new Error('无效的发送格式');
  if (!['none', 'lf', 'crlf', 'cr'].includes(ending)) throw new Error('无效的行结束符');
  if (!['none', 'modbus', 'sum8'].includes(checksum)) throw new Error('无效的校验方式');
  if (!ENCODINGS.includes(encoding)) throw new Error('不支持的字符编码');
  const suffix = { none: '', lf: '\n', crlf: '\r\n', cr: '\r' }[ending];
  let bytes = format === 'hex' ? parseHex(text) : format === 'mixed' ? Buffer.concat([Buffer.from(mixedBytes(text)), Buffer.from(suffix, 'ascii')]) : iconv.encode(text + suffix, encoding);
  if (bytes.length > 65536) throw new Error('单次发送不能超过 64 KiB');
  if (checksum === 'modbus') {
    const crc = crc16Modbus(bytes);
    bytes = Buffer.concat([bytes, Buffer.from([crc & 255, crc >>> 8])]);
  } else if (checksum === 'sum8') {
    bytes = Buffer.concat([bytes, Buffer.from([bytes.reduce((sum, byte) => (sum + byte) & 255, 0)])]);
  }
  if (bytes.length > 65536) throw new Error('附加校验后的数据不能超过 64 KiB');
  return bytes;
}

export class StreamParser {
  constructor(protocol = 'firewater') {
    if (!PROTOCOLS.includes(protocol)) throw new Error('未知的数据协议');
    this.protocol = protocol;
    this.buffer = Buffer.alloc(0);
    this.errors = 0;
    this.discardLine = false;
  }

  push(chunk) {
    if (this.protocol === 'raw') return [];
    const samples = [];
    this.buffer = Buffer.concat([this.buffer, chunk]);
    if (this.protocol === 'justfloat') {
      let end;
      while ((end = this.buffer.indexOf(FLOAT_TAIL)) >= 0) {
        const frame = this.buffer.subarray(0, end);
        this.buffer = this.buffer.subarray(end + 4);
        if (frame.length < 4 || frame.length % 4 || frame.length > 64) { this.errors++; continue; }
        const values = [];
        for (let offset = 0; offset < frame.length; offset += 4) values.push(frame.readFloatLE(offset));
        if (values.every(Number.isFinite)) samples.push(values);
        else this.errors++;
      }
      // Retain a possible split delimiter while waiting for a complete frame.
      if (this.buffer.length > 8192) { this.buffer = this.buffer.subarray(-3); this.errors++; }
      return samples;
    }
    let end;
    while ((end = this.buffer.indexOf(10)) >= 0) {
      const raw = this.buffer.subarray(0, end);
      this.buffer = this.buffer.subarray(end + 1);
      if (this.discardLine) { this.discardLine = false; continue; }
      if (raw.length > 16384) { this.errors++; continue; }
      const line = raw.toString('utf8').trim();
      if (!line) continue;
      try {
        let values;
        if (this.protocol === 'json') {
          const parsed = JSON.parse(line);
          values = Array.isArray(parsed) ? parsed : Object.entries(parsed)
            .filter(([key]) => !['t', 'time', 'timestamp'].includes(key)).map(([, value]) => value);
        } else {
          const content = line.includes(':') ? line.slice(line.indexOf(':') + 1) : line;
          const tokens = content.replace(/,+$/, '').split(/[,;\t]/).map(value => value.trim());
          if (tokens.some(value => !value || !/^[+-]?(?:\d+\.?\d*|\.\d+)(?:e[+-]?\d+)?$/i.test(value))) throw new Error('not numeric');
          values = tokens.map(Number);
        }
        if (!values.length || values.length > 16 || !values.every(value => typeof value === 'number' && Number.isFinite(value))) throw new Error('invalid values');
        samples.push(values);
      } catch { this.errors++; }
    }
    if (this.buffer.length > 16384) { this.buffer = Buffer.alloc(0); this.discardLine = true; this.errors++; }
    return samples;
  }
}

export function encodeSample(values, protocol) {
  if (protocol === 'justfloat') {
    const bytes = Buffer.alloc(values.length * 4 + 4);
    values.forEach((value, index) => bytes.writeFloatLE(value, index * 4));
    FLOAT_TAIL.copy(bytes, values.length * 4);
    return bytes;
  }
  return Buffer.from((protocol === 'json' ? JSON.stringify(values) : values.map(value => value.toFixed(4)).join(',')) + '\r\n');
}

export function importSSCOM(text) {
  const commands = [];
  for (const line of text.split(/\r?\n/)) {
    const match = /^N(\d+)=([AH]),(.*)$/.exec(line.trim());
    if (!match || Number(match[1]) > 32 || !match[3].trim()) continue;
    commands.push({ id: `sscom-${match[1]}-${Date.now()}`, name: `指令 ${match[1]}`, text: match[3], format: match[2] === 'H' ? 'hex' : 'text', ending: 'crlf', checksum: 'none' });
  }
  return commands;
}
