import { useEffect, useRef, useState } from 'react';
import { Check, FileDiff, MessageSquare, ShieldCheck, X } from 'lucide-react';
import { api } from './data';
import './agent-project.css';
import { appendBlueprint } from '../shared/display-blueprint.mjs';
import { panelFor, hit } from '../shared/display-scene.mjs';
import { paint, template, type Scene } from './display/scene';

export type Interaction = { id: string; kind: 'question' | 'brief' | 'action' | 'acceptance'; prompt: string; actionId?: string };
type Action = { path?: string; diff?: string; diffTruncated?: boolean; target?: string; payload?: { text: string; format: string; ending?: string; checksum?: string }; plan?: { command: string; args: string[] } };
export function ProjectInteraction({ item, action, scope, notify }: { item: Interaction; action?: Action; scope: { deviceId?: string; sessionId?: string; root: string }; notify: (s: string, error?: boolean) => void }) {
  const [answer, setAnswer] = useState(item.kind === 'brief' ? item.prompt : ''), [policy, setPolicy] = useState('ask'), [busy, setBusy] = useState(false);
  const [fullDiff, setFullDiff] = useState(''), [reading, setReading] = useState(false);
  const readDiff = async () => {
    if (!item.actionId) return;
    setReading(true);
    try {
      const query = new URLSearchParams({ deviceId: scope.deviceId || '', sessionId: scope.sessionId || '', root: scope.root });
      const change = await api<{ diff: string }>(`/ai/changes/${encodeURIComponent(item.actionId)}?${query}`);
      setFullDiff(change.diff);
    } catch (error) { notify((error as Error).message, true); }
    finally { setReading(false); }
  };
  const reply = async (decision: string) => { setBusy(true); try { await api('/ai/project/reply', { ...scope, id: item.id, decision, answer, policy }); } catch (e) { notify((e as Error).message, true); } finally { setBusy(false); } };
  const { kind } = item;
  return <section className="project-interaction" aria-label="项目交互"><header><ShieldCheck size={15}/><strong>{{question:'补充需求',brief:'确认工程提示词',action:'操作授权',acceptance:'交付验收'}[kind]}</strong></header>
    {kind !== 'brief' && <p>{item.prompt}</p>}
    {action && <><code>{action.path || action.target || action.plan?.command}</code>
      {action.payload && <small>{action.payload.format.toUpperCase()} · 结束符 {action.payload.ending || 'none'} · 校验 {action.payload.checksum || 'none'}</small>}
      <pre>{fullDiff || action.diff || action.payload?.text || action.plan?.args.join(' ')}</pre>
      {action.diffTruncated && !fullDiff && <button className="quiet-button" disabled={reading} onClick={readDiff}>{reading ? '正在读取差异' : '预览已截断，查看完整差异'}</button>}</>}
    {kind !== 'action' && <textarea aria-label={kind === 'brief' ? '标准工程提示词' : '项目反馈'} value={answer} maxLength={8000} rows={kind === 'brief' ? 6 : 2} placeholder={kind === 'acceptance' ? '还有哪些地方需要修改？' : '补充具体要求…'} onChange={e => setAnswer(e.target.value)}/>}
    {kind === 'brief' && <label>本次任务授权<select value={policy} onChange={e => setPolicy(e.target.value)}><option value="ask">每次操作前询问</option><option value="auto">直接执行：写文件、运行工具链、发送串口命令</option></select></label>}
    <footer>{kind === 'action' && <button className="quiet-button" disabled={busy} onClick={() => reply('deny')}><X size={14}/>拒绝</button>}
      {(kind === 'brief' || kind === 'acceptance') && <button className="quiet-button" disabled={busy || !answer.trim()} onClick={() => reply('revise')}><MessageSquare size={14}/>继续改进</button>}
      <button className="primary" disabled={busy || ((kind === 'question' || kind === 'brief') && !answer.trim())} onClick={() => reply(({question:'reply',brief:'confirm',action:'approve',acceptance:'accept'})[kind])}><Check size={14}/>{{question:'提交回答',brief:'确认并开始',action:'同意执行',acceptance:'验收完成'}[kind]}</button></footer>
  </section>;
}

export function LiveDiff({ action, open }: { action: Action & {status:string}; open?: (file: string, line: number) => void }) {
  if (!action.path || !action.diff) return null;
  return <details className="agent-live-diff"><summary><FileDiff size={14}/>{action.path}<small>{action.status === 'applied' ? '已写入' : action.status === 'pending' ? '待确认' : action.status}</small></summary>
    <pre className="diff-preview">{action.diff.split('\n').map((line,i) => <span key={i} className={line.startsWith('+') ? 'added' : line.startsWith('-') ? 'removed' : ''}>{line}{'\n'}</span>)}</pre>
    {action.diffTruncated && <small>差异预览已截断，完整内容可在修改记录中查看。</small>}
    {open && action.status === 'applied' && <button className="quiet-button" onClick={() => open(action.path!, Number(action.diff?.match(/@@ .*? \+(\d+)/)?.[1]) || 1)}>打开修改位置</button>}</details>;
}

export function ProjectScreen({ id }: { id: string }) {
  const [scene, setScene] = useState<Scene>(), [page, setPage] = useState(0), [error, setError] = useState('');
  const canvas = useRef<HTMLCanvasElement>(null);
  useEffect(() => { let live = true; api<{content:string}>(`/ai/changes/${encodeURIComponent(id)}`).then(change => {
    const design = JSON.parse(change.content), scene = appendBlueprint({ ...template(), profile: design.profile, pages: [] }, { pages: design.pages }, () => crypto.randomUUID());
    if (live) { setScene(scene); setPage(0); }
  }).catch(e => { if (live) setError(e.message); }); return () => { live = false; }; }, [id]);
  useEffect(() => { let live = true; if (scene) paint(scene,page).then(({canvas: bitmap}) => { if (live) canvas.current?.getContext('2d')?.drawImage(bitmap,0,0); }).catch(e => { if (live) setError(e.message); }); return () => { live = false; }; }, [scene,page]);
  const panel = panelFor(scene?.profile);
  return <details className="agent-live-diff" open><summary>屏幕交互预览 · {panel.label}</summary>{error ? <p role="alert">{error}</p> : scene && <><canvas ref={canvas} width={panel.w} height={panel.h} aria-label="工程屏幕预览" onClick={e => { const r = e.currentTarget.getBoundingClientRect(), n = hit(scene.pages[page].layers,panel,(e.clientX-r.left)*panel.w/r.width,(e.clientY-r.top)*panel.h/r.height); if (n) setPage(n.target); }}/><select aria-label="预览页面" value={page} onChange={e => setPage(+e.target.value)}>{scene.pages.map((p,i) => <option key={i} value={i}>{p.name}</option>)}</select></>}</details>;
}
