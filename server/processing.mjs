import jsep from 'jsep';
import { nodeKinds } from '../shared/nodes.mjs';

const functions = { abs: Math.abs, sqrt: Math.sqrt, sin: Math.sin, cos: Math.cos, tan: Math.tan, min: Math.min, max: Math.max, round: Math.round, floor: Math.floor, ceil: Math.ceil, log: Math.log, exp: Math.exp };
const operators = { '+': (a, b) => a + b, '-': (a, b) => a - b, '*': (a, b) => a * b, '/': (a, b) => a / b, '%': (a, b) => a % b };

function validate(node, names, depth = 0) {
  if (depth > 24) throw new Error('表达式嵌套过深');
  if (node.type === 'Literal' && typeof node.value === 'number' && Number.isFinite(node.value)) return;
  if (node.type === 'Identifier' && names.has(node.name)) return;
  if (node.type === 'UnaryExpression' && ['+', '-'].includes(node.operator)) return validate(node.argument, names, depth + 1);
  if (node.type === 'BinaryExpression' && Object.hasOwn(operators, node.operator)) {
    validate(node.left, names, depth + 1); validate(node.right, names, depth + 1); return;
  }
  if (node.type === 'CallExpression' && node.callee.type === 'Identifier' && Object.hasOwn(functions, node.callee.name) && node.arguments.length >= 1 && node.arguments.length <= 8) {
    node.arguments.forEach(argument => validate(argument, names, depth + 1)); return;
  }
  throw new Error('仅支持数值、通道名、四则运算和数学函数');
}

function evaluate(node, values) {
  if (node.type === 'Literal') return node.value;
  if (node.type === 'Identifier') return values[node.name];
  if (node.type === 'UnaryExpression') return (node.operator === '-' ? -1 : 1) * evaluate(node.argument, values);
  if (node.type === 'BinaryExpression') return operators[node.operator](evaluate(node.left, values), evaluate(node.right, values));
  return functions[node.callee.name](...node.arguments.map(argument => evaluate(argument, values)));
}

export function compileScript(source) {
  if (typeof source !== 'string' || source.length > 8192) throw new Error('脚本不能超过 8 KiB');
  const names = new Set(['pi', ...Array.from({ length: 16 }, (_, index) => `ch${index + 1}`)]);
  const outputs = [];
  for (const [index, raw] of source.split('\n').entries()) {
    const line = raw.replace(/\/\/.*$/, '').trim().replace(/;$/, '');
    if (!line) continue;
    const assignment = /^([a-zA-Z][\w]*)\s*=\s*(.+)$/.exec(line);
    if (!assignment || names.has(assignment[1]) || Object.hasOwn(functions, assignment[1])) throw new Error(`第 ${index + 1} 行：请使用不重复的输出名 = 表达式`);
    try {
      const ast = jsep(assignment[2]);
      validate(ast, names);
      outputs.push({ name: assignment[1], ast });
      names.add(assignment[1]);
    } catch (error) { throw new Error(`第 ${index + 1} 行：${error.message}`); }
  }
  if (!outputs.length || outputs.length > 16) throw new Error('输出通道数量应为 1 到 16');
  return {
    names: outputs.map(output => output.name),
    run(input) {
      const context = Object.create(null);
      context.pi = Math.PI;
      input.forEach((value, index) => { context[`ch${index + 1}`] = value; });
      return outputs.map(output => {
        const value = evaluate(output.ast, context);
        if (!Number.isFinite(value)) throw new Error(`${output.name}：结果非有限数，请检查输入通道或除数`);
        context[output.name] = value;
        return value;
      });
    },
  };
}

export function compileGraph(graph, { sampleRate = 200 } = {}) {
  if (!graph || !Array.isArray(graph.nodes) || !Array.isArray(graph.edges) || graph.nodes.length > 32 || graph.edges.length > 64) throw new Error('节点图最多支持 32 个节点和 64 条连线');
  const nodes = new Map();
  const incoming = new Map();
  for (let node of graph.nodes) {
    if (typeof node.id !== 'string' || nodes.has(node.id) || !Object.hasOwn(nodeKinds, node.data?.kind)) throw new Error('节点配置无效');
    node = { ...node, data: { ...nodeKinds[node.data.kind], ...node.data } };
    if (typeof node.data.label !== 'string' || node.data.label.length > 80 || typeof node.data.unit !== 'string' || node.data.unit.length > 16) throw new Error('节点名称或单位无效');
    for (const key of ['value', 'offset', 'max', 'frequency']) if (node.data[key] !== undefined && (!Number.isFinite(node.data[key]) || Math.abs(node.data[key]) > 1e6)) throw new Error('节点参数无效');
    if (['sine', 'square', 'ramp'].includes(node.data.kind) && (node.data.frequency <= 0 || node.data.frequency >= sampleRate / 2)) throw new Error('信号频率必须大于 0 且低于采样率的一半');
    if (['average', 'rms'].includes(node.data.kind) && (!Number.isInteger(node.data.value) || node.data.value < 1 || node.data.value > 128)) throw new Error('滑动窗口应为 1..128 个采样点');
    if (node.data.kind === 'adc' && node.data.max <= 0) throw new Error('ADC 满量程必须大于 0');
    if (node.data.kind === 'clamp' && node.data.value > node.data.max) throw new Error('限幅下限不能大于上限');
    if (node.data.kind === 'sequence') {
      if (typeof node.data.sequence !== 'string' || node.data.sequence.length > 2048) throw new Error('序列数据无效');
      const sequence = node.data.sequence.split(/[,\s]+/).filter(Boolean).map(Number);
      if (!sequence.length || sequence.length > 128 || sequence.some(value => !Number.isFinite(value) || Math.abs(value) > 1e6)) throw new Error('序列应包含 1..128 个有限数值');
      node.data.points = sequence;
    }
    if (node.data.kind === 'lowpass' && (node.data.value <= 0 || node.data.value > 1)) throw new Error('低通系数应大于 0 且不超过 1');
    nodes.set(node.id, node); incoming.set(node.id, []);
  }
  if (![...nodes.values()].some(node => ['output', 'display'].includes(node.data.kind))) throw new Error('请添加输出或数值显示节点');
  for (const edge of graph.edges) {
    const source = nodes.get(edge.source), target = nodes.get(edge.target);
    if (!source || !target || nodeKinds[target.data.kind].inputs === 0 || ['output', 'display'].includes(source.data.kind)) throw new Error('连线的源或目标无效');
    const targetPort = edge.targetHandle || 'a';
    if (!['a', 'b', 'c'].slice(0, nodeKinds[target.data.kind].inputs).includes(targetPort)) throw new Error('输入端口无效');
    if (source.data.kind === 'source' ? !/^ch(?:[1-9]|1[0-6])$/.test(edge.sourceHandle || '') : edge.sourceHandle !== 'out') throw new Error('输出端口无效');
    if (incoming.get(edge.target).some(other => (other.targetHandle || 'a') === targetPort)) throw new Error('一个输入端口只能连接一条线');
    incoming.get(edge.target).push(edge);
  }
  const visiting = new Set(), visited = new Set(), order = [];
  function visit(id) {
    if (visiting.has(id)) throw new Error('节点图包含环路');
    if (visited.has(id)) return;
    visiting.add(id);
    for (const edge of incoming.get(id)) visit(edge.source);
    visiting.delete(id); visited.add(id); order.push(id);
  }
  for (const id of nodes.keys()) visit(id);
  for (const node of nodes.values()) {
    const required = nodeKinds[node.data.kind].inputs;
    if (incoming.get(node.id).length !== required) throw new Error(`${node.data.label || node.id}：输入尚未连接`);
  }
  const outputNodes = order.filter(id => ['output', 'display'].includes(nodes.get(id).data.kind));
  if (outputNodes.length > 16) throw new Error('输出通道不能超过 16 个');
  const history = new Map();
  let sampleIndex = 0;
  return {
    plan: { nodes: order.map(id => nodes.get(id)), edges: graph.edges, outputs: outputNodes },
    latestValues: {},
    latestInputs: {},
    names: outputNodes.map(id => { const data = nodes.get(id).data; return `${data.label || '输出'}${data.unit ? ` (${String(data.unit).slice(0, 16)})` : ''}`; }),
    run(input) {
      const values = new Map(), inputs = {};
      const time = sampleIndex / sampleRate;
      for (const id of order) {
        const node = nodes.get(id), args = {};
        for (const edge of incoming.get(id)) {
          const source = nodes.get(edge.source);
          args[edge.targetHandle || 'a'] = source.data.kind === 'source' ? input[Number(edge.sourceHandle.slice(2)) - 1] : values.get(edge.source);
        }
        let value;
        inputs[id] = node.data.kind === 'source' ? input.slice() : ['a', 'b', 'c'].slice(0, nodeKinds[node.data.kind].inputs).map(key => args[key]);
        switch (node.data.kind) {
          case 'source': continue;
          case 'constant': value = node.data.value; break;
          case 'sequence': value = node.data.points[sampleIndex % node.data.points.length]; break;
          case 'sine': value = node.data.offset + node.data.value * Math.sin(2 * Math.PI * node.data.frequency * time); break;
          case 'square': value = node.data.offset + node.data.value * ((node.data.frequency * time) % 1 < 0.5 ? 1 : -1); break;
          case 'ramp': value = node.data.offset + node.data.value * (2 * ((node.data.frequency * time) % 1) - 1); break;
          case 'gain': value = args.a * node.data.value; break;
          case 'offset': value = args.a + node.data.value; break;
          case 'abs': value = Math.abs(args.a); break;
          case 'add': value = args.a + args.b; break;
          case 'subtract': value = args.a - args.b; break;
          case 'multiply': value = args.a * args.b; break;
          case 'divide': value = args.a / args.b; break;
          case 'linear': value = args.a * node.data.value + node.data.offset; break;
          case 'adc': value = args.a * node.data.value / node.data.max; break;
          case 'celsius': value = args.a * 1.8 + 32; break;
          case 'magnitude': value = Math.hypot(args.a, args.b, args.c); break;
          case 'clamp': value = Math.min(node.data.max, Math.max(node.data.value, args.a)); break;
          case 'threshold': value = args.a > node.data.value ? 1 : 0; break;
          case 'average':
          case 'rms': {
            const buffer = history.get(id) || []; buffer.push(args.a); if (buffer.length > node.data.value) buffer.shift(); history.set(id, buffer);
            value = node.data.kind === 'rms' ? Math.sqrt(buffer.reduce((sum, value) => sum + value * value, 0) / buffer.length) : buffer.reduce((sum, value) => sum + value, 0) / buffer.length; break;
          }
          case 'lowpass': value = history.has(id) ? history.get(id) + node.data.value * (args.a - history.get(id)) : args.a; history.set(id, value); break;
          default: value = args.a;
        }
        if (!Number.isFinite(value)) throw new Error(`${node.data.label || id}：输入不存在或结果无效`);
        values.set(id, value);
      }
      sampleIndex++; this.latestValues = Object.fromEntries(values); this.latestInputs = inputs;
      return outputNodes.map(id => values.get(id));
    },
  };
}
