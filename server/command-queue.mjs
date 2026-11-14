import { encodePayload } from './protocol.mjs';

export class CommandQueues {
  constructor(hub, logs) { this.hub = hub; this.logs = logs; this.jobs = new Map(); this.running = new Map(); }
  state(deviceId = this.hub.activeId) { return this.jobs.get(deviceId) || null; }
  async start(input) {
    const { deviceId, commands, interval = 150, repeat = 1 } = input;
    if (deviceId !== this.hub.activeId || !this.hub.devices.has(deviceId)) throw new Error('当前设备已切换');
    const device = this.hub.devices.get(deviceId), engine = device.engine;
    if (!engine.connected || engine.busy || engine.automationLock || engine.flashLock || this.running.has(deviceId)) throw new Error('设备未连接或正在执行其他任务');
    if (!Array.isArray(commands) || !commands.length || commands.length > 5000 || !Number.isInteger(repeat) || repeat < 1 || repeat > 100 || commands.length * repeat > 10000) throw new Error('队列最多 5000 条指令，累计发送不超过 10000 次');
    if (!Number.isInteger(interval) || interval < 20 || interval > 60000 || commands.length * repeat * interval > 3600000) throw new Error('发送间隔为 20..60000 ms，队列总等待时间不超过 1 小时');
    let totalBytes = 0;
    const payloads = commands.map(command => { totalBytes += encodePayload(command).length; if (totalBytes > 4 * 1024 * 1024) throw new Error('队列有效载荷超过 4 MiB'); return { ...command, name: String(command.name || '').slice(0, 80) }; });
    const generation = engine.generation, owner = {}, controller = { stopped: false, wake: null, completion: null };
    const job = { deviceId, deviceName: device.name, target: engine.config.path, status: 'running', total: commands.length * repeat, sent: 0, bytes: 0, current: '', error: '', startedAt: new Date().toISOString() };
    engine.stopTimedSend(); engine.automationLock = owner; this.jobs.set(deviceId, job); this.running.set(deviceId, controller); engine.emitState();
    controller.completion = (async () => {
      try {
        for (let index = 0; index < job.total; index++) {
          if (controller.stopped) break;
          if (!engine.connected || engine.generation !== generation) throw new Error('原设备连接已变化，队列已停止');
          const command = payloads[index % payloads.length]; job.current = command.name;
          job.bytes += await engine.send(command, owner); job.sent++;
          this.logs.write({ category: 'command-queue', device: deviceId, message: `已发送 ${command.name || index + 1}`, data: { index: job.sent, target: job.target, format: command.format } });
          if (index < job.total - 1 && !controller.stopped) await new Promise(resolve => { const timer = setTimeout(resolve, interval); controller.wake = () => { clearTimeout(timer); resolve(); }; });
        }
        job.status = controller.stopped ? 'cancelled' : 'succeeded';
      } catch (error) { job.status = 'failed'; job.error = error.message; }
      finally {
        if (engine.automationLock === owner) engine.automationLock = null;
        this.running.delete(deviceId); job.finishedAt = new Date().toISOString(); engine.emitState();
        this.logs.write({ category: 'command-queue', device: deviceId, level: job.status === 'failed' ? 'error' : 'info', message: `指令队列 ${job.status}`, data: { ...job } });
      }
    })();
    return job;
  }
  stop(deviceId = this.hub.activeId) { const running = this.running.get(deviceId); if (running) { running.stopped = true; running.wake?.(); } return this.state(deviceId); }
  async dispose() { const active = [...this.running.entries()]; for (const [id] of active) this.stop(id); await Promise.all(active.map(([, item]) => item.completion)); }
}
