import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { randomUUID } from 'node:crypto';
import { executableNames, toolDirectories, isExecutable } from './platform.mjs';
import { parseCanFrames } from './can-analysis.mjs';
import { validateTest, TestRunner } from './automation.mjs';
import { decodeDigitalCsv } from './digital-capture.mjs';

const execute = promisify(execFile);
const examples = { stm32: 'Stm32Oled', ch32: 'Ch32Heartbeat', stc: 'StcHeartbeat', stm8: 'Stm8Heartbeat' };
export async function projectLabFiles(root) {
  const base = await fs.realpath(root),
    dirs = [[base, 0]],
    files = [];
  let visited = 0;
  for (const [dir, depth] of dirs) {
    let entries;
    try {
      entries = await fs.readdir(dir, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      if (++visited > 20000 || files.length >= 300) return files.sort();
      if (entry.isSymbolicLink()) continue;
      const file = path.join(dir, entry.name);
      if (
        entry.isDirectory() &&
        depth < 8 &&
        (!entry.name.startsWith('.') || entry.name === '.pio') &&
        !['node_modules', 'CMakeFiles', 'libdeps', '.git'].includes(entry.name)
      )
        dirs.push([file, depth + 1]);
      if (entry.isFile() && /\.(elf|axf|out|kicad_pcb|kicad_sch|csv|vcd|sr)$/i.test(entry.name))
        files.push(path.relative(base, file).split(path.sep).join('/'));
    }
  }
  return files.sort();
}
export async function makeExample(id, examplesDir, dataDir) {
  if (!Object.hasOwn(examples, id)) throw new Error('未知模板');
  const folder = path.join(dataDir, 'projects');
  await fs.mkdir(folder, { recursive: true });
  const target = await fs.mkdtemp(path.join(folder, `${examples[id]}-`));
  try {
    await fs.cp(path.join(examplesDir, examples[id]), target, { recursive: true });
  } catch (err) {
    await fs.rm(target, { recursive: true, force: true });
    throw err;
  }
  return { root: target };
}

export async function artifact(root, relative, suffix, limit = 128 * 1024 * 1024) {
  if (
    typeof relative !== 'string' ||
    relative.length > 512 ||
    path.isAbsolute(relative) ||
    relative.split(/[\\/]/).includes('..') ||
    !suffix.test(relative)
  )
    throw new Error('请选择工程内对应格式的文件');
  const base = await fs.realpath(root),
    file = await fs.realpath(path.resolve(base, relative));
  const rel = path.relative(base, file);
  if (!rel || rel.startsWith('..') || path.isAbsolute(rel) || !suffix.test(file))
    throw new Error('文件位于工程之外或格式不符');
  const stat = await fs.stat(file);
  if (!stat.isFile() || stat.size > limit) throw new Error('文件过大或不是普通文件');
  return file;
}

export async function program(name) {
  const dirs = toolDirectories();
  if (name === 'kicad-cli') {
    for (const base of [
      process.env.ProgramFiles && path.join(process.env.ProgramFiles, 'KiCad'),
      '/Applications/KiCad/KiCad.app/Contents/MacOS',
    ]) {
      if (!base) continue;
      dirs.push(base);
      try {
        for (const v of await fs.readdir(base)) if (/^\d/.test(v)) dirs.unshift(path.join(base, v, 'bin'));
      } catch {
        /* Optional location */
      }
    }
  }
  const candidates = dirs.flatMap((dir) => executableNames(name).map((bin) => path.join(dir, bin)));
  if (name === 'python' && process.env.SIGNALDESK_LAB_PYTHON)
    candidates.unshift(process.env.SIGNALDESK_LAB_PYTHON);
  for (const file of candidates) if (await isExecutable(file)) return file;
  throw new Error(`未找到 ${name}，请安装并将工具目录加入 SIGNALDESK_TOOLCHAIN_PATH`);
}

export async function pythonTool(kind, input) {
  const file = await program('python');
  const script = await fs.readFile(new URL('./engineering-tools.py', import.meta.url), 'utf8');
  const child = execute(file, ['-I', '-X', 'utf8', '-c', script, kind], {
    timeout: 45000,
    maxBuffer: 8 * 1024 * 1024,
    windowsHide: true,
  });
  child.child.stdin.on('error', () => {});
  child.child.stdin.end(JSON.stringify(input));
  try {
    return JSON.parse((await child).stdout);
  } catch (err) {
    throw new Error((err.stderr || 'Python 工具启动失败或超时').trim().slice(-1600));
  }
}

export async function dbcSignals(input) {
  if (!input?.dbc || typeof input.dbc !== 'string' || Buffer.byteLength(input.dbc) > 2 * 1024 * 1024)
    throw new Error('请选择 2 MiB 以内的 DBC');
  const frames = parseCanFrames(input);
  return pythonTool('dbc', { dbc: input.dbc, frames });
}

export async function compareFirmware(root, input) {
  const suffix = /\.(elf|out|axf)$/i;
  const [before, after] = await Promise.all([
    artifact(root, input.before, suffix),
    artifact(root, input.after, suffix),
  ]);
  return pythonTool('size', { before, after, group: input.group === 'unit' ? 'unit' : 'symbol' });
}

export function replayDbcSignal(hub, input) {
  const { signal, points } = input;
  if (
    typeof signal !== 'string' ||
    !signal ||
    signal.length > 220 ||
    !Array.isArray(points) ||
    !points.length ||
    points.length > 12000
  )
    throw new Error('请选择一个已解码的信号');
  let previous = -Infinity;
  const packets = points.map((point) => {
    if (
      !Array.isArray(point) ||
      point.length !== 2 ||
      !Number.isFinite(point[0]) ||
      !Number.isFinite(point[1]) ||
      point[0] < previous ||
      point[0] - points[0][0] > 86400
    )
      throw new Error('信号时间或数值无效');
    previous = point[0];
    return {
      time: (point[0] - points[0][0]) * 1000,
      dir: 'RX',
      data: Buffer.from(String(point[1]) + '\n').toString('base64'),
    };
  });
  const id = hub.add(`DBC · ${signal}`),
    target = hub.devices.get(id).engine;
  target.config = { ...target.config, path: 'unassigned', protocol: 'firewater' };
  target.reset();
  target.source = 'replay';
  target.replay = {
    id: 'dbc-' + randomUUID(),
    packets,
    duration: packets.at(-1).time,
    index: 0,
    position: 0,
    speed: 1,
    channelName: signal,
  };
  hub.select(id);
  target.controlReplay({ action: 'play' });
  return { id, frames: packets.length };
}

export async function checkBoardRules(root, input) {
  const file = await artifact(root, input.file, /\.kicad_(sch|pcb)$/i);
  const board = /\.kicad_pcb$/i.test(file);
  const tool = await program('kicad-cli'),
    tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'signaldesk-kicad-'));
  const out = path.join(tmp, 'rules.json');
  try {
    await execute(tool, [...(board ? ['pcb', 'drc'] : ['sch', 'erc']), '--format', 'json', '-o', out, file], {
      timeout: 90000,
      windowsHide: true,
      maxBuffer: 1024 * 1024,
    });
    if ((await fs.stat(out)).size > 16 * 1024 * 1024) throw new Error('规则报告超过 16 MiB');
    const data = JSON.parse(await fs.readFile(out, 'utf8'));
    const rows = [];
    const collect = (items, sheet = '') => {
      for (const v of items || [])
        rows.push([
          v.severity,
          v.type,
          v.description,
          sheet,
          (v.items || []).map((i) => i.description).join(' / '),
        ]);
    };
    if (board) {
      if (!Array.isArray(data.violations)) throw new Error('无法识别 KiCad DRC 报告');
      collect(data.violations);
      collect(data.unconnected_items);
      collect(data.schematic_parity);
    } else {
      if (!Array.isArray(data.sheets)) throw new Error('无法识别 KiCad ERC 报告');
      for (const sheet of data.sheets) collect(sheet.violations, sheet.path);
    }
    return {
      source: `${board ? 'DRC' : 'ERC'} · ${input.file}`,
      columns: ['级别', '规则', '说明', '图纸', '关联对象'],
      rows: rows.slice(0, 1500),
      count: rows.length,
    };
  } finally {
    await fs.rm(tmp, { recursive: true, force: true });
  }
}

export async function decodeCapture(root, input) {
  const file = await artifact(
    root,
    input.file,
    /\.(sr|vcd|csv)$/i,
    /\.csv$/i.test(input.file) ? 8 * 1024 * 1024 : 128 * 1024 * 1024,
  );
  if (/\.csv$/i.test(file)) return decodeDigitalCsv(file, input);
  const pins = { i2c: ['scl', 'sda'], spi: ['clk', 'mosi', 'cs'], uart: ['rx'] };
  if (!Object.hasOwn(pins, input.protocol)) throw new Error('未知总线类型');
  const mapping = pins[input.protocol].map((pin) => {
    const value = input.pins?.[pin];
    if (typeof value !== 'string' || !/^[\w.-]{1,32}$/.test(value)) throw new Error(`请选择 ${pin} 对应通道`);
    return `${pin}=${value}`;
  });
  if (input.protocol === 'uart') {
    if (!Number.isInteger(input.baud) || input.baud < 50 || input.baud > 12000000)
      throw new Error('UART 波特率无效');
    mapping.push('baudrate=' + input.baud);
  }
  if (input.protocol === 'spi') {
    if (![0, 1, 2, 3].includes(input.mode)) throw new Error('SPI 模式无效');
    mapping.push(`cpol=${input.mode >> 1}`, `cpha=${input.mode & 1}`);
  }
  const { stdout } = await execute(
    await program('sigrok-cli'),
    ['-i', file, '-P', [input.protocol, ...mapping].join(':'), '--protocol-decoder-samplenum'],
    { timeout: 45000, windowsHide: true, maxBuffer: 4 * 1024 * 1024 },
  );
  const lines = stdout.trim().split(/\r?\n/).filter(Boolean);
  return {
    source: `sigrok · ${input.file}`,
    columns: ['采样区间 / 解码'],
    rows: lines.slice(0, 4000).map((line) => [line]),
    count: lines.length,
  };
}

export class BoardMatrix {
  job = null;
  runner = null;
  stop() {
    if (this.job?.status === 'running') {
      this.job.cancelled = true;
      this.runner?.stop();
    }
  }
  start(hub, input) {
    if (this.job?.status === 'running') throw new Error('多板测试正在运行');
    const plan = validateTest(input.plan);
    const fixtureList = (list = []) => {
      if (!Array.isArray(list) || list.length > 20 || list.some(name => typeof name !== 'string' || !name.trim() || name.length > 80)) throw new Error('夹具名称列表无效');
      return [...new Set(list.map(name => name.trim().toLowerCase()))];
    };
    const requiredFixtures = fixtureList(input.plan.fixtures);
    if (
      !Array.isArray(input.targets) ||
      !input.targets.length ||
      input.targets.length > 8 ||
      new Set(input.targets.map((t) => t.id)).size !== input.targets.length
    )
      throw new Error('请选择 1 至 8 个不同的测试设备');
    const entries = input.targets.map((t) => {
      const device = hub.devices.get(t.id);
      if (!device) throw new Error('设备已关闭，请重新选择');
      if (t.fingerprint && !/^[a-f0-9]{64}$/i.test(t.fingerprint))
        throw new Error('固件 SHA256 应为 64 位十六进制');
      return {
        device,
        generation: device.engine.generation,
        ready: t.fixtureReady === true,
        fixtures: fixtureList(t.fixtures),
        fingerprint: t.fingerprint || null,
      };
    });
    const job = (this.job = {
      id: randomUUID(),
      name: plan.name,
      requiredFixtures,
      status: 'running',
      startedAt: new Date().toISOString(),
      results: [],
    });
    this.completion = (async () => {
      for (const { device, generation, ready, fingerprint, fixtures } of entries) {
        const missing = requiredFixtures.filter(name => !fixtures.includes(name));
        const result = {
          deviceId: device.id,
          device: device.name,
          target: device.engine.config.path,
          fixtures,
          firmwareSHA256: fingerprint,
          fingerprintSource: fingerprint ? 'user' : 'unknown',
        };
        const reason = !ready
          ? '夹具未确认'
          : !device.engine.connected || device.engine.source !== 'serial'
            ? '未连接真实串口'
            : generation !== device.engine.generation
              ? '设备已重连'
              : '';
        if (reason || missing.length || job.cancelled) {
          job.results.push({ ...result, status: 'skipped', reason: reason || (missing.length ? `缺少夹具 ${missing.join('、')}` : '已取消') });
          continue;
        }
        try {
          this.runner = new TestRunner();
          await this.runner.start(device.engine, plan, device.id);
          await this.runner.completion;
          job.results.push({ ...result, ...this.runner.state() });
        } catch (err) {
          job.results.push({ ...result, status: 'failed', reason: err.message });
        } finally {
          this.runner = null;
        }
      }
      job.status = job.cancelled
        ? 'cancelled'
        : job.results.some((r) => r.status === 'failed')
          ? 'failed'
          : job.results.every((r) => r.status === 'passed')
            ? 'passed'
            : 'incomplete';
      job.finishedAt = new Date().toISOString();
    })();
    return job;
  }
}
