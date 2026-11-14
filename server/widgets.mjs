import { Worker } from 'node:worker_threads';
import { randomUUID } from 'node:crypto';

export class WidgetSandbox {
  constructor() { this.worker = null; this.pending = new Map(); }
  start() {
    if (this.worker) return;
    const worker = this.worker = new Worker(new URL('./widgets-worker.mjs', import.meta.url), { resourceLimits: { maxOldGenerationSizeMb: 64, stackSizeMb: 2 } });
    worker.on('message', message => { const item = this.pending.get(message.id); if (!item) return; clearTimeout(item.timer); this.pending.delete(message.id); if (message.error) item.reject(new Error(message.error)); else { try { item.resolve(this.validate(message.result)); } catch (error) { item.reject(error); } } });
    const failed = () => { if (this.worker === worker) { this.worker = null; for (const item of this.pending.values()) { clearTimeout(item.timer); item.reject(new Error('自定义 JS 工作线程已停止')); } this.pending.clear(); } };
    worker.on('error', failed); worker.on('exit', failed);
  }
  validate(result) {
    if (!result.state || typeof result.state !== 'object' || JSON.stringify(result.state).length > 32768) throw new Error('控件状态必须是 32 KiB 以内的对象');
    const view = result?.view;
    if (!view || !['number', 'bar', 'indicator', 'button', 'chart'].includes(view.kind)) throw new Error('控件必须返回 number / bar / indicator / button / chart 视图');
    if (!Number.isFinite(view.value) || Math.abs(view.value) > 1e12) throw new Error('控件数值必须是有限数');
    const min = view.min ?? 0, max = view.max ?? 100;
    if (!Number.isFinite(min) || !Number.isFinite(max) || min >= max) throw new Error('控件上下限无效');
    if (view.series !== undefined && (!Array.isArray(view.series) || view.series.length > 2000 || view.series.some(value => !Number.isFinite(value)))) throw new Error('控件曲线最多 2000 个有限数值');
    return { state: result.state || {}, view: { kind: view.kind, value: view.value, title: String(view.title || '').slice(0, 80), unit: String(view.unit || '').slice(0, 20), color: /^#[\da-f]{6}$/i.test(view.color) ? view.color : '#75beff', min, max, series: view.series || [] } };
  }
  async run(input) {
    if (typeof input.code !== 'string' || input.code.length > 16384) throw new Error('自定义 JS 不能超过 16 KiB');
    if (!Array.isArray(input.inputs) || input.inputs.length > 16 || input.inputs.some(value => !Number.isFinite(value)) || JSON.stringify(input.settings || {}).length > 4096 || JSON.stringify(input.state || {}).length > 32768) throw new Error('控件输入、设置或状态超出限制');
    if (this.pending.size >= 8) throw new Error('控件请求积压，请降低刷新率');
    this.start(); const id = randomUUID();
    return new Promise((resolve, reject) => { const timer = setTimeout(() => { void this.worker?.terminate(); reject(new Error('自定义 JS 执行超时')); }, 2500); this.pending.set(id, { resolve, reject, timer }); this.worker.postMessage({ id, input: { ...input, settings: input.settings || {}, state: input.state || {} } }); });
  }
  async dispose() { await this.worker?.terminate(); }
}
