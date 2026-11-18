import { randomUUID } from 'node:crypto';
import { StringDecoder } from 'node:string_decoder';

function text(value, max = 200) {
  return typeof value === 'string' && !!value.trim() && value.length <= max && !/[\r\n\0]/.test(value);
}

// Match complete protocol lines only. The first partial line after the request
// cannot be distinguished from a fresh line, so require an exact field or prefix.
export function valueFromLine(line, field, format) {
  if (format === 'prefix') return line.startsWith(field) ? line.slice(field.length).trim() : undefined;
  let obj;
  try {
    obj = JSON.parse(line);
  } catch {
    return;
  }
  for (const key of field.split('.')) {
    if (!obj || typeof obj !== 'object' || !Object.hasOwn(obj, key)) return;
    obj = obj[key];
  }
  return typeof obj === 'number' || typeof obj === 'string' ? obj : undefined;
}

export function watchReadback(engine, { field, format = 'json', timeout = 5000, accept = () => true }) {
  if (
    !text(field) ||
    !['json', 'prefix'].includes(format) ||
    !Number.isInteger(timeout) ||
    timeout < 100 ||
    timeout > 30000
  )
    throw new Error('回报字段、格式或超时时间无效');
  let pending = '',
    overflow = false,
    finish;
  const decoder = new StringDecoder('utf8');
  const promise = new Promise((resolve, reject) => {
    const packet = (p) => {
      if (p.dir !== 'RX') return;
      const chunks = (pending + decoder.write(Buffer.from(p.data, 'base64'))).split('\n');
      pending = chunks.pop();
      for (const raw of chunks) {
        if (overflow) {
          overflow = false;
          continue;
        }
        if (raw.length > 16384) continue;
        const value = valueFromLine(raw.trim(), field, format);
        if (value !== undefined && accept(value)) {
          finish(null, { value, at: p.time });
          return;
        }
      }
      if (pending.length > 16384) {
        pending = '';
        overflow = true;
      }
    };
    const timer = setTimeout(() => finish(new Error('等待设备回报超时')), timeout);
    finish = (error, result) => {
      clearTimeout(timer);
      engine.off('packet', packet);
      error ? reject(error) : resolve(result);
    };
    engine.on('packet', packet);
  });
  promise.catch(() => {});
  return { promise, cancel: () => finish(new Error('回报监听已结束')) };
}

export async function tuneParameter(engine, input) {
  const {
    name,
    unit = '',
    min,
    max,
    value,
    writeCommand,
    readCommand = '',
    field,
    format = 'json',
    timeout = 5000,
  } = input;
  if (
    !text(name, 80) ||
    typeof unit !== 'string' ||
    unit.length > 24 ||
    ![min, max, value].every(Number.isFinite) ||
    min >= max ||
    value < min ||
    value > max
  )
    throw new Error('参数名称、范围或请求值无效');
  if (
    !text(writeCommand, 512) ||
    !writeCommand.includes('{value}') ||
    (readCommand !== '' && !text(readCommand, 512))
  )
    throw new Error('写命令须包含 {value}，命令必须为单行');
  if (
    !text(field) ||
    !['json', 'prefix'].includes(format) ||
    !Number.isInteger(timeout) ||
    timeout < 100 ||
    timeout > 30000
  )
    throw new Error('读回配置无效');
  if (
    !engine.connected ||
    !['serial', 'tcp'].includes(engine.source) ||
    engine.automationLock ||
    engine.flashLock ||
    engine.sendInterval
  )
    throw new Error('请连接空闲的实际设备');
  const lock = randomUUID(),
    generation = engine.generation;
  engine.automationLock = lock;
  let listener,
    sentAt = Date.now();
  const onState = () => {
    if (!engine.connected || generation !== engine.generation) listener?.cancel();
  };
  engine.on('state', onState);
  try {
    const listen = () =>
      watchReadback(engine, {
        field,
        format,
        timeout,
        accept: (v) => String(v).trim() !== '' && Number.isFinite(Number(v)),
      });
    if (!readCommand) listener = listen();
    await engine.send(
      { text: writeCommand.replaceAll('{value}', String(value)), ending: input.ending || 'lf' },
      lock,
    );
    if (!engine.connected || generation !== engine.generation) throw new Error('写入后连接已变化');
    if (readCommand) {
      listener = listen();
      await engine.send({ text: readCommand, ending: input.ending || 'lf' }, lock);
    }
    const reply = await listener.promise;
    return {
      name,
      unit,
      requested: value,
      reported: Number(reply.value),
      sentAt,
      receivedAt: reply.at,
      status: Number(reply.value) === value ? 'matched' : 'different',
    };
  } finally {
    listener?.cancel();
    engine.off('state', onState);
    if (engine.automationLock === lock) engine.automationLock = null;
  }
}
