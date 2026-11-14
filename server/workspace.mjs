import fs from 'node:fs/promises';
import path from 'node:path';
import { validateConfig } from './engine.mjs';
import { validateAlarmRules } from './alarms.mjs';

export class WorkspaceStore {
  constructor(filename, hub) { this.filename = filename; this.hub = hub; this.signature = ''; this.queue = Promise.resolve(); this.failure = ''; }
  async load() {
    try {
      const data = JSON.parse(await fs.readFile(this.filename, 'utf8'));
      if (!Array.isArray(data.devices) || !data.devices.length || data.devices.length > 8) throw new Error('设备配置文件格式无效');
      const keys = ['buildPreset', 'fqbn', 'platformioEnvironment', 'keilProject', 'keilTarget', 'keilExecutable', 'iarProject', 'iarConfig', 'iarExecutable', 'cspyExecutable', 'gccCompiler', 'gccToolchainFile'];
      const entries = data.devices.map(entry => ({ name: String(entry.name).slice(0, 40), chip: String(entry.chip || '').slice(0, 80), board: String(entry.board || '').slice(0, 80), portBinding: entry.portBinding && typeof entry.portBinding.path === 'string' && typeof entry.portBinding.key === 'string' ? { ...entry.portBinding, autoMatch: entry.portBinding.autoMatch === true && Boolean(entry.portBinding.key) } : null, projectRoot: typeof entry.projectRoot === 'string' ? entry.projectRoot : '', config: validateConfig(entry.config), toolchainConfig: Object.fromEntries(Object.entries(entry.toolchainConfig || {}).filter(([key, value]) => keys.includes(key) && typeof value === 'string')) }));
      for (const { engine } of this.hub.devices.values()) await engine.dispose();
      this.hub.devices.clear(); this.hub.activeId = ''; this.hub.sequence = 0;
      for (const [index, item] of entries.entries()) { const id = this.hub.add(item.name), entry = this.hub.devices.get(id); entry.chip = item.chip; entry.board = item.board; entry.portBinding = item.portBinding; entry.alarmRules = validateAlarmRules(data.devices[index].alarmRules || []); entry.projectRoot = item.projectRoot; entry.toolchainConfig = item.toolchainConfig; entry.projectProfile = data.devices[index].projectProfile?.version === 1 ? { ...data.devices[index].projectProfile, aiInherited: false } : null; entry.engine.projectContext = entry.projectProfile; entry.engine.config = item.config; entry.engine.reset(); }
      this.hub.select(this.hub.devices.keys().next().value);
    } catch (error) { if (error.code !== 'ENOENT') this.failure = error.message; }
  }
  save() {
    const value = JSON.stringify({ version: 2, devices: [...this.hub.devices.values()].map(({ name, chip, board, portBinding, alarmRules, projectRoot, projectProfile, toolchainConfig, engine }) => ({ name, chip, board, portBinding, alarmRules, projectRoot, projectProfile, toolchainConfig, config: engine.config })) }, null, 2);
    if (value === this.signature) return;
    this.signature = value;
    this.queue = this.queue.then(async () => { await fs.mkdir(path.dirname(this.filename), { recursive: true }); await fs.writeFile(this.filename + '.tmp', value); await fs.rename(this.filename + '.tmp', this.filename); }).catch(error => { this.failure = error.message; });
  }
}
