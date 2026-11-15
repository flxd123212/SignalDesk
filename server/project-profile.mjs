import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import ini from 'ini';
import { parseDocument } from 'yaml';
import { readKeilProject } from './keil.mjs';
import { readIarProject } from './iar.mjs';
import { chipFamily } from './catalog.mjs';
import { portPathKey } from './platform.mjs';

const excluded = /^(node_modules|build|dist|target|Objects|Listings|Debug|Release|Drivers|Middlewares|\.git|\.pio|\.venv)$/i;
const relative = (root, filename) => path.relative(root, filename).split(path.sep).join('/');
const scalar = value => ['string', 'number'].includes(typeof value) ? String(value).trim() : '';
const plain = value => value && typeof value === 'object' && !Array.isArray(value) ? value : {};
const normalize = value => String(value || '').replace(/[^a-z0-9]/gi, '').toLowerCase();
const boards = {
  'esp32-s3-devkitc-1': ['ESP32-S3', 'ESP32-S3-DevKitC-1'], esp32s3: ['ESP32-S3', 'ESP32-S3'], esp32dev: ['ESP32', 'ESP32 DevKitC'], esp32: ['ESP32', 'ESP32'],
  'esp32-c3-devkitm-1': ['ESP32-C3', 'ESP32-C3-DevKitM-1'], esp32c3: ['ESP32-C3', 'ESP32-C3'], esp32c6: ['ESP32-C6', 'ESP32-C6'],
  nodemcuv2: ['ESP8266', 'NodeMCU 1.0'], d1_mini: ['ESP8266', 'LOLIN D1 mini'], uno: ['ATmega328P', 'Arduino Uno R3'], nanoatmega328: ['ATmega328P', 'Arduino Nano'],
  nano: ['ATmega328P', 'Arduino Nano'], megaatmega2560: ['ATmega2560', 'Arduino Mega 2560'], mega: ['ATmega2560', 'Arduino Mega 2560'], leonardo: ['ATmega32U4', 'Arduino Leonardo'],
  pico: ['RP2040', 'Raspberry Pi Pico'], picow: ['RP2040', 'Raspberry Pi Pico W'], pico2: ['RP2350', 'Raspberry Pi Pico 2'],
  bluepill_f103c8: ['STM32F103C8', 'Blue Pill'], blackpill_f411ce: ['STM32F411CE', 'Black Pill'], nucleo_f401re: ['STM32F401RE', 'NUCLEO-F401RE'], nucleo_f446re: ['STM32F446RE', 'NUCLEO-F446RE'],
};
function boardIdentity(name, explicitChip = '') {
  const known = boards[name];
  const chip = explicitChip || known?.[0] || (/^esp32(?:s[23]|c[2356]|h2|p4)?$/i.test(name) ? name.toUpperCase() : '');
  return { chip, board: known?.[1] || name || '', family: chipFamily(chip) };
}
function number(value, min, max) { const text = scalar(value); if (!/^\d+(?:\.\d+)?$/.test(text)) return undefined; const parsed = Number(text); return parsed >= min && parsed <= max ? parsed : undefined; }
function sourceHints(files) {
  const bauds = new Set(), periods = new Set(), rates = new Set(), protocols = new Set(), evidence = [];
  for (const [filename, contents] of files) {
    if (!/\.(?:ino|c|cpp|h|hpp)$/i.test(filename)) continue;
    const text = contents.replace(/"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|\/\/[^\n]*|\/\*[\s\S]*?\*\//g, token => token.startsWith('/') ? ' ' : token);
    const constants = new Map([...text.matchAll(/(?:#define\s+|\b(?:const|constexpr)\s+[\w:<>]+\s+)(\w+)\s*(?:=\s*)?(\d+)(?:[uUlL]*)(?=[\s;,])/g)].map(match => [match[1], Number(match[2])]));
    for (const match of text.matchAll(/(?:\bSerial(?:USB|\d*)?\s*\.\s*begin\s*\(\s*|\.BaudRate\s*=\s*)(\w+)/g)) {
      const value = /^\d+$/.test(match[1]) ? Number(match[1]) : constants.get(match[1]);
      if (Number.isInteger(value) && value >= 50 && value <= 12000000) { bauds.add(value); evidence.push(`${filename}: baud ${value}`); }
    }
    for (const [name, value] of constants) {
      if (/^(?:k)?sample_?period_?us$/i.test(name) && value > 0) periods.add(value);
      if (/^(?:k)?sample_?rate_?(?:hz)?$/i.test(name) && value > 0 && value <= 1000000) rates.add(value);
    }
    if (/Serial\w*\.print\s*\(\s*["'],["']\s*\)/.test(text) || /printf\s*\(\s*"[^"\n]*%[\w.]*f[^"\n]*,[^"\n]*%[\w.]*f/.test(text)) protocols.add('firewater');
    if (/\bserializeJson\s*\([^;]*Serial/.test(text)) protocols.add('json');
    if (/0x00\s*,\s*0x00\s*,\s*0x80\s*,\s*0x7[fF]/.test(text) && /Serial\w*\.write\s*\(/.test(text)) protocols.add('justfloat');
  }
  for (const period of periods) if (1000000 / period >= 1 && 1000000 / period <= 1000000) rates.add(1000000 / period);
  return { baudRate: bauds.size === 1 ? [...bauds][0] : undefined, sampleRate: rates.size === 1 ? [...rates][0] : undefined, protocol: protocols.size === 1 ? [...protocols][0] : undefined, evidence: evidence.slice(0, 8), conflicts: [bauds.size > 1 && '源码包含多个串口波特率，请核对监测接口', rates.size > 1 && '源码包含多个采样周期，采样率需要确认', protocols.size > 1 && '源码包含多种发送格式，请确认数据协议'].filter(Boolean) };
}

export async function scanProject(input) {
  if (typeof input !== 'string' || !path.isAbsolute(input)) throw new Error('请输入工程目录或工程文件的绝对路径');
  const resolved = await fs.realpath(input), stat = await fs.stat(resolved), chosenFile = stat.isFile() ? resolved : '';
  const root = chosenFile ? path.dirname(resolved) : resolved;
  if (!stat.isFile() && !stat.isDirectory()) throw new Error('请选择工程目录或工程文件');
  const files = new Map(), warnings = [], fingerprints = [], targets = [];
  let count = 0, bytes = 0, truncated = false;
  const walk = async (directory, depth) => {
    if (depth > 5 || count >= 1500 || bytes >= 8 * 1024 * 1024) { truncated = true; return; }
    const entries = (await fs.readdir(directory, { withFileTypes: true })).sort((a, b) => a.name.localeCompare(b.name));
    for (const entry of entries) {
      if (++count > 1500 || bytes >= 8 * 1024 * 1024) { truncated = true; return; }
      if (entry.isSymbolicLink() || excluded.test(entry.name) || entry.name.startsWith('.')) continue;
      const filename = path.join(directory, entry.name);
      if (entry.isDirectory()) { await walk(filename, depth + 1); continue; }
      if (!entry.isFile() || !/\.(?:ino|c|h|cpp|hpp|cmake|uvprojx?|ewp|ioc|ini|yaml|json|rs|py|go|js|ts|toml)$|^(?:go\.mod|CMakeLists\.txt|sdkconfig(?:\.defaults)?)$/i.test(entry.name)) continue;
      const fileStat = await fs.stat(filename);
      if (fileStat.size > (/\.(?:uvprojx?|ewp)$/.test(entry.name) ? 2 * 1024 * 1024 : 256 * 1024)) { warnings.push(`${relative(root, filename)} 超过扫描单文件上限`); continue; }
      const data = await fs.readFile(filename); bytes += data.length;
      fingerprints.push([relative(root, filename), createHash('sha256').update(data).digest('hex')]);
      try { files.set(relative(root, filename), new TextDecoder('utf-8', { fatal: true }).decode(data)); } catch { warnings.push(`${relative(root, filename)} 不是 UTF-8，未用于自动推断`); }
    }
  };
  await walk(root, 0);
  const manifestText = files.get('signaldesk.json');
  let manifest = {};
  if (manifestText) {
    try { manifest = plain(JSON.parse(manifestText)); if (manifest.version !== 1) throw new Error('version 必须为 1'); }
    catch (error) { throw new Error(`signaldesk.json: ${error.message}`); }
  }
  const serial = plain(manifest.serial);
  const add = target => {
    if (targets.length >= 40) return;
    const base = target.root || root, localFiles = [...files].filter(([file]) => { const inside = relative(base, path.join(root, file)); return inside && !inside.startsWith('../'); });
    const hints = sourceHints(localFiles);
    const entryFile = target.entryFile || localFiles.map(([file]) => relative(base, path.join(root, file))).find(file => /(?:^|\/)(?:main|app_main)\.(?:c|cpp)$/.test(file)) || localFiles.map(([file]) => relative(base, path.join(root, file))).find(file => /\.(?:ino|c|cpp)$/.test(file)) || '';
    const identity = { chip: target.chip || '', board: target.board || '', family: target.family || chipFamily(target.chip) };
    if (typeof manifest.chip === 'string') identity.chip = manifest.chip.slice(0, 80);
    if (typeof manifest.board === 'string') identity.board = manifest.board.slice(0, 80);
    identity.family = chipFamily(identity.chip);
    const baudRate = serial.baudRate ?? target.baudRate ?? hints.baudRate ?? 115200;
    const sampleRate = serial.sampleRate ?? hints.sampleRate ?? 200;
    const protocol = serial.protocol ?? hints.protocol ?? 'raw';
    const id = createHash('sha256').update(`${base}|${target.kind}|${target.file}|${target.label}`).digest('hex').slice(0, 20);
    targets.push({ ...target, ...identity, id, root: base, entryFile, name: scalar(manifest.name) || path.basename(base),
      serial: { baudRate, sampleRate, protocol, dataBits: serial.dataBits ?? 8, stopBits: serial.stopBits ?? 1, parity: serial.parity ?? 'none', ...(serial.schema ? { schema: serial.schema } : {}) },
      portHint: scalar(serial.port) || target.portHint || '',
      toolchain: { ...target.toolchain, ...(target.kind === 'arduino' && typeof manifest.fqbn === 'string' ? { fqbn: manifest.fqbn } : {}) },
      evidence: [...(target.evidence || []), ...hints.evidence, ...(manifestText ? ['signaldesk.json: 显式项目设置'] : []), `数据格式: ${serial.protocol ? '项目设置' : hints.protocol ? '源码线索' : '未识别，保留原始字节'}`, `采样率: ${serial.sampleRate ? '项目设置' : hints.sampleRate ? '源码周期线索' : '默认值，需核对真实发送周期'}`],
      warnings: [...(target.warnings || []), ...hints.conflicts],
    });
  };
  const selected = file => !chosenFile || path.join(root, file) === chosenFile || /\.(?:ino|ioc)$/.test(chosenFile);
  for (const [file, text] of files) {
    if (!selected(file)) continue;
    const base = path.dirname(path.join(root, file));
    try {
      if (path.basename(file) === 'Cargo.toml') add({ kind: 'cargo', root: base, file, label: 'Rust / Cargo', entryFile: files.has(relative(root, path.join(base, 'src', 'main.rs'))) ? 'src/main.rs' : 'src/lib.rs', toolchain: { buildPreset: 'cargo' }, evidence: [file], warnings: ['构建目标由 Cargo 配置决定；离线构建需要已有依赖与 Cargo.lock'] });
      if (path.basename(file) === 'go.mod') add({ kind: 'go', root: base, file, label: 'Go', entryFile: files.has(relative(root, path.join(base, 'main.go'))) ? 'main.go' : '', toolchain: { buildPreset: 'go' }, evidence: [file], warnings: ['Go 构建不等同于 MCU 固件烧录，需按实际目标配置工具链'] });
      if (/\.uvprojx?$/i.test(file)) {
        const project = await readKeilProject(root, file);
        for (const target of project.targets) add({ kind: 'keil', file, label: target.name, chip: target.chip, toolchain: { buildPreset: 'keil', keilProject: file, keilTarget: target.name }, evidence: [`${file} / ${target.name}: ${target.chip || '芯片未指定'}`] });
      } else if (/\.ewp$/i.test(file)) {
        const project = await readIarProject(root, file);
        for (const target of project.configurations) add({ kind: 'iar', file, label: target.name, chip: scalar(target.chip), toolchain: { buildPreset: 'iar', iarProject: file, iarConfig: target.name }, evidence: [`${file} / ${target.name}: ${scalar(target.chip) || target.toolchain}`] });
      } else if (path.basename(file) === 'platformio.ini') {
        const config = ini.parse(text.replace(/^(\s*\[[^\]\r\n]+)\]/gm, prefix => prefix.replaceAll('.', '\\.')));
        const section = (name, seen = new Set()) => {
          if (seen.has(name)) throw new Error('PlatformIO extends 包含循环');
          const current = plain(config[name]), merged = {}; seen.add(name);
          for (const parent of scalar(current.extends).split(/[\s,]+/).filter(Boolean)) Object.assign(merged, section(parent, new Set(seen)));
          return { ...merged, ...current };
        };
        const resolveValue = (value, seen = new Set()) => scalar(value).replace(/\$\{([^}]+)\}/g, (match, reference) => {
          if (seen.has(reference) || seen.size > 8) return match;
          const split = reference.lastIndexOf('.'), source = config[reference.slice(0, split)]?.[reference.slice(split + 1)];
          return source === undefined ? match : resolveValue(source, new Set([...seen, reference]));
        });
        const defaults = scalar(config.platformio?.default_envs).split(/[\s,]+/).filter(Boolean);
        for (const key of Object.keys(config).filter(key => key.startsWith('env:'))) {
          const env = key.slice(4), merged = { ...plain(config.env), ...section(key) };
          const settings = Object.fromEntries(Object.entries(merged).map(([key, value]) => [key, resolveValue(value)]));
          const identity = boardIdentity(settings.board || '', settings['board_build.mcu'] || '');
          add({ kind: 'platformio', root: base, file, label: env, platform: settings.platform || '', testDirectory: scalar(config.platformio?.test_dir) || 'test', ...identity, preferred: defaults.length === 1 && defaults[0] === env,
            baudRate: number(settings.monitor_speed, 50, 12000000), portHint: settings.monitor_port && !/[${*?]/.test(settings.monitor_port) ? settings.monitor_port : '',
            toolchain: { buildPreset: 'platformio', platformioEnvironment: env }, evidence: [`${file} [${key}]`, `board = ${settings.board || '未指定'}`],
            warnings: [config.platformio?.extra_configs && 'extra_configs 未展开，需核对外部配置', Object.values(settings).some(value => value.includes('${')) && '存在未解析的配置变量，需核对'].filter(Boolean) });
        }
      } else if (path.basename(file) === 'sketch.yaml') {
        const document = parseDocument(text); if (document.errors.length) throw document.errors[0];
        const sketch = plain(document.toJS({ maxAliasCount: 20 })), profiles = Object.entries(plain(sketch.profiles));
        for (const [name, profile] of profiles.length ? profiles : [['default', { fqbn: sketch.default_fqbn }]]) {
          const fqbn = scalar(profile?.fqbn), identity = boardIdentity(fqbn.split(':')[2] || '');
          add({ kind: 'arduino', root: base, file, label: name, ...identity, preferred: sketch.default_profile === name, portHint: scalar(sketch.default_port), toolchain: { buildPreset: 'arduino', fqbn }, evidence: [`${file}: ${name}`, `FQBN = ${fqbn || '待选择'}`] });
        }
      } else if (path.basename(file) === 'CMakeLists.txt') {
        if (base !== root) continue;
        const isIdf = /tools\/cmake\/project\.cmake|idf_build_process\s*\(/.test(text);
        const sdk = ini.parse(files.get('sdkconfig') || files.get('sdkconfig.defaults') || '');
        const chip = isIdf ? scalar(sdk.CONFIG_IDF_TARGET || text.match(/set\s*\(\s*IDF_TARGET\s+"?([\w-]+)/)?.[1]).toUpperCase() : '';
        const cross = isIdf ? [] : [...files].filter(([name, value]) => name.endsWith('.cmake') && /arm-none-eabi|riscv(?:32|64)?-(?:unknown|none)-elf/i.test(value));
        if (cross.length) for (const [toolchain] of cross) add({ kind: 'gcc', file, label: `GCC / ${toolchain}`, chip, toolchain: { buildPreset: 'gcc', gccToolchainFile: toolchain }, evidence: [file, toolchain], warnings: ['交叉编译需要项目自己的 CPU/ABI、链接脚本和启动文件'] });
        else add({ kind: isIdf ? 'esp-idf' : 'cmake', file, label: isIdf ? 'ESP-IDF' : 'CMake', chip, toolchain: { buildPreset: isIdf ? 'esp-idf' : 'cmake' }, evidence: [file, ...(chip ? [`sdkconfig / IDF_TARGET = ${chip}`] : [])] });
      }
    } catch (error) { warnings.push(`${file}: ${error.message}`); }
  }
  const ioc = [...files].find(([file]) => file.endsWith('.ioc'));
  if (ioc) {
    const settings = ini.parse(ioc[1]), chip = scalar(settings['Mcu.UserName'] || settings['Mcu.Name']);
    for (const target of targets.filter(target => ['cmake', 'keil', 'iar'].includes(target.kind))) { if (!target.chip) { target.chip = chip; target.family = chipFamily(chip); } target.evidence.push(`${ioc[0]}: ${chip}`); }
    if (!targets.length) add({ kind: 'cubemx', file: ioc[0], label: 'STM32CubeMX', chip, toolchain: { buildPreset: 'none' }, evidence: [`${ioc[0]}: ${chip}`], warnings: ['未找到生成的 Keil / IAR / CMake 构建工程'] });
  }
  if (!targets.length) {
    const sketches = [...files.keys()].filter(file => /\.ino$/i.test(file));
    for (const directory of new Set(sketches.map(file => path.dirname(file)))) {
      const filename = sketches.find(file => path.dirname(file) === directory && path.basename(file, '.ino') === path.basename(path.join(root, directory))) || sketches.find(file => path.dirname(file) === directory);
      if (chosenFile && chosenFile.endsWith('.ino') && path.dirname(chosenFile) !== path.join(root, directory)) continue;
      add({ kind: 'arduino', root: path.join(root, directory), file: filename, entryFile: path.basename(filename), label: path.basename(filename, '.ino'), toolchain: { buildPreset: 'arduino', fqbn: '' }, evidence: [filename], warnings: ['未配置开发板 FQBN；可先监测，编译前选择开发板'] });
    }
  }
  if (!targets.length) add({ kind: 'source', file: '', label: '源码工程', toolchain: { buildPreset: 'none' }, warnings: ['未识别构建工具，源码与串口仍可绑定'] });
  if (truncated) warnings.push('扫描达到数量、深度或大小上限，部分文件未检查');
  for (const target of targets) {
    if (target.chip && !target.family) target.family = chipFamily(target.chip);
    target.warnings = [...new Set(target.warnings)];
  }
  const preferred = targets.filter(target => target.preferred);
  return { root, fingerprint: createHash('sha256').update(JSON.stringify(fingerprints)).digest('hex'), targets, recommendedTarget: targets.length === 1 ? targets[0].id : preferred.length === 1 ? preferred[0].id : '', warnings, scannedFiles: files.size };
}

export function rankProjectPorts(target, ports, devices, existingId = '') {
  return ports.map(port => {
    const identity = port.identification, key = identity?.key || '';
    const owner = devices.find(device => device.id !== existingId && ((key && device.portBinding?.key === key) || device.portBinding?.path === port.path || ((device.connected || device.busy) && normalize(device.path) === normalize(port.path))));
    const duplicate = key && ports.filter(other => other.identification?.key === key).length > 1;
    let score = 0, reason = '通用串口，需确认目标设备';
    const existing = devices.find(device => device.id === existingId);
    if (existing?.portBinding && (key ? existing.portBinding.key === key : existing.portBinding.path === port.path)) { score = 100; reason = '已保存的项目设备绑定'; }
    else if (target.portHint && portPathKey(target.portHint) === portPathKey(port.path)) { score = 90; reason = '工程中指定的监测串口'; }
    else if (target.chip && identity?.chip && normalize(target.chip) === normalize(identity.chip)) { score = 80; reason = '芯片描述符匹配'; }
    else if (target.family && target.family === identity?.family) { score = 60; reason = '芯片系列匹配，具体开发板需核对'; }
    const conflict = target.family && identity?.family && target.family !== identity.family;
    if (conflict) { score = 0; reason = 'USB 芯片系列与工程不一致'; }
    return { path: port.path, key, vendorId: port.vendorId || '', productId: port.productId || '', serialNumber: port.serialNumber || '', interface: identity?.interface || '串口', chip: identity?.chip || '', score, reason, blocked: owner ? `已绑定或占用：${owner.name}` : duplicate ? 'USB 身份重复，不能唯一绑定' : '', transport: identity?.interface.startsWith('Bluetooth') ? 'bluetooth' : 'serial' };
  }).sort((a, b) => Number(!!a.blocked) - Number(!!b.blocked) || b.score - a.score || a.path.localeCompare(b.path));
}
