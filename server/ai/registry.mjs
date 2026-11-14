import { EventEmitter } from 'node:events';
import { randomUUID } from 'node:crypto';
import { AgentService } from './agent.mjs';
import { projectCommand } from '../project-setup.mjs';

export class AgentRegistry extends EventEmitter {
  constructor(hub, defaultRoot, historyDirectory = '', toolDefaults = {}) {
    super(); this.hub = hub; this.defaultRoot = defaultRoot; this.historyDirectory = historyDirectory; this.toolDefaults = toolDefaults; this.sessions = new Map(); this.selected = new Map(); this.deviceId = hub.activeId;
    this.ensure();
    hub.on('state', () => {
      for (const [id, entry] of this.sessions) if (!hub.devices.has(entry.device)) { entry.agent.dispose(); this.sessions.delete(id); }
      if (this.deviceId !== hub.activeId) { this.deviceId = hub.activeId; this.ensure(); this.changed(); }
    });
    return new Proxy(this, { get: (registry, key) => {
      if (key in registry) { const value = Reflect.get(registry, key); return typeof value === 'function' ? value.bind(registry) : value; }
      const value = registry.active.agent[key]; return typeof value === 'function' ? value.bind(registry.active.agent) : value;
    } });
  }
  get active() { return this.sessions.get(this.selected.get(this.hub.activeId)); }
  ensure() { if (!this.active) this.create({ name: '主会话' }); }
  create({ name = '新会话', parent = '', readOnly = false, external = false } = {}) {
    return this.createForDevice(this.hub.activeId, { name, parent, readOnly, external });
  }
  createForDevice(device, { name = '主会话', parent = '', readOnly = false, external = false } = {}) {
    const existing = [...this.sessions.values()].filter(entry => entry.device === device);
    if (existing.length >= 12) throw new Error('每个设备最多 12 个会话，请关闭不用的会话');
    const entry = this.hub.devices.get(device), root = entry.projectRoot || this.defaultRoot;
    const agent = new AgentService(entry.engine, root, { historyDirectory: this.historyDirectory }), id = randomUUID(); agent.readOnly = readOnly;
    agent.config = { ...agent.config, ...this.toolDefaults, ...entry.toolchainConfig };
    if (existing.length) agent.config = { ...existing[0].agent.config };
    this.sessions.set(id, { id, device, name: String(name).slice(0, 40), parent, readOnly, external, agent });
    agent.on('state', () => this.changed());
    agent.on('audit', record => this.emit('audit', { ...record, device, session: id }));
    if (!parent) this.selected.set(device, id);
    entry.projectRoot = root;
    this.changed(); return id;
  }
  state() {
    if (!this.active) return null;
    return { ...this.active.agent.state(), sessionId: this.active.id, readOnly: this.active.readOnly, deviceId: this.hub.activeId, sessions: [...this.sessions.values()].filter(entry => entry.device === this.hub.activeId).map(entry => ({ id: entry.id, name: entry.name, parent: entry.parent, readOnly: entry.readOnly, busy: entry.agent.busy, messages: entry.agent.messages.length })) };
  }
  changed() { this.emit('state', this.state()); }
  select(id) { const entry = this.sessions.get(id); if (!entry || entry.device !== this.hub.activeId) throw new Error('会话不属于当前设备'); this.selected.set(entry.device, id); this.changed(); }
  closeSession(id) {
    const entry = this.sessions.get(id), others = [...this.sessions.values()].filter(item => item.device === this.hub.activeId && item.id !== id);
    if (!entry || entry.device !== this.hub.activeId || !others.length) throw new Error('至少保留一个会话');
    if (entry.agent.busy || entry.agent.builder.child) throw new Error('请先停止会话任务');
    entry.agent.dispose(); this.sessions.delete(id);
    if (this.selected.get(entry.device) === id) this.selected.set(entry.device, others[0].id);
    this.changed();
  }
  async configure(input) {
    return this.configureDevice(this.hub.activeId, input);
  }
  async configureDevice(device, input) {
    if (!this.hub.devices.has(device)) throw new Error('设备不存在');
    if (!this.selected.has(device)) this.createForDevice(device);
    const entries = [...this.sessions.values()].filter(entry => entry.device === device);
    if (entries.some(entry => entry.agent.busy || entry.agent.builder.child)) throw new Error('请先停止该设备的所有 Agent 和构建任务');
    const active = this.sessions.get(this.selected.get(device)).agent;
    await active.configure(input);
    for (const entry of entries) if (entry.agent !== active) { await entry.agent.configure({ ...active.config, root: active.workspace.root, clearKey: !active.config.apiKey }); }
    const bound = this.hub.devices.get(device);
    if (!bound) throw new Error('配置期间设备已关闭');
    if (bound.projectRoot !== active.workspace.root) { bound.projectProfile = null; bound.engine.projectContext = null; }
    bound.projectRoot = active.workspace.root;
    if (bound.projectProfile) bound.projectProfile.buildCommand = projectCommand(active.config);
    const { baseUrl, model, apiStyle, apiKey, maxOutputTokens, timeoutSeconds, thinkingMode, reasoningEffort, ...toolchainConfig } = active.config; bound.toolchainConfig = toolchainConfig;
    this.hub.emitState(); this.changed();
    return active.publicConfig();
  }
  async delegate({ task, includeLogs = false, mode = 'ai' }) {
    const parent = this.active;
    if (parent.readOnly) throw new Error('子代理不能再次委派');
    if (typeof task !== 'string' || !task.trim() || task.length > 4000) throw new Error('请输入子代理任务');
    if (mode === 'ai' && !parent.agent.config.model) throw new Error('请先配置模型接口');
    const all = [...this.sessions.values()];
    if (all.filter(entry => entry.agent.busy).length > 3 || all.filter(entry => entry.device === this.hub.activeId).length > 9) throw new Error('正在运行的代理过多，或会话数量达到上限');
    const roles = ['数据诊断', '固件审查', '验证方案'];
    const children = roles.map(role => {
      const id = this.create({ name: role, parent: parent.id, readOnly: true });
      const child = this.sessions.get(id);
      return { child, role };
    });
    parent.agent.message('tool', `已启动子代理：${roles.join('、')}。任务：${task}`, 'tool');
    this.delegation = Promise.allSettled(children.map(async ({ child, role }) => {
      try { await child.agent.run({ mode, includeLogs, message: `以${role}角色执行只读分析：${task}。可以读取项目与当前数据；不要提议写入或发送命令，输出证据、风险和下一步验证。` }); }
      finally {
        const result = child.agent.messages.filter(message => message.role === 'assistant').at(-1)?.content || '无分析结果';
        parent.agent.message('assistant', `[子代理：${role}]\n${result}`, mode);
      }
    }));
    this.changed(); return this.state();
  }
  cancelAll() { for (const entry of this.sessions.values()) entry.agent.cancel(); }
  dispose() { for (const entry of this.sessions.values()) entry.agent.dispose(); }
}
