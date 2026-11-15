export const hardwareTestStorageKey = (deviceId, root) => `signaldesk.test:${deviceId}:${root}`;
export function hardwareTestPlan({ command, ack, delay, binding, board, revision }) {
  if (typeof command !== 'string' || !command.trim() || command.length > 4096 || typeof ack !== 'string' || !ack.trim() || ack.length > 1024) throw new Error('请填写命令与设备确认响应');
  if (!binding || !Number.isInteger(binding.channel) || binding.channel < 0 || binding.channel > 15 || !Number.isFinite(binding.min) || !Number.isFinite(binding.max) || binding.min > binding.max) throw new Error('反馈信号需要绑定通道并设置上下限');
  if (!Number.isInteger(delay) || delay < 1 || delay > 30000) throw new Error('稳定等待应为 1..30000 ms');
  return { name: `${board || '硬件'} ${revision || ''} · ${binding.name} 反馈测试`, steps: [{ type: 'send', text: command, format: 'text', ending: 'lf' }, { type: 'expect', contains: ack, timeout: 3000 }, { type: 'wait', ms: delay }, { type: 'assert', channel: binding.channel, min: binding.min, max: binding.max, fresh: true }] };
}
