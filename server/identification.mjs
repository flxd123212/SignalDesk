import fs from 'node:fs/promises';
import { EventEmitter } from 'node:events';
import path from 'node:path';
import { readKeilProject } from './keil.mjs';
import { readIarProject } from './iar.mjs';
import { chipFamily } from './catalog.mjs';
import { validateConfig } from './engine.mjs';

const id = value => String(value || '').replace(/^0x/i, '').padStart(4, '0').toLowerCase();
export function portKey(port) {
  if (!port.vendorId || !port.productId || !port.serialNumber?.trim()) return '';
  return JSON.stringify([id(port.vendorId), id(port.productId), port.serialNumber.trim().toLowerCase()]);
}
export function identifyPort(port) {
  const vid = id(port.vendorId), pid = id(port.productId);
  const result = { interface: '串口接口', family: '', chip: '', board: '', confidence: 'unknown', evidence: [], key: portKey(port) };
  const evidence = text => result.evidence.push(text);
  if (port.vendorId) evidence(`USB ${vid.toUpperCase()}:${pid.toUpperCase()}`);
  if (port.serialNumber) evidence(`Serial ${port.serialNumber}`);
  if (vid === '1a86') result.interface = ['7523', '5523'].includes(pid) ? 'CH340 / CH341 USB-UART' : 'WCH USB 接口';
  if (vid === '10c4') result.interface = 'CP210x USB-UART';
  if (vid === '0403') result.interface = 'FTDI USB-UART';
  if (vid === '067b') result.interface = 'Prolific USB-UART';
  if (vid === '303a') { result.interface = 'Espressif USB'; result.family = 'esp32'; result.confidence = 'family'; }
  if (vid === '0483') {
    result.interface = ['3748', '374b', '374e', '374f', '3752', '3753', '3754'].includes(pid) ? 'ST-LINK 调试器 / VCP' : 'ST USB CDC';
    if (pid === '5740') { result.family = 'stm32'; result.confidence = 'family'; }
  }
  if (vid === '1366') result.interface = 'SEGGER J-Link 调试器 / VCP';
  if (vid === '2e8a') { result.interface = 'Raspberry Pi USB'; result.family = 'rp2'; result.confidence = 'family'; }
  if (['2341', '2a03'].includes(vid)) {
    const arduino = { '0043': ['ATmega328P', 'Arduino Uno R3'], '0001': ['ATmega328P', 'Arduino Uno'], '0042': ['ATmega2560', 'Arduino Mega 2560'], '0010': ['ATmega2560', 'Arduino Mega 2560'], '8036': ['ATmega32U4', 'Arduino Leonardo'], '0036': ['ATmega32U4', 'Arduino Leonardo (Bootloader)'], '8037': ['ATmega32U4', 'Arduino Micro'] }[pid];
    result.interface = 'Arduino USB';
    if (arduino) { [result.chip, result.board] = arduino; result.family = 'avr'; result.confidence = 'descriptor'; evidence('Arduino VID/PID 对照；兼容板可能复用标识'); }
  }
  const descriptor = [port.friendlyName, port.manufacturer].filter(Boolean).join(' ');
  if (/bluetooth|蓝牙|BTHENUM|BTHMODEM/i.test([descriptor, port.pnpId, port.path].join(' '))) { result.interface = 'Bluetooth SPP / 虚拟串口'; evidence('蓝牙串口描述符；不代表 BLE GATT 服务'); }
  if (descriptor) evidence(descriptor.slice(0, 180));
  const explicit = descriptor.match(/\b(ESP32[- ]?(?:S[23]|C[2356]|H2|P4)|ESP8266|RP2040|RP2350|STM32[A-Z]\d{3}[A-Z0-9]*)\b/i)?.[1];
  if (explicit && !/ST-LINK|J-Link/.test(result.interface)) { result.chip = explicit.toUpperCase().replace(' ', '-'); result.family = chipFamily(result.chip); result.confidence = 'descriptor'; }
  return result;
}

export function matchBinding(binding, ports) {
  if (!binding) return { status: 'unbound', port: null };
  if (!binding.key) {
    const port = ports.find(port => port.path === binding.path && id(port.vendorId) === id(binding.vendorId) && id(port.productId) === id(binding.productId));
    return { status: port ? 'manual' : 'missing', port: port || null };
  }
  const matches = ports.filter(port => portKey(port) === binding.key);
  return { status: matches.length > 1 ? 'ambiguous' : matches.length ? 'matched' : 'missing', port: matches.length === 1 ? matches[0] : null };
}

export class PortDiscovery extends EventEmitter {
  constructor(hub, listPorts) {
    super(); this.hub = hub; this.listPorts = listPorts; this.pending = null; this.timer = null; this.disposed = false;
    this.snapshot = { ports: [], initialized: false, revision: 0, checkedAt: null, error: '' };
  }
  async start(interval = 1000) {
    await this.scan().catch(() => {});
    if (!this.disposed && !this.timer) { this.timer = setInterval(() => { void this.scan().catch(() => {}); }, interval); this.timer.unref?.(); }
  }
  async dispose() { this.disposed = true; clearInterval(this.timer); await this.pending?.catch(() => {}); this.removeAllListeners(); }
  async scan() {
    if (this.disposed) throw new Error('串口检测已停止');
    if (this.pending) return this.pending;
    this.pending = this.scanOnce().catch(error => {
      const message = error.message || '系统串口枚举失败';
      const changed = message !== this.snapshot.error;
      this.snapshot = { ...this.snapshot, checkedAt: new Date().toISOString(), error: message };
      if (changed && !this.disposed) this.emit('change', { ...this.snapshot, added: [], removed: [] });
      throw error;
    }).finally(() => { this.pending = null; });
    return this.pending;
  }
  async scanOnce() {
    const ports = (await this.listPorts()).map(port => ({ ...port, identification: identifyPort(port) })).sort((a, b) => a.path.localeCompare(b.path, undefined, { numeric: true }));
    if (this.disposed) return ports;
    const before = this.snapshot;
    const identity = port => JSON.stringify([port.path.toLowerCase(), portKey(port), port.vendorId || '', port.productId || '']);
    const previous = new Set(before.ports.map(identity)), current = new Set(ports.map(identity));
    const added = before.initialized ? ports.filter(port => !previous.has(identity(port))) : [];
    const removed = before.ports.filter(port => !current.has(identity(port)));
    const updated = !before.initialized || !!before.error || JSON.stringify(ports) !== JSON.stringify(before.ports);
    this.snapshot = { ports, initialized: true, revision: before.revision + (updated ? 1 : 0), checkedAt: new Date().toISOString(), error: '' };
    let changed = false;
    for (const device of this.hub.devices.values()) {
      const match = matchBinding(device.portBinding, ports), engine = device.engine;
      if (match.status === 'matched' && device.portBinding.autoMatch && !engine.connected && !engine.busy && !engine.flashLock && !engine.automationLock && engine.source !== 'replay' && !engine.store.recording && !this.hub.reserved.has(match.port.path.toLowerCase())) {
        const occupied = [...this.hub.devices.values()].some(other => other !== device && (other.engine.connected || other.engine.busy) && other.engine.config.path.toLowerCase() === match.port.path.toLowerCase());
        if (!occupied && engine.config.path !== match.port.path) { engine.config = { ...engine.config, path: match.port.path }; changed = true; }
      }
    }
    if (changed) this.hub.emitState();
    if (updated) this.emit('change', { ...this.snapshot, added, removed });
    return ports;
  }
  async bind(deviceId, input, guard = () => {}) {
    const device = this.hub.devices.get(deviceId);
    if (!device) throw new Error('设备不存在');
    if (device.engine.busy || device.engine.flashLock || device.engine.automationLock) throw new Error('请先停止设备任务');
    if (input.clear === true) { device.portBinding = null; this.hub.emitState(); return; }
    const ports = await this.scan();
    guard();
    if (this.hub.devices.get(deviceId) !== device) throw new Error('设备已关闭');
    if (device.engine.busy || device.engine.flashLock || device.engine.automationLock) throw new Error('请先停止设备任务');
    const port = ports.find(port => port.path === input.path);
    if (!port) throw new Error('串口已移除，请刷新列表');
    if (input.identity !== undefined && input.identity !== this.identity(port)) throw new Error('端口身份已变化，请重新选择设备');
    if (device.engine.connected && device.engine.config.path !== port.path) throw new Error('请先断开当前设备');
    const key = portKey(port);
    if (key && ports.filter(item => portKey(item) === key).length !== 1) throw new Error('多个接口使用同一 USB 序列号，不能唯一绑定');
    if ([...this.hub.devices.values()].some(other => other !== device && ((key && other.portBinding?.key === key) || other.portBinding?.path === port.path))) throw new Error('该串口已绑定其他设备工程');
    if (input.autoMatch && !key) throw new Error('该接口没有唯一 USB 序列号，仅支持固定端口绑定');
    device.portBinding = { key, path: port.path, vendorId: port.vendorId || '', productId: port.productId || '', serialNumber: port.serialNumber || '', autoMatch: input.autoMatch === true };
    device.engine.config = { ...device.engine.config, path: port.path }; this.hub.emitState();
  }
  identity(port) { return JSON.stringify([port.path, portKey(port), port.vendorId || '', port.productId || '']); }
  async attach(input, guard = () => {}) {
    if (this.attaching) throw new Error('设备连接正在进行');
    this.attaching = true;
    let created = '', device, previous;
    try {
      const ports = await this.scan(); guard();
      const port = ports.find(item => item.path === input.path);
      if (!port || input.identity !== this.identity(port)) throw new Error('端口已移除或身份变化，请刷新后重试');
      if (input.deviceId) {
        device = this.hub.devices.get(input.deviceId);
        if (!device || device.projectRoot !== input.expectedRoot) throw new Error('目标工程已变化，请重新选择');
        if (device.engine.connected || device.engine.busy || device.engine.store.recording || device.engine.replay) throw new Error('请先停止目标设备的连接、录制或回放，或选择新设备');
      }
      const config = validateConfig({ ...(device?.engine.config || {}), path: port.path, baudRate: input.baudRate, protocol: input.protocol, transport: port.identification.interface.startsWith('Bluetooth') ? 'bluetooth' : 'serial', rtscts: false, dtr: false, rts: false });
      if (!device) { created = this.hub.add(port.identification.board || port.identification.chip || port.path, { config }); device = this.hub.devices.get(created); }
      previous = { binding: device.portBinding, config: device.engine.config };
      await this.bind(device.id, { path: port.path, identity: input.identity, autoMatch: !!portKey(port) }, () => {
        guard();
        if (input.deviceId && device.projectRoot !== input.expectedRoot) throw new Error('目标工程已变化，请重新选择');
        if (device.engine.connected || device.engine.store.recording || device.engine.replay) throw new Error('目标设备正在使用，请重新选择');
      });
      device.engine.config = config;
      if (input.connect === true) await this.hub.connectDevice(device.id, config);
      if (!device.chip && port.identification.chip) device.chip = port.identification.chip;
      if (!device.board && port.identification.board) device.board = port.identification.board;
      this.hub.emitState(); return device.id;
    } catch (error) {
      if (created && this.hub.devices.has(created)) await this.hub.remove(created);
      else if (previous && this.hub.devices.get(device?.id) === device && !device.engine.connected) { device.portBinding = previous.binding; device.engine.config = previous.config; this.hub.emitState(); }
      throw error;
    } finally { this.attaching = false; }
  }
  async checkConnection(deviceId, config) {
    const binding = this.hub.devices.get(deviceId)?.portBinding;
    if (!binding || config.path === 'demo' || String(config.path).startsWith('tcp:')) return;
    const match = matchBinding(binding, await this.scan());
    if (!match.port || match.port.path !== config.path) throw new Error('串口与绑定身份不一致，请刷新识别或重新绑定');
  }
}

export async function inspectProject(input) {
  if (typeof input !== 'string' || !path.isAbsolute(input)) throw new Error('请选择工程绝对路径');
  const root = await fs.realpath(input);
  if (!(await fs.stat(root)).isDirectory()) throw new Error('请选择工程目录');
  const files = [], warnings = []; let visited = 0, truncated = false;
  const walk = async (folder, depth) => {
    if (depth > 3) return;
    for (const entry of await fs.readdir(folder, { withFileTypes: true })) {
      if (++visited > 1500 || files.length >= 50) { truncated = true; return; }
      if (entry.isSymbolicLink() || entry.name.startsWith('.') || /^(node_modules|build|dist|Objects|Listings|Debug|Release)$/i.test(entry.name)) continue;
      const filename = path.join(folder, entry.name);
      if (entry.isDirectory()) await walk(filename, depth + 1);
      else if (/\.(uvprojx?|ewp)$/i.test(entry.name)) files.push(path.relative(root, filename));
    }
  };
  await walk(root, 0);
  const candidates = [];
  for (const file of files) {
    try {
      const keil = /\.uvprojx?$/i.test(file), project = keil ? await readKeilProject(root, file) : await readIarProject(root, file);
      for (const target of keil ? project.targets : project.configurations) if (target.chip) candidates.push({ chip: target.chip, board: '', family: chipFamily(target.chip), source: 'project', confidence: 'configured', evidence: `${file} / ${target.name}`, project: file, target: target.name, tool: keil ? 'keil' : 'iar' });
    } catch (error) { warnings.push(`${file}: ${error.message}`); }
  }
  if (truncated) warnings.push('工程扫描达到上限，部分子目录未检查');
  return { root, candidates, warnings };
}

export function identifyBootLog(packets) {
  const text = packets.filter(packet => packet.dir === 'RX').slice(-50).map(packet => packet.text || Buffer.from(packet.data || '', 'base64').toString('utf8')).join('').slice(-32000);
  const chip = text.match(/ESP-ROM:(esp32(?:s[23]|c[2356]|h2|p4)?)(?=[-\s:]|$)/i)?.[1];
  return chip ? [{ chip: chip.toUpperCase(), board: '', family: 'esp32', source: 'boot-log', confidence: 'reported', evidence: `收到 ESP-ROM:${chip} 启动标识（未主动复位）` }] : [];
}
