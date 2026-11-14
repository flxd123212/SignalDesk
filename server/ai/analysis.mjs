export function captureSnapshot(engine, includeLogs = false) {
  const state = engine.state(), samples = engine.history.slice(-2048);
  const channels = state.names.map((name, index) => {
    const values = samples.map(sample => sample.values[index]).filter(Number.isFinite);
    if (!values.length) return { name, count: 0 };
    const mean = values.reduce((sum, value) => sum + value, 0) / values.length;
    const min = Math.min(...values), max = Math.max(...values);
    return { name, count: values.length, latest: values.at(-1), min, max, peakToPeak: max - min, mean, rms: Math.sqrt(values.reduce((sum, value) => sum + value * value, 0) / values.length), standardDeviation: Math.sqrt(values.reduce((sum, value) => sum + (value - mean) ** 2, 0) / values.length) };
  });
  return {
    capturedAt: new Date().toISOString(), source: state.source, port: state.config.path, connected: state.connected,
    ...(engine.projectContext ? { project: { ...engine.projectContext, serial: state.config } } : {}),
    protocol: state.config.protocol, configuredSampleRate: state.config.sampleRate, timeBasis: 'configured sample rate, not hardware timestamps',
    processing: state.processingMode, rxBytes: state.rxBytes, txBytes: state.txBytes, frames: state.frames,
    parseSkipped: state.parseErrors, processingErrors: state.processingErrors, displayDropped: state.dropped,
    windowSeconds: samples.length > 1 ? samples.at(-1).time - samples[0].time : 0, channels,
    samples: samples.filter((_, index) => index % Math.max(1, Math.ceil(samples.length / 64)) === 0),
    ...(includeLogs ? { logs: engine.recentPackets.slice(-8).map(packet => ({ direction: packet.dir, text: Buffer.from(packet.data, 'base64').toString('utf8').slice(0, 700) })) } : {}),
  };
}

export function localReport(snapshot) {
  const lines = ['本地数据检查', '', `数据来源：${snapshot.source === 'demo' ? '模拟设备' : snapshot.source === 'replay' ? '录制回放' : snapshot.connected ? snapshot.port : '未连接'}；窗口 ${snapshot.windowSeconds.toFixed(2)} s，累计 ${snapshot.frames} 帧。`];
  if (!snapshot.channels.length) lines.push('当前没有可分析的数值通道，请检查数据格式和连接状态。');
  for (const channel of snapshot.channels) {
    if (!channel.count) continue;
    lines.push(`${channel.name}：范围 ${channel.min.toFixed(4)} ～ ${channel.max.toFixed(4)}，均值 ${channel.mean.toFixed(4)}，RMS ${channel.rms.toFixed(4)}，峰峰值 ${channel.peakToPeak.toFixed(4)}。`);
    if (channel.count > 100 && channel.peakToPeak < 1e-7) lines.push(`${channel.name} 在当前窗口内保持常值。若预期是变化信号，检查采样更新、通道映射和固件发送逻辑。`);
  }
  if (snapshot.parseSkipped) lines.push(`累计跳过 ${snapshot.parseSkipped} 行或帧；可能包含普通日志，也可能存在分帧或数值格式不匹配。`);
  if (snapshot.processingErrors) lines.push(`处理链存在 ${snapshot.processingErrors} 次错误，请检查缺失通道、除零或不完整节点连接。`);
  if (snapshot.displayDropped) lines.push(`显示通道曾丢弃 ${snapshot.displayDropped} 个批次元素，当前图形不能作为完整数据记录。`);
  lines.push('', '时基取自配置采样率。该报告使用本地规则与统计量生成，未调用模型；不能据此判定电路故障或真实采样时序。');
  return lines.join('\n');
}
