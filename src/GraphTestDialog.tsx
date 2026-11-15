import { useEffect, useRef, useState } from 'react';
import { Download, FlaskConical, Play, X } from 'lucide-react';
import { api, COLORS, download } from './data';
import { Field, IconButton } from './ui';
import type { Sample } from './types';

type Result = { names: string[]; samples: Sample[]; code: string; filename: string; warnings: string[] };
const codeTargets = [{ id: 'arduino', label: 'Arduino / ESP32' }, { id: 'c', label: '通用 C99 / STM32 集成' }, { id: 'python', label: 'Python · 主机测试' }, { id: 'javascript', label: 'JavaScript · Node.js 测试' }];
function PreviewPlot({ result }: { result: Result }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const element = canvas.current; if (!element) return;
    const draw = () => {
      const width = element.clientWidth, height = 220, scale = devicePixelRatio || 1;
      element.width = Math.max(1, width * scale); element.height = height * scale;
      const ctx = element.getContext('2d')!; ctx.scale(scale, scale); ctx.fillStyle = '#151a1d'; ctx.fillRect(0, 0, width, height);
      ctx.strokeStyle = '#30383d'; ctx.lineWidth = 1;
      for (let y = 20; y < height; y += 40) { ctx.beginPath(); ctx.moveTo(40, y); ctx.lineTo(width - 10, y); ctx.stroke(); }
      let min = Infinity, max = -Infinity;
      for (const sample of result.samples) for (const value of sample.values) { min = Math.min(min, value); max = Math.max(max, value); }
      const range = max - min || 1;
      ctx.fillStyle = '#9aada6'; ctx.font = '10px Consolas'; ctx.fillText(max.toFixed(1), 2, 22); ctx.fillText(min.toFixed(1), 2, 200);
      result.names.forEach((_, channel) => { ctx.strokeStyle = COLORS[channel % COLORS.length]; ctx.beginPath(); result.samples.forEach((sample, index) => { const x = 42 + index / Math.max(1, result.samples.length - 1) * (width - 54), y = 200 - (sample.values[channel] - min) / range * 180; if (index) ctx.lineTo(x, y); else ctx.moveTo(x, y); }); ctx.stroke(); });
    };
    draw(); const observer = new ResizeObserver(draw); observer.observe(element); return () => observer.disconnect();
  }, [result]);
  return <canvas ref={canvas} className="test-preview-plot" aria-label="测试数据波形" />;
}

export function GraphTestDialog({ graph, close, notify }: { graph: object; close: () => void; notify: (message: string, error?: boolean) => void }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [sampleRate, setRate] = useState(100), [duration, setDuration] = useState(2), [raw, setRaw] = useState('1.65, 25, 50'), [format, setFormat] = useState('arduino'), [baudRate, setBaud] = useState(115200);
  const [result, setResult] = useState<Result | null>(null), [error, setError] = useState(''), [busy, setBusy] = useState(false);
  useEffect(() => { dialog.current?.showModal(); }, []);
  useEffect(() => { setResult(null); }, [sampleRate, duration, raw, format, baudRate]);
  const run = async () => {
    setBusy(true); setError('');
    try { setResult(await api<Result>('/testing/graph', { graph, sampleRate, duration, raw: raw.split(/[,\s]+/).filter(Boolean).map(Number), format, baudRate })); }
    catch (error) { setError((error as Error).message); } finally { setBusy(false); }
  };
  return <dialog ref={dialog} className="binding-dialog graph-test-dialog" onCancel={close} onClose={close} aria-label="节点测试与代码"><div className="panel-toolbar"><div className="panel-title"><FlaskConical size={16} />节点测试 <span className="small-tag">LOCAL / NO SERIAL TX</span></div><IconButton title="关闭节点测试" onClick={close}><X size={17} /></IconButton></div><div className="binding-content"><div className="test-options"><Field label="采样率 Hz"><input aria-label="测试采样率" type="number" value={sampleRate} onChange={event => setRate(Number(event.target.value))} /></Field><Field label="时长 s"><input aria-label="测试时长" type="number" value={duration} onChange={event => setDuration(Number(event.target.value))} /></Field><Field label="代码目标"><select aria-label="测试代码目标" value={format} onChange={event => setFormat(event.target.value)}>{codeTargets.map(target => <option key={target.id} value={target.id}>{target.label}</option>)}</select></Field><Field label="输出波特率"><select aria-label="测试输出波特率" value={baudRate} onChange={event => setBaud(Number(event.target.value))}>{[9600, 57600, 115200, 230400, 460800, 921600, 2000000].map(value => <option key={value}>{value}</option>)}</select></Field></div><Field label="原始输入通道"><input aria-label="测试原始通道" value={raw} onChange={event => setRaw(event.target.value)} /></Field><div className="lab-actions"><button className="primary" disabled={busy} onClick={run}><Play size={14} />生成并测试</button>{result && <><button className="quiet-button" onClick={() => { download(result.filename, result.code); notify('测试代码已导出'); }}><Download size={14} />导出测试代码</button><button className="quiet-button" onClick={() => download('graph-test.csv', ['time_s,' + result.names.map(name => JSON.stringify(name)).join(','), ...result.samples.map(sample => [sample.time, ...sample.values].join(','))].join('\r\n'), 'text/csv')}><Download size={14} />导出测试数据</button></>}</div>{error && <div role="alert" className="inline-error">{error}</div>}{result && <><div className="test-preview-legend">{result.names.map((name, index) => <span key={index} style={{ color: COLORS[index % COLORS.length] }}>{name} · {result.samples.at(-1)?.values[index].toFixed(3)}</span>)}<small>{result.samples.length} samples</small></div><PreviewPlot result={result} />{result.warnings.map((warning, index) => <p className="warning" key={index}>{warning}</p>)}<details className="generated-code" open><summary>{result.filename}</summary><textarea aria-label="生成的测试代码" readOnly value={result.code} spellCheck={false} /></details></>}</div></dialog>;
}
