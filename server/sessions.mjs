import fs from 'node:fs';
import path from 'node:path';
import { once, EventEmitter } from 'node:events';

export class SessionStore extends EventEmitter {
  constructor(directory) { super(); this.directory = directory; this.recording = null; this.pendingStart = null; }

  start(config) {
    if (this.recording || this.pendingStart) return Promise.reject(new Error('已有录制正在进行'));
    this.pendingStart = this.open(config);
    return this.pendingStart.finally(() => { this.pendingStart = null; });
  }

  async open(config) {
    await fs.promises.mkdir(this.directory, { recursive: true });
    const id = `${new Date().toISOString().replace(/[:.]/g, '-')}-${Math.random().toString(36).slice(2, 6)}.jsonl`;
    const stream = fs.createWriteStream(path.join(this.directory, id), { flags: 'wx' });
    await once(stream, 'open');
    stream.on('error', error => { this.recording = null; this.emit('failure', error); });
    stream.write(JSON.stringify({ kind: 'signaldesk', version: 1, createdAt: new Date().toISOString(), config }) + '\n');
    this.recording = { id, stream, started: performance.now(), bytes: 0 };
    return id;
  }

  write(direction, bytes) {
    const current = this.recording;
    if (!current) return;
    current.stream.write(JSON.stringify({ time: performance.now() - current.started, dir: direction, data: bytes.toString('base64') }) + '\n');
    current.bytes += bytes.length;
    if (current.stream.writableLength > 2 * 1024 * 1024) {
      void this.stop().catch(() => {});
      this.emit('failure', new Error('磁盘写入跟不上采集速度，录制已停止'));
    }
  }

  async stop() {
    if (this.pendingStart) await this.pendingStart.catch(() => {});
    const current = this.recording;
    if (!current) return null;
    this.recording = null;
    const complete = once(current.stream, 'finish');
    current.stream.end();
    await complete;
    return current.id;
  }

  resolve(id) {
    if (typeof id !== 'string' || !/^[a-zA-Z0-9_.-]+\.jsonl$/.test(id)) throw new Error('无效的录制文件名');
    return path.join(this.directory, id);
  }

  async list() {
    await fs.promises.mkdir(this.directory, { recursive: true });
    const names = (await fs.promises.readdir(this.directory)).filter(name => name.endsWith('.jsonl')).sort().reverse();
    const results = [];
    for (const id of names.slice(0, 200)) {
      const stat = await fs.promises.stat(this.resolve(id));
      results.push({ id, bytes: stat.size, modified: stat.mtime.toISOString(), active: this.recording?.id === id });
    }
    return results;
  }

  async load(id) {
    if (this.recording?.id === id) throw new Error('请先停止录制');
    const filename = this.resolve(id);
    if ((await fs.promises.stat(filename)).size > 32 * 1024 * 1024) throw new Error('第一版回放支持 32 MiB 以内的录制');
    return parseSession(await fs.promises.readFile(filename, 'utf8'));
  }

  async import(text) {
    parseSession(text);
    await fs.promises.mkdir(this.directory, { recursive: true });
    const id = `import-${Date.now()}-${Math.random().toString(36).slice(2, 6)}.jsonl`;
    await fs.promises.writeFile(this.resolve(id), text, { flag: 'wx' });
    return id;
  }
}

export function parseSession(text) {
  if (typeof text !== 'string' || Buffer.byteLength(text) > 32 * 1024 * 1024) throw new Error('录制文件不能超过 32 MiB');
  const lines = text.trim().split('\n');
  if (lines.length < 2 || lines.length > 200001) throw new Error('录制为空或超过 200000 个数据包');
  const header = JSON.parse(lines[0]);
  if (header.kind !== 'signaldesk' || header.version !== 1 || !header.config) throw new Error('不是受支持的 SignalDesk 录制');
  let previous = -1;
  const packets = lines.slice(1).map(line => {
    const packet = JSON.parse(line);
    if (!Number.isFinite(packet.time) || packet.time < 0 || packet.time < previous || packet.time > 86400000 || !['RX', 'TX'].includes(packet.dir) || typeof packet.data !== 'string' || packet.data.length > 90000 || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(packet.data)) throw new Error('录制中存在无效数据包');
    previous = packet.time;
    return packet;
  });
  return { header, packets, duration: packets.at(-1).time };
}
