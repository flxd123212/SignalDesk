import { useEffect, useRef, useState } from 'react';
import { ArrowDownToLine, ArrowUpFromLine, Check, Copy, Download, FileCode2, FolderOpen, List, Pause, Play, Plus, Radio, RefreshCw, Save, Send, Square, Trash2 } from 'lucide-react';
import { api, download, formatBytes, number } from './data';
import { Editor } from './Editor';
import { Empty, Field, IconButton } from './ui';
import type { AppState, Command, Session } from './types';
import { ModbusInspector } from './ModbusInspector';

type Notify = (message: string, error?: boolean) => void;
const initialCommands: Command[] = [
  { id: 'idn', name: '仪器身份查询', text: '*IDN?', format: 'text', ending: 'lf', checksum: 'none' },
  { id: 'at', name: 'AT 握手', text: 'AT', format: 'text', ending: 'crlf', checksum: 'none' },
  { id: 'version', name: '固件版本查询', text: 'AT+GMR', format: 'text', ending: 'crlf', checksum: 'none' },
  { id: 'modbus', name: '读取保持寄存器', text: '01 03 00 00 00 02', format: 'hex', ending: 'none', checksum: 'modbus' },
  { id: 'frequency', name: '模拟信号 · 2 Hz', text: 'freq 2', format: 'text', ending: 'lf', checksum: 'none' },
];

export function Commands({ connected, notify }: { connected: boolean; notify: Notify }) {
  const [commands, setCommands] = useState<Command[]>(() => { try { const stored = JSON.parse(localStorage.getItem('signaldesk.commands') || 'null'); return Array.isArray(stored) ? stored : initialCommands; } catch { return initialCommands; } });
  const file = useRef<HTMLInputElement>(null), running = useRef(false);
  const [batch, setBatch] = useState(false);
  useEffect(() => { localStorage.setItem('signaldesk.commands', JSON.stringify(commands)); }, [commands]);
  useEffect(() => () => { running.current = false; }, []);
  const update = (id: string, patch: Partial<Command>) => setCommands(current => current.map(command => command.id === id ? { ...command, ...patch } : command));
  const send = async (command: Command) => { try { await api('/send', command); notify(`已发送：${command.name}`); } catch (error) { notify((error as Error).message, true); } };
  const sendAll = async () => {
    if (batch) { running.current = false; setBatch(false); return; }
    running.current = true; setBatch(true);
    try {
      for (const command of commands) {
        if (!running.current) break;
        await api('/send', command);
        await new Promise(resolve => setTimeout(resolve, 150));
      }
    } catch (error) { notify((error as Error).message, true); }
    finally { running.current = false; setBatch(false); }
  };
  const importFile = async (chosen: File) => {
    try {
      if (chosen.size > 1024 * 1024) throw new Error('指令文件不能超过 1 MiB');
      let imported: Command[];
      if (/\.ini$/i.test(chosen.name)) {
        const bytes = new Uint8Array(await chosen.arrayBuffer()); let binary = '';
        for (const byte of bytes) binary += String.fromCharCode(byte);
        imported = await api<Command[]>('/import-sscom', { data: btoa(binary) });
      } else {
        imported = JSON.parse(await chosen.text());
        if (!Array.isArray(imported) || imported.length > 200 || imported.some(command => typeof command.name !== 'string' || typeof command.text !== 'string' || !['text', 'hex'].includes(command.format))) throw new Error('无效的指令库 JSON');
        imported = imported.map((command, index) => ({ ...command, id: `import-${Date.now()}-${index}`, ending: command.ending || 'crlf', checksum: command.checksum || 'none' }));
      }
      setCommands(current => [...current, ...imported].slice(0, 200)); notify(`已导入 ${imported.length} 条指令`);
    } catch (error) { notify((error as Error).message, true); }
  };
  return <section className="commands-page tool-panel"><div className="panel-toolbar"><div className="panel-title"><List size={16} /><span>常用指令</span><span className="small-tag">{commands.length}</span></div><div className="toolbar-actions">
    <input ref={file} hidden type="file" accept=".json,.ini" onChange={event => { if (event.target.files?.[0]) void importFile(event.target.files[0]); event.target.value = ''; }} />
    <IconButton title="导入 JSON 或 SSCOM 指令库" onClick={() => file.current?.click()}><ArrowUpFromLine size={16} /></IconButton>
    <IconButton title="导出指令库" onClick={() => download('signaldesk-commands.json', JSON.stringify(commands, null, 2), 'application/json')}><ArrowDownToLine size={16} /></IconButton>
    <button className="quiet-button" disabled={!connected || !commands.length} onClick={sendAll}>{batch ? <Square size={14} /> : <Play size={14} />}{batch ? '停止队列' : '依次发送'}</button>
    <button className="primary compact-button" onClick={() => setCommands(current => [...current, { id: `cmd-${Date.now()}`, name: '新指令', text: '', format: 'text', ending: 'crlf', checksum: 'none' }])}><Plus size={15} />添加指令</button>
  </div></div>
  <div className="table-scroll"><table className="command-table"><thead><tr><th>#</th><th>名称</th><th>发送内容</th><th>格式</th><th>结束符</th><th>校验</th><th /></tr></thead><tbody>{commands.map((command, index) => <tr key={command.id}><td className="row-number">{String(index + 1).padStart(2, '0')}</td><td><input aria-label={`指令 ${index + 1} 名称`} value={command.name} onChange={event => update(command.id, { name: event.target.value })} /></td><td><input className="mono" aria-label={`指令 ${index + 1} 内容`} value={command.text} onChange={event => update(command.id, { text: event.target.value })} /></td><td><select aria-label={`指令 ${index + 1} 格式`} value={command.format} onChange={event => update(command.id, { format: event.target.value as 'text' | 'hex' })}><option value="text">TEXT</option><option value="hex">HEX</option></select></td><td><select aria-label={`指令 ${index + 1} 结束符`} value={command.ending} onChange={event => update(command.id, { ending: event.target.value })}><option value="none">无</option><option value="lf">LF</option><option value="crlf">CRLF</option><option value="cr">CR</option></select></td><td><select aria-label={`指令 ${index + 1} 校验`} value={command.checksum} onChange={event => update(command.id, { checksum: event.target.value })}><option value="none">无</option><option value="modbus">CRC16</option><option value="sum8">SUM8</option></select></td><td><div className="row-actions"><IconButton title={`发送 ${command.name}`} disabled={!connected || !command.text} onClick={() => send(command)}><Send size={15} /></IconButton><IconButton title={`复制 ${command.name}`} onClick={() => setCommands(current => [...current, { ...command, id: `copy-${Date.now()}`, name: `${command.name} 副本` }])}><Copy size={15} /></IconButton><IconButton title={`删除 ${command.name}`} onClick={() => setCommands(current => current.filter(item => item.id !== command.id))}><Trash2 size={15} /></IconButton></div></td></tr>)}</tbody></table>{!commands.length && <Empty icon={<List size={30} />} title="指令库为空" />}</div></section>;
}

export function Script({ state, notify }: { state: AppState; notify: Notify }) {
  const [script, setScript] = useState(() => localStorage.getItem('signaldesk.script') || '// signal-processing.js\n\nvoltage = ch1\ncurrent = ch2\nreference = ch3\npower = voltage * current\n');
  const [error, setError] = useState(''), [dirty, setDirty] = useState(true);
  const apply = async () => {
    try { await api('/processing', { mode: 'script', script }); localStorage.setItem('signaldesk.script', script); setDirty(false); setError(''); notify('公式已应用到实时数据'); }
    catch (failure) { setError((failure as Error).message); }
  };
  return <section className="script-page tool-panel"><div className="panel-toolbar"><div className="panel-title"><FileCode2 size={16} /><span>signal-processing.js</span>{dirty && <span className="modified-dot" />}</div><div className="toolbar-actions"><IconButton title="导出公式" onClick={() => download('signal-processing.js', script)}><Download size={16} /></IconButton><button className="primary compact-button" onClick={apply}>{!dirty && state.processingMode === 'script' ? <Check size={15} /> : <Play size={15} />}{!dirty && state.processingMode === 'script' ? '已应用' : '应用公式'}</button></div></div>
    <div className="script-body"><Editor value={script} onChange={value => { setScript(value); setDirty(true); }} /><aside className="script-inspector"><div className="inspector-heading">输出通道</div><div className="mode-label">{state.processingMode === 'script' ? 'FORMULA / RUNNING' : 'FORMULA / IDLE'}</div>{state.names.map((name, index) => <div className="script-output" key={index}><span>{name}</span><b>{number(state.latest[index], 4)}</b></div>)}<div className="inspector-heading spaced">运行状态</div><div className="measurement-row"><span>处理错误</span><b>{state.processingErrors}</b></div><div className="measurement-row"><span>输入采样率</span><b>{state.config.sampleRate} Hz</b></div></aside></div>
    <div className={`editor-status ${error ? 'error' : ''}`}>{error || `${dirty ? '未应用的修改' : '已保存'} · 数学表达式 · UTF-8`}</div></section>;
}

export function Instruments({ connected, notify }: { connected: boolean; notify: Notify }) {
  const [slave, setSlave] = useState(1), [address, setAddress] = useState(0), [count, setCount] = useState(2), [func, setFunc] = useState(3);
  const [hex, setHex] = useState('01 03 00 00 00 02'), [crc, setCrc] = useState(''), [crcError, setCrcError] = useState('');
  const [scpi, setScpi] = useState('*IDN?');
  const frame = [slave, func, (address >> 8) & 255, address & 255, (count >> 8) & 255, count & 255].map(value => value.toString(16).padStart(2, '0').toUpperCase()).join(' ');
  useEffect(() => { let active = true; const timer = setTimeout(() => { api<{ hex: string }>('/crc', { text: hex }).then(result => { if (active) { setCrc(result.hex); setCrcError(''); } }).catch(error => { if (active) { setCrc(''); setCrcError(error.message); } }); }, 200); return () => { active = false; clearTimeout(timer); }; }, [hex]);
  const send = async (text: string, format = 'text', checksum = 'none') => { try { await api('/send', { text, format, ending: format === 'hex' ? 'none' : 'lf', checksum }); notify('指令已发送'); } catch (error) { notify((error as Error).message, true); } };
  const valid = Number.isInteger(slave) && slave >= 1 && slave <= 247 && Number.isInteger(address) && address >= 0 && address <= 65535 && Number.isInteger(count) && count >= 1 && count <= 125 && address + count <= 65536;
  return <div className="instrument-page"><section className="instrument-section"><div className="section-heading"><Radio size={19} /><h2>Modbus RTU</h2><span className="small-tag">MASTER</span></div><div className="instrument-fields"><Field label="从站地址"><input type="number" min="1" max="247" value={slave} onChange={event => setSlave(Number(event.target.value))} /></Field><Field label="功能码"><select value={func} onChange={event => setFunc(Number(event.target.value))}><option value="3">03 · 保持寄存器</option><option value="4">04 · 输入寄存器</option></select></Field><Field label="起始地址"><input type="number" min="0" max="65535" value={address} onChange={event => setAddress(Number(event.target.value))} /></Field><Field label="寄存器数量"><input type="number" min="1" max="125" value={count} onChange={event => setCount(Number(event.target.value))} /></Field></div><div className="frame-preview"><code>{frame}</code><span>+ CRC16 / LE</span><button className="primary" disabled={!connected || !valid} onClick={() => send(frame, 'hex', 'modbus')}><Send size={15} />发送请求</button></div></section>
    <section className="instrument-section"><div className="section-heading"><Radio size={19} /><h2>SCPI 仪器指令</h2><span className="small-tag">SERIAL</span></div><div className="scpi-presets">{['*IDN?', '*OPC?', 'SYST:ERR?', 'MEAS:VOLT:DC?', 'MEAS:CURR:DC?'].map(value => <button key={value} className={scpi === value ? 'selected' : ''} onClick={() => setScpi(value)}><code>{value}</code></button>)}</div><div className="inline-command"><input aria-label="SCPI 指令" className="mono" value={scpi} onChange={event => setScpi(event.target.value)} /><button className="primary" disabled={!connected || !scpi} onClick={() => send(scpi)}><Send size={15} />发送</button></div></section>
    <ModbusInspector notify={notify} />
    <section className="instrument-section"><div className="section-heading"><Save size={18} /><h2>CRC16 校验</h2><span className="small-tag">MODBUS</span></div><Field label="HEX 数据"><input className="mono" value={hex} onChange={event => setHex(event.target.value)} /></Field><div className="crc-result"><span>CRC / 低字节在前</span><code>{crc || '-- --'}</code><IconButton title="复制完整帧" disabled={!crc} onClick={() => { navigator.clipboard.writeText(`${hex} ${crc}`).then(() => notify('完整帧已复制')).catch(() => notify('剪贴板不可用', true)); }}><Copy size={16} /></IconButton></div>{crcError && <div className="inline-error">{crcError}</div>}</section>
  </div>;
}

export function Sessions({ state, notify }: { state: AppState; notify: Notify }) {
  const [sessions, setSessions] = useState<Session[]>([]), [speed, setSpeed] = useState(1);
  const file = useRef<HTMLInputElement>(null);
  const refresh = () => api<Session[]>('/sessions').then(setSessions).catch(error => notify(error.message, true));
  useEffect(() => { void refresh(); }, [state.recording?.id]);
  const control = async (action: string) => { try { await api('/replay/control', { action, speed }); } catch (error) { notify((error as Error).message, true); } };
  const load = async (id: string) => { try { await api('/replay/load', { id }); notify('录制已载入，串口已断开'); } catch (error) { notify((error as Error).message, true); } };
  const importFile = async (chosen: File) => { try { if (chosen.size > 32 * 1024 * 1024) throw new Error('录制文件不能超过 32 MiB'); await api('/sessions/import', { text: await chosen.text() }); await refresh(); notify('录制已导入'); } catch (error) { notify((error as Error).message, true); } };
  const replay = state.source === 'replay' ? state.replay : null;
  return <section className="session-page tool-panel"><div className="panel-toolbar"><div className="panel-title"><FolderOpen size={16} /><span>采集会话</span><span className="small-tag">JSONL</span></div><div className="toolbar-actions"><input hidden ref={file} type="file" accept=".jsonl" onChange={event => { if (event.target.files?.[0]) void importFile(event.target.files[0]); event.target.value = ''; }} /><IconButton title="刷新录制列表" onClick={refresh}><RefreshCw size={15} /></IconButton><button className="quiet-button" onClick={() => file.current?.click()}><ArrowUpFromLine size={15} />导入录制</button></div></div>
  <div className="session-list">{!sessions.length ? <Empty icon={<FolderOpen size={30} />} title="尚无采集会话" /> : <table><thead><tr><th>会话</th><th>时间</th><th>文件大小</th><th /></tr></thead><tbody>{sessions.map(session => <tr key={session.id} className={replay?.id === session.id ? 'selected-row' : ''}><td><div className="session-name"><span className={`status-dot ${session.active ? 'recording' : ''}`} /><span>{session.id.replace(/\.jsonl$/, '')}</span></div></td><td>{new Date(session.modified).toLocaleString('zh-CN', { hour12: false })}</td><td className="mono">{formatBytes(session.bytes)}</td><td><div className="row-actions"><button className="quiet-button" disabled={session.active} onClick={() => load(session.id)}><FolderOpen size={14} />载入</button>{!session.active && <a className="icon-button" title="下载录制" aria-label="下载录制" href={`/api/sessions/${encodeURIComponent(session.id)}`} download><Download size={15} /></a>}</div></td></tr>)}</tbody></table>}</div>
  <div className="replay-control"><div className="replay-heading"><span>{replay ? '会话回放' : '未载入会话'}</span><code>{((replay?.position || 0) / 1000).toFixed(1)} / {((replay?.duration || 0) / 1000).toFixed(1)} s</code></div><progress max={replay?.duration || 1} value={replay?.position || 0} /><div className="replay-actions"><IconButton title={replay?.playing ? '暂停回放' : '播放录制'} disabled={!replay} onClick={() => control(replay?.playing ? 'pause' : 'play')}>{replay?.playing ? <Pause size={17} /> : <Play size={17} />}</IconButton><IconButton title="停止并重置回放" disabled={!replay} onClick={() => control('stop')}><Square size={16} /></IconButton><select aria-label="回放速度" value={speed} disabled={!!replay?.playing} onChange={event => setSpeed(Number(event.target.value))}>{[0.25, 0.5, 1, 2, 4].map(value => <option value={value} key={value}>{value} ×</option>)}</select><span className="muted">{replay?.playing ? '正在回放' : replay ? '已暂停' : '等待载入'}</span></div></div></section>;
}
