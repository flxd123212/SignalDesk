import fs from 'node:fs/promises';
import path from 'node:path';
import { randomUUID, createHash } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import { benchTest, validateBenchOptions } from './bench.mjs';

const metrics = () => ({ count: 0, total: 0, max: 0 });
export class SoakRuns {
  constructor(directory, fail, trial = benchTest) {
    this.directory = directory;
    this.fail = fail;
    this.trial = trial;
    this.jobs = new Map();
  }
  filename(scope) {
    return path.join(this.directory, createHash('sha256').update(scope).digest('hex') + '.json');
  }
  async history(scope) {
    try {
      return JSON.parse(await fs.readFile(this.filename(scope), 'utf8'));
    } catch (e) {
      if (e.code === 'ENOENT') return [];
      throw e;
    }
  }
  async state(scope) {
    const reports = await this.history(scope);
    const active = this.jobs.get(scope)?.report;
    return {
      current:
        active ||
        (reports[0]?.status === 'running' ? { ...reports[0], status: 'interrupted' } : reports[0]) ||
        null,
      history: reports
        .filter((r) => r.id !== active?.id)
        .map((r) => (r.status === 'running' ? { ...r, status: 'interrupted' } : r)),
    };
  }
  start(scope, device, options) {
    if (this.jobs.has(scope) || device.automationLock || device.soakId)
      throw new Error('当前设备已有测试任务');
    if (!device.connected || !['serial', 'tcp'].includes(device.source))
      throw new Error('请连接实际设备后运行长稳测试');
    if (device.sendInterval || device.flashLock) throw new Error('设备正在执行其他任务');
    validateBenchOptions(options);
    if (
      !['count', 'time'].includes(options.mode) ||
      !Number.isInteger(options.cycles) ||
      options.cycles < 1 ||
      options.cycles > 1000000 ||
      !Number.isFinite(options.hours) ||
      options.hours <= 0 ||
      options.hours > 168 ||
      !Number.isInteger(options.interval) ||
      options.interval < 10 ||
      options.interval > 60000
    )
      throw new Error('循环次数、时长或间隔无效');
    const controller = new AbortController(),
      startedAt = Date.now(),
      gen = device.generation;
    const report = {
      id: randomUUID(),
      scope,
      startedAt,
      status: 'running',
      firmware: String(options.firmware || ''),
      options,
      passed: 0,
      failed: 0,
      timeouts: 0,
      longestSilence: 0,
      startup: metrics(),
      response: metrics(),
      firstFailure: null,
    };
    const slot = { controller, report };
    this.jobs.set(scope, slot);
    device.soakId = report.id;
    device.automationLock = report.id;
    let lastRx = startedAt,
      lastSave = 0,
      expired = false;
    const packet = (p) => {
      if (p.dir === 'RX') {
        report.longestSilence = Math.max(report.longestSilence, p.time - lastRx);
        lastRx = p.time;
      }
    };
    const disconnected = () => {
      if (!device.connected || device.generation !== gen) {
        slot.disconnected = true;
        controller.abort();
      }
    };
    device.on('packet', packet);
    device.on('state', disconnected);
    const deadline =
      options.mode === 'time'
        ? setTimeout(() => {
            expired = true;
            controller.abort();
          }, options.hours * 3600000)
        : null;
    const save = async () => {
      const history = await this.history(scope);
      const file = this.filename(scope);
      await fs.mkdir(this.directory, { recursive: true });
      await fs.writeFile(
        file + '.tmp',
        JSON.stringify([report, ...history.filter((r) => r.id !== report.id)].slice(0, 12)),
      );
      await fs.rename(file + '.tmp', file);
      lastSave = Date.now();
    };
    const failure = (err, rows) => {
      report.failed++;
      if (err.code === 'REPLY_TIMEOUT') report.timeouts++;
      if (!report.firstFailure) {
        const alarm = this.fail?.(err.message, scope);
        report.firstFailure = { at: Date.now(), reason: err.message, incident: alarm?.id, rows };
      }
    };
    slot.done = (async () => {
      try {
        await save();
        while (
          !controller.signal.aborted &&
          (options.mode === 'time' || report.passed + report.failed < options.cycles)
        ) {
          const rows = [];
          try {
            await this.trial(
              device,
              options,
              (r) => rows.push(r),
              controller.signal,
              undefined,
              (key, ms) => {
                const m = report[key];
                m.count++;
                m.total += ms;
                m.max = Math.max(m.max, ms);
              },
              report.id,
            );
            report.passed++;
          } catch (e) {
            if (controller.signal.aborted) break;
            failure(e, rows);
            if (!options.continueOnFailure) break;
          }
          report.longestSilence = Math.max(report.longestSilence, Date.now() - lastRx);
          if (Date.now() - lastSave > 3000 || (report.failed === 1 && report.passed === 0)) await save();
          if (options.mode === 'time' || report.passed + report.failed < options.cycles)
            await delay(options.interval, undefined, { signal: controller.signal });
        }
      } catch (e) {
        if (!controller.signal.aborted) failure(e, []);
      } finally {
        if (slot.disconnected) failure(new Error('目标连接已断开'), []);
        clearTimeout(deadline);
        device.off('packet', packet);
        device.off('state', disconnected);
        report.finishedAt = Date.now();
        report.longestSilence = Math.max(report.longestSilence, report.finishedAt - lastRx);
        report.status = slot.disconnected
          ? 'failed'
          : controller.signal.aborted && !expired
            ? 'cancelled'
            : report.failed
              ? 'failed'
              : report.passed
                ? 'passed'
                : 'incomplete';
        try {
          await save();
        } catch (e) {
          report.status = 'failed';
          report.storageError = e.message;
        } finally {
          device.soakId = null;
          if (device.automationLock === report.id) device.automationLock = null;
          if (!report.storageError) this.jobs.delete(scope);
        }
      }
    })();
    return report;
  }
  stop(scope, id) {
    const slot = this.jobs.get(scope);
    if (!slot || slot.report.id !== id) throw new Error('长稳任务已变化');
    slot.controller.abort();
  }
  async close() {
    for (const slot of this.jobs.values()) slot.controller.abort();
    await Promise.all([...this.jobs.values()].map((slot) => slot.done));
  }
}
