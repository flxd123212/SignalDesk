import { useState } from 'react';
import { Check, Copy, Fingerprint } from 'lucide-react';
import { IconButton } from './ui';

export type ModelCall = {
  requestedModel: string; reportedModel: string; endpoint: string; apiStyle: string;
  requestId: string; responseId: string; finishReason: string; latencyMs: number; time: string;
  inputTokens: number | null; outputTokens: number | null;
};

const callFields = (call: ModelCall) => [
  ['请求模型', call.requestedModel], ['接口返回模型', call.reportedModel || '接口未返回模型 ID'],
  ['请求地址', call.endpoint], ['API 格式', call.apiStyle],
  ['请求 ID', call.requestId || '未提供'], ['响应 ID', call.responseId || '未提供'],
  ['结束原因', call.finishReason || '未提供'], ['耗时', `${call.latencyMs} ms`],
  ['输入 / 输出 tokens', `${call.inputTokens ?? '未知'} / ${call.outputTokens ?? '未知'}`], ['调用时间', call.time],
];

export const formatCallRecord = (call: ModelCall) => callFields(call).map(([label, value]) => `${label}: ${value}`).join('\n');

export function AgentCallDetails({ call, notify }: { call: ModelCall; notify: (message: string, error?: boolean) => void }) {
  const [copied, setCopied] = useState(false);
  const different = !!call.reportedModel && call.reportedModel !== call.requestedModel;
  const copy = async () => { try { await navigator.clipboard.writeText(formatCallRecord(call)); setCopied(true); } catch { notify('无法复制调用记录', true); } };
  return <details className="agent-call-details">
    <summary aria-label="展开模型调用记录"><Fingerprint size={12} /><span>请求 {call.requestedModel}</span><span className={different ? 'call-model-different' : ''}>返回 {call.reportedModel || '未提供'}</span></summary>
    <div className="agent-call-heading"><span>模型调用记录</span><IconButton title={copied ? '调用记录已复制' : '复制调用记录'} onClick={() => void copy()}>{copied ? <Check size={13} /> : <Copy size={13} />}</IconButton></div>
    <dl>{callFields(call).map(([label, value]) => <div key={label}><dt>{label}</dt><dd>{value}</dd></div>)}</dl>
    <p>{different ? '返回 ID 与请求 ID 不同，可能是服务端别名或路由映射。' : ''}返回模型 ID 由接口提供，不代表已验证底层模型。</p>
  </details>;
}
