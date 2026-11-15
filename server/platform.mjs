import fs from 'node:fs/promises';
import { constants } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { spawn } from 'node:child_process';

export function toolDirectories(platform = process.platform, env = process.env, home = os.homedir()) {
  const paths = platform === 'win32' ? path.win32 : path.posix;
  const directories = [...(env.SIGNALDESK_TOOLCHAIN_PATH || '').split(paths.delimiter), ...(env.PATH || '').split(paths.delimiter)];
  if (platform !== 'win32') directories.push('/opt/homebrew/bin', '/usr/local/bin', '/usr/bin', '/bin', paths.join(home, '.local/bin'), paths.join(home, '.cargo/bin'), paths.join(home, 'go/bin'));
  if (platform === 'darwin') directories.push('/Applications/CMake.app/Contents/bin', '/Applications/STM32CubeProgrammer.app/Contents/MacOs/bin');
  directories.push(paths.join(home, '.platformio', 'penv', platform === 'win32' ? 'Scripts' : 'bin'));
  return [...new Set(directories.map(value => value.replace(/^"|"$/g, '')).filter(value => paths.isAbsolute(value)))];
}

export function executableNames(command, platform = process.platform) {
  if (!/^[a-zA-Z0-9][a-zA-Z0-9_.+-]*$/.test(command || '')) throw new Error('工具名称无效');
  if (platform === 'win32') return [command.endsWith('.exe') ? command : command + '.exe'];
  if (command === 'python') return ['python3', 'python'];
  if (['IarBuild', 'CSpyBat'].includes(command)) return [command.toLowerCase(), command];
  if (command === 'esptool') return ['esptool', 'esptool.py'];
  return [command];
}

export async function isExecutable(filename) {
  if (!path.isAbsolute(filename)) return false;
  try { if (!(await fs.stat(filename)).isFile()) return false; await fs.access(filename, process.platform === 'win32' ? constants.F_OK : constants.X_OK); return true; } catch { return false; }
}

export function toolEnvironment(env = process.env) { return { ...env, PATH: toolDirectories(process.platform, env).join(path.delimiter) }; }

// COM names are case insensitive; Unix device paths are not.
export function portPathKey(value) { const text = String(value || ''); return /^COM\d+$/i.test(text) || text.startsWith('tcp:') ? text.toLowerCase() : text; }

export function serialError(error, port, platform = process.platform) {
  const message = error?.message || String(error);
  if (/EACCES|permission denied|access denied/i.test(message) && platform === 'linux') return `${message}。无权访问 ${port}；请检查设备所属组（常见 dialout / uucp）及 udev 规则，授权后重新登录。不要以 root 启动 SignalDesk。`;
  if (/EBUSY|resource busy|access denied/i.test(message)) return `${message}。请关闭占用 ${port} 的串口监视器、下载器或其他工作区后重试。`;
  if (/ENOENT|no such file/i.test(message) && platform !== 'win32') return `${message}。设备可能已拔出或端口名称已变化，请刷新设备列表；macOS 通常选择 /dev/cu.*。`;
  return message;
}

export function stopProcessTree(child) {
  if (!child?.pid || child.exitCode !== null || child.signalCode) return;
  if (process.platform === 'win32') {
    const task = spawn('taskkill.exe', ['/PID', String(child.pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore' });
    task.once('error', () => child.kill()); return;
  }
  // Callers start a separate process group, so only this job and its children stop.
  const signal = name => { try { process.kill(-child.pid, name); } catch (error) { if (error.code !== 'ESRCH') child.kill(name); } };
  signal('SIGTERM'); const timer = setTimeout(() => signal('SIGKILL'), 2000); timer.unref();
  child.once('close', () => {
    // A compiler can exit before a child that ignores SIGTERM.
    try { process.kill(-child.pid, 0); } catch (error) { if (error.code === 'ESRCH') clearTimeout(timer); }
  });
}
