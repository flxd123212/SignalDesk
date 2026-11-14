import fs from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';

export class EventLog {
  constructor(directory) { this.directory = directory; this.entries = []; this.queue = Promise.resolve(); this.pending = 0; this.bytes = 0; this.failure = ''; this.secrets = new Set(); }
  async init() {
    await fs.mkdir(this.directory, { recursive: true });
    try {
      const content = await fs.readFile(path.join(this.directory, 'events.jsonl'), 'utf8'); this.bytes = Buffer.byteLength(content);
      this.entries = content.trim().split('\n').slice(-2000).flatMap(line => { try { return [JSON.parse(line)]; } catch { return []; } });
    } catch (error) { if (error.code !== 'ENOENT') this.failure = error.message; }
  }
  redact(value) {
    let text = JSON.stringify(value, (key, item) => /api.?key|authorization|password|secret/i.test(key) ? '[REDACTED]' : item);
    for (const secret of this.secrets) if (secret) text = text.split(secret).join('[REDACTED]');
    return JSON.parse(text);
  }
  write({ level = 'info', category = 'system', device = '', message, data = null }) {
    const entry = this.redact({ id: randomUUID(), time: new Date().toISOString(), level, category, device, message: String(message).slice(0, 4000), data });
    this.entries.push(entry); this.entries = this.entries.slice(-2000);
    if (this.pending >= 2000) { this.failure = '审计日志写入积压，部分记录未写入磁盘'; return; }
    const line = JSON.stringify(entry) + '\n'; this.pending++;
    this.queue = this.queue.then(async () => {
      if (this.bytes + Buffer.byteLength(line) > 8 * 1024 * 1024) {
        await fs.rm(path.join(this.directory, 'events.4.jsonl'), { force: true });
        for (let index = 3; index >= 0; index--) {
          const from = path.join(this.directory, index ? `events.${index}.jsonl` : 'events.jsonl');
          try { await fs.rename(from, path.join(this.directory, `events.${index + 1}.jsonl`)); } catch (error) { if (error.code !== 'ENOENT') throw error; }
        }
        this.bytes = 0;
      }
      await fs.appendFile(path.join(this.directory, 'events.jsonl'), line); this.bytes += Buffer.byteLength(line);
    }).catch(error => { this.failure = error.message; }).finally(() => { this.pending--; });
  }
  filter(entries, query) {
    const { level = '', device = '', search = '', category = '' } = query;
    return entries.filter(entry => (!level || entry.level === level) && (!device || entry.device === device) && (!category || entry.category === category) && (!search || JSON.stringify(entry).toLowerCase().includes(String(search).toLowerCase())));
  }
  list(query = {}) { return { entries: this.filter(this.entries, query).slice(-500).reverse(), failure: this.failure, retained: this.entries.length }; }
  async export(query) {
    await this.queue;
    const entries = [];
    for (let index = 4; index >= 0; index--) {
      try { const content = await fs.readFile(path.join(this.directory, index ? `events.${index}.jsonl` : 'events.jsonl'), 'utf8'); for (const line of content.split('\n')) { try { entries.push(JSON.parse(line)); } catch { /* Ignore an incomplete final record. */ } } }
      catch (error) { if (error.code !== 'ENOENT') throw error; }
    }
    return this.filter(entries, query).map(entry => JSON.stringify(entry)).join('\n');
  }
}
