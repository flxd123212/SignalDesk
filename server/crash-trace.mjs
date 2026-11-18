import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { toolDirectories, executableNames, isExecutable } from './platform.mjs';
import { discoverGcc } from './gcc.mjs';

const execute = promisify(execFile);
const targets = {
  8: ['MIPS', ['mips-elf', 'mipsel-elf', 'mipsel-none-elf', 'mips-mti-elf', 'pic32']],
  40: ['Arm', ['arm-none-eabi', 'arm-zephyr-eabi']],
  83: ['AVR', ['avr']],
  94: ['Xtensa', ['xtensa-esp-elf', 'xtensa-lx106-elf', 'xtensa-esp32-elf', 'xtensa-esp32s3-elf', 'xtensa-esp32s2-elf']],
  105: ['MSP430', ['msp430-elf', 'msp430']],
  183: ['AArch64', ['aarch64-none-elf', 'aarch64-zephyr-elf', 'aarch64-linux-gnu']],
  243: ['RISC-V', ['riscv32-esp-elf', 'riscv32-unknown-elf', 'riscv64-unknown-elf', 'riscv-none-elf', 'riscv32-none-elf', 'riscv64-none-elf']],
};
const elfExtension = /\.(elf|axf|out)$/i;
const inside = (root, file) => {
  const rel = path.relative(root, file);
  return !!rel && rel !== '..' && !rel.startsWith('..' + path.sep) && !path.isAbsolute(rel);
};

export async function traceArtifacts(projectRoot) {
  const root = await fs.realpath(projectRoot), paths = [], queue = [[root, 0]];
  let count = 0;
  for (const [dir, depth] of queue) {
    const entries = await fs.readdir(dir, { withFileTypes: true });
    for (const entry of entries) {
      if (++count > 12000 || paths.length >= 80) return paths.sort();
      if (entry.isSymbolicLink()) continue;
      const file = path.join(dir, entry.name);
      if (entry.isFile() && elfExtension.test(entry.name)) paths.push(path.relative(root, file).split(path.sep).join('/'));
      if (!entry.isDirectory() || depth >= 7 || (entry.name.startsWith('.') && entry.name !== '.pio')) continue;
      if (['node_modules','CMakeFiles','libdeps','managed_components','components','.git'].includes(entry.name)) continue;
      queue.push([file, depth + 1]);
    }
  }
  return paths.sort();
}

async function directoriesUnder(base) {
  try { return (await fs.readdir(base, { withFileTypes: true })).filter(e => e.isDirectory()).slice(0, 100).map(e => path.join(base, e.name)); }
  catch { return []; }
}

export async function arduinoToolDirectories() {
  const home = os.homedir();
  const base = process.env.ARDUINO_DIRECTORIES_DATA || (process.platform === 'win32' ? path.join(process.env.LOCALAPPDATA || path.join(home, 'AppData', 'Local'), 'Arduino15') : path.join(home, process.platform === 'darwin' ? 'Library/Arduino15' : '.arduino15'));
  const result = [];
  for (const vendor of await directoriesUnder(path.join(base, 'packages'))) {
    for (const pkg of await directoriesUnder(path.join(vendor, 'tools'))) {
      for (const version of await directoriesUnder(pkg)) result.push(path.join(version, 'bin'));
    }
  }
  return result;
}

async function resolveSymbolizer(prefixes, config, root) {
  const dirs = new Set(toolDirectories());
  if (config.gccCompiler && path.isAbsolute(config.gccCompiler)) {
    const prefix = path.basename(config.gccCompiler).replace(/-gcc(?:\.exe)?$/i, '');
    if (prefixes.includes(prefix)) {
      const sibling = path.join(path.dirname(config.gccCompiler), executableNames(prefix + '-addr2line')[0]);
      if (await isExecutable(sibling)) {
        const real = await fs.realpath(sibling);
        if (!inside(root, real)) return real;
      }
    }
  }
  for (const gcc of await discoverGcc()) dirs.add(path.dirname(gcc.path));
  for (const dir of await arduinoToolDirectories()) dirs.add(dir);
  const home = os.homedir();
  for (const pkg of await directoriesUnder(path.join(home, '.platformio', 'packages'))) {
    if (/^toolchain-/i.test(path.basename(pkg))) dirs.add(path.join(pkg, 'bin'));
  }
  const idf = path.join(process.env.IDF_TOOLS_PATH || path.join(home, '.espressif'), 'tools');
  for (const prefix of [...prefixes, 'llvm']) {
    for (const version of await directoriesUnder(path.join(idf, prefix))) {
      dirs.add(path.join(version, prefix, 'bin')); dirs.add(path.join(version, 'bin'));
    }
    const [name] = executableNames(`${prefix}-addr2line`);
    for (const dir of dirs) {
      const file = path.join(dir, name);
      if (!(await isExecutable(file))) continue;
      const real = await fs.realpath(file);
      if (!inside(root, real)) return real;
    }
  }
  throw new Error(`缺少地址解析工具 ${prefixes[0]}-addr2line，请在工具链中心检查安装或加入 PATH`);
}

async function resolveFrame(workspace, elf, address, name, location) {
  const match = /^(.*):(\d+)(?:\s+\(discriminator \d+\))?$/.exec(location);
  const line = Number(match?.[2]) || 0;
  let file = '';
  if (line) {
    for (const base of [workspace.root, path.dirname(elf)]) {
      const absolute = path.resolve(base, match[1]);
      if (!inside(workspace.root, absolute)) continue;
      const rel = path.relative(workspace.root, absolute).split(path.sep).join('/');
      try { await workspace.resolve(rel); file = rel; break; } catch { /* Source may belong to the SDK or a different checkout. */ }
    }
  }
  return { address, name: name === '??' ? '' : name, location, file, line };
}

export async function symbolizeCrash(workspace, config, { artifact, addresses, fingerprint = '', addressUnit = 'byte' }) {
  if (!Array.isArray(addresses) || !addresses.length || addresses.length > 64 || !addresses.every(a => typeof a === 'string' && /^0x[0-9a-f]{1,16}$/i.test(a))) throw new Error('请输入 1 至 64 个有效指令地址');
  if (typeof fingerprint !== 'string' || (fingerprint && !/^[0-9a-f]{8,64}$/i.test(fingerprint))) throw new Error('ELF 指纹无效');
  if (!['byte', 'avr-word'].includes(addressUnit)) throw new Error('无效的地址单位');
  if (typeof artifact !== 'string' || artifact.length > 512 || !elfExtension.test(artifact) || path.isAbsolute(artifact) || artifact.split(/[\\/]/).includes('..')) throw new Error('请选择当前工程内的 ELF、AXF 或 ELF 格式的 OUT 文件');
  const root = await fs.realpath(workspace.root), elf = await fs.realpath(path.resolve(root, artifact));
  if (!inside(root, elf)) throw new Error('所选固件位于工程之外');
  const handle = await fs.open(elf, 'r');
  try {
    const stat = await handle.stat();
    if (!stat.isFile() || stat.size > 128 * 1024 * 1024) throw new Error('仅支持 128 MiB 以内的 ELF 文件');
    const header = Buffer.alloc(20);
    await handle.read(header, 0, 20, 0);
    if (!header.subarray(0, 4).equals(Buffer.from([127,69,76,70])) || ![1,2].includes(header[5])) throw new Error('所选文件没有有效的 ELF 文件头');
    const machine = header[5] === 1 ? header.readUInt16LE(18) : header.readUInt16BE(18);
    const target = targets[machine];
    if (!target) throw new Error(`尚不支持 ELF 架构 ${machine}`);
    const hash = createHash('sha256');
    for await (const chunk of handle.createReadStream({ start: 0, autoClose: false })) hash.update(chunk);
    const sha256 = hash.digest('hex');
    if (fingerprint && !sha256.startsWith(fingerprint.toLowerCase())) throw new Error('日志中的 ELF 指纹与所选文件不一致，请选择烧录该固件时生成的 ELF');
    if (addressUnit === 'avr-word' && machine !== 83) throw new Error('字地址仅适用于 AVR 固件，请选择字节地址');
    const lookupAddresses = addresses.map(address => {
      const pc = BigInt(address);
      if (addressUnit === 'avr-word') return '0x' + (pc * 2n).toString(16);
      if (machine === 40) return '0x' + (pc & ~1n).toString(16);
      return address;
    });
    const tool = await resolveSymbolizer(target[1], config, root);
    const env = { ...process.env, DEBUGINFOD_URLS: '', PATH: path.dirname(tool) + path.delimiter + (process.env.PATH || '') };
    const { stdout } = await execute(tool, ['-f', '-C', '-e', elf, ...lookupAddresses], { env, timeout: 8000, maxBuffer: 256 * 1024, windowsHide: true });
    const after = await fs.stat(elf);
    if (stat.ino !== after.ino || stat.size !== after.size || stat.mtimeMs !== after.mtimeMs) throw new Error('解析时 ELF 已重新生成，请重试');
    const lines = stdout.trimEnd().split(/\r?\n/);
    if (lines.length !== addresses.length * 2) throw new Error('地址解析工具返回的帧数不完整');
    const frames = await Promise.all(addresses.map((pc, i) => resolveFrame(workspace, elf, pc, lines[i * 2], lines[i * 2 + 1])));
    return { artifact, architecture: target[0], addressUnit, lookupAddresses, tool: path.basename(tool), sha256, verified: !!fingerprint, frames };
  } finally { await handle.close(); }
}
