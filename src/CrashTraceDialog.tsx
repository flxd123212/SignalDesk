import { useEffect, useRef, useState } from 'react';
import { Bug, Download, FileCode2, Play, RotateCw, X } from 'lucide-react';
import { api, dataStore, download } from './data';
import { IconButton } from './ui';
import { parseCrashTrace, recentCrashLog } from '../shared/crash-trace.mjs';
import './crash-trace.css';

type Report = {
  artifact: string; architecture: string; tool: string; sha256: string; verified: boolean;
  frames: { address: string; name: string; location: string; file: string; line: number }[];
};
type Props = { deviceId: string; root: string; snapshot?: string; close: () => void; open: (file: string, line: number) => void };

export function CrashTraceDialog({ deviceId, root, snapshot, close, open }: Props) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [log, setLog] = useState(() => snapshot ?? recentCrashLog(dataStore.packets));
  const [paths, setPaths] = useState<string[]>([]), [artifact, setArtifact] = useState('');
  const [addressUnit, setAddressUnit] = useState('byte');
  const [report, setReport] = useState<Report>(), [error, setError] = useState('');
  const [busy, setBusy] = useState(false), [loading, setLoading] = useState(true);
  const { addresses, fingerprint } = parseCrashTrace(log);
  useEffect(() => {
    const element = dialog.current, previous = document.activeElement;
    let live = true;
    element?.showModal();
    api<{ paths: string[] }>(`/debug/artifacts?${new URLSearchParams({ deviceId, root })}`).then(data => {
      if (!live) return;
      setPaths(data.paths);
      if (data.paths.length === 1) setArtifact(current => current || data.paths[0]);
    }).catch(e => { if (live) setError(e.message); }).finally(() => { if (live) setLoading(false); });
    return () => { live = false; element?.close(); if (previous instanceof HTMLElement) previous.focus(); };
  }, [deviceId, root]);
  const reset = () => { setError(''); setReport(undefined); };
  const run = async () => {
    if (busy || !artifact || !addresses.length || addresses.length > 64) return;
    reset(); setBusy(true);
    try { setReport(await api<Report>('/debug/backtrace', { deviceId, root, artifact, addresses, fingerprint, addressUnit })); }
    catch (e) { setError((e as Error).message); }
    finally { setBusy(false); }
  };
  return <dialog ref={dialog} className="command-palette trace-dialog" aria-label="崩溃回溯" onCancel={close}>
    <header className="panel-toolbar"><div className="panel-title"><Bug size={17}/>崩溃回溯</div><IconButton title="关闭回溯" onClick={close}><X size={16}/></IconButton></header>
    <div className="trace-content">
      <label>调试固件<input value={artifact} list="trace-artifacts" disabled={busy} placeholder={loading ? '正在查找 ELF…' : '工程内 ELF / AXF / OUT 文件路径'} onChange={e => { reset(); setArtifact(e.target.value); }}/></label>
      <datalist id="trace-artifacts">{paths.map(p => <option key={p} value={p}/>)}</datalist>
      <label>日志地址单位<select value={addressUnit} disabled={busy} onChange={e => { reset(); setAddressUnit(e.target.value); }}><option value="byte">字节地址</option><option value="avr-word">AVR 字地址（每字 2 字节）</option></select></label>
      <label>异常日志<textarea autoFocus spellCheck={false} value={log} disabled={busy} maxLength={32768} placeholder="粘贴 Backtrace、PC / LR 寄存器或十六进制指令地址" onChange={e => { reset(); setLog(e.target.value); }}/></label>
      <div className="trace-actions"><button disabled={busy} onClick={() => { reset(); setLog(recentCrashLog(dataStore.packets)); }}><RotateCw size={14}/>读取最近接收</button><span>{addresses.length} 个指令地址</span><button className="primary" disabled={busy || !artifact || !addresses.length || addresses.length > 64} onClick={run}><Play size={14}/>{busy ? '解析中…' : '解析地址'}</button></div>
      {addresses.length > 64 && <p role="alert">单次最多解析 64 帧，请缩小日志范围。</p>}
      {error && <p className="error-text" role="alert">{error}</p>}
      {report && <section aria-label="调用栈"><div className="trace-summary"><strong>{report.architecture}</strong><span>{report.verified ? 'ELF 指纹已匹配' : '日志未提供 ELF 指纹'}</span><IconButton title="下载回溯报告" onClick={() => download('crash-backtrace.json', JSON.stringify(report, null, 2), 'application/json')}><Download size={15}/></IconButton></div>
        <ol>{report.frames.map((frame, i) => <li key={i}><code>{frame.address}</code><div><strong>{frame.name || '未知函数'}</strong>{frame.file ? <button title="跳到源码行" onClick={() => open(frame.file, frame.line)}><FileCode2 size={14}/>{frame.file}:{frame.line}</button> : <small>{frame.line ? frame.location : '无调试行号'}</small>}</div></li>)}</ol>
      </section>}
    </div>
  </dialog>;
}
