import fs from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';
import { randomUUID } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import { program, pythonTool } from './engineering.mjs';

export const columns = {
  'visa.list': ['VISA 资源'],
  'visa.identify': ['VISA 资源', '仪器标识'],
  'visa.measure': ['时间 / s', '测量值', '单位', '仪器'],
  'ble.scan': ['地址', '设备', 'RSSI / dBm'],
  'ble.services': ['服务 UUID', '特征 UUID', '句柄', '属性'],
  'ble.read': ['时间 / s', 'HEX', '无符号小端值'],
  'ble.notify': ['时间 / s', 'HEX', '无符号小端值'],
  'ble.write': ['特征', '字节', '写入方式'],
  'can.capture': ['时间 / s', 'ID', '帧型', '长度', 'HEX', '周期 / ms', 'BRS'],
  'power.list': ['Joulescope'],
  'power.capture': ['主机时间 / s', '电流 / A', '电压 / V', '功率 / W', '累计能量 / J'],
  'bench.test': ['时间 / s', '步骤', '结果', '单位或来源'],
};

export async function adapter(action, opts, row, signal) {
  signal?.throwIfAborted();
  const [bin, script] = await Promise.all([
    program('python'),
    fs.readFile(new URL('./bench-adapters.py', import.meta.url), 'utf8'),
  ]);
  signal?.throwIfAborted();
  return new Promise((resolve, reject) => {
    const child = spawn(bin, ['-I', '-u', '-X', 'utf8', '-c', script, action], { windowsHide: true });
    let stderr = '',
      error;
    const stop = () => child.kill();
    const timer = setTimeout(() => {
      error = new Error('仪器响应超时');
      stop();
    }, 145000);
    signal?.addEventListener('abort', stop, { once: true });
    child.once('error', (e) => {
      error = e;
    });
    child.stdin.on('error', () => {});
    child.stderr.on('data', (s) => {
      stderr = (stderr + s).slice(-1800);
    });
    createInterface({ input: child.stdout }).on('line', (s) => {
      try {
        const cells = JSON.parse(s);
        if (!Array.isArray(cells)) throw new Error('适配器输出格式无效');
        row(cells);
      } catch (e) {
        error = e;
        stop();
      }
    });
    child.once('close', (code) => {
      clearTimeout(timer);
      signal?.removeEventListener('abort', stop);
      if (signal?.aborted) reject(new Error('已停止采集'));
      else if (error || code !== 0) reject(error || new Error(stderr.trim() || '仪器适配器退出'));
      else resolve();
    });
    child.stdin.end(JSON.stringify(opts));
  });
}

export function validateBenchOptions(opts) {
  if(!Array.isArray(opts.sequence ?? []))throw new Error('台架步骤需要数组');
  if (
    (!opts.resource && (!opts.sequence?.length || opts.sequence.some(s => s?.type === 'measure'))) ||
    !Number.isInteger(opts.adcChannel) ||
    opts.adcChannel < 0 ||
    opts.adcChannel > 15 ||
    !Number.isFinite(opts.tolerance) ||
    opts.tolerance < 0
  )
    throw new Error('请选择仪表、ADC 通道和非负误差限');
  const steps = opts.sequence || [];
  if (!Array.isArray(steps) || steps.length > 32) throw new Error('台架步骤最多 32 项');
  for (const step of steps) {
    if (step?.type === 'send' || step?.type === 'expect') {
      if (typeof step.text !== 'string' || !step.text || step.text.length > 1024) throw new Error('步骤缺少命令或期望文本');
    } else if (step?.type === 'wait') {
      if (!Number.isInteger(step.ms) || step.ms < 0 || step.ms > 10000) throw new Error('步骤延时应为 0..10000 ms');
    } else if (step?.type === 'measure') {
      if (!['V','A'].includes(step.unit) || !Number.isFinite(step.min) || !Number.isFinite(step.max) || step.max<step.min) throw new Error('测量步骤需要单位和有效区间');
    } else throw new Error('未知台架步骤');
  }
  return steps;
}

export async function benchTest(device, opts, row, signal, run = adapter, timing = () => {}, owner) {
  if (!device.connected || !['serial', 'tcp'].includes(device.source)) throw new Error('台架测试需要连接实际设备');
  if ((device.automationLock && device.automationLock!==owner) || device.sendInterval) throw new Error('设备正在执行其他发送任务');
  const steps=validateBenchOptions(opts), lock=owner || randomUUID(), generation=device.generation;
  const guard = () => {
    signal.throwIfAborted();
    if (!device.connected || generation !== device.generation) throw new Error('设备连接已变化');
  };
  const log = (step, value, source) => row([Date.now() / 1000, step, value, source]);
  let powerRequested = false,
    received = '',
    observed,
    sampleAt = 0;
  let requestedAt = Date.now();
  const packets = (p) => {
    if (p.dir === 'RX')
      received = (received + Buffer.from(p.data, 'base64').toString('utf8')).slice(-32000);
  };
  const samples = (values) => {
    for (const sample of values) {
      if (Number.isFinite(sample.values[opts.adcChannel])) {
        observed = sample.values[opts.adcChannel];
        sampleAt = Date.now();
      }
    }
  };
  const until = async (test, message) => {
    const end = Date.now() + 10000;
    while (!test()) {
      guard();
      if (Date.now() > end) throw Object.assign(new Error(message), {code:'REPLY_TIMEOUT'});
      await delay(25, undefined, { signal });
    }
    guard();
  };
  device.automationLock = lock;
  device.on('packet', packets);
  device.on('samples', samples);
  try {
    guard();
    if (opts.supply) {
      powerRequested = true;
      await run(
        'visa.output',
        { resource: opts.supply, backend: opts.backend, on: true },
        () => {},
        signal,
      );
      log('电源输出', 'ON', opts.supply);
    }
    if (opts.ready) {
      await until(() => received.includes(opts.ready), '等待设备就绪超时');
      timing('startup', Date.now()-requestedAt);
      log('启动标志', opts.ready, device.config.path);
    }
    if (steps.length) {
      for (const step of steps) {
        guard();
        if (step.type === 'send') {
          received=''; requestedAt=Date.now(); await device.send({text:step.text,format:'text',ending:'lf'},lock); log('发送',step.text,device.config.path);
        } else if (step.type === 'expect') {
          await until(()=>received.includes(step.text),'等待设备响应超时');
          timing('response', Date.now()-requestedAt);
          received=received.slice(received.indexOf(step.text)+step.text.length);log('收到',step.text,device.config.path);
        } else if (step.type === 'wait') {
          await delay(step.ms,undefined,{signal});log('等待',step.ms,'ms');
        } else {
          let reading;
          await run('visa.measure',{resource:opts.resource,backend:opts.backend,unit:step.unit},r=>{reading=r;},signal);
          guard(); if(!reading || !Number.isFinite(reading[1]))throw new Error('无有效仪器读数');
          row([reading[0],`测量 / ${step.unit}`,reading[1],opts.resource]);
          if(reading[1]<step.min || reading[1]>step.max)throw new Error(`测量超限：期望 ${step.min}..${step.max} ${step.unit}`);
        }
      }
      return;
    }
    observed = undefined;
    if (opts.command) {
      await device.send({ text: opts.command, format: 'text', ending: 'lf' }, lock);
      log('发送', opts.command, device.config.path);
    }
    guard();
    let measurement;
    await run(
      'visa.measure',
      { resource: opts.resource, backend: opts.backend, unit: 'V' },
      (r) => {
        measurement = r;
      },
      signal,
    );
    if (!measurement || !Number.isFinite(measurement[1])) throw new Error('仪表没有返回有效读数');
    row([measurement[0], '万用表 / V', measurement[1], opts.resource]);
    await until(() => observed !== undefined, '没有收到新的 ADC 数值');
    row([sampleAt / 1000, '固件 ADC / V', observed, `${device.config.path} CH${opts.adcChannel + 1}`]);
    const error = Math.abs(observed - measurement[1]);
    log('绝对误差 / V', error, `允许 ${opts.tolerance} V`);
    if (error > opts.tolerance) throw new Error(`ADC 误差超限：${error} V`);
  } finally {
    device.off('packet', packets);
    device.off('samples', samples);
    try {
      if (powerRequested) {
        await run('visa.output', { resource: opts.supply, backend: opts.backend, on: false }, () => {});
        log('电源输出', 'OFF', opts.supply);
      }
    } finally {
      if (!owner && device.automationLock === lock) device.automationLock = null;
    }
  }
}

export class BenchRuns {
  jobs = new Map();
  constructor(run = adapter) {
    this.run = run;
  }
  start(scope, device, action, opts, onRow) {
    if (!Object.hasOwn(columns, action)) throw new Error('未知仪器操作');
    if (this.jobs.get(scope)?.status === 'running') throw new Error('请先结束当前采集');
    if (this.jobs.size >= 24 && !this.jobs.has(scope)) {
      const done = [...this.jobs].find(([, j]) => j.status !== 'running');
      if (!done) throw new Error('采集任务已满');
      this.jobs.delete(done[0]);
    }
    const controller = new AbortController(),
      now = Date.now();
    const job = {
      id: randomUUID(),
      action,
      columns: columns[action],
      source: action,
      status: 'running',
      rows: [],
      count: 0,
      markers: [],
      startedAt: now,
      device: device.config.path,
      firmware: String(opts.firmware || ''),
      controller,
    };
    this.jobs.set(scope, job);
    const row = (r) => {
      job.count++;
      if (job.rows.length < 12000) job.rows.push(r);
      onRow?.(r);
    };
    const packet = (p) => {
      if (p.dir === 'RX' && job.markers.length < 1000)
        job.markers.push([p.time / 1000, Buffer.from(p.data, 'base64').toString('utf8').slice(0, 160)]);
    };
    const mark =
      action === 'power.capture' && device.connected && ['serial', 'tcp'].includes(device.source);
    if (mark) device.on('packet', packet);
    const task =
      action === 'bench.test'
        ? benchTest(device, opts, row, controller.signal, this.run)
        : this.run(action, opts, row, controller.signal);
    job.done = task
      .then(
        () => {
          job.status = controller.signal.aborted ? 'cancelled' : 'complete';
        },
        (e) => {
          job.error = e.message;
          job.status = controller.signal.aborted ? 'cancelled' : 'failed';
        },
      )
      .finally(() => {
        if (mark) device.off('packet', packet);
        job.finishedAt = Date.now();
      });
    return this.state(scope);
  }
  state(scope) {
    const job = this.jobs.get(scope);
    if (!job) return null;
    const { controller, done, ...publicJob } = job;
    return publicJob;
  }
  async decode(scope, id, dbc) {
    const job = this.jobs.get(scope);
    if (!job || job.action !== 'can.capture' || job.id !== id) throw new Error('请选择当前 CAN 采集');
    if (typeof dbc !== 'string' || !dbc || Buffer.byteLength(dbc) > 2 * 1024 * 1024)
      throw new Error('请选择 2 MiB 以内的 DBC');
    const frames = job.rows
      .filter((r) => r[2] === 'CAN' || r[2] === 'FD')
      .map((r) => ({ time: r[0], id: r[1], extended: r[1].length === 8, data: r[4], rtr: false }));
    return pythonTool('dbc', { dbc, frames });
  }
  stop(scope, id) {
    const j = this.jobs.get(scope);
    if (j?.id !== id) throw new Error('采集任务已经变化');
    j.controller.abort();
    return this.state(scope);
  }
  async dispose() {
    for (const j of this.jobs.values()) j.controller.abort();
    await Promise.all([...this.jobs.values()].map((j) => j.done));
  }
}
