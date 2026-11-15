import { compileGraph } from './processing.mjs';
import { generateHostGraph } from './graph-codegen.mjs';

const cFloat = value => `${Number(value).toExponential(8)}f`;
export function graphTest(input) {
  const { graph, sampleRate = 100, duration = 2, raw = [1.65, 25, 50], format = 'arduino', baudRate = 115200 } = input;
  if (!Number.isInteger(sampleRate) || sampleRate < 1 || sampleRate > 1000 || !Number.isFinite(duration) || duration <= 0 || duration > 10 || sampleRate * duration > 4000) throw new Error('本地测试限 1..1000 Hz、10 秒和 4000 个采样点');
  if (!Array.isArray(raw) || !raw.length || raw.length > 16 || raw.some(value => !Number.isFinite(value) || Math.abs(value) > 1e6)) throw new Error('请输入 1..16 个原始通道数值');
  if (!['arduino', 'c', 'python', 'javascript'].includes(format) || ![9600, 57600, 115200, 230400, 460800, 921600, 2000000].includes(baudRate)) throw new Error('代码目标或串口波特率无效');
  const compiled = compileGraph(graph, { sampleRate }), samples = [];
  for (let index = 0; index < Math.ceil(sampleRate * duration); index++) samples.push({ time: index / sampleRate, values: compiled.run(raw) });
  const warnings = [];
  if ((compiled.names.length * 18 + 2) * 10 * sampleRate > baudRate * 0.8) warnings.push('CSV 预计超过当前波特率吞吐量，请降低采样率或提高波特率');
  const code = ['python', 'javascript'].includes(format) ? generateHostGraph(compiled.plan, { sampleRate, raw, format, duration }) : generateC(compiled.plan, { sampleRate, raw, format, baudRate });
  return { names: compiled.names, samples, nodeValues: compiled.latestValues, warnings, code, filename: `signaldesk_test.${{ arduino: 'ino', c: 'c', python: 'py', javascript: 'mjs' }[format]}` };
}

function generateC(plan, { sampleRate, raw, format, baudRate }) {
  const names = new Map(plan.nodes.map((node, index) => [node.id, `v${index}`]));
  const state = [], lines = [];
  for (const node of plan.nodes) {
    const data = node.data, name = names.get(node.id), args = {};
    for (const edge of plan.edges.filter(edge => edge.target === node.id)) {
      const source = plan.nodes.find(node => node.id === edge.source);
      args[edge.targetHandle || 'a'] = source.data.kind === 'source' ? `raw[${Number(edge.sourceHandle.slice(2)) - 1}]` : names.get(edge.source);
    }
    const a = args.a, b = args.b, c = args.c, v = cFloat(data.value);
    let expression;
    switch (data.kind) {
      case 'source': continue;
      case 'constant': expression = v; break;
      case 'sequence': state.push(`static const float seq_${name}[] = { ${data.points.map(cFloat).join(', ')} };`); expression = `seq_${name}[sample_index % ${data.points.length}u]`; break;
      case 'sine': expression = `${cFloat(data.offset)} + ${v} * sinf(6.28318530718f * ${cFloat(data.frequency)} * t)`; break;
      case 'square': expression = `${cFloat(data.offset)} + ${v} * (fmodf(${cFloat(data.frequency)} * t, 1.0f) < 0.5f ? 1.0f : -1.0f)`; break;
      case 'ramp': expression = `${cFloat(data.offset)} + ${v} * (2.0f * fmodf(${cFloat(data.frequency)} * t, 1.0f) - 1.0f)`; break;
      case 'gain': expression = `${a} * ${v}`; break;
      case 'offset': expression = `${a} + ${v}`; break;
      case 'abs': expression = `fabsf(${a})`; break;
      case 'add': expression = `${a} + ${b}`; break;
      case 'subtract': expression = `${a} - ${b}`; break;
      case 'multiply': expression = `${a} * ${b}`; break;
      case 'divide': expression = `${a} / ${b}`; break;
      case 'linear': expression = `${a} * ${v} + ${cFloat(data.offset)}`; break;
      case 'adc': expression = `${a} * ${v} / ${cFloat(data.max)}`; break;
      case 'celsius': expression = `${a} * 1.8f + 32.0f`; break;
      case 'magnitude': expression = `sqrtf(${a} * ${a} + ${b} * ${b} + ${c} * ${c})`; break;
      case 'clamp': expression = `fminf(${cFloat(data.max)}, fmaxf(${v}, ${a}))`; break;
      case 'threshold': expression = `${a} > ${v} ? 1.0f : 0.0f`; break;
      case 'lowpass': state.push(`static float h_${name};`); expression = `sample_index ? h_${name} + ${v} * (${a} - h_${name}) : ${a}`; break;
      case 'average':
      case 'rms': {
        state.push(`static float h_${name}[${data.value}];`);
        lines.push(`  h_${name}[sample_index % ${data.value}u] = ${data.kind === 'rms' ? `${a} * ${a}` : a};`, `  const uint32_t count_${name} = sample_index < ${data.value}u ? sample_index + 1u : ${data.value}u;`, `  float sum_${name} = 0.0f;`, `  for (uint32_t i = 0; i < count_${name}; ++i) sum_${name} += h_${name}[i];`);
        expression = data.kind === 'rms' ? `sqrtf(sum_${name} / count_${name})` : `sum_${name} / count_${name}`; break;
      }
      default: expression = a;
    }
    lines.push(`  const float ${name} = ${expression};`, `  if (!isfinite(${name})) return 0;`);
    if (data.kind === 'lowpass') lines.push(`  h_${name} = ${name};`);
  }
  const generated = [
    '/* SignalDesk synthetic graph test. No sensor drivers or hardware auto-detection.',
    ' * Call from a main loop/task, never an ISR. Float math may be software-emulated.',
    ' * Fixed-size buffers only. MCU clock/UART/watchdog setup remains board-specific.',
    ' * Short-duration test generator; validate sample timing and UART throughput.',
    ' */', '#include <stdint.h>', '#include <stddef.h>', '#include <math.h>',
    ...(format === 'arduino' ? ['#include <Arduino.h>'] : []),
    `#define SIGNALDESK_RATE_HZ ${sampleRate}u`, `#define SIGNALDESK_CHANNELS ${plan.outputs.length}u`,
    `static const float raw[] = { ${raw.map(cFloat).join(', ')} };`, 'static uint32_t sample_index;', ...state,
    'int signaldesk_next(float output[SIGNALDESK_CHANNELS]) {', `  const float t = (float)sample_index / ${cFloat(sampleRate)};`, '  (void)t; (void)raw;', ...lines,
    ...plan.outputs.map((id, index) => `  output[${index}] = ${names.get(id)};`), '  ++sample_index;', '  return 1;', '}',
  ];
  if (format === 'arduino') generated.push(
    `void setup() { Serial.begin(${baudRate}); }`,
    'void loop() {', '  static uint32_t last_us, fraction;', '  const uint32_t now = micros();',
    '  if ((uint32_t)(now - last_us) < 1000000u / SIGNALDESK_RATE_HZ) return;',
    '  last_us += 1000000u / SIGNALDESK_RATE_HZ;', '  fraction += 1000000u % SIGNALDESK_RATE_HZ;',
    '  if (fraction >= SIGNALDESK_RATE_HZ) { ++last_us; fraction -= SIGNALDESK_RATE_HZ; }',
    '  if ((uint32_t)(now - last_us) > 1000000u) last_us = now;',
    '  float values[SIGNALDESK_CHANNELS];', '  if (!signaldesk_next(values)) return;',
    "  for (size_t i = 0; i < SIGNALDESK_CHANNELS; ++i) { if (i) Serial.print(','); Serial.print(values[i], 6); }", '  Serial.println();', '}',
  );
  else generated.push('/* Integration: call signaldesk_next() at SIGNALDESK_RATE_HZ.', ' * Serialize outputs as comma-separated decimals + LF (FireWater/CSV), or use', ' * your existing UART/DMA transport. No MCU registers or UART handles assumed.', ' * Link libm where needed; configure the platform watchdog in your main loop. */');
  return generated.join('\n') + '\n';
}
