import { randomUUID } from 'node:crypto';
import { gccDirectory, resolveGcc } from './gcc.mjs';
import { scanProject, rankProjectPorts } from './project-profile.mjs';
import { DEFAULT_CONFIG, validateConfig } from './engine.mjs';
import { findExecutable, findIdfInvoker } from './ai/build.mjs';
import { findKeilExecutable } from './keil.mjs';
import { findIarExecutable } from './iar.mjs';
import { captureSnapshot } from './ai/analysis.mjs';

const modelKeys = ['baseUrl', 'apiStyle', 'apiKey', 'model', 'maxOutputTokens', 'timeoutSeconds', 'thinkingMode', 'reasoningEffort'];
const copyModel = config => Object.fromEntries(modelKeys.filter(key => config[key] !== undefined).map(key => [key, config[key]]));
const sameRoot = (a, b) => process.platform === 'win32' ? a?.toLowerCase() === b?.toLowerCase() : a === b;
const quote = value => JSON.stringify(value);
export function projectCommand(config) {
  if (config.buildPreset === 'platformio') return `platformio run${config.platformioEnvironment ? ` -e ${quote(config.platformioEnvironment)}` : ''}`;
  if (config.buildPreset === 'arduino' && config.fqbn) return `arduino-cli compile --fqbn ${quote(config.fqbn)} .`;
  if (config.buildPreset === 'keil') return `UV4 -b ${quote(config.keilProject)} -t ${quote(config.keilTarget)}`;
  if (config.buildPreset === 'iar') return `IarBuild ${quote(config.iarProject)} -build ${quote(config.iarConfig)}`;
  if (config.buildPreset === 'esp-idf') return 'idf.py build';
  if (config.buildPreset === 'cmake') return 'cmake --build build';
  if (config.buildPreset === 'cargo') return 'cargo build --offline --locked';
  if (config.buildPreset === 'go') return 'go build ./...';
  if (config.buildPreset === 'gcc') return `cmake --build ${gccDirectory(config)}`;
  return '';
}
async function toolStatus(config, root) {
  try {
    if (config.buildPreset === 'gcc') { const tools = await resolveGcc(config, root); await findExecutable('cmake'); await findExecutable('ninja'); return { available: true, executable: tools.compiler, message: '已发现 GCC、CMake 与 Ninja；未执行交叉编译' }; }
    const executable = config.buildPreset === 'keil' ? await findKeilExecutable(config.keilExecutable) : config.buildPreset === 'iar' ? await findIarExecutable(config.iarExecutable) : config.buildPreset === 'esp-idf' ? (await findIdfInvoker()).script : config.buildPreset === 'none' ? '' : await findExecutable({ arduino: 'arduino-cli', platformio: 'platformio', cmake: 'cmake', cargo: 'cargo', go: 'go' }[config.buildPreset]);
    return { available: !!executable, executable, message: executable ? '已检测到工具；未执行构建' : '未指定构建工具' };
  } catch (error) { return { available: false, executable: '', message: error.message }; }
}

export class ProjectSetup {
  constructor(hub, registry, discovery, workspace, logs) { this.hub = hub; this.registry = registry; this.discovery = discovery; this.workspace = workspace; this.logs = logs; this.plans = new Map(); this.busy = false; }
  async health(deviceId) {
    if (deviceId !== this.hub.activeId) throw new Error('当前设备已切换');
    const entry = this.hub.devices.get(deviceId), agent = this.registry.active.agent;
    if (agent.busy) throw new Error('请先停止当前 Agent 任务');
    const root = entry.projectRoot, snapshot = captureSnapshot(entry.engine), tool = await toolStatus(agent.config, root), checks = [];
    checks.push({ label: '工程绑定', status: root && root === agent.workspace.root ? 'pass' : 'fail', detail: root || '未绑定工程' });
    const source = entry.projectProfile?.entryFile;
    if (source) { try { const file = await agent.workspace.read(source); checks.push({ label: '主源码', status: 'pass', detail: `${source} · ${file.bytes} B · SHA256 ${file.hash.slice(0, 12)}` }); } catch (error) { checks.push({ label: '主源码', status: 'fail', detail: error.message }); } }
    else checks.push({ label: '主源码', status: 'warn', detail: '尚未识别入口文件' });
    checks.push({ label: '工具链', status: tool.available ? 'info' : 'warn', detail: tool.message + (tool.executable ? ` · ${tool.executable}` : '') });
    checks.push({ label: '设备连接', status: snapshot.connected ? 'pass' : 'warn', detail: `${entry.chip || '芯片未标记'} · ${snapshot.port === 'unassigned' ? '尚未匹配串口' : snapshot.port} · ${snapshot.connected ? '已连接' : '未连接'}` });
    checks.push({ label: '采样数据', status: snapshot.channels.length ? 'pass' : 'warn', detail: `${snapshot.source === 'demo' ? '模拟数据' : '当前数据'} · ${snapshot.frames} 帧 · ${snapshot.channels.length} 通道 · ${snapshot.protocol} · ${snapshot.configuredSampleRate} Hz（配置时基）` });
    checks.push({ label: '解码与处理', status: snapshot.parseSkipped || snapshot.processingErrors || snapshot.displayDropped ? 'warn' : 'info', detail: `解析跳过 ${snapshot.parseSkipped} · 处理错误 ${snapshot.processingErrors} · 显示丢弃 ${snapshot.displayDropped}；零计数不证明物理链路无误码` });
    checks.push({ label: 'AI 接口', status: agent.config.model ? 'info' : 'warn', detail: agent.config.model ? `${agent.config.model} · ${agent.config.apiStyle} · 本次未调用模型或验证接口` : '未配置模型，当前可使用本地分析与项目体检' });
    for (const warning of entry.projectProfile?.warnings || []) checks.push({ label: '工程识别', status: 'warn', detail: warning });
    if (this.hub.activeId !== deviceId || this.registry.active.agent !== agent || entry.projectRoot !== root) throw new Error('体检期间项目或会话已变化，请重新检查');
    const labels = { pass: '正常', info: '信息', warn: '待确认', fail: '异常' };
    const content = `项目体检 · ${entry.name}\n\n${checks.map(check => `[${labels[check.status]}] ${check.label}：${check.detail}`).join('\n')}`;
    agent.message('assistant', content, 'local');
    return { deviceId, checks };
  }
  async prepare(root) {
    const sourceDevice = this.hub.activeId, selection = this.hub.selection;
    const report = await scanProject(root), ports = await this.discovery.scan();
    const choices = [];
    for (const target of report.targets) {
      validateConfig({ ...DEFAULT_CONFIG, ...target.serial, path: 'unassigned' });
      const existing = this.hub.list().find(device => sameRoot(device.projectRoot, target.root) && device.projectProfile?.targetId === target.id);
      const matches = rankProjectPorts(target, ports, this.hub.list(), existing?.id), available = matches.filter(port => !port.blocked && port.reason !== 'USB 芯片系列与工程不一致');
      const highest = available.filter(port => port.score === available[0]?.score);
      const recommendedPort = highest.length === 1 && (highest[0].score > 0 || available.length === 1) ? highest[0].path : '';
      const tools = { ...this.registry.toolDefaults, ...target.toolchain };
      choices.push({ ...target, tool: await toolStatus(tools, target.root), command: projectCommand(tools), ports: matches, recommendedPort, existingDeviceId: existing?.id || '' });
    }
    if (sourceDevice !== this.hub.activeId || selection !== this.hub.selection) throw new Error('扫描期间切换了设备，请重新识别项目');
    const id = randomUUID(), config = this.registry.active.agent.config;
    const plan = { ...report, targets: choices, id, sourceDevice, selection, inputRoot: root, created: Date.now() };
    this.plans.set(id, plan); if (this.plans.size > 20) this.plans.delete(this.plans.keys().next().value);
    return { ...report, id, targets: choices, ai: { configured: !!config.model, model: config.model, apiStyle: config.apiStyle } };
  }
  async apply(input) {
    if (this.busy) throw new Error('已有项目正在添加');
    const plan = this.plans.get(input?.id);
    if (!plan || Date.now() - plan.created > 15 * 60 * 1000) throw new Error('识别结果已失效，请重新扫描');
    if (plan.sourceDevice !== this.hub.activeId || plan.selection !== this.hub.selection) throw new Error('当前设备已切换，请重新扫描项目');
    const target = plan.targets.find(item => item.id === input.targetId);
    if (!target) throw new Error('请选择一个工程目标');
    for (const key of ['connect', 'reuseAI', 'newDevice']) if (input[key] !== undefined && typeof input[key] !== 'boolean') throw new Error('项目选项无效');
    const name = input.name === undefined ? target.name : input.name;
    if (typeof name !== 'string' || !name.trim() || name.length > 40) throw new Error('设备名称需要 1 到 40 个字符');
    this.busy = true; let created = '';
    try {
      const fresh = await scanProject(plan.inputRoot);
      if (fresh.fingerprint !== plan.fingerprint) throw new Error('工程文件在识别后发生变化，请重新扫描');
      if (plan.sourceDevice !== this.hub.activeId || plan.selection !== this.hub.selection) throw new Error('当前设备已切换，请重新扫描项目');
      if ([...this.registry.sessions.values()].some(entry => entry.device === plan.sourceDevice && (entry.agent.busy || entry.agent.builder.child))) throw new Error('请先停止当前设备的 Agent 或构建任务');
      const existing = !input.newDevice && target.existingDeviceId && this.hub.devices.get(target.existingDeviceId);
      if (existing) {
        if (!sameRoot(existing.projectRoot, target.root) || existing.projectProfile?.targetId !== target.id) throw new Error('已绑定项目发生变化，请重新扫描');
        if (input.connect && !existing.engine.connected) { await this.discovery.checkConnection(existing.id, existing.engine.config); await this.hub.connectDevice(existing.id, existing.engine.config); }
        this.hub.select(existing.id); this.plans.delete(plan.id);
        return { deviceId: existing.id, reused: true, connected: existing.engine.connected, protocol: existing.engine.config.protocol, warnings: ['已切换到现有项目；保留该设备的设置和会话'], state: this.hub.state() };
      }
      if (this.hub.devices.size >= 8) throw new Error('最多同时打开 8 个设备，请关闭不用的标签');
      let selected = null;
      if (input.port) {
        const before = target.ports.find(port => port.path === input.port);
        if (!before || before.blocked) throw new Error('该串口不是当前可用候选，请重新扫描');
        const ports = await this.discovery.scan(), current = rankProjectPorts(target, ports, this.hub.list());
        const matches = before.key ? current.filter(port => port.key === before.key) : current.filter(port => port.path === before.path && port.vendorId === before.vendorId && port.productId === before.productId && port.serialNumber === before.serialNumber);
        if (matches.length !== 1 || matches[0].blocked) throw new Error(matches[0]?.blocked || '串口已移除或身份发生变化，请重新扫描');
        selected = matches[0];
      }
      if (input.connect && !selected) throw new Error('没有匹配的串口，可以先添加离线项目');
      const overrides = input.serial || {};
      if (typeof overrides !== 'object' || Array.isArray(overrides) || Object.keys(overrides).some(key => !['baudRate', 'sampleRate', 'protocol'].includes(key))) throw new Error('串口覆盖参数无效');
      const config = validateConfig({ ...DEFAULT_CONFIG, ...target.serial, ...overrides, path: selected?.path || 'unassigned', transport: selected?.transport || 'serial', dtr: false, rts: false, rtscts: false });
      const toolchain = { ...this.registry.toolDefaults, ...target.toolchain };
      if (input.fqbn !== undefined) { if (toolchain.buildPreset !== 'arduino' || typeof input.fqbn !== 'string' || input.fqbn.length > 180 || (input.fqbn && !/^[a-zA-Z0-9][a-zA-Z0-9_.:,=-]+$/.test(input.fqbn))) throw new Error('开发板 FQBN 无效'); toolchain.fqbn = input.fqbn; }
      const chip = target.chip || selected?.chip || '', board = target.board || '';
      const inherited = input.reuseAI !== false ? copyModel(this.registry.active.agent.config) : { model: '', clearKey: true };
      const profile = { version: 1, targetId: target.id, kind: target.kind, target: target.label, name: name.trim(), chip, board, family: target.family, root: target.root, entryFile: target.entryFile, buildCommand: projectCommand(toolchain), serial: config, evidence: target.evidence, warnings: [...plan.warnings, ...target.warnings], aiInherited: !!inherited.model };
      if (plan.sourceDevice !== this.hub.activeId || plan.selection !== this.hub.selection) throw new Error('当前设备已切换，请重新扫描项目');
      const binding = selected ? { key: selected.key, path: selected.path, vendorId: selected.vendorId, productId: selected.productId, serialNumber: selected.serialNumber, autoMatch: !!selected.key } : null;
      created = this.hub.add(name.trim(), { projectRoot: target.root, chip, board, config, toolchainConfig: toolchain, projectProfile: profile, portBinding: binding });
      await this.registry.configureDevice(created, { root: target.root, ...toolchain, ...inherited });
      const device = this.hub.devices.get(created);
      const warnings = [...profile.warnings];
      if (input.connect) {
        try { await this.discovery.checkConnection(created, config); await this.hub.connectDevice(created, config); }
        catch (error) { warnings.push(`项目已保存，串口未连接：${error.message}`); }
      }
      if (this.hub.activeId === plan.sourceDevice) this.hub.select(created); else this.hub.emitState();
      this.workspace.save(); await this.workspace.queue;
      if (this.workspace.failure) warnings.push(`配置保存提示：${this.workspace.failure}`);
      this.logs.write({ category: 'project', device: created, message: '项目自动配置已完成', data: { root: target.root, kind: target.kind, chip, port: config.path, buildPreset: toolchain.buildPreset, connected: device.engine.connected, reusedAI: !!inherited.model } });
      this.plans.delete(plan.id);
      return { deviceId: created, connected: device.engine.connected, protocol: config.protocol, warnings, state: this.hub.state() };
    } catch (error) {
      if (created && this.hub.devices.has(created)) await this.hub.remove(created);
      throw error;
    } finally { this.busy = false; }
  }
}
