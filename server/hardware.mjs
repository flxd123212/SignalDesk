import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { XMLParser, XMLValidator } from 'fast-xml-parser';

const array = value => value === undefined ? [] : Array.isArray(value) ? value : [value];
const text = (value, limit = 200) => String(value ?? '').slice(0, limit);
const hardwareExtensions = new Set(['.kicad_pro', '.kicad_sch', '.kicad_pcb', '.sch', '.pcb', '.net', '.xml', '.pdf', '.step', '.stp', '.glb']);
const excluded = new Set(['node_modules', 'build', 'dist', 'target', 'release', 'artifacts']);
const digest = value => createHash('sha256').update(value).digest('hex');

export function parseKiCadNetlist(xml, filename = '') {
  if (typeof xml !== 'string' || Buffer.byteLength(xml) > 2 * 1024 * 1024) throw new Error('网表不能超过 2 MiB');
  if (/<!DOCTYPE|<!ENTITY/i.test(xml) || XMLValidator.validate(xml) !== true) throw new Error('请导入不含 DTD 的 KiCad XML 网表');
  const parsed = new XMLParser({ ignoreAttributes: false, attributeNamePrefix: '', parseTagValue: false, parseAttributeValue: false, processEntities: false }).parse(xml).export;
  if (!parsed?.components || !parsed?.nets) throw new Error('需要 KiCad 导出的 XML 网表（包含 components 和 nets）');
  const components = array(parsed.components.comp).map(item => ({ ref: text(item.ref, 80), value: text(item.value), footprint: text(item.footprint), datasheet: text(item.datasheet, 500) }));
  const refs = new Set();
  if (!components.length || components.length > 2000) throw new Error('网表支持 1..2000 个器件');
  for (const item of components) { if (!item.ref || refs.has(item.ref)) throw new Error('器件编号缺失或重复'); refs.add(item.ref); }
  const nets = array(parsed.nets.net).map((item, index) => ({ id: `net-${index}`, name: text(item.name), pins: array(item.node).map(pin => ({ ref: text(pin.ref, 80), pin: text(pin.pin, 40), name: text(pin.pinfunction, 80) })) }));
  if (nets.length > 4000 || nets.reduce((n, net) => n + net.pins.length, 0) > 16000) throw new Error('网表规模超过限制');
  const endpoints = new Set();
  for (const net of nets) for (const pin of net.pins) { if (!refs.has(pin.ref) || !pin.pin) throw new Error('网表包含未知器件或空引脚'); const key = JSON.stringify([pin.ref, pin.pin]); if (endpoints.has(key)) throw new Error('同一物理引脚出现在多个连接中'); endpoints.add(key); }
  return { name: text(filename, 200), hash: digest(xml), importedAt: new Date().toISOString(), components, nets };
}

export function validateHardware(value) {
  if (!value || typeof value !== 'object' || !Array.isArray(value.bindings) || value.bindings.length > 200) throw new Error('引脚映射最多 200 行');
  const ids = new Set();
  const bindings = value.bindings.map(item => {
    if (!item || typeof item.id !== 'string' || !item.id || item.id.length > 100 || ids.has(item.id)) throw new Error('映射 ID 无效'); ids.add(item.id);
    const channel = item.channel;
    if (!Number.isInteger(channel) || channel < -1 || channel > 15) throw new Error('通道应为空或 CH1..CH16');
    if (typeof item.source !== 'string' || item.source.length > 400 || path.isAbsolute(item.source) || item.source.split(/[\\/]/).some(part => part === '..' || part.startsWith('.'))) throw new Error('源码路径应为工程内的相对路径');
    if (!Number.isInteger(item.line) || item.line < 1 || item.line > 1000000) throw new Error('源码行号无效');
    for (const key of ['min', 'max']) if (item[key] !== null && item[key] !== undefined && !Number.isFinite(item[key])) throw new Error('阈值应为有限数值或空');
    if (item.min != null && item.max != null && item.min > item.max) throw new Error('下限不能超过上限');
    return { id: item.id, ref: text(item.ref, 80), pin: text(item.pin, 40), gpio: text(item.gpio, 60), net: text(item.net), name: text(item.name, 80), unit: text(item.unit, 16), channel, source: item.source, line: item.line, min: item.min ?? null, max: item.max ?? null };
  });
  return { board: text(value.board, 100), revision: text(value.revision, 80), notes: text(value.notes, 4000), bindings };
}

export function hardwareChecks(profile, netlist) {
  const findings = [], seen = new Map();
  for (const binding of profile.bindings) {
    const endpoint = `${binding.ref}.${binding.pin}`;
    if (binding.ref && binding.pin && netlist && !netlist.nets.some(net => net.pins.some(pin => pin.ref === binding.ref && pin.pin === binding.pin))) findings.push({ level: 'warning', binding: binding.id, message: `${endpoint} 未在导入网表中找到` });
    if (binding.gpio) { const key = binding.gpio.toUpperCase(); if (seen.has(key) && seen.get(key) !== binding.net) findings.push({ level: 'warning', binding: binding.id, message: `${binding.gpio} 关联了不同网络，请确认是否为复用配置` }); seen.set(key, binding.net); }
    if (binding.channel < 0) findings.push({ level: 'info', binding: binding.id, message: `${binding.name || endpoint} 尚未绑定数据通道` });
  }
  return findings;
}

export class HardwareStore {
  constructor(directory) { this.directory = directory; this.queues = new Map(); }
  key(root, deviceId) { return digest(JSON.stringify([path.resolve(root), deviceId])); }
  async load(root, deviceId) {
    const filename = path.join(this.directory, this.key(root, deviceId) + '.json');
    try { return JSON.parse(await fs.readFile(filename, 'utf8')); }
    catch (error) { if (error.code !== 'ENOENT') throw new Error('硬件工程记录损坏，请保留记录并检查文件'); return { version: 0, board: '', revision: '', notes: '', bindings: [], netlist: null }; }
  }
  async save(root, deviceId, expectedVersion, patch) {
    const key = this.key(root, deviceId), previous = this.queues.get(key) || Promise.resolve();
    const operation = previous.catch(() => {}).then(async () => {
      const current = await this.load(root, deviceId);
      if (current.version !== expectedVersion) throw Object.assign(new Error('硬件配置已在其他窗口修改，请刷新后再保存'), { status: 409 });
      const next = { ...current, ...patch, version: current.version + 1, updatedAt: new Date().toISOString() };
      await fs.mkdir(this.directory, { recursive: true }); const target = path.join(this.directory, key + '.json'), temporary = `${target}.${randomUUID()}.tmp`;
      await fs.writeFile(temporary, JSON.stringify(next)); await fs.rename(temporary, target); return next;
    });
    this.queues.set(key, operation); try { return await operation; } finally { if (this.queues.get(key) === operation) this.queues.delete(key); }
  }
}

export async function listHardwareFiles(root) {
  const result = []; let visited = 0;
  const walk = async (directory, depth) => { if (depth > 5 || result.length >= 200 || visited > 4000) return; for (const entry of await fs.readdir(directory, { withFileTypes: true })) { if (++visited > 4000) break; if (entry.name.startsWith('.') || entry.isSymbolicLink() || excluded.has(entry.name)) continue; const filename = path.join(directory, entry.name); if (entry.isDirectory()) await walk(filename, depth + 1); else if (entry.isFile() && hardwareExtensions.has(path.extname(entry.name).toLowerCase())) result.push({ path: path.relative(root, filename).split(path.sep).join('/'), bytes: (await fs.stat(filename)).size }); } };
  await walk(root, 0); return result;
}

export async function readProjectNetlist(root, relative) {
  if (typeof relative !== 'string' || path.isAbsolute(relative) || relative.split(/[\\/]/).some(part => part === '..' || part.startsWith('.')) || !/\.(xml|net)$/i.test(relative)) throw new Error('请选择工程内的 XML 网表');
  const base = await fs.realpath(root), filename = await fs.realpath(path.resolve(base, relative)), inside = path.relative(base, filename);
  if (!inside || inside.startsWith('..') || path.isAbsolute(inside) || !(await fs.stat(filename)).isFile()) throw new Error('网表必须位于当前工程内');
  if ((await fs.stat(filename)).size > 2 * 1024 * 1024) throw new Error('网表不能超过 2 MiB');
  return parseKiCadNetlist(await fs.readFile(filename, 'utf8'), relative);
}
