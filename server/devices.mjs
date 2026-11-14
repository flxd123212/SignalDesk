import { EventEmitter } from 'node:events';
import { SerialEngine } from './engine.mjs';

export class DeviceHub extends EventEmitter {
  constructor(options) {
    super(); this.options = options; this.devices = new Map(); this.activeId = ''; this.sequence = 0; this.selection = 0; this.reserved = new Set();
    this.add('设备 1');
    // Existing acquisition/Agent APIs address the selected device, never a shared byte stream.
    return new Proxy(this, { get: (hub, key) => {
      if (key === 'generation') return `${hub.selection}:${hub.active.generation}`;
      if (key in hub) { const value = Reflect.get(hub, key); return typeof value === 'function' ? value.bind(hub) : value; }
      const value = hub.active[key]; return typeof value === 'function' ? value.bind(hub.active) : value;
    } });
  }
  get active() { return this.devices.get(this.activeId).engine; }
  add(name = '', metadata = {}) {
    if (this.devices.size >= 8) throw new Error('最多同时打开 8 个设备');
    const restoredId = typeof metadata.id === 'string' && /^device-[1-9]\d{0,8}$/.test(metadata.id) ? metadata.id : '';
    if (restoredId && this.devices.has(restoredId)) throw new Error('设备标识重复');
    const id = restoredId || `device-${++this.sequence}`, engine = new SerialEngine(this.options);
    this.sequence = Math.max(this.sequence, Number(id.slice(7)));
    const label = String(name || `设备 ${this.sequence}`).slice(0, 40);
    if (metadata.config) { engine.config = metadata.config; engine.reset(); }
    engine.projectContext = metadata.projectProfile || null;
    this.devices.set(id, { name: label, chip: '', board: '', portBinding: null, projectRoot: '', ...metadata, id, engine });
    for (const event of ['state', 'reset', 'packet', 'samples', 'notice']) engine.on(event, value => {
      if (event === 'state') this.emitState();
      else if (this.activeId === id) this.emit(event, value);
    });
    if (!this.activeId) this.activeId = id;
    this.emitState(); return id;
  }
  list() { return [...this.devices.values()].map(({ id, name, chip, board, portBinding, projectRoot, projectProfile, engine }) => ({ id, name, chip, board, portBinding, projectRoot, projectProfile, connected: engine.connected, busy: engine.busy, path: engine.config.path, source: engine.source, recording: engine.store.recording?.id, rxBytes: engine.rxBytes, txBytes: engine.txBytes, latest: engine.latest, names: engine.names })); }
  state() { return { ...this.active.state(), activeDevice: this.activeId, devices: this.list() }; }
  emitState() { for (const entry of this.devices.values()) if (entry.projectProfile) entry.engine.projectContext = { ...entry.projectProfile, chip: entry.chip, board: entry.board, root: entry.projectRoot }; this.emit('state', this.state()); }
  select(id) {
    if (!this.devices.has(id)) throw new Error('设备不存在');
    this.activeId = id; this.selection++; this.emit('reset');
    this.emit('samples', this.active.history.slice());
    for (const packet of this.active.recentPackets) this.emit('packet', packet);
    this.emitState();
  }
  async remove(id) {
    if (this.devices.size < 2 || !this.devices.has(id)) throw new Error('至少保留一个设备');
    const entry = this.devices.get(id);
    if (entry.engine.busy || entry.engine.automationLock || entry.engine.flashLock) throw new Error('请先停止设备任务');
    await entry.engine.dispose(); this.devices.delete(id);
    if (this.activeId === id) this.select(this.devices.keys().next().value); else this.emitState();
  }
  async connect(config) {
    return this.connectDevice(this.activeId, config);
  }
  async connectDevice(id, config) {
    const selected = this.devices.get(id)?.engine;
    if (!selected) throw new Error('设备已关闭');
    const target = String(config.path).toLowerCase();
    if (this.reserved.has(target)) throw new Error('该端口正在烧录');
    if (target !== 'demo' && [...this.devices.values()].some(({ engine }) => engine !== selected && (engine.connected || engine.busy) && engine.config.path.toLowerCase() === target)) throw new Error('该端口已在另一个设备标签中打开');
    this.reserved.add(target);
    try { return await selected.connect(config); } finally { this.reserved.delete(target); }
  }
  async dispose() { await Promise.all([...this.devices.values()].map(({ engine }) => engine.dispose())); this.removeAllListeners(); }
}
