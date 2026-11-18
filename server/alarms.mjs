import { EventEmitter } from 'node:events';
import { randomUUID } from 'node:crypto';

export function validateAlarmRules(input) {
  if (!Array.isArray(input) || input.length > 32) throw new Error('每个设备最多 32 条报警规则');
  const seen = new Set();
  return input.map(rule => {
    if (!rule || typeof rule.id !== 'string' || !rule.id || rule.id.length > 80 || seen.has(rule.id)) throw new Error('报警规则标识无效');
    seen.add(rule.id);
    if (!['range', 'jump', 'stale', 'connection'].includes(rule.kind) || typeof rule.name !== 'string' || !rule.name.trim() || rule.name.length > 80 || typeof rule.enabled !== 'boolean') throw new Error('报警名称或类型无效');
    if (!Number.isInteger(rule.channel) || rule.channel < 0 || rule.channel > 15) throw new Error('报警通道应为 1..16');
    for (const key of ['holdMs', 'cooldownMs', 'timeoutMs']) if (!Number.isInteger(rule[key]) || rule[key] < 0 || rule[key] > 3600000) throw new Error('报警时间参数应为 0..3600000 ms');
    if (rule.cooldownMs < 500 || rule.timeoutMs < 100) throw new Error('冷却时间至少 500 ms，断流时间至少 100 ms');
    if (rule.kind === 'range') {
      if (rule.min === null && rule.max === null) throw new Error('至少设置一个阈值');
      for (const key of ['min', 'max']) if (rule[key] !== null && !Number.isFinite(rule[key])) throw new Error('阈值必须为有限数值');
      if (rule.min !== null && rule.max !== null && rule.min >= rule.max) throw new Error('报警下限必须小于上限');
    }
    if (rule.kind === 'jump' && (!Number.isFinite(rule.delta) || rule.delta <= 0)) throw new Error('突变阈值必须大于 0');
    return { id: rule.id, name: rule.name, kind: rule.kind, enabled: rule.enabled, channel: rule.channel, min: rule.min ?? null, max: rule.max ?? null, delta: rule.delta ?? 1, holdMs: rule.kind === 'jump' || rule.kind === 'connection' ? 0 : rule.holdMs, cooldownMs: rule.cooldownMs, timeoutMs: rule.timeoutMs };
  });
}

export class AlarmMonitor {
  constructor(rules, emit, now = Date.now) { this.rules = validateAlarmRules(rules); this.emit = emit; this.now = now; this.context = new Map(); this.reset(); }
  reset() { const now = this.now(); this.context = new Map(this.rules.map(rule => [rule.id, { pending: null, active: false, lastNotified: -Infinity, previous: undefined, lastSampleAt: now }])); }
  evaluate(rule, bad, value, detail, now) {
    const state = this.context.get(rule.id);
    if (!bad) {
      if (state.active) this.emit({ rule: rule.id, name: rule.name, kind: 'recovered', value, message: `${rule.name} 已恢复正常` });
      state.pending = null; state.active = false; return;
    }
    if (state.pending === null) state.pending = now;
    if (!state.active && now - state.pending >= rule.holdMs && now - state.lastNotified >= rule.cooldownMs) {
      state.active = true; state.lastNotified = now;
      this.emit({ rule: rule.id, name: rule.name, kind: rule.kind, value, channel: rule.channel, message: `${rule.name}: ${detail}` });
    }
  }
  samples(samples) {
    const now = this.now();
    for (const sample of samples) for (const rule of this.rules.filter(rule => rule.enabled)) {
      const state = this.context.get(rule.id), value = sample.values[rule.channel];
      if (!Number.isFinite(value)) continue;
      state.lastSampleAt = now;
      if (rule.kind === 'range') this.evaluate(rule, (rule.min !== null && value < rule.min) || (rule.max !== null && value > rule.max), value, `CH${rule.channel + 1} = ${value.toFixed(4)}，范围 ${rule.min ?? '-∞'}..${rule.max ?? '+∞'}`, now);
      if (rule.kind === 'jump') { const delta = state.previous === undefined ? 0 : Math.abs(value - state.previous); this.evaluate(rule, delta > rule.delta, value, `CH${rule.channel + 1} 突变 ${delta.toFixed(4)} > ${rule.delta}`, now); }
      if (rule.kind === 'stale') this.evaluate(rule, false, value, '', now);
      state.previous = value;
    }
  }
  tick() {
    const now = this.now();
    for (const rule of this.rules.filter(rule => rule.enabled && rule.kind === 'stale')) { const elapsed = now - this.context.get(rule.id).lastSampleAt; this.evaluate(rule, elapsed >= rule.timeoutMs, null, `CH${rule.channel + 1} 已 ${elapsed} ms 无有效采样`, now); }
  }
  disconnected() { const now = this.now(); for (const rule of this.rules.filter(rule => rule.enabled && rule.kind === 'connection')) this.evaluate(rule, true, null, '设备连接意外断开', now); }
}

export class AlarmService extends EventEmitter {
  constructor(hub, logs) {
    super(); this.hub = hub; this.logs = logs; this.monitors = new Map(); this.events = [];
    for (const entry of logs.entries || []) if (entry.category === 'alarm' && entry.data?.id) {
      if (entry.data.kind) this.events.unshift({ ...entry.data });
      else { const event = this.events.find(event => event.id === entry.data.id); if (event) event.acknowledged = true; }
    }
    this.events = this.events.slice(0, 300);
    this.sync = () => {
      for (const [id, item] of this.monitors) if (!hub.devices.has(id)) { item.dispose(); this.monitors.delete(id); }
      for (const device of hub.devices.values()) if (!this.monitors.has(device.id)) this.observe(device);
    };
    this.sync(); hub.on('state', this.sync);
    this.timer = setInterval(() => { for (const { device, monitor } of this.monitors.values()) if (device.engine.connected) monitor.tick(); }, 100);
  }
  observe(device) {
    const engine = device.engine, monitor = new AlarmMonitor(device.alarmRules || [], event => this.record(device, event));
    let connected = engine.connected;
    const samples = values => { if (engine.connected || (engine.source==='replay' && engine.replay?.channelName)) monitor.samples(values); };
    const reset = () => monitor.reset();
    const state = () => { if (connected !== engine.connected) { connected = engine.connected; monitor.reset(); } };
    const notice = event => { if (connected && !engine.connected && event.level === 'error') monitor.disconnected(); };
    engine.on('samples', samples); engine.on('reset', reset); engine.on('state', state); engine.on('notice', notice);
    this.monitors.set(device.id, { device, monitor, dispose: () => { engine.off('samples', samples); engine.off('reset', reset); engine.off('state', state); engine.off('notice', notice); } });
  }
  record(device, details) {
    const event = { ...details, id: randomUUID(), device: device.id, deviceName: device.name, time: new Date().toISOString(), acknowledged: false };
    this.events.unshift(event); this.events = this.events.slice(0, 300);
    this.logs.write({ category: 'alarm', device: device.id, level: details.kind === 'recovered' ? 'info' : 'warn', message: details.message, data: event });
    this.emit('alarm', event); return event;
  }
  state() { return { rules: this.hub.devices.get(this.hub.activeId).alarmRules || [], events: this.events, active: [...this.monitors.values()].flatMap(({ device, monitor }) => [...monitor.context.entries()].filter(([, state]) => state.active).map(([rule]) => ({ device: device.id, rule }))) }; }
  configure(input) {
    if (input.deviceId !== this.hub.activeId) throw new Error('当前设备已切换');
    const device = this.hub.devices.get(input.deviceId), rules = validateAlarmRules(input.rules);
    device.alarmRules = rules; const monitor = this.monitors.get(device.id).monitor; monitor.rules = rules; monitor.reset(); this.hub.emitState(); return this.state();
  }
  acknowledge(id) {
    const event = this.events.find(event => event.id === id); if (!event) throw new Error('报警记录不存在');
    event.acknowledged = true; this.logs.write({ category: 'alarm', device: event.device, message: '报警已确认', data: { id } }); return this.state();
  }
  dispose() { clearInterval(this.timer); this.hub.off('state', this.sync); for (const item of this.monitors.values()) item.dispose(); }
}
