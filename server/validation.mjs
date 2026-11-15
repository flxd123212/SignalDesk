import fs from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { scanProject } from './project-profile.mjs';
import { buildPlan } from './ai/build.mjs';
import { validationResult } from './diagnostics.mjs';
import { sourceFingerprint } from './validation-sources.mjs';

const buildKeys = ['buildPreset', 'fqbn', 'platformioEnvironment', 'keilProject', 'keilTarget', 'keilExecutable', 'iarProject', 'iarConfig', 'iarExecutable', 'gccCompiler', 'gccToolchainFile'];
const configKey = config => JSON.stringify(Object.fromEntries(buildKeys.map(key => [key, config[key] || ''])));
const sameRoot = (a, b) => process.platform === 'win32' ? a.toLowerCase() === b.toLowerCase() : a === b;
async function inside(root, relative, directory = false) {
  try { const filename = await fs.realpath(path.resolve(root, relative)), rel = path.relative(root, filename); if (rel === '..' || rel.startsWith('..' + path.sep) || path.isAbsolute(rel)) return false; const stat = await fs.stat(filename); return directory ? stat.isDirectory() : stat.isFile(); } catch { return false; }
}

export class ProjectValidation {
  constructor(hub, registry, logs) { this.hub = hub; this.registry = registry; this.logs = logs; this.plans = new Map(); this.observed = new WeakSet(); this.history = new Map(); this.pending = new Set(); this.starting = false; }
  context(input = {}) {
    const owner = this.registry.active;
    if (input.deviceId && input.deviceId !== this.hub.activeId) throw new Error('当前设备已切换');
    if (input.root && input.root !== owner.agent.workspace.root) throw new Error('当前工程已变化');
    if (input.sessionId && input.sessionId !== owner.id) throw new Error('当前会话已切换');
    return owner;
  }
  check(owner) { if (this.registry.active !== owner || !this.hub.devices.has(owner.device)) throw new Error('设备或会话已变化，请重新操作'); }
  async configure(input) {
    const owner = this.context(input); if (owner.readOnly) throw new Error('只读会话不能修改构建设置');
    const patch = Object.fromEntries(buildKeys.filter(key => input[key] !== undefined).map(key => [key, input[key]]));
    await this.registry.configureDevice(owner.device, patch); return this.ownerState(owner);
  }
  observe(owner) {
    const builder = owner.agent.builder;
    if (this.observed.has(builder)) return; this.observed.add(builder);
    builder.on('update', () => {
      const job = builder.job;
      if (!job?.validation || builder.child || job.status === 'running' || job.validation.sourceState !== 'running') return;
      job.validation.sourceState = 'checking';
      const task = sourceFingerprint(job.cwd).then(report => { job.validation.sourceState = report.fingerprint === job.validation.fingerprint ? 'unchanged' : 'changed'; }).catch(() => { job.validation.sourceState = 'unavailable'; }).finally(() => {
        const key = `${owner.device}:${job.cwd}`, result = validationResult(job), previous = this.history.get(key) || [];
        this.history.set(key, [result, ...previous].slice(0, 10)); if (this.history.size > 50) this.history.delete(this.history.keys().next().value);
        this.logs.write({ category: 'validation', device: owner.device, level: job.status === 'failed' ? 'error' : 'info', message: result.summary, data: result });
        if (builder.job === job) builder.emit('update');
        this.pending.delete(task);
      });
      this.pending.add(task);
    });
  }
  state(input) {
    return this.ownerState(this.context(input));
  }
  ownerState(owner) {
    const root = owner.agent.workspace.root;
    const job = owner.agent.builder.job;
    return { deviceId: owner.device, sessionId: owner.id, root, readOnly: owner.readOnly, job: job?.validation && sameRoot(job.cwd, root) ? validationResult(job) : null, history: this.history.get(`${owner.device}:${root}`) || [] };
  }
  requireBuiltSource(root, fingerprint, config, key) {
    const latest = [...this.history.values()].flat().filter(job => sameRoot(job.cwd, root) && ['build', 'configure'].includes(job.validation.kind)).sort((a, b) => b.finishedAt.localeCompare(a.finishedAt))[0];
    if (!latest || latest.validation.kind !== 'build' || latest.status !== 'succeeded' || latest.validation.sourceState !== 'unchanged' || latest.validation.fingerprint !== fingerprint || latest.validation.configuration !== config.buildConfiguration || latest.validation.buildKey !== key) throw new Error(`请先对当前源码完成 ${config.buildConfiguration} 编译，再运行 CTest；不能用旧程序验证新源码`);
  }
  async capabilities(input) {
    const owner = this.context(input), root = owner.agent.workspace.root, report = await scanProject(root), snapshot = await sourceFingerprint(root), choices = [];
    const pythonTests = await inside(root, 'tests', true) && (await fs.readdir(path.join(root, 'tests'))).some(name => /^test.*\.py$/i.test(name));
    if (pythonTests) choices.push({ id: 'python-unittest', label: 'Python · unittest', runner: 'python-unittest', kind: 'test', environment: '', note: '执行工程 tests 目录中的 Python 测试；需要本机 Python 环境。' });
    if (await inside(root, 'package.json')) choices.push({ id: 'node-test', label: 'JavaScript · Node.js Test', runner: 'node-test', kind: 'test', environment: '', note: '使用 node --test 执行工程测试；不会安装依赖。' });
    if (await inside(root, 'Cargo.toml')) choices.push({ id: 'cargo-check', label: 'Rust · 测试代码检查', runner: 'cargo-check', kind: 'test-build', environment: '', note: '离线检查测试目标，不运行目标程序；需要已安装依赖及 Cargo.lock。' });
    if (await inside(root, 'go.mod')) choices.push({ id: 'go-test', label: 'Go · go test', runner: 'go-test', kind: 'test', environment: '', note: '执行工程 Go 测试；构建目标由工程及 Go 环境决定。' });
    if (owner.agent.config.buildPreset !== 'gcc' && await inside(root, 'build/CTestTestfile.cmake')) choices.push({ id: 'ctest', label: 'CTest · 本机测试', runner: 'ctest', kind: 'test', environment: '', note: '运行工程 build 目录中的测试程序；每个用例默认最多 30 秒。' });
    for (const target of report.targets.filter(target => target.kind === 'platformio' && sameRoot(target.root, root))) {
      if (!await inside(root, target.testDirectory, true)) continue;
      const native = /^native(?:@|$)/i.test(target.platform);
      choices.push({ id: `pio:${target.label}`, label: `${target.label} · ${native ? '本机单元测试' : '仅编译测试固件'}`, runner: native ? 'platformio-native' : 'platformio-compile', kind: native ? 'test' : 'test-build', environment: target.label, note: native ? '执行 PlatformIO native 环境的测试程序。' : '检查测试固件能否编译；不会运行板上测试用例，也不代表硬件验证通过。' });
    }
    this.check(owner);
    if (owner.agent.config.buildPreset === 'gcc') return { deviceId: owner.device, sessionId: owner.id, root, preset: 'gcc', readOnly: owner.readOnly, ...snapshot, choices: [], note: '交叉编译产物不能直接在本机执行。运行测试需另设本机测试工程、仿真器或连接开发板。' };
    return { deviceId: owner.device, sessionId: owner.id, root, preset: owner.agent.config.buildPreset, readOnly: owner.readOnly, ...snapshot, choices, note: choices.length ? '' : '未发现可运行的本机测试入口。CMake 需先配置 build 并启用 CTest；PlatformIO 需有测试目录。也可使用设备通信测试验证串口回执。' };
  }
  async prepare(input) {
    const owner = this.context(input); if (owner.readOnly) throw new Error('只读子代理会话不可执行编译或测试');
    if (!['build', 'test', 'configure'].includes(input.kind)) throw new Error('请选择编译或测试');
    const capabilities = await this.capabilities(input); this.check(owner);
    const configuration = input.configuration || 'Debug';
    if (!['Debug', 'Release', 'RelWithDebInfo', 'MinSizeRel'].includes(configuration)) throw new Error('构建配置无效');
    let config = { ...owner.agent.config, buildConfiguration: configuration }, kind = 'build', label = '工程编译';
    if (input.kind === 'configure') {
      if (!['cmake', 'gcc'].includes(config.buildPreset)) throw new Error('当前工程不是 CMake / GCC 工程');
      const gcc = config.buildPreset === 'gcc'; config.buildPreset = gcc ? 'gcc-configure' : 'cmake-configure'; kind = 'configure'; label = gcc ? 'GCC 配置' : 'CMake 配置';
    }
    if (input.kind === 'test') {
      const choice = capabilities.choices.find(choice => choice.id === input.choiceId); if (!choice) throw new Error('请选择有效的测试目标');
      config = { ...config, buildPreset: 'test', testRunner: choice.runner, platformioEnvironment: choice.environment }; kind = choice.kind; label = choice.label;
      if (choice.runner === 'ctest') this.requireBuiltSource(capabilities.root, capabilities.fingerprint, config, configKey(owner.agent.config));
    }
    const plan = buildPlan(config, capabilities.root), id = randomUUID();
    this.plans.set(id, { id, owner, root: capabilities.root, config, configKey: configKey(owner.agent.config), fingerprint: capabilities.fingerprint, plan, kind, label, created: Date.now() });
    if (this.plans.size > 20) this.plans.delete(this.plans.keys().next().value);
    return { id, command: plan.command, args: plan.args, cwd: plan.cwd, kind, label, fingerprint: capabilities.fingerprint };
  }
  async execute(input) {
    if (input.confirm !== true) throw new Error('请确认编译或测试任务');
    if (this.starting) throw new Error('已有验证任务正在启动');
    const item = this.plans.get(input.id); if (!item || Date.now() - item.created > 300000) throw new Error('验证计划已失效');
    const owner = this.context(input); if (owner !== item.owner || owner.readOnly) throw new Error('当前会话与验证计划不一致');
    this.starting = true;
    try {
      if (configKey(owner.agent.config) !== item.configKey || owner.agent.workspace.root !== item.root) throw new Error('构建配置已变化，请重新预览');
      if ([...this.registry.sessions.values()].some(entry => sameRoot(entry.agent.workspace.root, item.root) && (entry.agent.builder.child || entry.agent.builder.job?.validation?.sourceState === 'checking'))) throw new Error('此工程已有工具链任务正在运行或复核');
      const report = await sourceFingerprint(item.root); this.check(owner);
      if (configKey(owner.agent.config) !== item.configKey || owner.agent.workspace.root !== item.root) throw new Error('构建配置已变化，请重新预览');
      if (report.fingerprint !== item.fingerprint) throw new Error('源码已变化，请重新生成验证计划');
      if (item.config.testRunner === 'ctest') this.requireBuiltSource(item.root, item.fingerprint, item.config, item.configKey);
      this.observe(owner); this.plans.delete(item.id);
      const metadata = { id: item.id, kind: item.kind, label: item.label, fingerprint: item.fingerprint, sourceState: 'running', configuration: item.config.buildConfiguration, buildKey: item.configKey, deviceId: owner.device, sessionId: owner.id };
      try { await owner.agent.builder.start({ ...item.config, validationMeta: metadata }, item.root); }
      catch (error) {
        if (owner.agent.builder.child) throw error;
        const now = new Date().toISOString(); owner.agent.builder.job = { status: 'failed', command: [item.plan.command, ...item.plan.args].join(' '), cwd: item.root, startedAt: now, finishedAt: now, output: error.message, exitCode: null, diagnostics: [], validation: metadata }; owner.agent.builder.emit('update');
      }
      return this.ownerState(owner);
    } finally { this.starting = false; }
  }
  cancel(input) { const owner = this.context(input); if (owner.readOnly || owner.agent.builder.job?.validation?.id !== input.id) throw new Error('验证任务不属于当前可操作会话'); owner.agent.builder.stop(); return this.state(input); }
  async dispose() { await Promise.allSettled([...this.pending]); }
}
