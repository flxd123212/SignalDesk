import fs from 'node:fs/promises';
import path from 'node:path';

const PRE = 10000,
  POST = 20000,
  MAX_ROWS = 4000,
  MAX_BYTES = 512 * 1024;

function append(bucket, row, keepRecent) {
  const size = row.data?.length || (row.values?.length || 1) * 12 + 64;
  if (keepRecent) {
    while (
      bucket.rows.length &&
      (row.at - bucket.rows[0].at > PRE ||
        bucket.bytes + size > MAX_BYTES ||
        bucket.rows.length >= MAX_ROWS)
    ) {
      const removed = bucket.rows.shift();
      bucket.bytes -= removed.size;
      if (row.at - removed.at <= PRE) bucket.dropped++;
    }
  }
  if (bucket.rows.length >= MAX_ROWS || bucket.bytes + size > MAX_BYTES) {
    bucket.dropped++;
    return;
  }
  bucket.rows.push({ ...row, size });
  bucket.bytes += size;
}
const buffer = () => ({ rows: [], bytes: 0, dropped: 0 });

export class IncidentStore {
  constructor(directory, hub, alarms, now = Date.now) {
    this.directory = directory;
    this.hub = hub;
    this.alarms = alarms;
    this.now = now;
    this.devices = new Map();
    this.open = new Map();
    this.waiting = new Map();
    this.queue = Promise.resolve();
    this.sync = () => {
      for (const [id, slot] of this.devices)
        if (!hub.devices.has(id)) {
          slot.detach();
          this.devices.delete(id);
        }
      for (const item of hub.devices.values()) if (!this.devices.has(item.id)) this.observe(item);
    };
    this.onAlarm = (event) => {
      if (!['recovered', 'test'].includes(event.kind)) this.capture(event);
    };
    this.sync();
    hub.on('state', this.sync);
    alarms.on('alarm', this.onAlarm);
  }
  observe(item) {
    const engine = item.engine,
      slot = {
        ring: buffer(),
        connected: engine.connected,
        scope: item.projectRoot,
        source: engine.source,
      };
    const add = (row) => {
      if (slot.scope !== item.projectRoot) {
        slot.scope = item.projectRoot;
        slot.ring = buffer();
        slot.lastTx = null;
        slot.lastSample = null;
      }
      append(slot.ring, row, true);
      if (row.type === 'TX') slot.lastTx = row;
      if (row.type === 'sample') slot.lastSample = row;
      for (const report of this.open.values())
        if (report.device === item.id && report.root === item.projectRoot && row.at <= report.end)
          append(report.after, row, false);
    };
    const packet = (p) =>
      add({
        at: p.time,
        type: p.dir,
        data: p.data.slice(0, 16384),
        bytes: p.length,
        truncated: p.data.length > 16384,
      });
    const samples = (batch) => {
      const at = this.now();
      for (const sample of batch)
        add({ at, type: 'sample', time: sample.time, values: sample.values.slice(0, 16) });
    };
    const state = () => {
      if (engine.connected) slot.source = engine.source;
      if (slot.connected === engine.connected) return;
      slot.connected = engine.connected;
      const at = this.now();
      add({ at, type: engine.connected ? 'connected' : 'disconnected' });
      if (engine.connected) {
        const report = this.waiting.get(item.id);
        if (report && report.root === item.projectRoot && report.port === engine.config.path) {
          report.reconnectedAt = at;
          this.waiting.delete(item.id);
          this.save(report);
        }
      }
    };
    // Record the triggering sample before the alarm monitor evaluates it.
    engine.prependListener('samples', samples);
    engine.on('packet', packet);
    engine.on('state', state);
    slot.detach = () => {
      engine.off('samples', samples);
      engine.off('packet', packet);
      engine.off('state', state);
    };
    this.devices.set(item.id, slot);
  }
  capture(event) {
    const slot = this.devices.get(event.device),
      item = this.hub.devices.get(event.device);
    if (!slot || !item) return;
    const at = this.now(),
      before = slot.ring.rows.filter((r) => r.at >= at - PRE);
    if (this.open.size >= 16) this.finish(this.open.values().next().value, 'capacity');
    const fw = item.runningFirmware;
    const report = {
      id: event.id,
      kind: event.kind,
      device: event.device,
      name: event.deviceName,
      root: item.projectRoot || '',
      port: item.engine.config.path,
      source: slot.source,
      channels: [...item.engine.names],
      firmware: fw?.port === item.engine.config.path && fw?.root === item.projectRoot ? fw : null,
      alarm: event.message,
      at,
      end: at + POST,
      status: 'collecting',
      before,
      beforeDropped: slot.ring.dropped,
      lastTx: slot.lastTx || null,
      lastSample: slot.lastSample || null,
      after: buffer(),
      reconnectedAt: null,
    };
    this.open.set(report.id, report);
    if (event.kind === 'connection') this.waiting.set(item.id, report);
    report.timer = setTimeout(() => this.finish(report, 'complete'), POST);
    report.timer.unref();
    this.save(report);
  }
  snapshot(report) {
    const { timer, after, ...fields } = report;
    return { ...fields, after: after.rows, afterDropped: after.dropped };
  }
  save(report) {
    const data = JSON.stringify(this.snapshot(report));
    this.queue = this.queue
      .catch(() => {})
      .then(async () => {
        await fs.mkdir(this.directory, { recursive: true });
        const dest = path.join(this.directory, report.id + '.json');
        await fs.writeFile(dest + '.tmp', data);
        await fs.rename(dest + '.tmp', dest);
        const files = (await fs.readdir(this.directory)).filter((f) => f.endsWith('.json'));
        if (files.length > 64) {
          const info = await Promise.all(
            files.map(async (f) => [f, (await fs.stat(path.join(this.directory, f))).mtimeMs]),
          );
          for (const [f] of info.sort((a, b) => a[1] - b[1]).slice(0, -64))
            await fs.unlink(path.join(this.directory, f));
        }
      });
    this.queue.catch((e) =>
      this.alarms.logs.write({ category: 'alarm-archive', level: 'error', message: e.message }),
    );
  }
  finish(report, status) {
    clearTimeout(report.timer);
    report.status = status;
    this.open.delete(report.id);
    this.save(report);
  }
  async get(id) {
    if (!/^[\da-f-]{36}$/i.test(id)) throw new Error('现场记录编号无效');
    const live = this.open.get(id);
    if (live) return this.snapshot(live);
    await this.queue;
    try {
      const data = JSON.parse(await fs.readFile(path.join(this.directory, id + '.json'), 'utf8'));
      if (data.status === 'collecting') data.status = 'interrupted';
      return data;
    } catch (e) {
      if (e.code === 'ENOENT') throw new Error('这条报警没有可用的现场记录');
      throw e;
    }
  }
  async dispose() {
    this.hub.off('state', this.sync);
    this.alarms.off('alarm', this.onAlarm);
    for (const slot of this.devices.values()) slot.detach();
    for (const report of this.open.values()) this.finish(report, 'interrupted');
    await this.queue;
  }
}
