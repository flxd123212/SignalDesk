import fs from 'node:fs/promises';
import path from 'node:path';
import { EventEmitter } from 'node:events';

const MAX_BYTES = 128 * 1024 * 1024;

// Desktop supplies OS-backed encryption. Standalone servers never persist keys.
export class AgentStore extends EventEmitter {
  constructor(filename, encryption = null) {
    super(); this.filename = filename; this.encryption = encryption; this.queue = Promise.resolve();
    this.timer = null; this.snapshot = null; this.blocked = false;
    this.status = { mode: encryption ? 'encrypted' : 'local', state: 'saved', savedAt: null, error: '' };
  }
  update(patch) { this.status = { ...this.status, ...patch }; this.emit('status'); }
  async load() {
    try {
      if ((await fs.stat(this.filename)).size > MAX_BYTES) throw new Error('oversized');
      const envelope = JSON.parse(await fs.readFile(this.filename, 'utf8'));
      if (envelope.version !== 1) throw new Error('version');
      let data;
      if (envelope.mode === 'encrypted') {
        if (!this.encryption || typeof envelope.payload !== 'string') throw new Error('encryption unavailable');
        data = JSON.parse(await this.encryption.decrypt(Buffer.from(envelope.payload, 'base64')));
      } else if (envelope.mode === 'local') data = envelope.data;
      if (!data || data.version !== 1 || !Array.isArray(data.sessions) || data.sessions.length > 96) throw new Error('format');
      this.update({ savedAt: envelope.savedAt || null });
      return { data, encrypted: envelope.mode === 'encrypted' };
    } catch (error) {
      if (error.code !== 'ENOENT') {
        // Keep the original intact if another account cannot decrypt it or it is damaged.
        this.blocked = true;
        this.update({ state: 'error', error: '无法读取已保存的 Agent 数据，原文件已保留。请使用原系统账户，或备份并移走 agent-state.json 后重启。' });
      }
      return null;
    }
  }
  schedule(snapshot) {
    this.snapshot = snapshot;
    if (this.blocked) return;
    if (this.status.state !== 'pending') this.update({ state: 'pending', error: '' });
    if (!this.timer) this.timer = setTimeout(() => { this.timer = null; void this.flush().catch(() => {}); }, 300);
  }
  async flush() {
    clearTimeout(this.timer); this.timer = null;
    if (this.blocked) throw new Error(this.status.error);
    const snapshot = this.snapshot; this.snapshot = null;
    if (snapshot) {
      this.queue = this.queue.catch(() => {}).then(async () => {
        try {
          const data = snapshot(!!this.encryption), text = JSON.stringify(data), savedAt = new Date().toISOString();
          if (Buffer.byteLength(text) > MAX_BYTES / 1.5) throw new Error('oversized');
          const envelope = this.encryption
            ? { version: 1, mode: 'encrypted', savedAt, payload: (await this.encryption.encrypt(text)).toString('base64') }
            : { version: 1, mode: 'local', savedAt, data };
          await fs.mkdir(path.dirname(this.filename), { recursive: true });
          await fs.writeFile(this.filename + '.tmp', JSON.stringify(envelope), { mode: 0o600 });
          await fs.rename(this.filename + '.tmp', this.filename);
          this.update({ state: this.snapshot ? 'pending' : 'saved', savedAt, error: '' });
        } catch {
          this.update({ state: 'error', error: 'Agent 数据保存失败，请检查用户数据目录的空间和写入权限。' });
          throw new Error(this.status.error);
        }
      });
    }
    await this.queue;
  }
}
