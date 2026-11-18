import { useState } from 'react';
import { Download, Play, Upload, FlaskConical } from 'lucide-react';
import { api, download } from './data';
import { Field } from './ui';
import { ReportTable, type LabReport } from './EngineeringLab';

type Result = { count: number; duration: number; framesPerSecond: number; load: { lower: number; upper: number; payload: number }; warnings: string[]; ids: { key: string; id: string; extended: boolean; rtr: boolean; count: number; rate: number; meanPeriod: number | null; minPeriod: number | null; maxPeriod: number; data: string }[]; timeline: { time: number; lower: number; upper: number; count: number }[] };
export function CanAnalysis({ notify,openWave }: { notify: (message: string, error?: boolean) => void; openWave?:()=>void }) {
  const [selection,setSelection]=useState('');
  const [dbc,setDbc]=useState(''), [dbcName,setDbcName]=useState(''), [signals,setSignals]=useState<{input:string;format:string;dbc:string;report:LabReport}>(), [decoding,setDecoding]=useState(false);
  const signalKey=(row:(string|number)[])=>`${row[1]} / ${row[2]}.${row[3]}${row[5]?' ('+row[5]+')':''}`;
  const channels=[...new Set(signals?.report.rows.map(signalKey)||[])];
  const chosen=channels.includes(selection)?selection:channels[0];
  async function replay(){if(!signals||!chosen)return;setDecoding(true);try{
    const points=signals.report.rows.filter(row=>signalKey(row)===chosen && typeof row[4]==='number').map(row=>[row[0],row[4]]);
    await api('/lab/dbc/replay',{signal:chosen,points});openWave?.();
  }catch(e){notify((e as Error).message,true);}finally{setDecoding(false);}}
  async function loadDbc(file?:File) {
    if(!file)return;
    if(file.size>2*1024*1024)return notify('DBC 不能超过 2 MiB',true);
    try {const content=await file.text();setDbc(content);setDbcName(file.name);setSignals(undefined);} catch(e){notify((e as Error).message,true);}
  }
  async function decode() {
    setDecoding(true);setSignals(undefined);
    try {const report=await api<LabReport>('/lab/dbc',{text,format,dbc});setSignals({input:text,format,dbc,report});}
    catch(e){notify((e as Error).message,true);}finally{setDecoding(false);}
  }
  const [text, setText] = useState(''), [format, setFormat] = useState('csv'), [bitrate, setBitrate] = useState(500000), [duration, setDuration] = useState(0), [result, setResult] = useState<Result | null>(null), [busy, setBusy] = useState(false), [query, setQuery] = useState('');
  const run = async () => { setBusy(true); setResult(null); try { setResult(await api<Result>('/can/analyze', { text, format, bitrate, duration })); } catch (error) { notify((error as Error).message, true); } finally { setBusy(false); } };
  const demo = () => { setText('time,id,data\n' + Array.from({ length: 1001 }, (_, i) => `${(i / 1000).toFixed(3)},${i % 5 ? '123' : '321'},0102030405060708`).join('\n')); setFormat('csv'); setDuration(1); setResult(null); };
  const importFile = async (file?: File) => { if (!file) return; if (file.size > 4 * 1024 * 1024) return notify('CAN 记录不能超过 4 MiB', true); try { setText(await file.text()); setResult(null); } catch (error) { notify((error as Error).message, true); } };
  const percent = (value: number) => `${value.toFixed(2)}%`;
  return <section className="instrument-workspace"><div className="instrument-toolbar"><Field label="记录格式"><select value={format} onChange={event => setFormat(event.target.value)}><option value="csv">CSV · 秒 / 十六进制 ID / 数据</option><option value="candump">candump -L</option></select></Field><Field label="经典 CAN 码率 / bit/s"><input aria-label="CAN 码率" type="number" min="1000" max="1000000" list="can-rates" value={bitrate} onChange={event => setBitrate(Number(event.target.value))} /><datalist id="can-rates">{[10000, 20000, 50000, 100000, 125000, 250000, 500000, 800000, 1000000].map(rate => <option key={rate} value={rate} />)}</datalist></Field><Field label="观察时长 / s（0 = 时间跨度）"><input aria-label="CAN 观察时长" type="number" min="0" step="0.1" value={duration} onChange={event => setDuration(Number(event.target.value))} /></Field><button onClick={demo}><FlaskConical size={15} />示例记录</button><label className="file-button"><Upload size={15} />导入记录<input aria-label="导入 CAN 记录" type="file" accept=".csv,.log,.txt" onChange={event => { void importFile(event.target.files?.[0]); event.target.value = ''; }} /></label><button className="primary-button" disabled={!text.trim() || busy} onClick={run}><Play size={15} />分析</button></div>
    <textarea className="can-input" aria-label="CAN 记录" placeholder={'time,id,data\n0.000,123,01020304\n0.010,123,05060708'} value={text} onChange={event => { setText(event.target.value); setResult(null); }} />
    <div className="instrument-notice"><button onClick={()=>window.dispatchEvent(new CustomEvent('signaldesk-lab',{detail:{kind:'can'}}))}><Play size={14}/>适配器采集</button> 经典 CAN 离线负载估算 · 错误帧和重发未计入</div>
    {result && <><div className="instrument-metrics"><div><span>估算总线负载</span><strong>{percent(result.load.lower)} ~ {percent(result.load.upper)}</strong></div><div><span>数据位占用</span><strong>{percent(result.load.payload)}</strong></div><div><span>帧率</span><strong>{result.framesPerSecond.toFixed(1)} fps</strong></div><div><span>帧数 / 时长</span><strong>{result.count} / {result.duration.toFixed(3)} s</strong></div></div><div className="can-timeline" aria-label="CAN 负载时间分布">{result.timeline.map((bin, i) => <div key={i} title={`${bin.time.toFixed(3)} s · ${bin.count} 帧 · ${percent(bin.lower)} ~ ${percent(bin.upper)}`} style={{ height: `${Math.max(1, Math.min(100, bin.upper))}%` }} />)}</div><div className="instrument-toolbar"><input aria-label="筛选 CAN ID" placeholder="筛选 ID" value={query} onChange={event => setQuery(event.target.value)} /><span>{result.ids.length} IDs</span><button onClick={() => download(`can-analysis-${Date.now()}.json`, JSON.stringify(result, null, 2), 'application/json')}><Download size={15} />导出分析</button></div><div className="instrument-table-wrap"><table className="instrument-table"><thead><tr><th>ID</th><th>类型</th><th>帧数</th><th>帧率</th><th>周期均值 / 最小 / 最大 (ms)</th><th>最新数据</th></tr></thead><tbody>{result.ids.filter(entry => entry.id.includes(query.toUpperCase())).slice(0, 500).map(entry => <tr key={entry.key}><td>{entry.id}</td><td>{entry.extended ? 'EXT' : 'STD'} {entry.rtr ? 'RTR' : 'DATA'}</td><td>{entry.count}</td><td>{entry.rate.toFixed(1)}</td><td>{entry.meanPeriod === null ? '--' : [entry.meanPeriod, entry.minPeriod!, entry.maxPeriod].map(value => (value * 1000).toFixed(3)).join(' / ')}</td><td>{entry.data.match(/.{2}/g)?.join(' ') || '--'}</td></tr>)}</tbody></table></div>{result.warnings.map(warning => <p className="instrument-notice" key={warning}>{warning}</p>)}</>}
    <details className="lab-body"><summary>DBC 信号解码</summary><div className="instrument-toolbar"><label className="file-button"><Upload size={15}/>{dbcName||'导入 DBC'}<input type="file" aria-label="导入 DBC" accept=".dbc" onChange={e=>{void loadDbc(e.target.files?.[0]);e.target.value='';}}/></label><button disabled={!dbc||!text||decoding} onClick={()=>void decode()}><Play size={14}/>{decoding?'解码中…':'解码信号'}</button></div>
    {signals && signals.input===text && signals.format===format && signals.dbc===dbc && <>{channels.length>0&&<div className="lab-strip"><select aria-label="回放 DBC 信号" value={chosen} onChange={e=>setSelection(e.target.value)}>{channels.map(ch=><option key={ch}>{ch}</option>)}</select><button disabled={decoding} onClick={()=>void replay()}><Play size={14}/>在独立设备回放</button></div>}<ReportTable report={signals.report}/></>}</details>
  </section>;
}
