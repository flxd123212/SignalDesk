import { useCallback, useEffect, useState } from 'react';
import { CheckCircle2, Download, ExternalLink, RefreshCw, Wrench } from 'lucide-react';
import { api } from './data';
import './display/studio.css';

interface Tool { id: string; name: string; executable: string; url: string; direct: boolean }
export default function ToolCenter() {
  const [tools, setTools] = useState<Tool[]>([]), [busy, setBusy] = useState(false), [error, setError] = useState('');
  const [downloading, setDownloading] = useState(false);
  async function downloadArduino(t: Tool) {
    setDownloading(true); setError('');
    try {
      const response = await fetch('/api/toolchains/download/arduino-cli');
      if (!response.ok) throw new Error((await response.json()).error || '下载失败');
      const url = URL.createObjectURL(await response.blob()), link = document.createElement('a');
      link.href = url; link.download = new URL(t.url).pathname.split('/').at(-1)!; link.click(); setTimeout(() => URL.revokeObjectURL(url), 30000);
    } catch (err) { setError((err as Error).message); } finally { setDownloading(false); }
  }
  const scan = useCallback(async () => {
    setBusy(true);
    try { setTools(await api<Tool[]>('/toolchains/inventory')); setError(''); }
    catch (err) { setError((err as Error).message); } finally { setBusy(false); }
  }, []);
  useEffect(() => { void scan(); }, [scan]);
  return <section className="tool-center"><header><Wrench size={18}/><strong>本机开发环境</strong><span>{tools.filter(t => t.executable).length} / {tools.length} 已找到</span><button className="quiet-button" disabled={busy} onClick={scan}><RefreshCw size={14}/>{busy ? '检测中' : '重新检测'}</button></header>
    {error && <p role="alert">{error}</p>}{tools.map(t => <div className="tool-record" key={t.id}><div><strong>{t.name}</strong><small>{t.executable || '未在工具目录中找到'}</small></div>{t.executable ? <CheckCircle2 aria-label="已找到" size={17}/> : <div className="studio-buttons">{t.direct && <button disabled={downloading} onClick={() => downloadArduino(t)}><Download size={14}/>{downloading ? '下载并校验中…' : '下载工具包'}</button>}<a href={t.url} target="_blank" rel="noreferrer" onClick={e => { if (window.signaldeskDesktop) { e.preventDefault(); void window.signaldeskDesktop.openToolDownload(t.id).catch(err => setError(err.message)); } }}><ExternalLink size={14}/>{t.direct ? '官方镜像' : '官方安装入口'}</a></div>}</div>)}
  </section>;
}
