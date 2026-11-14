import { useEffect, useRef, useState } from 'react';
import { History, Send, Timer, Trash2, Upload } from 'lucide-react';
import { api, formatBytes } from './data';
import { IconButton } from './ui';
import type { AppState } from './types';
import { mixedBytes } from '../shared/mixed-payload.mjs';

type Payload = { text: string; format: string; ending: string; checksum: string; encoding: string };
type Draft = Payload & { interval: number; history: Payload[] };
const drafts = new Map<string, Draft>();
const initialDraft: Draft = { text: 'AT', format: 'text', ending: 'crlf', checksum: 'none', encoding: 'utf8', interval: 1000, history: [] };

export function SendBar({ state, notify }: { state: AppState; notify: (message: string, error?: boolean) => void }) {
  const deviceId = state.activeDevice, draftKey = deviceId || 'initial';
  const [draft, setDraft] = useState(() => drafts.get(draftKey) || { ...initialDraft });
  const { text, format, ending, checksum, encoding, interval, history } = draft;
  const [sending, setSending] = useState(false);
  const file = useRef<HTMLInputElement>(null);
  const payload = { text, format, ending, checksum, encoding };
  const update = (patch: Partial<Draft>) => setDraft(current => ({ ...current, ...patch }));
  useEffect(() => {
    drafts.set(draftKey, draft);
    for (const id of drafts.keys()) if (state.devices && !state.devices.some(device => device.id === id)) drafts.delete(id);
  }, [draft, draftKey, state.devices]);
  let mixedPreview = '', mixedError = '';
  if (format === 'mixed') { try { const bytes = mixedBytes(text); mixedPreview = `${bytes.length} B · ` + Array.from(bytes.slice(0, 128), byte => byte.toString(16).padStart(2, '0').toUpperCase()).join(' ') + (bytes.length > 128 ? ' ...' : ''); } catch (error) { mixedError = (error as Error).message; } }
  const canSend = state.connected && state.source !== 'replay' && !mixedError;
  const send = async () => {
    if (!canSend || !text || sending) return;
    setSending(true);
    try {
      await api('/send', { ...payload, deviceId });
      if (text.length <= 65536) {
        const current = drafts.get(draftKey) || draft;
        const recent = [payload, ...current.history.filter(item => JSON.stringify(item) !== JSON.stringify(payload))].slice(0, 30);
        drafts.set(draftKey, { ...current, history: recent });
        setDraft(current => ({ ...current, history: recent }));
      }
    } catch (error) { notify((error as Error).message, true); } finally { setSending(false); }
  };
  const timer = async () => {
    setSending(true);
    try { await api('/timer', { active: !state.timedSend, payload, interval, deviceId }); }
    catch (error) { notify((error as Error).message, true); } finally { setSending(false); }
  };
  const sendFile = async (chosen: File) => {
    if (!deviceId || !canSend || sending) return;
    const targetDevice = deviceId;
    setSending(true);
    try {
      if (chosen.size > 65536 || chosen.size === 0) throw new Error('文件发送支持 1 B 到 64 KiB');
      const bytes = new Uint8Array(await chosen.arrayBuffer());
      await api('/send', { text: Array.from(bytes, byte => byte.toString(16).padStart(2, '0')).join(''), format: 'hex', ending: 'none', checksum: 'none', deviceId: targetDevice });
      notify(`已发送文件：${chosen.name}（${formatBytes(chosen.size)}）`);
    } catch (error) { notify((error as Error).message, true); } finally { setSending(false); }
  };
  const target = state.devices?.find(device => device.id === deviceId);
  return <div className="send-bar">
    <div className="send-context"><span className="send-target"><span className={`status-dot ${state.connected ? 'live' : ''}`} />{target?.name || '当前设备'}<small>{state.config.path === 'demo' ? 'DEMO' : state.config.path}</small></span><div className="send-history"><History size={14} /><select aria-label="最近发送记录" title="载入当前设备最近成功发送的指令" value="" disabled={!history.length} onChange={event => { const entry = history[Number(event.target.value)]; if (entry) update(entry); }}><option value="">最近发送{history.length ? ` · ${history.length}` : ''}</option>{history.map((item, index) => <option key={index} value={index}>{item.format.toUpperCase()} · {item.text.replace(/\s+/g, ' ').slice(0, 70)}</option>)}</select><IconButton title="清空当前设备发送记录" disabled={!history.length} onClick={() => update({ history: [] })}><Trash2 size={13} /></IconButton></div></div>
    <div className="send-compose"><div className="send-mode"><select aria-label="发送格式" value={format} onChange={event => update({ format: event.target.value })}><option value="text">TEXT</option><option value="hex">HEX</option><option value="mixed">ASCII + HEX</option></select></div><select className="send-encoding" aria-label="发送编码" value={encoding} disabled={format !== 'text'} onChange={event => update({ encoding: event.target.value })}><option value="utf8">UTF-8</option><option value="gb18030">GBK</option><option value="utf16le">UTF-16</option><option value="latin1">Latin-1</option></select><textarea aria-label="发送内容" value={text} placeholder={format === 'mixed' ? 'AT[HEX:00 FF]END' : format === 'text' ? '输入串口指令' : '01 03 00 00 00 02'} onChange={event => update({ text: event.target.value })} onKeyDown={event => { if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing && event.keyCode !== 229) { event.preventDefault(); void send(); } }} spellCheck={false} /><button className="primary send-button" disabled={!canSend || !text || sending} onClick={send}><Send size={16} />发送</button></div>
    {format === 'mixed' && <div className={`mixed-preview ${mixedError ? 'error' : ''}`} role="status">{mixedError || `正文预览（结束符与校验另加）· ${mixedPreview}`}</div>}
    <div className="send-options"><label><span>结束符</span><select aria-label="发送结束符" disabled={format === 'hex'} value={ending} onChange={event => update({ ending: event.target.value })}><option value="none">无</option><option value="crlf">CRLF</option><option value="lf">LF</option><option value="cr">CR</option></select></label><label><span>校验</span><select aria-label="发送校验" value={checksum} onChange={event => update({ checksum: event.target.value })}><option value="none">无</option><option value="modbus">CRC16</option><option value="sum8">SUM8</option></select></label><span className="toolbar-divider" /><label className="timed-toggle"><input type="checkbox" checked={!!state.timedSend} disabled={sending || (!state.timedSend && (!canSend || !text))} onChange={timer} /><Timer size={13} /><span>定时发送</span></label><input className="interval-input" aria-label="定时发送间隔" type="number" min="20" max="3600000" value={state.timedSend || interval} disabled={!!state.timedSend} onChange={event => update({ interval: Number(event.target.value) })} /><span className="muted">ms</span><span className="send-spacer" /><input type="file" hidden ref={file} onChange={event => { if (event.target.files?.[0]) void sendFile(event.target.files[0]); event.target.value = ''; }} /><button className="file-send" disabled={!canSend || sending} onClick={() => file.current?.click()}><Upload size={14} />发送文件</button></div>
  </div>;
}
