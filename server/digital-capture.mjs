import fs from 'node:fs/promises';
import { parse } from 'csv-parse/sync';

// Input rows hold the level from the specified timestamp to the next change.
export async function decodeDigitalCsv(file, input) {
  const raw = parse(await fs.readFile(file, 'utf8'), {
    columns: true,
    bom: true,
    skip_empty_lines: true,
    trim: true,
    max_record_size: 4096,
  });
  if (raw.length < 2 || raw.length > 120000) throw new Error('CSV 需要 2 至 120000 行，时间列名为 time（秒）');
  const names = { i2c: ['scl', 'sda'], spi: ['clk', 'mosi', 'cs'], uart: ['rx'] }[input.protocol];
  if (!names) throw new Error('未知协议');
  const cols = names.map((pin) => input.pins?.[pin]);
  if (new Set(cols).size !== cols.length || cols.some((col) => !Object.hasOwn(raw[0], col) || col === 'time'))
    throw new Error('通道映射与 CSV 表头不符');
  let previous = -Infinity;
  const samples = raw.map((row, i) => {
    const time = Number(row.time);
    if (
      !row.time ||
      !Number.isFinite(time) ||
      time < 0 ||
      time <= previous ||
      cols.some((col) => !['0', '1'].includes(row[col]))
    )
      throw new Error(`第 ${i + 2} 行时间或数字电平无效`);
    previous = time;
    return [time, ...cols.map((col) => Number(row[col]))];
  });
  const rows = [],
    hex = (n) => '0x' + n.toString(16).toUpperCase().padStart(2, '0');
  let byte = 0,
    bits = 0,
    address = true,
    active = false;
  if (input.protocol === 'spi' && ![0, 1, 2, 3].includes(input.mode)) throw new Error('SPI 模式无效');
  if (input.protocol === 'uart' && (!Number.isInteger(input.baud) || input.baud < 50 || input.baud > 12000000))
    throw new Error('UART 波特率无效');
  for (let i = 1; i < samples.length; i++) {
    const [time, clk, data, cs] = samples[i],
      [, oldClk, oldData] = samples[i - 1];
    if (input.protocol === 'i2c') {
      if (clk && oldClk && data !== oldData) {
        active = !data;
        address = true;
        bits = 0;
        byte = 0;
        rows.push([time, active ? 'START' : 'STOP', '']);
      } else if (active && clk && !oldClk) {
        if (bits < 8) {
          byte = byte * 2 + data;
          bits++;
        } else {
          rows.push([
            time,
            address ? `${hex(byte >> 1)} ${byte & 1 ? 'R' : 'W'}` : hex(byte),
            data ? 'NACK' : 'ACK',
          ]);
          byte = 0;
          bits = 0;
          address = false;
        }
      }
    } else if (input.protocol === 'spi') {
      if (cs) {
        bits = 0;
        byte = 0;
        continue;
      }
      const rising = input.mode === 0 || input.mode === 3;
      if (clk !== oldClk && Boolean(clk) === rising) {
        byte = byte * 2 + data;
        if (++bits === 8) {
          rows.push([time, hex(byte), 'MOSI']);
          byte = 0;
          bits = 0;
        }
      }
    } else if (oldClk && !clk) {
      let cursor = i,
        value = 0;
      const bit = (offset) => {
        const t = time + offset / input.baud;
        while (cursor + 1 < samples.length && samples[cursor + 1][0] <= t) cursor++;
        return samples[cursor][1];
      };
      if (time + 9.5 / input.baud > samples.at(-1)[0]) {
        rows.push([time, '', '帧不完整']);
        break;
      }
      if (bit(0.5)) continue;
      for (let b = 0; b < 8; b++) value |= bit(1.5 + b) << b;
      rows.push([time, hex(value), bit(9.5) ? '8N1' : '停止位错误']);
      i = cursor;
    }
  }
  return {
    source: `CSV · ${input.protocol.toUpperCase()} · ${raw.length} 采样点`,
    columns: ['时间 / s', '事件 / 数据', '应答 / 格式'],
    rows: rows.slice(0, 4000),
    count: rows.length,
    pins: cols,
    samples: samples.slice(0, 1200),
  };
}
