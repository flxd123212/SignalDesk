import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';

const compilerName = /^(?:arm-none-eabi|riscv(?:32|64)?-(?:unknown|none)-elf)-gcc(?:\.exe)?$/i;
export function gccDirectory(config) { return `build/gcc-${createHash('sha256').update(JSON.stringify([config.gccCompiler || '', config.gccToolchainFile || '', config.buildConfiguration || 'Debug'])).digest('hex').slice(0, 12)}`; }
function toolchainPath(config, root) {
  const file = config.gccToolchainFile;
  if (typeof file !== 'string' || file.length > 400 || !/\.cmake$/i.test(file) || path.isAbsolute(file) || file.split(/[\\/]/).some(part => part === '..' || part.startsWith('.')) || /[\r\n\0]/.test(file)) throw new Error('请选择工程内的 GCC .cmake 工具链文件');
  return path.resolve(root, file);
}
export function gccPlan(config, root) {
  const file = toolchainPath(config, root), directory = gccDirectory(config);
  if (config.gccCompiler && (!path.isAbsolute(config.gccCompiler) || !compilerName.test(path.basename(config.gccCompiler)))) throw new Error('GCC 路径必须指向 ARM 或 RISC-V 交叉编译器');
  const args = config.buildPreset === 'gcc-configure'
    ? ['-S', '.', '-B', directory, '-G', 'Ninja', `-DCMAKE_TOOLCHAIN_FILE=${file}`, `-DCMAKE_BUILD_TYPE=${config.buildConfiguration || 'Debug'}`, '-DCMAKE_EXPORT_COMPILE_COMMANDS=ON']
    : ['--build', directory, '--config', config.buildConfiguration || 'Debug'];
  return { command: 'cmake', args, cwd: root, gcc: { directory, file, configure: config.buildPreset === 'gcc-configure' } };
}

export async function discoverGcc() {
  const home = process.env.USERPROFILE || process.env.HOME || '';
  const directories = new Set([...(process.env.PATH || '').split(path.delimiter), process.env.ARM_GCC_PATH, process.env.RISCV_GCC_PATH, 'D:\\DevTools_Hi3861V100_v1.0\\hcc_riscv32_win\\bin', path.join(home, '.platformio', 'packages', 'toolchain-gccarmnoneeabi', 'bin')].filter(Boolean));
  for (const base of ['C:\\Program Files\\Arm GNU Toolchain arm-none-eabi', 'C:\\Program Files (x86)\\Arm GNU Toolchain arm-none-eabi', 'C:\\Program Files (x86)\\GNU Arm Embedded Toolchain']) {
    try { for (const entry of (await fs.readdir(base, { withFileTypes: true })).slice(0, 30)) if (entry.isDirectory()) directories.add(path.join(base, entry.name, 'bin')); } catch { /* Optional installation directory. */ }
  }
  const found = new Map();
  for (const directory of [...directories].slice(0, 150)) {
    const folder = directory.replace(/^"|"$/g, ''); if (!path.isAbsolute(folder)) continue;
    try { for (const name of await fs.readdir(folder)) if (compilerName.test(name)) { const filename = await fs.realpath(path.join(folder, name)); if ((await fs.stat(filename)).isFile()) found.set(filename.toLowerCase(), { path: filename, name, family: name.startsWith('arm-') ? 'ARM' : 'RISC-V' }); } } catch { /* Continue through available installations. */ }
  }
  return [...found.values()];
}

export async function resolveGcc(config, root) {
  const lexical = toolchainPath(config, root), file = await fs.realpath(lexical), relative = path.relative(await fs.realpath(root), file);
  if (relative.startsWith('..') || path.isAbsolute(relative) || !(await fs.stat(file)).isFile()) throw new Error('工具链文件必须位于当前工程内');
  const text = await fs.readFile(file, 'utf8'); if (text.length > 256000) throw new Error('工具链文件过大');
  let compiler = config.gccCompiler;
  if (!compiler) {
    const available = await discoverGcc(), prefix = text.match(/(?:arm-none-eabi|riscv(?:32|64)?-(?:unknown|none)-elf)/i)?.[0];
    const matches = prefix ? available.filter(item => item.name.startsWith(prefix)) : available;
    if (matches.length !== 1) throw new Error(matches.length ? '发现多个交叉编译器，请在设置中明确选择' : '未找到匹配的 GCC 交叉编译器，请指定 gcc.exe 路径');
    compiler = matches[0].path;
  }
  if (!path.isAbsolute(compiler) || !compilerName.test(path.basename(compiler)) || !(await fs.stat(compiler)).isFile()) throw new Error('交叉编译器路径无效');
  const cxx = compiler.replace(/gcc(\.exe)?$/i, 'g++$1');
  return { compiler, cxx, file, directory: gccDirectory(config) };
}

export async function prepareGcc(config, root, resolveExecutable) {
  const tools = await resolveGcc(config, root);
  if (config.buildPreset !== 'gcc-configure') {
    try { await fs.access(path.join(root, tools.directory, 'CMakeCache.txt')); } catch { throw new Error('GCC 工程尚未配置，请先点击“配置 GCC 工程”'); }
    return { args: [], env: { ...process.env, PATH: `${path.dirname(tools.compiler)}${path.delimiter}${process.env.PATH || ''}` } };
  }
  const ninja = await resolveExecutable('ninja');
  return { args: [`-DCMAKE_C_COMPILER=${tools.compiler}`, `-DCMAKE_CXX_COMPILER=${tools.cxx}`, `-DCMAKE_ASM_COMPILER=${tools.compiler}`, `-DCMAKE_MAKE_PROGRAM=${ninja}`], env: { ...process.env, PATH: `${path.dirname(tools.compiler)}${path.delimiter}${process.env.PATH || ''}` } };
}

export async function gccArtifacts(root, config) {
  const base = path.resolve(root, gccDirectory(config)), files = []; let count = 0;
  try { const rel = path.relative(await fs.realpath(root), await fs.realpath(base)); if (rel.startsWith('..') || path.isAbsolute(rel)) throw new Error('产物目录不在当前工程内'); } catch (error) { if (error.code === 'ENOENT') return []; throw error; }
  const walk = async (directory, depth) => {
    if (depth > 7 || count > 4000 || files.length >= 50) return;
    for (const entry of await fs.readdir(directory, { withFileTypes: true })) {
      if (++count > 4000 || files.length >= 50) break;
      if (entry.isSymbolicLink()) continue;
      if (entry.isDirectory() && ['CMakeFiles', 'Testing'].includes(entry.name)) continue;
      const filename = path.join(directory, entry.name);
      if (entry.isDirectory()) await walk(filename, depth + 1);
      else if (entry.isFile() && /\.(?:elf|axf|bin|hex|map|a)$/i.test(entry.name)) {
        const stat = await fs.stat(filename); let architecture = '';
        if (/\.(elf|axf)$/i.test(entry.name)) {
          const handle = await fs.open(filename, 'r');
          try { const header = Buffer.alloc(20), read = await handle.read(header, 0, 20, 0); if (read.bytesRead === 20 && header.subarray(0, 4).equals(Buffer.from([127, 69, 76, 70]))) { const machine = header[5] === 2 ? header.readUInt16BE(18) : header.readUInt16LE(18); architecture = `${({ 40: 'ARM', 243: 'RISC-V' })[machine] || `ELF machine ${machine}`} · ${header[4] === 1 ? '32' : '64'} bit`; } } finally { await handle.close(); }
        }
        files.push({ path: path.relative(root, filename).split(path.sep).join('/'), bytes: stat.size, modifiedAt: stat.mtime.toISOString(), architecture });
      }
    }
  };
  try { await walk(base, 0); } catch (error) { if (error.code !== 'ENOENT') throw error; }
  return files;
}
