import { useEffect, useMemo, useRef, useState } from 'react';
import { ArrowDownToLine, Download, Search, TerminalSquare, Trash2, Pause, Play, ChevronLeft, ChevronRight, ChevronDown, ChevronUp } from 'lucide-react';
import { dataStore, download, downloadPacketBytes, useDataRevision } from './data';
import { Empty, IconButton } from './ui';
import type { Packet } from './types';
import { findPacketMatches } from './terminal-search.mjs';
import { Bug } from 'lucide-react';
import { recentCrashLog } from '../shared/crash-trace.mjs';

function Highlight({ text, ranges = [] }: { text: string; ranges?: number[][] }) {
  const parts = []; let last = 0;
  for (const [start, end] of ranges) { if (end <= last) continue; parts.push(text.slice(last, Math.max(last, start)), <mark key={`${start}-${end}`}>{text.slice(Math.max(last, start), end)}</mark>); last = end; }
  parts.push(text.slice(last)); return <>{parts}</>;
}

export function Terminal({ compact = false, collapsed = false, onToggle, onTrace }: { compact?: boolean; collapsed?: boolean; onToggle?: () => void; onTrace?: (snapshot: string) => void }) {
  const revision = useDataRevision();
  const [hex, setHex] = useState(false), [filter, setFilter] = useState(''), [direction, setDirection] = useState('all');
  const [follow, setFollow] = useState(true), [paused, setPaused] = useState(false);
  const [hit, setHit] = useState(0), [exportType, setExportType] = useState('text'), [filteredExport, setFilteredExport] = useState(false);
  const held = useRef<Packet[]>([]), scroll = useRef<HTMLDivElement>(null);
  const cached = paused ? held.current : dataStore.packets;
  const searched = useMemo(() => findPacketMatches(cached.filter(packet => direction === 'all' || packet.dir === direction), filter, hex), [cached, revision, filter, hex, direction]);
  const matching = cached.filter(packet => (direction === 'all' || packet.dir === direction) && (!filter || searched.ids.has(packet.id)));
  const selected = Math.min(hit, Math.max(0, searched.hits.length - 1)), focusIds = searched.hits[selected] || [];
  const focusIndex = matching.findIndex(packet => packet.id === focusIds[0]);
  const limit = compact ? 80 : 200, start = filter && focusIndex >= 0 ? Math.max(0, focusIndex - 10) : Math.max(0, matching.length - limit);
  const packets = matching.slice(start, start + limit);
  useEffect(() => { if (follow && scroll.current) scroll.current.scrollTop = scroll.current.scrollHeight; }, [revision, follow, paused, filter, direction]);
  useEffect(() => { if (filter && focusIds.length) scroll.current?.querySelector(`[data-packet-id="${focusIds[0]}"]`)?.scrollIntoView({ block: 'nearest' }); }, [selected, filter, focusIds[0]]);
  const togglePause = () => { if (!paused) held.current = dataStore.packets.slice(); setPaused(!paused); };
  const exportPackets = () => { const data = filteredExport ? matching : cached; if (exportType === 'rxbin' || exportType === 'txbin') downloadPacketBytes(data, exportType === 'rxbin' ? 'RX' : 'TX'); else if (exportType === 'jsonl') download(`serial-packets-${Date.now()}.jsonl`, data.map(({ id, time, dir, data: raw, length }) => JSON.stringify({ id, time, dir, data: raw, length })).join('\n'), 'application/x-ndjson'); else download(`serial-log-${Date.now()}.txt`, data.map(packet => `${new Date(packet.time).toISOString()} ${packet.dir} ${hex ? packet.hex : packet.text.trimEnd()}`).join('\r\n')); };
  return <section className={`terminal-panel tool-panel ${compact ? 'compact' : 'full-terminal'} ${collapsed ? 'is-collapsed' : ''}`}>
    <div className="panel-toolbar"><div className="panel-title"><TerminalSquare size={15} /><span>串口终端</span><span className="small-tag">RAW DATA</span></div>
      <div className="toolbar-actions">
        {onTrace && <IconButton title="崩溃回溯 (F9)" onClick={() => onTrace(recentCrashLog(cached))}><Bug size={15} /></IconButton>}
        <div className="segmented small"><button className={!hex ? 'active' : ''} onClick={() => setHex(false)}>TEXT</button><button className={hex ? 'active' : ''} onClick={() => setHex(true)}>HEX</button></div>
        {!compact && <select aria-label="收发方向" value={direction} onChange={event => setDirection(event.target.value)}><option value="all">收发全部</option><option value="RX">仅接收</option><option value="TX">仅发送</option></select>}
        <IconButton title={paused ? '恢复终端刷新' : '暂停终端刷新'} className={paused ? 'selected' : ''} onClick={togglePause}>{paused ? <Play size={15} /> : <Pause size={15} />}</IconButton>
        <IconButton title="自动滚动" className={follow ? 'selected' : ''} onClick={() => setFollow(!follow)}><ArrowDownToLine size={15} /></IconButton>
        <IconButton title="导出终端缓存" onClick={exportPackets}><Download size={15} /></IconButton>
        <IconButton title="清空终端显示" onClick={() => { dataStore.clearLogs(); held.current = []; }}><Trash2 size={15} /></IconButton>
        {compact && onToggle && <IconButton title={collapsed ? '展开终端' : '收起终端'} aria-expanded={!collapsed} onClick={onToggle}>{collapsed ? <ChevronDown size={16} /> : <ChevronUp size={16} />}</IconButton>}
      </div>
    </div>
    {!compact && <><div className="terminal-search"><Search size={15} /><input aria-label="搜索串口数据" placeholder={hex ? '搜索 HEX 字节' : '搜索接收或发送字符'} value={filter} onChange={event => { setFilter(event.target.value); setHit(0); setFollow(false); }} /><IconButton title="上一个匹配" disabled={!searched.hits.length} onClick={() => setHit((selected - 1 + searched.hits.length) % searched.hits.length)}><ChevronLeft size={15} /></IconButton><span>{searched.hits.length ? selected + 1 : 0} / {searched.hits.length}</span><IconButton title="下一个匹配" disabled={!searched.hits.length} onClick={() => setHit((selected + 1) % searched.hits.length)}><ChevronRight size={15} /></IconButton><select className="encoding-select" aria-label="接收编码" value={dataStore.encoding} onChange={event => dataStore.setEncoding(event.target.value)}><option value="utf-8">UTF-8</option><option value="gb18030">GBK / GB18030</option><option value="utf-16le">UTF-16 LE</option><option value="windows-1252">Latin / Windows</option></select></div><div className="terminal-export"><span>缓存 {cached.length} / 1,000 条 · 匹配 {matching.length} 条</span><select aria-label="报文导出格式" value={exportType} onChange={event => setExportType(event.target.value)}><option value="text">TXT · 当前编码</option><option value="jsonl">JSONL · 时间戳与原始字节</option><option value="rxbin">BIN · 接收字节</option><option value="txbin">BIN · 发送字节</option></select><label className="checkbox"><input type="checkbox" checked={filteredExport} onChange={event => setFilteredExport(event.target.checked)} />仅导出筛选结果</label></div></>}
    <div className="terminal-log" ref={scroll} role="log" aria-label="串口收发数据">
      {!packets.length && <Empty icon={<TerminalSquare size={25} />} title="暂无收发数据" />}
      {packets.map(packet => <div className={`log-line ${filter && focusIds.includes(packet.id) ? 'search-current' : ''}`} data-packet-id={packet.id} key={packet.id}><time>{new Date(packet.time).toLocaleTimeString('zh-CN', { hour12: false })}<span>.{String(packet.time % 1000).padStart(3, '0')}</span></time><span className={`direction ${packet.dir.toLowerCase()}`}>{packet.dir}</span><pre><Highlight text={(hex ? packet.hex : packet.text) || '·'} ranges={searched.ranges.get(packet.id)} /></pre></div>)}
    </div>
  </section>;
}
