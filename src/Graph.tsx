import { useCallback, useState } from 'react';
import { ReactFlow, Background, Controls, MiniMap, Handle, Position, addEdge, useNodesState, useEdgesState, type Connection, type Node, type NodeProps } from '@xyflow/react';
import { Activity, ArrowRight, Check, GitBranch, Plus, Save, SlidersHorizontal, Trash2, FlaskConical } from 'lucide-react';
import '@xyflow/react/dist/style.css';
import { api, number } from './data';
import { Field, IconButton } from './ui';
import type { AppState } from './types';
import { nodeKinds } from '../shared/nodes.mjs';
import { GraphTestDialog } from './GraphTestDialog';

type SignalData = { kind: string; label: string; value: number; latest?: number; liveInputs?: number[]; inspect?: () => void; offset?: number; frequency?: number; max?: number; sequence?: string; unit?: string; channels?: number };
type Kind = { label: string; group: string; inputs: number; value: number; offset?: number; frequency?: number; max?: number; sequence?: string; unit: string };
const definitions = nodeKinds as Record<string, Kind>;
type SignalNode = Node<SignalData, 'signal'>;
const defaults: SignalNode[] = [
  { id: 'source', type: 'signal', position: { x: 30, y: 90 }, data: { kind: 'source', label: '串口数据源', value: 1 } },
  { id: 'gain', type: 'signal', position: { x: 290, y: 45 }, data: { kind: 'gain', label: '增益', value: 1.5 } },
  { id: 'filter', type: 'signal', position: { x: 290, y: 230 }, data: { kind: 'lowpass', label: '低通滤波', value: 0.15 } },
  { id: 'output1', type: 'signal', position: { x: 550, y: 45 }, data: { kind: 'output', label: '放大信号', value: 1 } },
  { id: 'output2', type: 'signal', position: { x: 550, y: 230 }, data: { kind: 'output', label: '平滑信号', value: 1 } },
];
const defaultEdges = [
  { id: 'a', source: 'source', sourceHandle: 'ch1', target: 'gain', targetHandle: 'a' },
  { id: 'b', source: 'source', sourceHandle: 'ch2', target: 'filter', targetHandle: 'a' },
  { id: 'c', source: 'gain', sourceHandle: 'out', target: 'output1', targetHandle: 'a' },
  { id: 'd', source: 'filter', sourceHandle: 'out', target: 'output2', targetHandle: 'a' },
];
const kinds: Record<string, string> = Object.fromEntries(Object.entries(definitions).map(([key, value]) => [key, value.label]));

function Signal({ data, selected }: NodeProps<SignalNode>) {
  const definition = definitions[data.kind], output = ['output', 'display'].includes(data.kind);
  const formula = ({ add: 'a + b', subtract: 'a - b', multiply: 'a * b', divide: 'a / b', magnitude: '| XYZ |', celsius: 'C -> F', sequence: 'SEQUENCE', abs: '| x |' } as Record<string, string>)[data.kind] || number(data.value, 2);
  return <div className={`signal-node ${data.kind} ${selected ? 'is-selected' : ''}`}>
    <div className="node-heading">{data.kind === 'source' ? <Activity size={14} /> : data.kind === 'output' ? <ArrowRight size={14} /> : <SlidersHorizontal size={14} />}<span>{data.label}</span><span className="node-kind">{data.kind.toUpperCase()}</span></div>
    {data.kind === 'source' ? <div className="node-ports">{Array.from({ length: data.channels || 3 }, (_, index) => index + 1).map(channel => <div className="source-port" key={channel}><span>CH{channel}</span><b>{number(data.liveInputs?.[channel - 1])}</b><Handle type="source" position={Position.Right} id={`ch${channel}`} /></div>)}</div> : <>
      {['a', 'b', 'c'].slice(0, definition.inputs).map((handle, index) => <Handle key={handle} type="target" position={Position.Left} id={handle} style={{ top: `${definition.inputs === 1 ? 60 : 48 + index * 20}%` }} title={handle.toUpperCase()} />)}
      <div className="node-value">{output || data.latest !== undefined ? number(data.latest) : formula}<span>{data.unit}</span></div>
      {!output && <><small className="node-readout">{formula} · result</small><div className="node-input-readouts">{Array.from({ length: definition.inputs }, (_, i) => <div key={i}><span>in{i}</span><b>{number(data.liveInputs?.[i])}</b></div>)}</div><Handle type="source" position={Position.Right} id="out" style={{ top: '60%' }} /></>}
      {output && <button className="node-data-link nodrag" onClick={data.inspect}><ArrowRight size={12} />查看数据</button>}
    </>}
  </div>;
}
const nodeTypes = { signal: Signal };

export function Graph({ state, notify, openWorkspace }: { state: AppState; notify: (message: string, error?: boolean) => void; openWorkspace: () => void }) {
  const scope = state as AppState & { activeDevice?: string; devices?: { id: string; projectRoot: string }[]; graphValues?: Record<string, number>; graphInputs?: Record<string, number[]> };
  const storageKey = `signaldesk.graph:${scope.activeDevice}:${scope.devices?.find(device => device.id === scope.activeDevice)?.projectRoot || ''}`;
  const [saved] = useState(() => { try { return JSON.parse(localStorage.getItem(storageKey) || localStorage.getItem('signaldesk.graph') || 'null'); } catch { return null; } });
  const [nodes, setNodes, onNodesChange] = useNodesState<SignalNode>(saved?.nodes || defaults);
  const [edges, setEdges, onEdgesChange] = useEdgesState(saved?.edges || defaultEdges);
  const [selected, setSelected] = useState<string | null>('gain'), [kind, setKind] = useState('gain'), [dirty, setDirty] = useState(true);
  const [testing, setTesting] = useState(false), [preset, setPreset] = useState('sensor');
  const makePreset = () => {
    if (preset === 'ratio') { setNodes([{ id: 'ratio-source', type: 'signal', position: { x: 20, y: 80 }, data: { kind: 'source', label: '通道源', value: 1, channels: 3 } }, { id: 'ratio-math', type: 'signal', position: { x: 290, y: 50 }, data: { kind: 'divide', label: '双通道比值', value: 1 } }, { id: 'ratio-output', type: 'signal', position: { x: 560, y: 80 }, data: { kind: 'display', label: '比值', value: 1 } }]); setEdges([{ id: 'ratio-a', source: 'ratio-source', sourceHandle: 'ch1', target: 'ratio-math', targetHandle: 'a' }, { id: 'ratio-b', source: 'ratio-source', sourceHandle: 'ch2', target: 'ratio-math', targetHandle: 'b' }, { id: 'ratio-out', source: 'ratio-math', sourceHandle: 'out', target: 'ratio-output', targetHandle: 'a' }]); setSelected('ratio-math'); setDirty(true); return; }
    const temperature = preset === 'sensor';
    const nodes: SignalNode[] = [
      { id: 'test-source', type: 'signal', position: { x: 20, y: 80 }, data: { kind: temperature ? 'sine' : 'sequence', label: temperature ? '模拟温度' : '突变测试', value: 4, offset: 25, frequency: 0.5, sequence: '20, 20, 20, 20, 48, 20, 20', unit: 'degC' } },
      { id: 'test-filter', type: 'signal', position: { x: 290, y: 80 }, data: { kind: 'lowpass', label: '温度平滑', value: 0.2 } },
      { id: 'test-display', type: 'signal', position: { x: 560, y: 80 }, data: { kind: 'display', label: '温度', value: 1, unit: 'degC' } },
    ];
    setNodes(nodes); setEdges([{ id: 'test-a', source: 'test-source', sourceHandle: 'out', target: 'test-filter', targetHandle: 'a' }, { id: 'test-b', source: 'test-filter', sourceHandle: 'out', target: 'test-display', targetHandle: 'a' }]); setSelected('test-source'); setDirty(true);
  };
  const onConnect = useCallback((connection: Connection) => { setEdges(current => addEdge(connection, current)); setDirty(true); }, [setEdges]);
  const current = nodes.find(node => node.id === selected);
  const apply = async () => {
    try { await api('/processing', { mode: 'graph', graph: { nodes, edges } }); localStorage.setItem(storageKey, JSON.stringify({ nodes, edges })); setDirty(false); notify('节点图已应用到实时数据'); }
    catch (error) { notify((error as Error).message, true); }
  };
  const update = (data: Partial<SignalData>) => { setNodes(currentNodes => currentNodes.map(node => node.id === selected ? { ...node, data: { ...node.data, ...data } } : node)); setDirty(true); };
  return <section className="graph-page tool-panel">
    <div className="panel-toolbar"><div className="panel-title"><GitBranch size={16} /><span>信号处理图</span><span className="small-tag">{nodes.length} NODES</span></div><div className="toolbar-actions">
      <select aria-label="新节点类型" value={kind} onChange={event => setKind(event.target.value)}>{[...new Set(Object.values(definitions).map(item => item.group))].map(group => <optgroup label={group} key={group}>{Object.entries(definitions).filter(([, item]) => item.group === group).map(([key, item]) => <option key={key} value={key}>{item.label}</option>)}</optgroup>)}</select>
      <IconButton title="添加节点" disabled={nodes.length >= 32} onClick={() => { const id = crypto.randomUUID(); setNodes(currentNodes => [...currentNodes, { id, type: 'signal', position: { x: 180 + Math.random() * 140, y: 90 + Math.random() * 180 }, data: { ...definitions[kind], kind } }]); setSelected(id); setDirty(true); }}><Plus size={17} /></IconButton>
      <button className="quiet-button" onClick={() => setTesting(true)}><FlaskConical size={15} />测试与代码</button>
      <button className="primary compact-button" onClick={apply}>{!dirty && state.processingMode === 'graph' ? <Check size={15} /> : <Save size={15} />}{!dirty && state.processingMode === 'graph' ? '已应用' : '应用到数据'}</button>
    </div></div>
    <div className="graph-body"><div className="graph-canvas"><ReactFlow nodes={nodes.map(node => ({ ...node, data: { ...node.data, latest: !dirty && state.processingMode === 'graph' ? scope.graphValues?.[node.id] : undefined, liveInputs: !dirty && state.processingMode === 'graph' ? scope.graphInputs?.[node.id] : undefined, inspect: openWorkspace } }))} edges={edges} onNodesChange={changes => { onNodesChange(changes); if (changes.some(change => change.type === 'remove')) setDirty(true); }} onEdgesChange={changes => { onEdgesChange(changes); if (changes.some(change => change.type !== 'select')) setDirty(true); }} onConnect={onConnect} onNodeClick={(_event, node) => setSelected(node.id)} nodeTypes={nodeTypes} fitView minZoom={0.3} maxZoom={1.8} colorMode="dark" defaultEdgeOptions={{ type: 'smoothstep', style: { stroke: '#6aafaa', strokeWidth: 2 } }} deleteKeyCode="Delete" proOptions={{ hideAttribution: false }}><Background color="#3b4248" gap={20} size={1} /><Controls showInteractive={false} /><MiniMap nodeColor="#467d70" maskColor="#131618b8" /></ReactFlow></div>
      <aside className="node-inspector"><div className="inspector-heading">节点参数</div>{current ? <>
        <Field label="名称"><input value={current.data.label} onChange={event => update({ label: event.target.value })} maxLength={32} /></Field>
        <Field label="类型"><div className="static-value">{current.data.kind === 'source' ? '数据源' : kinds[current.data.kind]}</div></Field>
        {['gain', 'offset', 'lowpass', 'constant', 'sine', 'square', 'ramp', 'average', 'rms', 'clamp', 'threshold', 'linear', 'adc'].includes(current.data.kind) && <Field label={({ lowpass: '滤波系数 α', average: '窗口点数', rms: '窗口点数', sine: '幅值', square: '幅值', ramp: '幅值', clamp: '下限', linear: '比例系数', adc: '参考电压 V', threshold: '阈值' } as Record<string, string>)[current.data.kind] || '数值'}><input aria-label="节点数值" type="number" step="any" value={current.data.value} onChange={event => update({ value: Number(event.target.value) })} /></Field>}
        {['sine', 'square', 'ramp', 'linear'].includes(current.data.kind) && <Field label="偏置"><input aria-label="节点偏置" type="number" step="any" value={current.data.offset ?? 0} onChange={event => update({ offset: Number(event.target.value) })} /></Field>}
        {['sine', 'square', 'ramp'].includes(current.data.kind) && <Field label="频率 Hz"><input aria-label="节点频率" type="number" step="0.1" value={current.data.frequency ?? 1} onChange={event => update({ frequency: Number(event.target.value) })} /></Field>}
        {['clamp', 'adc'].includes(current.data.kind) && <Field label={current.data.kind === 'adc' ? 'ADC 满量程码值' : '上限'}><input aria-label="节点上限" type="number" value={current.data.max ?? 4095} onChange={event => update({ max: Number(event.target.value) })} /></Field>}
        {current.data.kind === 'sequence' && <Field label="数据序列"><textarea aria-label="节点数据序列" value={current.data.sequence || ''} onChange={event => update({ sequence: event.target.value })} /></Field>}
        {current.data.kind === 'source' && <Field label="输入通道数"><select value={current.data.channels || 3} onChange={event => update({ channels: Number(event.target.value) })}>{Array.from({ length: 16 }, (_, index) => <option key={index}>{index + 1}</option>)}</select></Field>}
        <Field label="单位"><input aria-label="节点单位" value={current.data.unit || ''} maxLength={16} onChange={event => update({ unit: event.target.value })} /></Field>
        {current.data.kind !== 'source' && <button className="danger-quiet" onClick={() => { setNodes(currentNodes => currentNodes.filter(node => node.id !== selected)); setEdges(currentEdges => currentEdges.filter(edge => edge.source !== selected && edge.target !== selected)); setSelected(null); setDirty(true); }}><Trash2 size={14} />删除节点</button>}
      </> : <div className="muted">未选择节点</div>}
      <div className="inspector-heading spaced">当前处理</div><div className="status-value"><span className={`status-dot ${state.processingMode === 'graph' ? 'live' : ''}`} />{state.processingMode === 'graph' ? '节点图运行中' : state.processingMode === 'script' ? '公式运行中' : '原始通道'}</div>
      {state.names.map((name, index) => <div className="measurement-row" key={index}><span>{name}</span><b>{number(state.latest[index])}</b></div>)}
      <div className="inspector-heading spaced">测试拼图</div><select aria-label="测试拼图模板" value={preset} onChange={event => setPreset(event.target.value)}><option value="sensor">温度传感器</option><option value="spike">数据突变</option><option value="ratio">双通道比值</option></select><button className="quiet-button graph-preset" onClick={makePreset}>载入模板</button>
      </aside>
    </div>
    {testing && <GraphTestDialog graph={{ nodes, edges }} notify={notify} close={() => setTesting(false)} />}
  </section>;
}
