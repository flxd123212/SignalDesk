import { nodeKinds } from './nodes.mjs';

export const graphPresets = [
  { id: 'channels', label: '全部通道直通', source: 'device' },
  { id: 'smooth', label: '全部通道平滑', source: 'device' },
  { id: 'adc', label: 'ADC 转电压', source: 'device' },
  { id: 'ratio', label: '双通道比值', source: 'device' },
  { id: 'magnitude', label: '三轴模长', source: 'device' },
  { id: 'sensor', label: '温度测试信号', source: 'synthetic' },
  { id: 'spike', label: '突变测试信号', source: 'synthetic' },
];

export function createGraphPreset(preset, channelNames = []) {
  if (!graphPresets.some(item => item.id === preset)) throw new Error('未知节点模板');
  const count = Math.min(16, Math.max(1, channelNames.length));
  if (preset === 'ratio' && count < 2) throw new Error('比值模板需要至少两个输入通道');
  if (preset === 'magnitude' && count < 3) throw new Error('三轴模板需要至少三个输入通道');
  const nodes = [], edges = [];
  const node = (id, kind, label, data = {}) => nodes.push({ id, type: 'signal', position: { x: 0, y: 0 }, data: { ...nodeKinds[kind], kind, label, ...data } });
  const connect = (source, sourceHandle, target, targetHandle = 'a') => edges.push({ id: `${source}:${sourceHandle}:${target}:${targetHandle}`, source, sourceHandle, target, targetHandle });
  if (['sensor', 'spike'].includes(preset)) {
    node('input', preset === 'sensor' ? 'sine' : 'sequence', '本地测试信号', { value: 4, offset: 25, frequency: 0.5, sequence: '20,20,20,48,20,20', unit: 'degC' });
    node('filter', 'lowpass', '平滑', { value: 0.2 }); node('output', 'display', '温度', { unit: 'degC' });
    connect('input', 'out', 'filter'); connect('filter', 'out', 'output');
  } else {
    node('source', 'source', '设备原始通道', { channels: count });
    if (['ratio', 'magnitude'].includes(preset)) {
      node('math', preset === 'ratio' ? 'divide' : 'magnitude', preset === 'ratio' ? '双通道比值' : '三轴模长');
      for (let i = 0; i < (preset === 'ratio' ? 2 : 3); i++) connect('source', `ch${i + 1}`, 'math', ['a', 'b', 'c'][i]);
      node('output', 'display', '结果'); connect('math', 'out', 'output');
    } else {
      const limit = count;
      for (let i = 0; i < limit; i++) {
        const name = String(channelNames[i] || `CH${i + 1}`).slice(0, 48);
        node(`output${i}`, 'output', name, preset === 'adc' ? { unit: 'V' } : {});
        if (preset === 'channels') connect('source', `ch${i + 1}`, `output${i}`);
        else { node(`process${i}`, preset === 'adc' ? 'adc' : 'lowpass', preset === 'adc' ? `${name} 转换` : `${name} 平滑`); connect('source', `ch${i + 1}`, `process${i}`); connect(`process${i}`, 'out', `output${i}`); }
      }
    }
  }
  return layoutGraph({ nodes, edges });
}

export function connectionError(graph, edge, ignoreId = '') {
  const source = graph.nodes.find(node => node.id === edge.source), target = graph.nodes.find(node => node.id === edge.target);
  if (!source || !target || source.id === target.id) return '请选择不同的源节点和目标节点';
  const sourcePorts = source.data.kind === 'source' ? Array.from({ length: source.data.channels || 3 }, (_, i) => `ch${i + 1}`) : ['output', 'display'].includes(source.data.kind) ? [] : ['out'];
  if (!sourcePorts.includes(edge.sourceHandle)) return '源输出端口无效';
  if (!['a', 'b', 'c'].slice(0, nodeKinds[target.data.kind]?.inputs || 0).includes(edge.targetHandle)) return '目标输入端口无效';
  const edges = graph.edges.filter(item => item.id !== ignoreId);
  if (edges.some(item => item.target === edge.target && (item.targetHandle || 'a') === edge.targetHandle)) return '该输入已连接，请先断开原连线';
  const pending = [edge.target], visited = new Set();
  while (pending.length) { const id = pending.pop(); if (id === edge.source) return '此连接会形成环路'; if (visited.has(id)) continue; visited.add(id); for (const item of edges) if (item.source === id) pending.push(item.target); }
  return '';
}

export function normalizeGraph(input) {
  if (!input || !Array.isArray(input.nodes) || !Array.isArray(input.edges) || input.nodes.length > 64 || input.edges.length > 128) throw new Error('节点图限 64 个节点、128 条连线');
  const ids = new Set();
  const nodes = input.nodes.map(node => {
    if (typeof node.id !== 'string' || !node.id || node.id.length > 100 || ids.has(node.id) || !Object.hasOwn(nodeKinds, node.data?.kind)) throw new Error('节点类型或 ID 无效');
    ids.add(node.id);
    const data = { ...nodeKinds[node.data.kind], kind: node.data.kind };
    for (const key of ['label', 'unit', 'sequence']) if (node.data[key] !== undefined) { if (typeof node.data[key] !== 'string' || node.data[key].length > (key === 'sequence' ? 2048 : key === 'label' ? 80 : 16)) throw new Error('节点文本无效'); data[key] = node.data[key]; }
    for (const key of ['value', 'offset', 'frequency', 'max', 'channels']) if (node.data[key] !== undefined) { if (!Number.isFinite(node.data[key]) || Math.abs(node.data[key]) > 1e6) throw new Error('节点数值无效'); data[key] = node.data[key]; }
    if (data.channels !== undefined && (!Number.isInteger(data.channels) || data.channels < 1 || data.channels > 16)) throw new Error('通道数量应为 1..16');
    return { id: node.id, type: 'signal', position: { x: Number.isFinite(node.position?.x) ? Math.max(-50000, Math.min(50000, node.position.x)) : 0, y: Number.isFinite(node.position?.y) ? Math.max(-50000, Math.min(50000, node.position.y)) : 0 }, data };
  });
  const result = { nodes, edges: [] };
  for (const [i, edge] of input.edges.entries()) {
    const clean = { id: `edge-${i}`, source: edge.source, sourceHandle: edge.sourceHandle, target: edge.target, targetHandle: edge.targetHandle || 'a' };
    const error = connectionError(result, clean); if (error) throw new Error(error); result.edges.push(clean);
  }
  return result;
}

export function layoutGraph(graph) {
  const levels = new Map(), visiting = new Set();
  const level = id => { if (levels.has(id)) return levels.get(id); if (visiting.has(id)) throw new Error('节点图包含环路'); visiting.add(id); const parents = graph.edges.filter(edge => edge.target === id).map(edge => edge.source); const n = parents.length ? Math.max(...parents.map(level)) + 1 : 0; visiting.delete(id); levels.set(id, n); return n; };
  const rows = new Map();
  return { ...graph, nodes: graph.nodes.map(node => { const column = level(node.id), y = rows.get(column) || 24; rows.set(column, y + Math.max(190, node.data.kind === 'source' ? 70 + (node.data.channels || 3) * 30 : 190)); return { ...node, position: { x: 24 + column * 290, y } }; }) };
}
