import { Download } from 'lucide-react';
import { download, formatBytes } from './data';
import type { AppState } from './types';

export function DecodeQuality({ state }: { state: AppState }) {
  const quality = (state as AppState & { quality?: { crcErrors: number; resyncBytes: number; pendingBytes: number; recordingErrors: number; decodeMs: number; maxChunkBytes: number; maxDecodeMs: number } }).quality;
  if (!quality) return null;
  const checksum = state.config.protocol === 'custom' && (state.config.schema as { checksum?: string })?.checksum !== 'none';
  return <details className="decode-quality"><summary>链路与解码质量 · {state.frames.toLocaleString()} 有效帧 · {state.parseErrors} 未解析 · {quality.recordingErrors} 录制异常</summary><div className="instrument-metrics">{[
    ['接收字节', formatBytes(state.rxBytes)], ['有效采样帧', state.frames.toLocaleString()], ['未解析行 / 候选帧', state.parseErrors], ['校验失败', checksum ? quality.crcErrors : '未启用校验'], ['重新同步跳过字节', state.config.protocol === 'custom' ? quality.resyncBytes : '--'], ['待拼接字节', quality.pendingBytes], ['数学运算异常', state.processingErrors], ['界面显示丢弃', state.dropped], ['录制异常', quality.recordingErrors], ['最大接收块', formatBytes(quality.maxChunkBytes)], ['单块处理峰值', `${quality.maxDecodeMs.toFixed(3)} ms`], ['累计解码与处理', `${quality.decodeMs.toFixed(2)} ms`],
  ].map(([label, value]) => <div key={label}><span>{label}</span><strong>{value}</strong></div>)}</div><p className="instrument-notice">未解析内容可能包含文本回复；显示丢弃不等于串口丢包。未提供发送端序号或参考数据，物理误码率及实际丢帧率未知。</p><button onClick={() => download(`decode-quality-${Date.now()}.json`, JSON.stringify({ at: new Date().toISOString(), source: state.source, config: state.config, rxBytes: state.rxBytes, frames: state.frames, parseErrors: state.parseErrors, processingErrors: state.processingErrors, displayDropped: state.dropped, ...quality, bitErrorRate: null, frameLossRate: null }, null, 2), 'application/json')}><Download size={15} />导出质量报告</button></details>;
}
