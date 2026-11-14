import { useEffect, useRef, useState } from 'react';
import { Activity, ArrowUpRight, Download, FolderOpen, RefreshCw, Save, Search, TerminalSquare } from 'lucide-react';
import { api, COLORS, formatBytes } from './data';
import { Field, IconButton } from './ui';
import type { AppState, Device, Sample } from './types';
export { ProjectBinding as DeviceProject } from './ProjectBinding';

type Notify = (message: string, error?: boolean) => void;
type BoundDevice = Device & { chip: string; projectRoot: string; samples: Sample[]; names: string[]; latest: number[] };

function MiniPlot({ samples }: { samples: Sample[] }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const element = canvas.current; if (!element) return;
    const draw = () => {
      const box = element.getBoundingClientRect(), scale = devicePixelRatio || 1;
      element.width = Math.max(1, box.width * scale); element.height = 150 * scale;
      const ctx = element.getContext('2d')!; ctx.scale(scale, scale); ctx.fillStyle = '#191d20'; ctx.fillRect(0, 0, box.width, 150);
      ctx.strokeStyle = '#30373b'; ctx.lineWidth = 1;
      for (let x = 0; x < box.width; x += box.width / 8) { ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, 150); ctx.stroke(); }
      for (let y = 0; y < 150; y += 30) { ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(box.width, y); ctx.stroke(); }
      if (samples.length < 2) return;
      const values = samples.flatMap(sample => sample.values.slice(0, 3)).filter(Number.isFinite), min = Math.min(...values), max = Math.max(...values), range = max - min || 1;
      for (let channel = 0; channel < Math.min(3, samples[0].values.length); channel++) {
        ctx.strokeStyle = COLORS[channel]; ctx.lineWidth = 1.5; ctx.beginPath();
        samples.forEach((sample, index) => { const x = index / (samples.length - 1) * box.width, y = 137 - (sample.values[channel] - min) / range * 124; if (index) ctx.lineTo(x, y); else ctx.moveTo(x, y); }); ctx.stroke();
      }
    };
    draw(); const observer = new ResizeObserver(draw); observer.observe(element); return () => observer.disconnect();
  }, [samples]);
  return <canvas className="device-mini-plot" ref={canvas} aria-label="设备概览波形" />;
}

export function Overview({ notify, openWorkspace }: { notify: Notify; openWorkspace: () => void }) {
  const [devices, setDevices] = useState<BoundDevice[]>([]);
  useEffect(() => { let active = true; const refresh = () => api<BoundDevice[]>('/devices/overview').then(value => { if (active) setDevices(value); }).catch(() => {}); void refresh(); const timer = setInterval(refresh, 300); return () => { active = false; clearInterval(timer); }; }, []);
  const select = async (id: string) => { try { await api('/devices/select', { id }); openWorkspace(); } catch (error) { notify((error as Error).message, true); } };
  return <div className="overview-grid">{devices.map(device => <section className="device-summary" key={device.id}><div className="device-summary-heading"><Activity size={15} /><b>{device.name}</b><span className={`status-dot ${device.connected ? 'live' : ''}`} /><IconButton title={`查看 ${device.name}`} onClick={() => select(device.id)}><ArrowUpRight size={17} /></IconButton></div><div className="overview-identity"><strong>{device.chip || '芯片型号未标记'}</strong><code>{device.path === 'demo' ? 'SIMULATED DEVICE' : device.path}</code></div><MiniPlot samples={device.samples} /><div className="overview-values">{device.latest.slice(0, 3).map((value, index) => <span key={index} style={{ color: COLORS[index] }}>{device.names[index]} <b>{value.toFixed(3)}</b></span>)}</div><div className="overview-project"><FolderOpen size={13} /><span>{device.projectRoot || '未绑定工程'}</span></div><div className="overview-counters"><span>RX {formatBytes(device.rxBytes)}</span><span>TX {formatBytes(device.txBytes)}</span><span>{device.recording ? 'REC' : device.connected ? 'LIVE' : 'OFFLINE'}</span></div></section>)}</div>;
}

type LogEntry = { id: string; time: string; level: string; category: string; device: string; message: string; data: unknown };
export function Logs({ state, notify }: { state: AppState; notify: Notify }) {
  const [level, setLevel] = useState(''), [device, setDevice] = useState(''), [search, setSearch] = useState(''), [entries, setEntries] = useState<LogEntry[]>([]), [failure, setFailure] = useState('');
  const devices = (state as AppState & { devices?: Device[] }).devices || [];
  const query = new URLSearchParams({ level, device, search }).toString();
  useEffect(() => { let active = true; const refresh = () => api<{ entries: LogEntry[]; failure: string }>(`/logs?${query}`).then(result => { if (active) { setEntries(result.entries); setFailure(result.failure); } }).catch(error => notify(error.message, true)); void refresh(); const timer = setInterval(refresh, 1500); return () => { active = false; clearInterval(timer); }; }, [query]);
  return <section className="logs-page tool-panel"><div className="panel-toolbar"><div className="panel-title"><TerminalSquare size={15} />运行与修改日志</div><a className="quiet-button" href={`/api/logs/export?${query}`} download><Download size={14} />导出 JSONL</a></div><div className="log-filters"><select aria-label="日志级别" value={level} onChange={event => setLevel(event.target.value)}><option value="">全部级别</option><option value="info">INFO</option><option value="warn">WARN</option><option value="error">ERROR</option></select><select aria-label="日志设备" value={device} onChange={event => setDevice(event.target.value)}><option value="">所有设备</option>{devices.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</select><Search size={14} /><input aria-label="搜索日志" placeholder="搜索错误、文件或操作" value={search} onChange={event => setSearch(event.target.value)} /></div>{failure && <div className="inline-error">{failure}</div>}<div className="event-list">{entries.map(entry => <article className={`event-entry ${entry.level}`} key={entry.id}><div><time>{new Date(entry.time).toLocaleString('zh-CN', { hour12: false })}</time><b>{entry.level.toUpperCase()}</b><span>{devices.find(item => item.id === entry.device)?.name || entry.device} · {entry.category}</span></div><p>{entry.message}</p>{entry.data != null && <details><summary>详细数据</summary><pre>{JSON.stringify(entry.data, null, 2)}</pre></details>}</article>)}</div></section>;
}
