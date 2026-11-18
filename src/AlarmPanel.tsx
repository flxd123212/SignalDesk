import { useEffect, useState } from 'react';
import { Bell, Check, Download, Plus, Save, Trash2 } from 'lucide-react';
import { api } from './data';
import { Field, IconButton } from './ui';
import { IncidentDialog } from './FieldDiagnostics';
import type { AppState, Device } from './types';

type Rule = { id: string; name: string; kind: string; enabled: boolean; channel: number; min: number | null; max: number | null; delta: number; holdMs: number; cooldownMs: number; timeoutMs: number };
type Event = { id: string; device: string; deviceName: string; name: string; kind: string; time: string; message: string; acknowledged: boolean };
type Report = { rules: Rule[]; events: Event[]; active: { device: string; rule: string }[] };
export function AlarmBell({ open }: { open: () => void }) {
  const [count, setCount] = useState(0);
  useEffect(() => {
    let active = true;
    const refresh = () => api<Report>('/alarms').then(report => { if (active) setCount(report.events.filter(event => !event.acknowledged && event.kind !== 'recovered').length); }).catch(() => {});
    void refresh(); const timer = setInterval(refresh, 3000); window.addEventListener('signaldesk-alarm', refresh);
    return () => { active = false; clearInterval(timer); window.removeEventListener('signaldesk-alarm', refresh); };
  }, []);
  return <button className={`alarm-bell ${count ? 'warning' : ''}`} title="查看报警" aria-label="查看报警" onClick={open}><Bell size={17} />{count > 0 && <span>{count > 99 ? '99+' : count}</span>}</button>;
}

export function AlarmPanel({ state, notify,review }: { state: AppState; notify: (message: string, error?: boolean) => void; review?:(text:string)=>void }) {
  const [incident,setIncident]=useState('');
  const scope = state as AppState & { activeDevice?: string; devices?: Device[] };
  const [rules, setRules] = useState<Rule[]>([]), [report, setReport] = useState<Report | null>(null), [dirty, setDirty] = useState(false), [busy, setBusy] = useState(false), [filter, setFilter] = useState(''), [failure, setFailure] = useState('');
  const [desktopNotice, setDesktopNotice] = useState(localStorage.getItem('signaldesk.alarm-notifications') === 'true');
  useEffect(() => {
    let active = true;
    const refresh = (initial = false) => api<Report>('/alarms').then(result => { if (active) { setReport(result); if (initial) setRules(result.rules); } }).catch(error => { if (active) setFailure(error.message); });
    void refresh(true); const timer = setInterval(() => refresh(), 800);
    return () => { active = false; clearInterval(timer); };
  }, []);
  const update = (id: string, patch: Partial<Rule>) => { setRules(current => current.map(rule => rule.id === id ? { ...rule, ...patch } : rule)); setDirty(true); };
  const save = async () => { setBusy(true); setFailure(''); try { const result = await api<Report>('/alarms/config', { deviceId: scope.activeDevice, rules }); setRules(result.rules); setReport(result); setDirty(false); notify('当前设备报警规则已保存'); } catch (error) { setFailure((error as Error).message); } finally { setBusy(false); } };
  const notifications = async (enabled: boolean) => {
    if (enabled && (typeof Notification === 'undefined' || await Notification.requestPermission() !== 'granted')) { notify('系统通知未获授权，应用内报警仍然有效', true); return; }
    setDesktopNotice(enabled); localStorage.setItem('signaldesk.alarm-notifications', String(enabled));
  };
  return <div className="alarm-page"><section className="instrument-section"><div className="section-heading"><Bell size={18} /><h2>报警规则</h2><span className="small-tag">{scope.devices?.find(device => device.id === scope.activeDevice)?.name}</span><span className="muted">{dirty ? '未保存' : '已保存'}</span></div><div className="lab-actions"><button className="quiet-button" disabled={rules.length >= 32} onClick={() => { setRules(current => [...current, { id: crypto.randomUUID(), name: `通道报警 ${current.length + 1}`, enabled: true, kind: 'range', channel: 0, min: 0, max: 3.3, delta: 1, holdMs: 100, cooldownMs: 5000, timeoutMs: 2000 }]); setDirty(true); }}><Plus size={14} />添加报警规则</button><button className="primary" disabled={busy || !dirty} onClick={save}><Save size={14} />保存报警规则</button><button className="quiet-button" onClick={() => api('/alarms/test', {}).catch(error => notify(error.message, true))}><Bell size={14} />测试通知</button><label className="checkbox"><input aria-label="系统报警通知" type="checkbox" checked={desktopNotice} onChange={event => notifications(event.target.checked)} />系统通知</label></div>{failure && <div role="alert" className="inline-error">{failure}</div>}
    <div className="alarm-rules">{rules.map((rule, index) => <article className="alarm-rule" key={rule.id}><div className="alarm-rule-heading"><label className="checkbox"><input aria-label={`启用报警 ${index + 1}`} type="checkbox" checked={rule.enabled} onChange={event => update(rule.id, { enabled: event.target.checked })} />启用</label><input aria-label={`报警名称 ${index + 1}`} value={rule.name} maxLength={80} onChange={event => update(rule.id, { name: event.target.value })} /><span className={report?.active.some(item => item.device === scope.activeDevice && item.rule === rule.id) ? 'warning' : 'muted'}>{report?.active.some(item => item.device === scope.activeDevice && item.rule === rule.id) ? '报警中' : '正常 / 待采样'}</span><IconButton title={`删除报警 ${index + 1}`} onClick={() => { setRules(current => current.filter(item => item.id !== rule.id)); setDirty(true); }}><Trash2 size={15} /></IconButton></div><div className="alarm-fields"><Field label="类型"><select aria-label={`报警类型 ${index + 1}`} value={rule.kind} onChange={event => update(rule.id, { kind: event.target.value })}><option value="range">上下限</option><option value="jump">相邻采样突变</option><option value="stale">有效数据断流</option><option value="connection">设备意外断开</option></select></Field><Field label="数据通道"><select aria-label={`报警通道 ${index + 1}`} value={rule.channel} disabled={rule.kind === 'connection'} onChange={event => update(rule.id, { channel: Number(event.target.value) })}>{Array.from({ length: 16 }, (_, channel) => <option key={channel} value={channel}>{state.names[channel] || `CH${channel + 1}`}</option>)}</select></Field>
      {rule.kind === 'range' && <><Field label="下限"><input aria-label={`报警下限 ${index + 1}`} type="number" step="any" value={rule.min ?? ''} placeholder="不限" onChange={event => update(rule.id, { min: event.target.value === '' ? null : Number(event.target.value) })} /></Field><Field label="上限"><input aria-label={`报警上限 ${index + 1}`} type="number" step="any" value={rule.max ?? ''} placeholder="不限" onChange={event => update(rule.id, { max: event.target.value === '' ? null : Number(event.target.value) })} /></Field></>}
      {rule.kind === 'jump' && <Field label="突变幅度"><input aria-label={`突变幅度 ${index + 1}`} type="number" step="any" value={rule.delta} onChange={event => update(rule.id, { delta: Number(event.target.value) })} /></Field>}
      {rule.kind === 'stale' && <Field label="断流时间 ms"><input aria-label={`断流时间 ${index + 1}`} type="number" value={rule.timeoutMs} onChange={event => update(rule.id, { timeoutMs: Number(event.target.value) })} /></Field>}
      <Field label="持续时间 ms"><input aria-label={`报警持续时间 ${index + 1}`} type="number" disabled={['jump', 'connection'].includes(rule.kind)} value={['jump', 'connection'].includes(rule.kind) ? 0 : rule.holdMs} onChange={event => update(rule.id, { holdMs: Number(event.target.value) })} /></Field><Field label="通知冷却 ms"><input aria-label={`报警冷却 ${index + 1}`} type="number" value={rule.cooldownMs} onChange={event => update(rule.id, { cooldownMs: Number(event.target.value) })} /></Field></div></article>)}</div>{!rules.length && <div className="muted">当前设备暂无报警规则</div>}</section>
    <section className="instrument-section"><div className="section-heading"><h2>报警记录</h2><select className="alarm-device-filter" aria-label="报警设备筛选" value={filter} onChange={event => setFilter(event.target.value)}><option value="">所有设备</option>{scope.devices?.map(device => <option key={device.id} value={device.id}>{device.name}</option>)}</select><a className="quiet-button" href={`/api/logs/export?category=alarm&device=${encodeURIComponent(filter)}`} download><Download size={14} />导出报警日志</a></div><div className="alarm-events">{report?.events.filter(event => !filter || event.device === filter).map(event => <article className={`alarm-event ${event.kind === 'recovered' ? 'recovered' : ''}`} key={event.id}><div><b>{event.deviceName} · {event.name}</b><time>{new Date(event.time).toLocaleString('zh-CN', { hour12: false })}</time><p>{event.message}</p>{!['test','recovered'].includes(event.kind)&&<button onClick={()=>setIncident(event.id)}>查看现场</button>}</div>{event.kind !== 'recovered' && <button className="quiet-button" disabled={event.acknowledged} onClick={() => api<Report>('/alarms/acknowledge', { id: event.id }).then(setReport).catch(error => notify(error.message, true))}><Check size={14} />{event.acknowledged ? '已确认' : '确认报警'}</button>}</article>)}</div></section>{incident&&<IncidentDialog id={incident} close={()=>setIncident('')} review={report?.events.find(e=>e.id===incident)?.device===state.activeDevice?review:undefined}/>}</div>;
}
