import { useEffect, useMemo, useRef, useState } from 'react';
import { ReactFlow, Background, Controls } from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import { Activity, CircuitBoard, Download, FileCode2, FlaskConical, Plus, RefreshCw, Save, Search, Trash2, Upload } from 'lucide-react';
import { api, download, number } from './data';
import type { AppState } from './types';
import { Field, IconButton } from './ui';
import { useInspector } from './Inspector';
import { hardwareTestPlan, hardwareTestStorageKey } from '../shared/hardware-test.mjs';

type Binding = { id: string; ref: string; pin: string; gpio: string; net: string; name: string; unit: string; channel: number; source: string; line: number; min: number | null; max: number | null };
type Netlist = { name: string; hash: string; components: { ref: string; value: string; footprint: string; datasheet: string }[]; nets: { id: string; name: string; pins: { ref: string; pin: string; name: string }[] }[] };
type Profile = { root: string; version: number; board: string; revision: string; notes: string; bindings: Binding[]; netlist: Netlist | null; files: { path: string; bytes: number }[]; checks: { level: string; message: string }[] };
type Props = { state: AppState; live?: boolean; notify: (message: string, error?: boolean) => void; openSource: (file: string, line: number) => void; openTests: () => void };
type HardwareDraft = { version: number; profile: Pick<Profile, 'board' | 'revision' | 'notes' | 'bindings'> };

function editableFields({ board, revision, notes, bindings }: HardwareDraft['profile']) {
  return { board, revision, notes, bindings };
}

function readDraft(key: string): HardwareDraft | null {
  try {
    const draft = JSON.parse(localStorage.getItem(key) || 'null');
    const fields = draft?.profile;
    if (!Number.isInteger(draft?.version) || !fields || ![fields.board, fields.revision, fields.notes].every(value => typeof value === 'string') || !Array.isArray(fields.bindings)) return null;
    if (!fields.bindings.every((binding: Binding) => binding && typeof binding.id === 'string' && typeof binding.name === 'string')) return null;
    return { version: draft.version, profile: editableFields(fields) };
  } catch { return null; }
}

export function HardwareWorkbench({ state, live = false, notify, openSource, openTests }: Props) {
  const [profile, setProfile] = useState<Profile | null>(null), [error, setError] = useState(''), [busy, setBusy] = useState(false), [dirty, setDirty] = useState(false), [selected, setSelected] = useState(''), [search, setSearch] = useState(''), [component, setComponent] = useState('');
  const [view, setView] = useState<'pins' | 'nets' | 'map'>(live ? 'map' : 'pins'), file = useRef<HTMLInputElement>(null), [sourceFiles, setSourceFiles] = useState<{ path: string }[]>([]);
  const root = state.devices?.find(device => device.id === state.activeDevice)?.projectRoot || '';
  const draftKey = `signaldesk.hardware-draft:${state.activeDevice}:${root}`;
  const [conflict, setConflict] = useState<HardwareDraft | null>(null);
  const active = useRef(true), [clock, setClock] = useState(Date.now());
  useEffect(() => { const timer = setInterval(() => setClock(Date.now()), 1000); return () => clearInterval(timer); }, []);
  const fresh = state.connected && !!state.lastSampleAt && clock - state.lastSampleAt < 3000;
  const refresh = async (pending?: HardwareDraft) => {
    setBusy(true); setError('');
    try {
      const next = await api<Profile>(`/hardware?deviceId=${encodeURIComponent(state.activeDevice || '')}&root=${encodeURIComponent(root)}`);
      if (!active.current) return;
      const draft = pending ?? readDraft(draftKey);
      const compatible = draft?.version === next.version;
      setProfile(compatible ? { ...next, ...draft.profile } : next);
      setDirty(compatible);
      setConflict(draft && !compatible ? draft : null);
    } catch (error) { if (active.current) setError((error as Error).message); } finally { if (active.current) setBusy(false); }
  };
  useEffect(() => { active.current = true; void refresh(); api<{ path: string }[]>(`/ai/files?deviceId=${encodeURIComponent(state.activeDevice || '')}`).then(files => { if (active.current) setSourceFiles(files); }).catch(() => {}); return () => { active.current = false; }; }, []);
  useEffect(() => { if (dirty && profile) { try { localStorage.setItem(draftKey, JSON.stringify({ version: profile.version, profile: { board: profile.board, revision: profile.revision, notes: profile.notes, bindings: profile.bindings } })); } catch { setError('本地存储空间不足，草稿尚未保存'); } } }, [profile, dirty, draftKey]);
  const change = (patch: Partial<Profile>) => { setProfile(current => current ? { ...current, ...patch } : current); setDirty(true); };
  const update = (patch: Partial<Binding>) => { if (profile) change({ bindings: profile.bindings.map(binding => binding.id === selected ? { ...binding, ...patch } : binding) }); };
  const save = async () => {
    if (!profile || busy) return; setBusy(true); setError('');
    try {
      const saved = await api<Profile>('/hardware/save', { deviceId: state.activeDevice, root: profile.root, version: profile.version, profile });
      if (!active.current) return;
      setProfile({ ...profile, ...saved }); setDirty(false); localStorage.removeItem(draftKey); notify('硬件工程与引脚映射已保存');
    } catch (error) {
      if (!active.current) return;
      if ((error as { status?: number }).status === 409) await refresh({ version: profile.version, profile: editableFields(profile) });
      else setError((error as Error).message);
    } finally { if (active.current) setBusy(false); }
  };
  const importNetlist = async (input: { path?: string; xml?: string; name?: string }) => {
    if (!profile || busy) return; if (dirty) { setError('请先保存当前引脚配置，再导入网表'); return; } setBusy(true); setError('');
    try { const saved = await api<Profile>('/hardware/import', { ...input, deviceId: state.activeDevice, root: profile.root, version: profile.version }); if (active.current) { setProfile({ ...profile, ...saved }); setView('nets'); notify('网表已导入，现有手工绑定已保留'); } } catch (error) { if (active.current) setError((error as Error).message); } finally { if (active.current) setBusy(false); }
  };
  const addBinding = (ref = '', pin = '', net = '') => { if (!profile || profile.bindings.length >= 200) return; const binding: Binding = { id: crypto.randomUUID(), ref, pin, net, gpio: '', name: ref ? `${ref}.${pin}` : '新信号', unit: '', channel: -1, source: '', line: 1, min: null, max: null }; change({ bindings: [...profile.bindings, binding] }); setSelected(binding.id); showInspector(); };
  const binding = profile?.bindings.find(item => item.id === selected);
  const inspector = useMemo(() => profile && <div className="hardware-inspector"><div className="inspector-heading">{binding ? '引脚与数据绑定' : '硬件工程属性'}</div>{binding ? <fieldset disabled={busy}>
    <Field label="信号名称"><input aria-label="硬件信号名称" value={binding.name} onChange={event => update({ name: event.target.value })} maxLength={80} /></Field><div className="hardware-field-pair"><Field label="器件编号"><input aria-label="器件编号" value={binding.ref} onChange={event => update({ ref: event.target.value })} /></Field><Field label="物理脚号"><input aria-label="物理脚号" value={binding.pin} onChange={event => update({ pin: event.target.value })} /></Field></div>
    <Field label="GPIO / 板上标号"><input aria-label="GPIO 标号" value={binding.gpio} onChange={event => update({ gpio: event.target.value })} /></Field><Field label="电气网络"><input aria-label="电气网络" value={binding.net} onChange={event => update({ net: event.target.value })} /></Field><Field label="数据通道"><select aria-label="硬件数据通道" value={binding.channel} onChange={event => update({ channel: Number(event.target.value) })}><option value={-1}>未绑定</option>{Array.from({ length: 16 }, (_, i) => <option key={i} value={i}>CH{i + 1}{state.names[i] ? ` · ${state.names[i]}` : ''}</option>)}</select></Field><Field label="单位"><input aria-label="硬件信号单位" value={binding.unit} onChange={event => update({ unit: event.target.value })} maxLength={16} /></Field><div className="hardware-field-pair"><Field label="期望下限"><input aria-label="硬件信号下限" type="number" step="any" value={binding.min ?? ''} onChange={event => update({ min: event.target.value === '' ? null : Number(event.target.value) })} /></Field><Field label="期望上限"><input aria-label="硬件信号上限" type="number" step="any" value={binding.max ?? ''} onChange={event => update({ max: event.target.value === '' ? null : Number(event.target.value) })} /></Field></div><Field label="关联源码"><input aria-label="硬件关联源码" list="hardware-source-files" value={binding.source} onChange={event => update({ source: event.target.value })} /><datalist id="hardware-source-files">{sourceFiles.map(file => <option value={file.path} key={file.path} />)}</datalist></Field><Field label="源码行号"><input aria-label="硬件源码行号" type="number" min={1} value={binding.line} onChange={event => update({ line: Number(event.target.value) })} /></Field><div className="lab-actions"><button className="quiet-button" disabled={!binding.source} onClick={() => openSource(binding.source, binding.line)}><FileCode2 size={14} />跳转源码</button><button className="danger-quiet" onClick={() => { change({ bindings: profile.bindings.filter(item => item.id !== binding.id) }); setSelected(''); }}><Trash2 size={14} />删除映射</button></div></fieldset> : <fieldset disabled={busy}><Field label="开发板名称"><input aria-label="硬件开发板名称" value={profile.board} onChange={event => change({ board: event.target.value })} maxLength={100} /></Field><Field label="硬件版本"><input aria-label="硬件版本" value={profile.revision} onChange={event => change({ revision: event.target.value })} maxLength={80} /></Field><Field label="工程备注"><textarea aria-label="硬件工程备注" value={profile.notes} onChange={event => change({ notes: event.target.value })} maxLength={4000} /></Field><code className="hardware-path">{profile.root}</code></fieldset>}</div>, [profile, selected, busy, sourceFiles, state.names]);
  const showInspector = useInspector(conflict ? null : inspector);
  if (!profile) return <section className="hardware-workbench"><p role={error ? 'alert' : 'status'}>{error || '正在读取硬件工程'}</p><button onClick={() => void refresh()} disabled={busy}>重新读取</button></section>;
  if (conflict) return <section className="hardware-workbench" aria-label="硬件草稿恢复"><div className="hardware-empty">
    <h2>硬件映射存在两个版本</h2>
    <p>本地草稿基于版本 {conflict.version}，包含 {conflict.profile.bindings.length} 个引脚映射。工程现为版本 {profile.version}，包含 {profile.bindings.length} 个映射。</p>
    <p>恢复会将草稿中的开发板资料与全部引脚映射载入编辑器，点击保存后生效。</p>
    {error && <p role="alert">{error}</p>}
    <div className="lab-actions"><button className="primary" onClick={() => { setProfile({ ...profile, ...conflict.profile }); setDirty(true); setConflict(null); }}>恢复草稿</button>
      <button className="quiet-button" onClick={() => { try { localStorage.removeItem(draftKey); setConflict(null); } catch { setError('无法清除本地草稿'); } }}>舍弃草稿并使用工程版本</button>
      <button className="quiet-button" onClick={() => download('hardware-draft.json', JSON.stringify(conflict, null, 2), 'application/json')}><Download size={14} />导出草稿</button></div>
  </div></section>;
  const netlist = profile.netlist, filter = search.toLowerCase(), rows = profile.bindings.filter(binding => [binding.name, binding.ref, binding.pin, binding.gpio, binding.net].some(value => value.toLowerCase().includes(filter)));
  return <section className="hardware-workbench" aria-label="硬件工程工作台"><div className="panel-toolbar"><div className="panel-title"><CircuitBoard size={17} /><span>{profile.board || '硬件工程'}</span><small className="small-tag">{profile.revision || '未标记版本'}</small></div><div className="toolbar-actions"><IconButton title="硬件工程属性" onClick={() => { setSelected(''); showInspector(); }}><CircuitBoard size={16} /></IconButton><IconButton title="刷新硬件工程" disabled={busy || dirty} onClick={() => void refresh()}><RefreshCw size={16} /></IconButton><button className="quiet-button" disabled={busy || dirty} onClick={() => file.current?.click()}><Upload size={15} />导入网表</button><IconButton title="导出硬件工程记录" onClick={() => download('signaldesk-hardware.json', JSON.stringify({ ...profile, device: state.devices?.find(device => device.id === state.activeDevice), exportedAt: new Date().toISOString(), readings: profile.bindings.map(binding => ({ id: binding.id, value: binding.channel >= 0 ? state.latest[binding.channel] ?? null : null, fresh, processingMode: state.processingMode })) }, null, 2), 'application/json')}><Download size={16} /></IconButton><button className="primary compact-button" disabled={busy || !dirty} onClick={() => void save()}><Save size={15} />保存映射</button></div></div>
    <div className="hardware-tabs"><div className="segmented">{(['pins', 'nets', 'map'] as const).map(tab => <button key={tab} aria-pressed={view === tab} className={view === tab ? 'active' : ''} onClick={() => setView(tab)}>{({ pins: '引脚与源码', nets: '网表与器件', map: '实时电路图' })[tab]}</button>)}</div><span className={fresh ? 'live-chip' : 'muted'}>{fresh ? '数据更新中' : state.connected ? '无新数据' : '设备未连接'}</span><span className="muted">{dirty ? '未保存 · 本地草稿' : '已保存'} · {state.processingMode === 'raw' ? '原始通道' : '处理后通道'}</span></div>
    {error && <p className="inline-error" role="alert">{error}</p>}
    {view === 'pins' && <><div className="hardware-search"><Search size={15} /><input aria-label="搜索引脚映射" placeholder="信号、GPIO、网络" value={search} onChange={event => setSearch(event.target.value)} /><button className="quiet-button" disabled={busy} onClick={() => addBinding()}><Plus size={15} />添加引脚映射</button></div><div className="hardware-table-wrap"><table><thead><tr><th>信号</th><th>器件 / 脚号</th><th>GPIO / 网络</th><th>通道</th><th>最新值</th><th>源码</th></tr></thead><tbody>{rows.map(binding => { const value = binding.channel >= 0 ? state.latest[binding.channel] : undefined, outside = fresh && value !== undefined && (binding.min !== null && value < binding.min || binding.max !== null && value > binding.max); return <tr key={binding.id} className={selected === binding.id ? 'selected' : ''}><td><button onClick={() => { setSelected(binding.id); showInspector(); }}>{binding.name}</button></td><td>{binding.ref || '--'} / {binding.pin || '--'}</td><td>{binding.gpio || binding.net || '--'}</td><td>{binding.channel < 0 ? '未绑定' : `CH${binding.channel + 1}`}</td><td className={outside ? 'warning' : ''}>{fresh ? number(value) : '--'} {binding.unit}</td><td><button className="source-link" disabled={!binding.source} onClick={() => openSource(binding.source, binding.line)}>{binding.source ? `${binding.source}:${binding.line}` : '未关联'}</button></td></tr>; })}</tbody></table>{!rows.length && <div className="hardware-empty"><CircuitBoard className="empty-symbol" size={42} /><h2>{search ? '没有匹配的引脚' : '暂无引脚映射'}</h2>
        {search ? <button className="quiet-button" onClick={() => setSearch('')}>清除筛选</button> : <div className="empty-actions"><button className="primary" disabled={busy} onClick={() => addBinding()}><Plus size={15} />添加引脚映射</button><button className="quiet-button" disabled={dirty || busy} onClick={() => file.current?.click()}><Upload size={15} />选择网表</button></div>}</div>}</div><HardwareTestComposer profile={profile} deviceId={state.activeDevice || ''} openTests={openTests} notify={notify} /></>}
    {view === 'nets' && <div className="hardware-netlist">{netlist ? <><div className="hardware-summary"><span>{netlist.name}</span><span>{netlist.components.length} 个器件 · {netlist.nets.length} 条网络</span><code>SHA256 {netlist.hash.slice(0, 16)}</code></div><Field label="查看器件"><select aria-label="网表器件" value={component || netlist.components[0]?.ref || ''} onChange={event => setComponent(event.target.value)}>{netlist.components.map(item => <option key={item.ref} value={item.ref}>{item.ref} · {item.value}</option>)}</select></Field><div className="hardware-table-wrap"><table><thead><tr><th>网络</th><th>引脚</th><th>连接器件</th><th>映射</th></tr></thead><tbody>{netlist.nets.filter(net => net.pins.some(pin => pin.ref === (component || netlist.components[0]?.ref))).map(net => <tr key={net.id}><td>{net.name}</td><td>{net.pins.filter(pin => pin.ref === (component || netlist.components[0]?.ref)).map(pin => pin.pin).join(', ')}</td><td>{net.pins.map(pin => `${pin.ref}.${pin.pin}${pin.name ? ` (${pin.name})` : ''}`).join(' · ')}</td><td>{net.pins.filter(pin => pin.ref === (component || netlist.components[0]?.ref)).map(pin => <IconButton key={pin.pin} title={`绑定 ${pin.ref}.${pin.pin}`} onClick={() => { addBinding(pin.ref, pin.pin, net.name); setView('pins'); }}><Plus size={14} /></IconButton>)}</td></tr>)}</tbody></table></div></> : <div className="hardware-empty"><Upload size={28} /><span>尚未导入 KiCad XML 网表</span><button className="quiet-button" disabled={dirty} onClick={() => file.current?.click()}>选择网表</button></div>}{profile.files.length > 0 && <details className="hardware-files" open><summary>工程硬件文件 · {profile.files.length}</summary>{profile.files.map(item => <div key={item.path}><code>{item.path}</code>{/\.(xml|net)$/i.test(item.path) && <button className="quiet-button" disabled={busy || dirty} onClick={() => void importNetlist({ path: item.path })}>导入网表</button>}</div>)}</details>}</div>}
    {view === 'map' && <LiveCircuit profile={profile} state={state} fresh={fresh} select={id => { setSelected(id); showInspector(); }} />}
    <details className="hardware-checks"><summary>绑定检查与证据</summary><p>网表连接来自导入文件；GPIO、源码与数据通道为手工确认的映射。显示值来自当前解析通道，不代表对每个网络进行了电气实测。</p>{profile.checks?.map((item, i) => <p className={item.level === 'warning' ? 'warning' : 'muted'} key={i}>{item.message}</p>)}<p className="muted">此处不替代 ERC/DRC、电气仿真或实际接线检查。</p></details>
    <input ref={file} hidden aria-label="KiCad 网表文件" type="file" accept=".xml,.net" onChange={async event => { const input = event.currentTarget, selected = input.files?.[0]; input.value = ''; if (!selected) return; if (selected.size > 2097152) { setError('网表不能超过 2 MiB'); return; } await importNetlist({ xml: await selected.text(), name: selected.name }); }} />
  </section>;
}

function LiveCircuit({ profile, state, fresh, select }: { profile: Profile; state: AppState; fresh: boolean; select: (id: string) => void }) {
  const [focus, setFocus] = useState('');
  const refs = [...new Set([...(profile.netlist?.components.map(item => item.ref) || []), ...profile.bindings.map(binding => binding.ref || '设备')])], root = refs.includes(focus) ? focus : refs[0];
  const nets = profile.netlist?.nets.filter(net => net.pins.some(pin => pin.ref === root)).slice(0, 16) || [];
  const related = [...new Set(nets.flatMap(net => net.pins.map(pin => pin.ref)))].filter(ref => ref !== root).slice(0, 20);
  const label = (ref: string) => <div className="circuit-component"><strong>{ref}</strong><span>{profile.netlist?.components.find(item => item.ref === ref)?.value || profile.board}</span>{profile.bindings.filter(binding => (binding.ref || '设备') === ref).slice(0, 8).map(binding => <button className="nodrag" key={binding.id} onClick={() => select(binding.id)}><span>{binding.name}</span><b>{fresh && binding.channel >= 0 ? number(state.latest[binding.channel]) : '--'} {binding.unit}</b></button>)}</div>;
  const nodes = root ? [{ id: `part:${root}`, position: { x: 20, y: 80 }, data: { label: label(root) }, className: 'circuit-part' }, ...related.map((ref, i) => ({ id: `part:${ref}`, position: { x: 650, y: 30 + i * 180 }, data: { label: label(ref) }, className: 'circuit-part' })), ...nets.map((net, i) => ({ id: net.id, position: { x: 340, y: 40 + i * 110 }, data: { label: net.name }, className: 'circuit-net' }))] : [];
  const edges = nets.flatMap(net => [{ id: `${root}:${net.id}`, source: `part:${root}`, target: net.id }, ...related.filter(ref => net.pins.some(pin => pin.ref === ref)).map(ref => ({ id: `${net.id}:${ref}`, source: net.id, target: `part:${ref}` }))]);
  return <div className="live-circuit"><div className="hardware-search"><Activity size={15} /><select aria-label="电路图中心器件" value={root || ''} onChange={event => setFocus(event.target.value)}>{refs.map(ref => <option key={ref}>{ref}</option>)}</select><span className="muted">{profile.netlist ? '网表连接 · 器件邻域' : '手工绑定 · 无电气连线'}</span></div>{nodes.length ? <div className="circuit-canvas"><ReactFlow key={`${root}:${profile.netlist?.hash || ''}`} nodes={nodes} edges={edges} fitView nodesDraggable={false} nodesConnectable={false} colorMode="dark" minZoom={0.1} maxZoom={1.5} panOnScroll defaultEdgeOptions={{ type: 'smoothstep', style: { stroke: '#91b4c8' } }}><Background gap={24} /><Controls showInteractive={false} /></ReactFlow></div> : <div className="hardware-empty">导入网表或添加引脚映射后显示电路图</div>}</div>;
}

function HardwareTestComposer({ profile, deviceId, openTests, notify }: { profile: Profile; deviceId: string; openTests: () => void; notify: Props['notify'] }) {
  const [command, setCommand] = useState(''), [ack, setAck] = useState(''), [bindingId, setBindingId] = useState(''), [delay, setDelay] = useState(500);
  return <details className="hardware-test-builder"><summary>参数下发与反馈测试</summary><div className="hardware-test-fields"><Field label="下发命令"><input aria-label="硬件测试命令" value={command} onChange={event => setCommand(event.target.value)} /></Field><Field label="确认响应"><input aria-label="硬件测试确认响应" value={ack} onChange={event => setAck(event.target.value)} /></Field><Field label="反馈信号"><select aria-label="硬件测试反馈信号" value={bindingId} onChange={event => setBindingId(event.target.value)}><option value="">选择信号</option>{profile.bindings.filter(binding => binding.channel >= 0).map(binding => <option key={binding.id} value={binding.id}>{binding.name}</option>)}</select></Field><Field label="稳定等待 ms"><input aria-label="硬件测试等待" type="number" min={1} max={30000} value={delay} onChange={event => setDelay(Number(event.target.value))} /></Field></div><button className="quiet-button" onClick={() => { try { const plan = hardwareTestPlan({ command, ack, delay, binding: profile.bindings.find(binding => binding.id === bindingId), board: profile.board, revision: profile.revision }); localStorage.setItem(hardwareTestStorageKey(deviceId, profile.root), JSON.stringify(plan)); openTests(); } catch (error) { notify((error as Error).message, true); } }}><FlaskConical size={15} />生成测试草稿</button></details>;
}
