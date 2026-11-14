import { parse } from 'csv-parse/sync';

export function analyzeCan({ text, format = 'csv', bitrate = 500000, duration = 0 }) {
  if (typeof text !== 'string' || Buffer.byteLength(text) > 4 * 1024 * 1024) throw new Error('CAN 记录不能超过 4 MiB');
  if (!Number.isInteger(bitrate) || bitrate < 1000 || bitrate > 1000000) throw new Error('经典 CAN 码率应为 1 kbit/s..1 Mbit/s；CAN FD 需单独适配');
  let records;
  if (format === 'csv') records = parse(text, { columns: true, skip_empty_lines: true, trim: true, max_record_size: 8192 });
  else if (format === 'candump') records = text.split(/\r?\n/).filter(line => line.trim()).map((line, index) => {
    if (line.includes('##')) throw new Error(`第 ${index + 1} 行是 CAN FD，本分析器仅计算经典 CAN`);
    const match = /^\s*\((\d+(?:\.\d+)?)\)\s+\S+\s+([\da-fA-F]{1,8})#([\da-fA-F]*|R[0-8]?)\s*$/.exec(line);
    if (!match) throw new Error(`第 ${index + 1} 行不是 candump -L 记录`);
    return { time: match[1], id: match[2], data: match[3].startsWith('R') ? '' : match[3], extended: match[2].length > 3, rtr: match[3].startsWith('R'), dlc: match[3].startsWith('R') ? Number(match[3].slice(1) || 0) : match[3].length / 2 };
  });
  else throw new Error('请选择 CSV 或 candump -L 格式');
  if (!records.length || records.length > 100000) throw new Error('CAN 记录应为 1..100000 帧');
  const frames = records.map((record, index) => {
    const time = Number(record.time), idText = String(record.id || '').replace(/^0x/i, ''), identifier = /^[\da-f]{1,8}$/i.test(idText) ? parseInt(idText, 16) : NaN;
    if (!Number.isFinite(time) || time < 0 || !Number.isInteger(identifier) || identifier > 0x1fffffff) throw new Error(`第 ${index + 1} 帧时间或十六进制 ID 无效`);
    const extended = record.extended === true || ['1', 'true'].includes(String(record.extended).toLowerCase()) || identifier > 0x7ff;
    const rtr = record.rtr === true || ['1', 'true'].includes(String(record.rtr).toLowerCase()), data = String(record.data || '').replace(/\s/g, '');
    if (!/^(?:[\da-f]{2}){0,8}$/i.test(data) || (rtr && data)) throw new Error(`第 ${index + 1} 帧数据无效；仅支持 0..8 字节经典 CAN`);
    const dlc = record.dlc === undefined || record.dlc === '' ? data.length / 2 : Number(record.dlc);
    if (!Number.isInteger(dlc) || dlc < 0 || dlc > 8 || (!rtr && data.length / 2 !== dlc)) throw new Error(`第 ${index + 1} 帧 DLC 与数据长度不一致`);
    const dataBits = rtr ? 0 : dlc * 8, baseBits = (extended ? 67 : 47) + dataBits;
    return { time, id: identifier.toString(16).toUpperCase().padStart(extended ? 8 : 3, '0'), extended, rtr, dlc, data: data.toUpperCase(), baseBits, upperBits: baseBits + Math.floor(((extended ? 54 : 34) + dataBits - 1) / 4), dataBits };
  });
  if (frames.some((frame, index) => index && frame.time < frames[index - 1].time)) throw new Error('CAN 时间戳必须单调递增；请检查时钟回绕或时间单位');
  const elapsed = frames.at(-1).time - frames[0].time;
  if (!Number.isFinite(duration) || duration < 0 || (duration > 0 && duration < elapsed)) throw new Error('观察时长不能小于记录时间跨度');
  const seconds = duration || elapsed;
  if (seconds <= 0) throw new Error('单时间戳记录需填写观察时长');
  const ids = new Map(), bins = new Map(), bucketSize = Math.max(0.1, seconds / 500);
  let lower = 0, upper = 0, payload = 0;
  for (const frame of frames) {
    lower += frame.baseBits; upper += frame.upperBits; payload += frame.dataBits;
    const key = `${frame.extended ? 'EXT' : 'STD'}:${frame.id}:${frame.rtr ? 'RTR' : 'DATA'}`;
    const entry = ids.get(key) || { key, id: frame.id, extended: frame.extended, rtr: frame.rtr, count: 0, last: null, minPeriod: Infinity, maxPeriod: 0, sumPeriod: 0, data: '' };
    if (entry.last !== null) { const gap = frame.time - entry.last; entry.minPeriod = Math.min(entry.minPeriod, gap); entry.maxPeriod = Math.max(entry.maxPeriod, gap); entry.sumPeriod += gap; }
    entry.count++; entry.last = frame.time; entry.data = frame.data; ids.set(key, entry);
    const bucket = Math.min(Math.ceil(seconds / bucketSize) - 1, Math.floor((frame.time - frames[0].time) / bucketSize));
    const current = bins.get(bucket) || { lower: 0, upper: 0, count: 0 }; current.lower += frame.baseBits; current.upper += frame.upperBits; current.count++; bins.set(bucket, current);
  }
  const percent = bits => bits / (bitrate * seconds) * 100;
  return { count: frames.length, duration: seconds, bitrate, framesPerSecond: frames.length / seconds, load: { lower: percent(lower), upper: percent(upper), payload: percent(payload) }, warnings: [
    '负载是未填充位到最大位填充的估算范围，含帧间隔；不是实测总线占用率。',
    '记录未提供错误帧、重发和 ACK/CRC 细节，不能据此计算真实误码率。',
    ...(percent(lower) > 100 ? ['最低估算负载已超过 100%，请检查时间单位、观察时长和码率。'] : []),
  ], ids: [...ids.values()].map(entry => ({ ...entry, rate: entry.count / seconds, meanPeriod: entry.count > 1 ? entry.sumPeriod / (entry.count - 1) : null, minPeriod: Number.isFinite(entry.minPeriod) ? entry.minPeriod : null })), timeline: Array.from({ length: Math.ceil(seconds / bucketSize) }, (_, index) => { const bucket = bins.get(index) || { lower: 0, upper: 0, count: 0 }, width = Math.min(bucketSize, seconds - index * bucketSize); return { time: index * bucketSize, lower: bucket.lower / (bitrate * width) * 100, upper: bucket.upper / (bitrate * width) * 100, count: bucket.count }; }) };
}
