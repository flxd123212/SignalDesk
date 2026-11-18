import fs from 'node:fs/promises';
import path from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { artifact } from './engineering.mjs';
import { watchReadback } from './device-readback.mjs';
import { portPathKey } from './platform.mjs';

export function flashVerification(family, output, count, ok) {
  if (!ok) return 'failed';
  if (
    family === 'stm32' &&
    /(download verified successfully|verification successfully done)/i.test(output)
  )
    return 'verified';
  if (
    family === 'avr' &&
    /\b(?:bytes? of flash verified|bytes? of flash memory verified|bytes? verified)\b/i.test(output)
  )
    return 'verified';
  if (
    ['esp32', 'esp8266'].includes(family) &&
    (output.match(/hash of data verified/gi) || []).length >= Math.max(1, count)
  )
    return 'verified';
  return 'unconfirmed';
}

export function validateHandshake(h, device, target) {
  if (!h) return null;
  const valid = (v, max) => typeof v === 'string' && v.trim() && v.length <= max && !/[\r\n\0]/.test(v);
  if (
    !valid(h.expected, 100) ||
    !valid(h.field, 120) ||
    !['json', 'prefix'].includes(h.format) ||
    (h.command && !valid(h.command, 256))
  )
    throw new Error('请配置预期固件版本及回报字段');
  const port = device?.engine.config.path;
  if (
    !port ||
    ['demo', 'unassigned'].includes(port) ||
    port.startsWith('tcp:') ||
    (target !== 'SWD' && portPathKey(target) !== portPathKey(port))
  )
    throw new Error('请先将运行串口绑定到当前目标设备');
  return {
    expected: h.expected.trim(),
    field: h.field.trim(),
    format: h.format,
    command: h.command || '',
    port,
  };
}

export async function bootCheck(hub, plan, job) {
  const h = plan.handshake,
    device = hub.devices.get(plan.deviceId),
    result = job.evidence;
  try {
    if (
      !device ||
      device.projectRoot !== plan.root ||
      portPathKey(device.engine.config.path) !== portPathKey(h.port)
    )
      throw new Error('目标绑定已变化');
    const engine = device.engine;
    const reader = watchReadback(engine, {
      ...h,
      timeout: 10000,
      accept: (v) => String(v).length <= 120,
    });
    try {
      if (!engine.connected) await hub.connectDevice(plan.deviceId, { ...engine.config });
      if (
        !engine.connected ||
        engine.source !== 'serial' ||
        portPathKey(engine.config.path) !== portPathKey(h.port)
      )
        throw new Error('运行串口未连接');
      const generation = engine.generation;
      if (h.command) await engine.send({ text: h.command, ending: 'lf' });
      const reply = await reader.promise;
      if (!engine.connected || generation !== engine.generation || device.projectRoot !== plan.root)
        throw new Error('握手过程中连接或工程已变化');
      result.reported = String(reply.value);
      result.receivedAt = reply.at;
      result.runtime = result.reported === h.expected ? 'matched' : 'different';
      device.runningFirmware = {
        version: result.reported,
        port: h.port,
        root: plan.root,
        at: reply.at,
        job: job.id,
      };
    } finally {
      reader.cancel();
    }
  } catch (e) {
    result.runtime = 'unconfirmed';
    result.reason = e.message;
  }
}

export async function buildFlashPlan(validation, chips, input, guard) {
  guard();
  if (!input.handshake) throw new Error('请设置启动版本握手');
  validateHandshake(
    input.handshake,
    chips.hub.devices.get(input.deviceId),
    input.family === 'stm32' && input.interface === 'SWD' ? 'SWD' : input.port,
  );
  const sources = input.sources;
  if (
    !Array.isArray(sources) ||
    !sources.length ||
    sources.length > 8 ||
    sources.some((s) => typeof s.path !== 'string' || !s.path)
  )
    throw new Error('请填写工程构建输出的相对路径');
  const build = await validation.prepare({ ...input, kind: 'build' });
  guard();
  const started = await validation.execute({ ...input, id: build.id, confirm: true });
  const ctx = { ...input, sessionId: started.sessionId };
  let job = started.job;
  while (
    job?.validation?.id === build.id &&
    (job.status === 'running' || ['running', 'checking'].includes(job.validation.sourceState))
  ) {
    await delay(250);
    guard();
    job = validation.state(ctx).job;
  }
  if (
    job?.validation?.id !== build.id ||
    job.status !== 'succeeded' ||
    job.validation.sourceState !== 'unchanged'
  )
    throw new Error('工程构建失败或源码已变化，请查看构建输出');
  const images = [],
    outputs = [];
  for (const source of sources) {
    const file = await artifact(input.root, source.path, /\.(bin|hex|elf)$/i, 16 * 1024 * 1024);
    const stat = await fs.stat(file);
    const image = await chips.upload({
      name: path.basename(file),
      version: input.handshake.expected,
      data: (await fs.readFile(file)).toString('base64'),
    });
    images.push({ id: image.id, address: source.address });
    outputs.push({
      path: source.path,
      sha256: image.sha256,
      updated: stat.mtimeMs >= Date.parse(job.startedAt),
    });
  }
  guard();
  const plan = await chips.prepare({ ...input, images });
  guard();
  plan.build = { id: build.id, fingerprint: build.fingerprint, finishedAt: job.finishedAt, outputs };
  return plan;
}
