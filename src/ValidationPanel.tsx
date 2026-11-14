import { useEffect, useRef, useState } from 'react';
import { AlertCircle, Bot, Download, FlaskConical, Hammer, Plug, RefreshCw, Settings2, Square, Wrench } from 'lucide-react';
import { api, download, formatBytes } from './data';
import { IconButton } from './ui';
import { BuildSettings } from './BuildSettings';

export type ValidationRequest = { id: number; mode: 'build' | 'test' };
type Diagnostic = { path: string; location: string; line: number; column: number; severity: string; message: string };
type Job = { status: string; command: string; cwd: string; output: string; outputTruncated?: boolean; artifacts?: { path: string; bytes: number; architecture: string }[]; startedAt: string; finishedAt?: string; exitCode: number | null; summary: string; elapsedMs: number; diagnostics: Diagnostic[]; validation?: { id: string; kind: string; label: string; fingerprint: string; sourceState: string } };
type RunState = { deviceId: string; sessionId: string; root: string; readOnly: boolean; job: Job | null; history: Job[] };
type Capabilities = { deviceId: string; sessionId: string; root: string; preset: string; readOnly: boolean; note: string; choices: { id: string; label: string; note: string }[] };
type Props = { deviceId: string; root: string; request?: ValidationRequest; consume: () => void; openSource: (file: string, line: number) => void; analyze: (file: string, prompt: string) => void; deviceTests: () => void };

export function ValidationPanel({ deviceId, root, request, consume, openSource, analyze, deviceTests }: Props) {
  const [settings, setSettings] = useState(false);
  const [state, setState] = useState<RunState | null>(null), [caps, setCaps] = useState<Capabilities | null>(null), [error, setError] = useState(''), [busy, setBusy] = useState(false);
  const [choice, setChoice] = useState(''), [configuration, setConfiguration] = useState('Debug'), [view, setView] = useState<'output' | 'problems' | 'history' | 'artifacts'>('output'), [selected, setSelected] = useState<Job | null>(null);
  const alive = useRef(true), handled = useRef(0), loadingCaps = useRef(false), activeRun = useRef(false), output = useRef<HTMLPreElement>(null), follow = useRef(true);
  const query = new URLSearchParams({ deviceId, root }).toString();
  const refreshCaps = async () => {
    if (loadingCaps.current) return;
    loadingCaps.current = true;
    try { const result = await api<Capabilities>(`/validation/capabilities?${query}`); if (alive.current) { setCaps(result); setChoice(current => result.choices.some(item => item.id === current) ? current : result.choices[0]?.id || ''); } return result; }
    catch (error) { if (alive.current) setError((error as Error).message); }
    finally { loadingCaps.current = false; }
  };
  useEffect(() => {
    alive.current = true; let pending = false;
    const refresh = async () => { if (pending) return; pending = true; try { const value = await api<RunState>(`/validation/state?${query}`); if (alive.current) setState(value); } catch (error) { if (alive.current) setError((error as Error).message); } finally { pending = false; } };
    void refresh(); void refreshCaps(); const timer = setInterval(refresh, 800);
    return () => { alive.current = false; clearInterval(timer); };
  }, [query]);
  useEffect(() => { setSelected(null); void refreshCaps(); }, [state?.sessionId, state?.job?.finishedAt]);
  const run = async (kind: 'build' | 'test' | 'configure') => {
    if (activeRun.current) return; activeRun.current = true; setBusy(true); setError(''); setSelected(null); setView('output'); follow.current = true;
    try {
      const owner = await api<Capabilities>(`/validation/capabilities?${query}`);
      if (!alive.current) return;
      setCaps(owner);
      const context = { deviceId, root, sessionId: owner.sessionId };
      const plan = await api<{ id: string }>('/validation/prepare', { ...context, kind, choiceId: choice, configuration });
      if (!alive.current) return;
      const result = await api<RunState>('/validation/execute', { ...context, id: plan.id, confirm: true });
      if (alive.current) setState(result);
    } catch (error) { if (alive.current) setError((error as Error).message); }
    finally { activeRun.current = false; if (alive.current) setBusy(false); }
  };
  useEffect(() => {
    if (!request || handled.current === request.id) return;
    handled.current = request.id; consume();
    if (request.mode === 'build') void run('build');
    else { setView('output'); void refreshCaps(); }
  }, [request?.id]);
  const current = state?.job, job = selected || current;
  const running = busy || current?.status === 'running' || ['running', 'checking'].includes(current?.validation?.sourceState || '');
  const disabled = running || !state || !caps || state.readOnly || caps.readOnly || state.sessionId !== caps.sessionId;
  const errors = job?.diagnostics.filter(item => item.severity === 'error').length || 0, warnings = job?.diagnostics.filter(item => item.severity === 'warning').length || 0;
  const diagnostics = [...(job?.diagnostics || [])].sort((a, b) => (a.severity === 'error' ? 0 : 1) - (b.severity === 'error' ? 0 : 1));
  useEffect(() => { if (follow.current && output.current) output.current.scrollTop = output.current.scrollHeight; }, [job?.output, view]);
  return <section className="validation-panel" aria-label="源码编译与测试">
    <div className="validation-toolbar">
      <IconButton title="设置构建工具" disabled={running || !state || state.readOnly} onClick={() => setSettings(true)}><Wrench size={14} /></IconButton>
      <button className="quiet-button" disabled={disabled} onClick={() => void run('build')}><Hammer size={14} />编译工程</button>
      {['cmake', 'gcc'].includes(caps?.preset || '') && <><IconButton title={caps?.preset === 'gcc' ? '配置 GCC 工程' : '配置 CMake 工程'} disabled={disabled} onClick={() => void run('configure')}><Settings2 size={15} /></IconButton><select aria-label="构建配置" value={configuration} onChange={event => setConfiguration(event.target.value)} disabled={running}><option>Debug</option><option>Release</option><option>RelWithDebInfo</option><option>MinSizeRel</option></select></>}
      <select aria-label="测试目标" value={choice} onChange={event => setChoice(event.target.value)} disabled={disabled || !caps?.choices.length}><option value="">{caps?.choices.length ? '选择测试目标' : '未发现测试入口'}</option>{caps?.choices.map(item => <option key={item.id} value={item.id}>{item.label}</option>)}</select>
      <IconButton title="运行选定测试" disabled={disabled || !choice} onClick={() => void run('test')}><FlaskConical size={15} /></IconButton>
      <IconButton title="停止验证任务" disabled={!current?.validation || current.status !== 'running' || !!state?.readOnly} onClick={async () => { try { setState(await api<RunState>('/validation/cancel', { deviceId, root, sessionId: state?.sessionId, id: current?.validation?.id })); } catch (error) { setError((error as Error).message); } }}><Square size={13} /></IconButton>
      <IconButton title="刷新测试入口" disabled={running} onClick={() => { setError(''); void refreshCaps(); }}><RefreshCw size={14} /></IconButton>
      <span className="validation-target" title={root}>{root.split(/[\\/]/).at(-1)} · {caps?.preset || '待配置'}</span>
      <IconButton title="设备通信测试" onClick={deviceTests}><Plug size={14} /></IconButton>
      <IconButton title="导出验证报告" disabled={!job} onClick={() => { if (job) download(`validation-${job.startedAt.replace(/[:.]/g, '-')}.json`, JSON.stringify({ exportedAt: new Date().toISOString(), deviceId, sessionId: state?.sessionId, ...job }, null, 2), 'application/json'); }}><Download size={15} /></IconButton>
      <IconButton title="交给 Agent 排查" disabled={!job || running} onClick={() => { if (job) analyze(job.diagnostics.find(item => item.path)?.path || '', `请分析当前工程的编译/测试结果，结合源码给出原因和修改建议，先不要执行或修改。\n${job.command}\n${job.summary}\n${JSON.stringify(job.diagnostics)}\n${job.output.slice(-10000)}`); }}><Bot size={15} /></IconButton>
    </div>
    {error && <div className="validation-error" role="alert"><AlertCircle size={14} />{error}</div>}
    <div className="validation-results-heading"><div className="validation-views">{(['output', 'problems', 'history', 'artifacts'] as const).map(id => <button key={id} aria-pressed={view === id} className={view === id ? 'active' : ''} onClick={() => setView(id)}>{id === 'output' ? '输出' : id === 'problems' ? `问题 ${errors + warnings}` : id === 'history' ? `记录 ${state?.history.length || 0}` : `产物 ${job?.artifacts?.length || 0}`}</button>)}</div><span className={`validation-summary ${job?.status || ''}`} title={job?.summary}>{job?.summary || (state?.readOnly ? '当前为只读会话' : '尚未执行验证')}</span>{job && <small>{(job.elapsedMs / 1000).toFixed(1)}s</small>}{selected && <button className="quiet-button" onClick={() => setSelected(null)}>当前任务</button>}</div>
    <div className="validation-body">
      {view === 'output' && <><div className="validation-note">{caps?.choices.find(item => item.id === choice)?.note || caps?.note}{job?.validation?.sourceState === 'changed' && ' 本次结果对应较早源码。'}{job?.outputTruncated && ' 输出过长，仅显示末尾 64,000 字符。'}</div><pre ref={output} className="validation-output" onScroll={event => { const element = event.currentTarget; follow.current = element.scrollHeight - element.scrollTop - element.clientHeight < 40; }}>{job ? `${job.command}\n${job.output}${job.exitCode !== null ? `\nexit ${job.exitCode}` : ''}` : '暂无编译或测试输出'}</pre></>}
      {view === 'problems' && <div className="validation-problems">{job?.diagnostics.length ? diagnostics.map((item, index) => <button key={index} disabled={!item.path} title={item.location} className={item.severity} onClick={() => openSource(item.path, item.line)}><AlertCircle size={14} /><code>{item.path || item.location}:{item.line}{item.column ? `:${item.column}` : ''}</code><span>{item.message}</span></button>) : <p className="muted">{job?.status === 'failed' ? '未识别到源码定位信息，请查看输出中的错误。' : '没有解析到编译器诊断。'}</p>}</div>}
      {view === 'history' && <div className="validation-history">{state?.history.length ? state.history.map(item => <button key={item.validation?.id} onClick={() => { setSelected(item); setView('output'); }}><time>{new Date(item.startedAt).toLocaleTimeString()}</time><span>{item.validation?.label}</span><strong className={item.status}>{item.summary}</strong><code title="源码扫描指纹">{item.validation?.fingerprint.slice(0, 10)}</code></button>) : <p className="muted">本次运行尚无已完成记录。</p>}</div>}
      {view === 'artifacts' && <div className="validation-artifacts">{job?.artifacts?.length ? <table><thead><tr><th>产物路径</th><th>大小</th><th>目标架构</th></tr></thead><tbody>{job.artifacts.map(item => <tr key={item.path}><td><code>{item.path}</code></td><td>{formatBytes(item.bytes)}</td><td>{item.architecture || '—'}</td></tr>)}</tbody></table> : <p className="muted">本次任务没有记录交叉编译产物。</p>}</div>}
    </div>
    {settings && <BuildSettings deviceId={deviceId} root={root} saved={() => { setError(''); void refreshCaps(); }} close={() => setSettings(false)} />}
  </section>;
}
