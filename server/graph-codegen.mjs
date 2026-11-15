// Embedded verbatim into the exported host-side test module.
function createRunner(plan, sampleRate, raw) {
  let index = 0; const history = new Map(), nodes = new Map(plan.nodes.map(node => [node.id, node]));
  return () => {
    const values = new Map(), time = index / sampleRate;
    for (const node of plan.nodes) {
      const data = node.data, a = {};
      for (const edge of plan.edges.filter(edge => edge.target === node.id)) a[edge.targetHandle || 'a'] = nodes.get(edge.source).data.kind === 'source' ? raw[Number(edge.sourceHandle.slice(2)) - 1] : values.get(edge.source);
      let value;
      switch (data.kind) {
        case 'source': continue;
        case 'constant': value = data.value; break;
        case 'sequence': value = data.points[index % data.points.length]; break;
        case 'sine': value = data.offset + data.value * Math.sin(2 * Math.PI * data.frequency * time); break;
        case 'square': value = data.offset + data.value * ((data.frequency * time) % 1 < 0.5 ? 1 : -1); break;
        case 'ramp': value = data.offset + data.value * (2 * ((data.frequency * time) % 1) - 1); break;
        case 'gain': value = a.a * data.value; break;
        case 'offset': value = a.a + data.value; break;
        case 'abs': value = Math.abs(a.a); break;
        case 'add': value = a.a + a.b; break;
        case 'subtract': value = a.a - a.b; break;
        case 'multiply': value = a.a * a.b; break;
        case 'divide': value = a.a / a.b; break;
        case 'linear': value = a.a * data.value + data.offset; break;
        case 'adc': value = a.a * data.value / data.max; break;
        case 'celsius': value = a.a * 1.8 + 32; break;
        case 'magnitude': value = Math.hypot(a.a, a.b, a.c); break;
        case 'clamp': value = Math.min(data.max, Math.max(data.value, a.a)); break;
        case 'threshold': value = a.a > data.value ? 1 : 0; break;
        case 'lowpass': value = history.has(node.id) ? history.get(node.id) + data.value * (a.a - history.get(node.id)) : a.a; history.set(node.id, value); break;
        case 'average': case 'rms': { const buffer = history.get(node.id) || []; buffer.push(a.a); if (buffer.length > data.value) buffer.shift(); history.set(node.id, buffer); value = data.kind === 'rms' ? Math.sqrt(buffer.reduce((sum, v) => sum + v * v, 0) / buffer.length) : buffer.reduce((sum, v) => sum + v, 0) / buffer.length; break; }
        default: value = a.a;
      }
      if (!Number.isFinite(value)) throw new Error(`Invalid input or result: ${node.id}`);
      values.set(node.id, value);
    }
    index++; return plan.outputs.map(id => values.get(id));
  };
}

export function generateHostGraph(plan, { format, sampleRate, raw, duration }) {
  if (format === 'javascript') return [
    '// SignalDesk host-side synthetic test. No device access or real-time timing guarantee.',
    'export ' + createRunner.toString(),
    `const plan = ${JSON.stringify(plan, null, 2)};`,
    `export const next = createRunner(plan, ${sampleRate}, ${JSON.stringify(raw)});`,
    `for (let i = 0; i < ${Math.ceil(sampleRate * duration)}; i++) console.log(next().join(','));`,
  ].join('\n') + '\n';
  return `# SignalDesk host-side synthetic test. No device access or timing guarantee.
import json
import math

PLAN = json.loads(${JSON.stringify(JSON.stringify(plan))})
RAW = ${JSON.stringify(raw)}
RATE = ${sampleRate}
_index = 0
_history = {}
_nodes = {node['id']: node for node in PLAN['nodes']}

def signaldesk_next():
    global _index
    values = {}
    t = _index / RATE
    for node in PLAN['nodes']:
        d = node['data']
        k = d['kind']
        a = {}
        for edge in PLAN['edges']:
            if edge['target'] == node['id']:
                a[edge.get('targetHandle') or 'a'] = RAW[int(edge['sourceHandle'][2:]) - 1] if _nodes[edge['source']]['data']['kind'] == 'source' else values[edge['source']]
        if k == 'source': continue
        if k == 'constant': v = d['value']
        elif k == 'sequence': v = d['points'][_index % len(d['points'])]
        elif k == 'sine': v = d['offset'] + d['value'] * math.sin(2 * math.pi * d['frequency'] * t)
        elif k == 'square': v = d['offset'] + d['value'] * (1 if (d['frequency'] * t) % 1 < 0.5 else -1)
        elif k == 'ramp': v = d['offset'] + d['value'] * (2 * ((d['frequency'] * t) % 1) - 1)
        elif k == 'gain': v = a['a'] * d['value']
        elif k == 'offset': v = a['a'] + d['value']
        elif k == 'abs': v = abs(a['a'])
        elif k == 'add': v = a['a'] + a['b']
        elif k == 'subtract': v = a['a'] - a['b']
        elif k == 'multiply': v = a['a'] * a['b']
        elif k == 'divide': v = a['a'] / a['b']
        elif k == 'linear': v = a['a'] * d['value'] + d['offset']
        elif k == 'adc': v = a['a'] * d['value'] / d['max']
        elif k == 'celsius': v = a['a'] * 1.8 + 32
        elif k == 'magnitude': v = math.sqrt(a['a'] ** 2 + a['b'] ** 2 + a['c'] ** 2)
        elif k == 'clamp': v = min(d['max'], max(d['value'], a['a']))
        elif k == 'threshold': v = 1 if a['a'] > d['value'] else 0
        elif k == 'lowpass':
            v = _history[node['id']] + d['value'] * (a['a'] - _history[node['id']]) if node['id'] in _history else a['a']
            _history[node['id']] = v
        elif k in ('average', 'rms'):
            h = _history.setdefault(node['id'], [])
            h.append(a['a'])
            if len(h) > d['value']: h.pop(0)
            v = math.sqrt(sum(x * x for x in h) / len(h)) if k == 'rms' else sum(h) / len(h)
        else: v = a['a']
        if not math.isfinite(v): raise ValueError('Invalid input or result: ' + node['id'])
        values[node['id']] = v
    _index += 1
    return [values[key] for key in PLAN['outputs']]

if __name__ == '__main__':
    for _ in range(${Math.ceil(sampleRate * duration)}):
        print(','.join(str(v) for v in signaldesk_next()))
`;
}
