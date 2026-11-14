import { EventEmitter } from 'node:events';
import { spawn } from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';
import { parseArgsStringToArgv } from 'string-argv';
import { keilPlan, readKeilProject, findKeilExecutable } from '../keil.mjs';
import { iarPlan, readIarProject, findIarExecutable } from '../iar.mjs';
import { parseDiagnostics } from '../diagnostics.mjs';
import { gccPlan, prepareGcc, gccArtifacts } from '../gcc.mjs';

export function commandPlan(commandLine, root) {
  if (typeof commandLine !== 'string' || !commandLine.trim() || commandLine.length > 2000 || /[\r\n\x00]/.test(commandLine)) throw new Error('命令行无效');
  const [command, ...args] = parseArgsStringToArgv(commandLine);
  if (command === 'idf.py') { if (args.length !== 1 || args[0] !== 'build') throw new Error('ESP-IDF 命令仅支持 idf.py build'); return { command, args, cwd: root }; }
  if (command?.toLowerCase() === 'iarbuild') {
    if (args.length !== 3 || args[1] !== '-build') throw new Error('IAR 命令格式：IarBuild 工程.ewp -build "配置名称"');
    return iarPlan({ iarProject: args[0], iarConfig: args[2] }, root);
  }
  if (command?.toLowerCase() === 'uv4') {
    if (args.length !== 4 || args[0] !== '-b' || args[2] !== '-t') throw new Error('Keil 命令格式：UV4 -b 工程.uvprojx -t "Target 名称"');
    return keilPlan({ keilProject: args[1], keilTarget: args[3] }, root);
  }
  const allowed = { platformio: ['run', 'device', 'pkg'], pio: ['run', 'device', 'pkg'], 'arduino-cli': ['compile', 'board', 'core', 'version'], cmake: ['--build', '--version'], git: ['status', 'diff', 'log'] };
  if (!allowed[command]?.includes(args[0])) throw new Error('支持 PlatformIO run/device/pkg、Arduino compile/board/core、CMake --build、Git status/diff/log');
  if (args.some(arg => /upload|flash|erase|program|reset|install|uninstall|execute|exec-path|config-env|ext-diff|textconv|output|--open|^-c$|^-S$|^-B$|--preset|--toolchain/i.test(arg))) throw new Error('该参数不在当前工具链命令允许范围');
  if (['device', 'pkg', 'board', 'core'].includes(args[0]) && (args.length !== 2 || args[1] !== 'list')) throw new Error('设备和包管理仅支持 list');
  if (command === 'git') args.unshift('--no-pager');
  return { command, args, cwd: root };
}

export function buildPlan(config, root) {
  if (config.buildConfiguration && !['Debug', 'Release', 'RelWithDebInfo', 'MinSizeRel'].includes(config.buildConfiguration)) throw new Error('构建配置无效');
  if (['gcc', 'gcc-configure'].includes(config.buildPreset)) return gccPlan(config, root);
  if (config.buildPreset === 'cmake-configure') return { command: 'cmake', args: ['-S', '.', '-B', 'build', `-DCMAKE_BUILD_TYPE=${config.buildConfiguration || 'Debug'}`], cwd: root };
  if (config.buildPreset === 'test') {
    if (config.testRunner === 'ctest') return { command: 'ctest', args: ['--test-dir', 'build', '-C', config.buildConfiguration || 'Debug', '--output-on-failure', '--no-tests=error', '--timeout', '30'], cwd: root };
    if (!['platformio-native', 'platformio-compile'].includes(config.testRunner) || !/^[a-zA-Z0-9][a-zA-Z0-9_.-]{0,99}$/.test(config.platformioEnvironment || '')) throw new Error('测试目标无效');
    return { command: 'platformio', args: ['test', '-e', config.platformioEnvironment, '--without-uploading', ...(config.testRunner === 'platformio-compile' ? ['--without-testing'] : [])], cwd: root };
  }
  if (config.buildPreset === 'iar') return iarPlan(config, root);
  if (config.buildPreset === 'keil') return keilPlan(config, root);
  if (config.buildPreset === 'command') return commandPlan(config.commandLine, root);
  if (config.buildPreset === 'platformio') {
    const environment = config.platformioEnvironment || '';
    if (typeof environment !== 'string' || (environment && !/^[a-zA-Z0-9][a-zA-Z0-9_.-]{0,99}$/.test(environment))) throw new Error('PlatformIO 环境名称无效');
    return { command: 'platformio', args: ['run', ...(environment ? ['-e', environment] : [])], cwd: root };
  }
  if (config.buildPreset === 'esp-idf') return { command: 'idf.py', args: ['build'], cwd: root };
  if (config.buildPreset === 'cmake') return { command: 'cmake', args: ['--build', 'build', ...(config.buildConfiguration ? ['--config', config.buildConfiguration] : [])], cwd: root };
  if (config.buildPreset === 'arduino') {
    if (typeof config.fqbn !== 'string' || !/^[a-zA-Z0-9][a-zA-Z0-9_.:,=-]{2,180}$/.test(config.fqbn)) throw new Error('请先填写开发板 FQBN');
    return { command: 'arduino-cli', args: ['compile', '--fqbn', config.fqbn, '--build-path', path.join(root, '.signaldesk-build'), root], cwd: root };
  }
  throw new Error('请选择项目构建方式');
}

export async function findExecutable(command) {
  const directories = (process.env.PATH || '').split(path.delimiter);
  if (process.platform === 'win32' && command === 'ninja') {
    for (const base of [path.join(process.env.ProgramFiles || 'C:\\Program Files', 'Microsoft Visual Studio'), 'D:\\Microsoft Visual Studio']) for (const edition of ['Community', 'Professional', 'Enterprise', 'BuildTools']) directories.push(path.join(base, '2022', edition, 'Common7', 'IDE', 'CommonExtensions', 'Microsoft', 'CMake', 'Ninja'));
  }
  if (process.platform === 'win32' && ['cmake', 'ctest'].includes(command)) {
    directories.push(path.join(process.env.ProgramFiles || 'C:\\Program Files', 'CMake', 'bin'));
    for (const base of [path.join(process.env.ProgramFiles || 'C:\\Program Files', 'Microsoft Visual Studio'), 'D:\\Microsoft Visual Studio']) for (const edition of ['Community', 'Professional', 'Enterprise', 'BuildTools']) directories.push(path.join(base, '2022', edition, 'Common7', 'IDE', 'CommonExtensions', 'Microsoft', 'CMake', 'CMake', 'bin'));
  }
  if (command === 'platformio') directories.push(path.join(process.env.USERPROFILE || process.env.HOME || '', '.platformio', 'penv', process.platform === 'win32' ? 'Scripts' : 'bin'));
  for (const directory of directories) {
    const candidate = path.join(directory.replace(/^"|"$/g, ''), command + (process.platform === 'win32' ? '.exe' : ''));
    try { if (path.isAbsolute(candidate) && (await fs.stat(candidate)).isFile()) return candidate; } catch { /* Continue through PATH. */ }
  }
  throw new Error(`未找到 ${command}，请安装对应工具链并加入 PATH`);
}

export async function findIdfInvoker() {
  const candidates = [...(process.env.IDF_PATH ? [path.join(process.env.IDF_PATH, 'tools', 'idf.py')] : []), ...(process.env.PATH || '').split(path.delimiter).map(folder => path.join(folder.replace(/^"|"$/g, ''), 'idf.py'))];
  for (const filename of candidates) {
    try { if (path.isAbsolute(filename) && (await fs.stat(filename)).isFile()) return { executable: await findExecutable('python'), script: filename }; } catch { /* Continue through the active ESP-IDF environment. */ }
  }
  throw new Error('未检测到 ESP-IDF Python 环境；请从已激活的 ESP-IDF 终端启动 SignalDesk');
}

export class BuildRunner extends EventEmitter {
  constructor() { super(); this.job = null; this.child = null; }
  async start(config, root) {
    if (this.child) throw new Error('已有构建正在运行');
    const plan = buildPlan(config, root);
    const gcc = plan.gcc ? await prepareGcc(config, root, findExecutable) : null;
    if (gcc) plan.args.push(...gcc.args);
    if (plan.command === 'UV4') {
      const project = await readKeilProject(root, plan.keilConfig.keilProject);
      if (!project.targets.some(target => target.name === plan.keilConfig.keilTarget)) throw new Error('Keil Target 不存在');
      await fs.mkdir(path.dirname(plan.logFile), { recursive: true });
    }
    if (plan.command === 'IarBuild') { const project = await readIarProject(root, plan.iarConfig.iarProject); if (!project.configurations.some(item => item.name === plan.iarConfig.iarConfig)) throw new Error('IAR 配置不存在'); }
    const idf = plan.command === 'idf.py' ? await findIdfInvoker() : null;
    const executable = idf ? idf.executable : plan.command === 'UV4' ? await findKeilExecutable(config.keilExecutable) : plan.command === 'IarBuild' ? await findIarExecutable(config.iarExecutable) : await findExecutable(plan.command);
    if (this.child) throw new Error('已有构建正在运行');
    this.job = { status: 'running', command: [plan.command, ...plan.args].join(' '), cwd: root, output: '', startedAt: new Date().toISOString(), exitCode: null, diagnostics: [], outputTruncated: false, ...(config.validationMeta ? { validation: config.validationMeta } : {}) };
    const child = spawn(executable, idf ? [idf.script, ...plan.args] : plan.args, { cwd: root, ...(gcc ? { env: gcc.env } : {}), windowsHide: true, shell: false, stdio: ['ignore', 'pipe', 'pipe'] });
    this.child = child;
    const append = data => {
      const output = this.job.output + data.toString(), limit = this.job.validation ? 64000 : 24000;
      this.job.outputTruncated ||= output.length > limit; this.job.output = output.slice(-limit);
      const merged = new Map([...this.job.diagnostics, ...parseDiagnostics(output, root)].map(item => [JSON.stringify(item), item])); this.job.diagnostics = [...merged.values()].slice(0, 200);
      this.emit('update');
    };
    child.stdout.on('data', append); child.stderr.on('data', append);
    const timeoutSeconds = config.validationMeta ? 600 : 120;
    const timeout = setTimeout(() => { this.job.output += `\n任务超过 ${timeoutSeconds} 秒，已停止。`; this.stop(); }, timeoutSeconds * 1000);
    child.once('error', error => { append(error.message); this.job.status = 'failed'; });
    child.once('close', async code => { clearTimeout(timeout); if (plan.logFile) { try { append((await fs.readFile(plan.logFile)).subarray(-24000)); } catch { append('\nKeil 未生成日志文件。'); } } if (plan.gcc && !plan.gcc.configure && code === 0) { try { this.job.artifacts = await gccArtifacts(root, config); } catch (error) { append(`\n产物清单读取失败：${error.message}`); } } this.child = null; this.job.exitCode = code; this.job.finishedAt = new Date().toISOString(); if (this.job.status !== 'cancelled') this.job.status = code === 0 || (plan.command === 'UV4' && code === 1) ? 'succeeded' : 'failed'; if (plan.command === 'UV4' && code === 1) append('\nKeil 完成，存在警告。'); this.emit('update'); });
    this.emit('update'); return this.job;
  }
  stop() {
    if (!this.child) return;
    this.job.status = 'cancelled';
    if (process.platform === 'win32') spawn('taskkill.exe', ['/PID', String(this.child.pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore' });
    else this.child.kill('SIGTERM');
    this.emit('update');
  }
}
