import { useEffect, useState } from 'react';
import { Activity, BookOpen, Pause, Play, RefreshCw } from 'lucide-react';

export type AgentProgress = { phase: string; step: number; maxSteps: number; attempt: number; detail: string; nextRetryAt?: number | null; waitingSince?: number };
export type HandoffEntry = { request: string; conclusion: string; tools: string[] };

export function AgentRunStatus({ progress, busy }: { progress?: AgentProgress; busy: boolean }) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => { if (!busy || progress?.phase !== 'model') return; setNow(Date.now()); const timer = window.setInterval(() => setNow(Date.now()), 1000); return () => clearInterval(timer); }, [busy, progress?.phase, progress?.waitingSince]);
  if (!progress?.detail) return null;
  return <div className={`agent-working ${progress.phase}`} role="status" aria-label="Agent 运行状态">
    {busy ? <RefreshCw size={13} className="spin" /> : progress.phase === 'paused' ? <Pause size={13} /> : <Activity size={13} />}
    <span>{progress.phase === 'error' ? '本轮分析失败，请查看上方错误' : progress.detail}</span>
    {busy && progress.phase === 'model' && progress.waitingSince && <time aria-hidden="true">{Math.max(0, Math.floor((now - progress.waitingSince) / 1000))} s</time>}
    <small>{progress.step > 0 ? `${progress.step} / ${progress.maxSteps} 步` : ''}</small>
    {busy && progress.maxSteps>0 && <progress className="agent-budget-meter" aria-label="本轮已用步骤" value={progress.step} max={progress.maxSteps}/>}
  </div>;
}

export function AgentRecovery({ remaining, maxSteps, changeSteps, resume, busy }: { remaining: number; maxSteps: number; changeSteps: (value: number) => void; resume: () => void; busy: boolean }) {
  const limits = [...new Set([maxSteps, 8, 12, 16, 20])].sort((a, b) => a - b);
  return <div className="agent-recovery" aria-label="继续未完成任务">
    <div><Pause size={13} /><span>{remaining ? `计划还有 ${remaining} 项未完成` : '本轮已停止，可继续原任务'}</span></div>
    <label>本轮预算<select aria-label="继续任务步骤预算" value={maxSteps} disabled={busy} onChange={event => changeSteps(Number(event.target.value))}>{limits.map(limit => <option key={limit} value={limit}>{limit} 步</option>)}</select></label>
    <button className="quiet-button" disabled={busy} onClick={resume}><Play size={13} />继续任务</button>
  </div>;
}

export function AgentHandoff({ entries }: { entries: HandoffEntry[] }) {
  if (!entries.length) return null;
  return <details className="agent-handoff"><summary><BookOpen size={13} />历史任务摘录<span>{entries.length}</span></summary><div>
    <p>摘录有截断，旧结论未经重新验证。当前源码、提案状态和工具结果优先。</p>
    {entries.map((entry, index) => <section key={index}><b>请求</b><p>{entry.request}</p><b>当时的回复</b><p>{entry.conclusion || '无正文结论'}</p>{entry.tools.length > 0 && <code>{entry.tools.join(' · ')}</code>}</section>)}
  </div></details>;
}
