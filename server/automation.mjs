import { EventEmitter } from 'node:events';
import { randomUUID } from 'node:crypto';
import { encodePayload } from './protocol.mjs';

export function validateTest(input) {
  if (!input || !Array.isArray(input.steps) || !input.steps.length || input.steps.length > 100) throw new Error('测试应包含 1..100 个步骤');
  let duration = 0;
  const steps = input.steps.map(step => {
    if (!['send', 'wait', 'expect', 'assert'].includes(step.type)) throw new Error('只支持 send / wait / expect / assert');
    if (step.type === 'send') encodePayload(step);
    if (step.type === 'wait' || step.type === 'expect') {
      const ms = step.type === 'wait' ? step.ms : step.timeout;
      if (!Number.isInteger(ms) || ms < 1 || ms > 30000) throw new Error('等待时间应为 1..30000 ms');
      duration += ms;
    }
    if (step.type === 'expect' && (typeof step.contains !== 'string' || !step.contains || step.contains.length > 1024 || !['text', 'hex'].includes(step.format || 'text'))) throw new Error('expect 需要 contains 文本或 HEX');
    if (step.type === 'assert' && (!Number.isInteger(step.channel) || step.channel < 0 || step.channel > 15 || !Number.isFinite(step.min) || !Number.isFinite(step.max) || step.min > step.max)) throw new Error('assert 通道或范围无效');
    return structuredClone(step);
  });
  if (duration > 300000) throw new Error('单次测试等待总时长不能超过 5 分钟');
  return { name: String(input.name || '自动测试').slice(0, 80), steps };
}

export class TestRunner extends EventEmitter {
  constructor() { super(); this.job = null; this.controller = null; }
  state() { return this.job; }
  async start(engine, input) {
    if (this.controller || engine.automationLock) throw new Error('自动测试正在运行');
    if (!engine.connected || engine.source === 'replay') throw new Error('请连接目标设备');
    if (engine.sendInterval) throw new Error('请先停止定时发送');
    const plan = validateTest(input), token = randomUUID(), generation = engine.generation;
    const controller = this.controller = new AbortController(); engine.automationLock = token;
    this.job = { id: token, name: plan.name, target: engine.config.path, status: 'running', results: [], startedAt: new Date().toISOString(), sampleRate: engine.config.sampleRate, protocol: engine.config.protocol, processingMode: engine.processingMode };
    let sentAtFrame = engine.validSamples;
    let received = Buffer.alloc(0);
    const receive = packet => { if (packet.dir === 'RX') received = Buffer.concat([received, Buffer.from(packet.data, 'base64')]).subarray(-65536); };
    const changed = () => { if (!engine.connected || generation !== engine.generation) controller.abort(); };
    engine.on('packet', receive); engine.on('state', changed);
    const wait = ms => new Promise((resolve, reject) => {
      if (controller.signal.aborted) return reject(new Error('测试已取消或连接已变化'));
      const cancel = () => { clearTimeout(timer); reject(new Error('测试已取消或连接已变化')); };
      const timer = setTimeout(() => { controller.signal.removeEventListener('abort', cancel); resolve(); }, ms);
      controller.signal.addEventListener('abort', cancel, { once: true });
    });
    this.emit('update');
    this.completion = (async () => {
      try {
        for (const [index, step] of plan.steps.entries()) {
          if (controller.signal.aborted) throw new Error('测试已取消');
          const result = { index: index + 1, type: step.type, status: 'running', detail: '' };
          this.job.results.push(result); this.emit('update');
          try {
            if (step.type === 'send') { received = Buffer.alloc(0); sentAtFrame = engine.validSamples; result.detail = `${await engine.send(step, token)} B sent`; }
            if (step.type === 'wait') await wait(step.ms);
            if (step.type === 'expect') {
              const needle = step.format === 'hex' ? encodePayload({ text: step.contains, format: 'hex' }) : Buffer.from(step.contains);
              const end = Date.now() + step.timeout;
              while (!received.includes(needle)) { if (Date.now() >= end) throw new Error(`等待响应超时：${step.contains}`); await wait(20); }
              result.detail = `匹配 ${step.contains}`;
              received = received.subarray(received.indexOf(needle) + needle.length);
            }
            if (step.type === 'assert') {
              if (step.fresh && engine.validSamples <= sentAtFrame) throw new Error('指令后未收到新的有效采样数据；请检查设备、数据通道与通信状态');
              const value = engine.latest[step.channel];
              if (!Number.isFinite(value) || value < step.min || value > step.max) throw new Error(`CH${step.channel + 1}=${value ?? '--'}，期望 ${step.min}..${step.max}`);
              result.detail = String(value);
            }
            result.status = 'passed';
          } catch (error) { result.status = 'failed'; result.detail = error.message; throw error; }
          this.emit('update');
        }
        this.job.status = 'passed';
      } catch (error) { this.job.status = controller.signal.aborted ? 'cancelled' : 'failed'; this.job.error = error.message; }
      finally { engine.off('packet', receive); engine.off('state', changed); engine.automationLock = null; this.controller = null; this.job.finishedAt = new Date().toISOString(); this.emit('update'); }
    })();
    return this.job;
  }
  stop() { this.controller?.abort(); }
}
