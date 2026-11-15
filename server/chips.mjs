import { EventEmitter } from 'node:events';
import { spawn } from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { keilPlan, readKeilProject, findKeilExecutable, keilArtifact } from './keil.mjs';
import { toolDirectories, executableNames, isExecutable, portPathKey, toolEnvironment, stopProcessTree } from './platform.mjs';

const digest = bytes => createHash('sha256').update(bytes).digest('hex');
const toolNames = { esp32: 'esptool', esp8266: 'esptool', stm32: 'STM32_Programmer_CLI', avr: 'avrdude' };
const avrParts = { ATmega328P: 'm328p', ATmega168: 'm168', ATmega2560: 'm2560', ATmega32U4: 'm32u4', ATmega1284P: 'm1284p', ATtiny85: 't85', ATtiny84: 't84' };
const chipNames = ['esp32', 'esp32s2', 'esp32s3', 'esp32c2', 'esp32c3', 'esp32c5', 'esp32c6', 'esp32h2', 'esp32p4'];
export function flashPlan(input, images) {
  if (!Object.hasOwn(toolNames, input.family)) throw new Error('该系列需使用对应工程或外部下载器');
  const target = input.family === 'stm32' && input.interface === 'SWD' ? 'SWD' : String(input.port || '');
  if (target !== 'SWD' && !/^(COM\d{1,4}|\/dev\/[a-zA-Z0-9._/-]+)$/.test(target)) throw new Error('请填写实际下载串口');
  if (target !== 'SWD' && (!Number.isInteger(input.baudRate) || input.baudRate < 9600 || input.baudRate > 2000000)) throw new Error('下载波特率无效');
  if (!images.length || images.length > 8 || (['stm32', 'avr'].includes(input.family) && images.length !== 1)) throw new Error('固件数量无效');
  const address = text => { if (typeof text !== 'string' || !/^0x[\da-f]{1,8}$/i.test(text)) throw new Error('下载地址必须是 0x 开头的十六进制'); return Number(text); };
  let args;
  if (['esp32', 'esp8266'].includes(input.family)) {
    if (input.family === 'esp32' ? !chipNames.includes(input.chip) : !['esp8266', 'ESP8285'].includes(input.chip)) throw new Error('请选择具体 ESP 芯片');
    const ranges = images.map(image => {
      if (image.extension !== '.bin') throw new Error('ESP 仅支持 BIN 固件');
      const start = address(image.address);
      if (start + image.bytes > 0x1000000) throw new Error('当前集成支持 16 MiB 以内的 ESP32 Flash 地址');
      return { start, end: start + image.bytes };
    }).sort((a, b) => a.start - b.start);
    if (ranges.some((range, index) => index && range.start < ranges[index - 1].end)) throw new Error('多个固件的烧录地址重叠');
    args = ['--chip', input.family === 'esp8266' ? 'esp8266' : input.chip, '--port', target, '--baud', String(input.baudRate), '--before', 'default_reset', '--after', 'hard_reset', 'write_flash', ...images.flatMap(image => [image.address, image.path])];
  } else if (input.family === 'avr') {
    if (!Object.hasOwn(avrParts, input.chip) || !['arduino', 'wiring', 'avr109', 'stk500v1'].includes(input.programmer)) throw new Error('AVR 芯片或串口下载协议无效');
    if (images[0].extension !== '.hex') throw new Error('AVR 下载仅支持 Intel HEX 固件');
    args = ['-p', avrParts[input.chip], '-c', input.programmer, '-P', target, '-b', String(input.baudRate), '-D', '-U', `flash:w:${images[0].path}:i`];
  } else {
    if (!['SWD', 'UART'].includes(input.interface)) throw new Error('STM32 支持 SWD 或 UART 下载');
    args = ['-c', `port=${target}`, ...(target === 'SWD' ? ['mode=UR'] : [`br=${input.baudRate}`]), '-w', images[0].path];
    if (images[0].extension === '.bin') {
      const start = address(images[0].address);
      if (start < 0x08000000 || start + images[0].bytes > 0x0a000000) throw new Error('BIN 下载地址应位于 STM32 内部 Flash 区域');
      args.push(images[0].address);
    }
    args.push('-v', '-rst');
  }
  return { command: toolNames[input.family], args, target, confirmation: `WRITE ${target}` };
}

export class ChipService extends EventEmitter {
  constructor(directory, hub, { spawnProcess = spawn } = {}) { super(); this.directory = directory; this.hub = hub; this.spawnProcess = spawnProcess; this.plans = new Map(); this.job = null; this.child = null; this.preparing = false; }
  async init() { await fs.mkdir(this.directory, { recursive: true }); }
  async upload(input) {
    if (typeof input.data !== 'string' || input.data.length > 24 * 1024 * 1024 || !/^[A-Za-z0-9+/]*={0,2}$/.test(input.data)) throw new Error('固件文件无效或超过 16 MiB');
    const name = path.basename(String(input.name)).slice(0, 120), extension = path.extname(name).toLowerCase();
    if (!['.bin', '.hex', '.elf'].includes(extension)) throw new Error('支持 BIN、HEX、ELF 固件');
    const bytes = Buffer.from(input.data, 'base64');
    if (!bytes.length || bytes.length > 16 * 1024 * 1024) throw new Error('固件必须为 1 B..16 MiB');
    const id = randomUUID(), metadata = { id, name, extension, version: String(input.version || '').slice(0, 80), bytes: bytes.length, sha256: digest(bytes), createdAt: new Date().toISOString() };
    await this.init(); await fs.writeFile(path.join(this.directory, id + extension), bytes, { flag: 'wx' });
    await fs.writeFile(path.join(this.directory, id + '.json'), JSON.stringify(metadata)); return metadata;
  }
  async list() {
    await this.init(); const entries = await fs.readdir(this.directory), results = [];
    for (const file of entries.filter(file => /^[\da-f-]{36}\.json$/.test(file))) results.push(JSON.parse(await fs.readFile(path.join(this.directory, file), 'utf8')));
    return results.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }
  async image(id) {
    if (typeof id !== 'string' || !/^[\da-f-]{36}$/.test(id)) throw new Error('固件 ID 无效');
    const info = JSON.parse(await fs.readFile(path.join(this.directory, id + '.json'), 'utf8'));
    if (!['.bin', '.hex', '.elf'].includes(info.extension)) throw new Error('固件元数据无效');
    const filename = path.join(this.directory, id + info.extension), bytes = await fs.readFile(filename);
    if (digest(bytes) !== info.sha256) throw new Error('固件内容已变化，SHA256 不一致');
    return { ...info, path: filename };
  }
  async executable(family, supplied = '') {
    if (!toolNames[family]) throw new Error('芯片系列无效');
    const names = executableNames(toolNames[family]), basename = names[0];
    const candidates = supplied ? [supplied] : toolDirectories().flatMap(folder => names.map(name => path.join(folder, name)));
    for (const candidate of candidates) {
      if (!path.isAbsolute(candidate) || !names.some(name => name.toLowerCase() === path.basename(candidate).toLowerCase())) continue;
      if (await isExecutable(candidate)) return candidate;
    }
    throw new Error(`未找到 ${basename}，请安装官方工具或指定可执行文件绝对路径`);
  }
  async prepare(input) {
    if (input.family === 'keil') {
      const root = this.hub.devices.get(this.hub.activeId).projectRoot;
      const project = await readKeilProject(root, input.keilProject);
      const target = project.targets.find(target => target.name === input.keilTarget);
      if (!target) throw new Error('Keil Target 不存在');
      const plan = keilPlan(input, root, true), executable = await findKeilExecutable(input.executable), id = randomUUID(), artifact = await keilArtifact(root, project, input.keilTarget);
      const proposal = { ...plan, id, executable, family: 'keil', chip: target.chip, artifact, projectHash: project.sha256, optionsHash: project.optionsHash, createdAt: Date.now(), images: [], deviceId: this.hub.activeId };
      this.plans.set(id, proposal); return proposal;
    }
    if (!Array.isArray(input.images)) throw new Error('请选择固件');
    const images = await Promise.all(input.images.map(async item => ({ ...await this.image(item.id), address: item.address })));
    const plan = flashPlan(input, images), executable = await this.executable(input.family, input.executable);
    const id = randomUUID(), createdAt = Date.now();
    for (const [key, value] of this.plans) if (createdAt - value.createdAt > 300000) this.plans.delete(key);
    if (this.plans.size >= 20) this.plans.delete(this.plans.keys().next().value);
    const proposal = { ...plan, id, createdAt, executable, images, family: input.family, chip: input.chip || 'STM32' };
    this.plans.set(id, proposal); return proposal;
  }
  async execute({ id, confirmation }) {
    if (this.child || this.preparing) throw new Error('已有烧录任务');
    const plan = this.plans.get(id);
    if (!plan || Date.now() - plan.createdAt > 300000 || confirmation !== plan.confirmation) throw new Error('烧录确认不匹配或预览已过期');
    this.preparing = true;
    try {
      if (plan.family === 'keil') {
        const device = this.hub.devices.get(plan.deviceId);
        if (!device || device.projectRoot !== plan.root || device.engine.connected || device.engine.busy || device.engine.automationLock) throw new Error('请保持原工程绑定并断开目标设备后烧录');
        const project = await readKeilProject(plan.root, plan.keilConfig.keilProject);
        if (project.sha256 !== plan.projectHash || project.optionsHash !== plan.optionsHash) throw new Error('Keil 工程或下载器配置已变化，请重新预览');
        const artifact = await keilArtifact(plan.root, project, plan.keilConfig.keilTarget);
        if (artifact.sha256 !== plan.artifact.sha256 || artifact.path !== plan.artifact.path) throw new Error('Keil 构建输出已变化，请重新预览烧录');
        await fs.mkdir(path.dirname(plan.logFile), { recursive: true });
        device.engine.flashLock = true;
      }
      for (const image of plan.images) await this.image(image.id);
      if (plan.target !== 'SWD' && [...this.hub.devices.values()].some(({ engine }) => (engine.connected || engine.busy) && portPathKey(engine.config.path) === portPathKey(plan.target))) throw new Error('请先断开占用下载串口的设备');
      if (plan.target !== 'SWD') this.hub.reserved.add(portPathKey(plan.target));
      this.plans.delete(id);
      this.job = { id, status: 'running', target: plan.target, command: [plan.executable, ...plan.args].map(part => JSON.stringify(part)).join(' '), output: '', startedAt: new Date().toISOString(), exitCode: null };
      const child = this.child = this.spawnProcess(plan.executable, plan.args, { shell: false, windowsHide: true, detached: process.platform !== 'win32', env: toolEnvironment(), stdio: ['ignore', 'pipe', 'pipe'] });
      const append = value => { this.job.output = (this.job.output + value.toString()).slice(-48000); this.emit('update'); };
      child.stdout.on('data', append); child.stderr.on('data', append);
      const timeout = setTimeout(() => { append('\n烧录超过 5 分钟，任务已停止。'); this.stop(); }, 300000);
      child.once('error', error => { append(error.message); this.job.status = 'failed'; });
      child.once('close', async code => { clearTimeout(timeout); if (plan.logFile) { try { append((await fs.readFile(plan.logFile)).subarray(-24000)); } catch { append('\nKeil 未生成下载日志。'); } } this.child = null; if (plan.deviceId && this.hub.devices.has(plan.deviceId)) this.hub.devices.get(plan.deviceId).engine.flashLock = false; this.hub.reserved.delete(portPathKey(plan.target)); this.job.exitCode = code; if (this.job.status !== 'cancelled') this.job.status = code === 0 || (plan.family === 'keil' && code === 1) ? 'succeeded' : 'failed'; this.emit('update'); });
      this.emit('update'); return this.job;
    } catch (error) { if (!this.child) { this.hub.reserved.delete(portPathKey(plan.target)); if (plan.deviceId && this.hub.devices.has(plan.deviceId)) this.hub.devices.get(plan.deviceId).engine.flashLock = false; } throw error; }
    finally { this.preparing = false; }
  }
  stop() {
    if (!this.child) return;
    this.job.status = 'cancelled';
    stopProcessTree(this.child);
    this.emit('update');
  }
}
