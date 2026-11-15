import { useEffect, useState } from 'react';
import { Check, Download, FlaskConical, Play, Save, ScanLine, Square } from 'lucide-react';
import { api, download } from './data';
import { Editor } from './Editor';
import { Field, IconButton } from './ui';
import type { AppState } from './types';
import { hardwareTestStorageKey } from '../shared/hardware-test.mjs';

type Notify = (message: string, error?: boolean) => void;
export const defaultSchema = { header: 'AA 55', length: 8, endian: 'LE', checksum: 'modbus', fields: [{ name: 'voltage', offset: 2, type: 'u16', scale: 0.001 }, { name: 'current', offset: 4, type: 'i16', scale: 0.001 }] };
type FrameResult = { valid: boolean; headerValid: boolean; checksum: { valid: boolean; expected: number | null; actual: number | null }; fields: { name: string; type: string; offset: number; raw: number; value: number }[]; hex?: string };
const demoTest = { name: '模拟设备回归测试', steps: [{ type: 'send', text: '*IDN?', format: 'text', ending: 'lf' }, { type: 'expect', contains: 'SignalDesk,SIMULATOR', timeout: 2000 }, { type: 'send', text: 'freq 2', format: 'text', ending: 'lf' }, { type: 'expect', contains: 'OK', timeout: 1000 }, { type: 'wait', ms: 200 }, { type: 'assert', channel: 0, min: 0, max: 3.3 }] };
type TestJob = { name: string; target: string; status: string; error?: string; results: { index: number; type: string; status: string; detail: string }[] };

export function FrameTools({ state, notify }: { state: AppState; notify: Notify }) {
  const [schema, setSchema] = useState(() => localStorage.getItem('signaldesk.frame-schema') || JSON.stringify(defaultSchema, null, 2));
  const [hex, setHex] = useState('AA 55 E8 03 64 00'), [result, setResult] = useState<FrameResult | null>(null), [live, setLive] = useState(false);
  useEffect(() => { if (!live) return; let active = true; const timer = setInterval(() => api<FrameResult | null>('/frames/latest').then(value => { if (active) setResult(value); }).catch(() => {}), 500); return () => { active = false; clearInterval(timer); }; }, [live]);
  const inspect = async (appendCRC = false) => {
    try { const data = JSON.parse(schema); let text = hex;
      if (appendCRC) { const crc = await api<{ hex: string }>('/crc', { text }); text += ' ' + crc.hex; setHex(text); }
      setResult(await api<FrameResult>('/frames/inspect', { schema: data, hex: text }));
    } catch (error) { notify((error as Error).message, true); }
  };
  const save = async () => {
    try {
      const parsed = JSON.parse(schema);
      await api('/frames/validate', { schema: parsed });
      localStorage.setItem('signaldesk.frame-schema', JSON.stringify(parsed, null, 2));
      notify('帧配置已保存，可在数据协议中选择');
    } catch (error) { notify((error as Error).message, true); }
  };
  return <section className="lab-editor-page tool-panel"><div className="panel-toolbar"><div className="panel-title"><ScanLine size={16} /><span>frame-schema.json</span></div><div className="toolbar-actions"><IconButton title="导出帧配置" onClick={() => download('frame-schema.json', schema, 'application/json')}><Download size={15} /></IconButton><button className="primary compact-button" onClick={save}><Save size={14} />保存帧配置</button></div></div><div className="lab-split"><div className="lab-editor"><Editor value={schema} onChange={setSchema} /></div><aside className="lab-inspector"><h2>帧校验与字段</h2><Field label="HEX 帧"><textarea aria-label="待解析帧" className="mono" value={hex} onChange={event => setHex(event.target.value)} /></Field><div className="lab-actions"><button className="quiet-button" onClick={() => inspect(true)}><Check size={14} />附加 CRC 并解析</button><button className="primary compact-button" onClick={() => inspect()}><Play size={14} />解析</button></div><label className="checkbox"><input type="checkbox" checked={live} disabled={state.config.protocol !== 'custom'} onChange={event => setLive(event.target.checked)} />跟随当前设备帧</label>{result && <><div className={`test-status ${result.valid ? 'passed' : 'failed'}`}>{result.valid ? '帧有效' : '帧无效'}</div><div className="measurement-row"><span>帧头</span><b>{result.headerValid ? 'PASS' : 'FAIL'}</b></div><div className="measurement-row"><span>校验</span><b>{result.checksum.valid ? 'PASS' : 'FAIL'}</b></div><code className="hash-text">expected={result.checksum.expected ?? 'none'} / actual={result.checksum.actual ?? 'none'}</code><table><thead><tr><th>字段</th><th>原值</th><th>换算值</th></tr></thead><tbody>{result.fields.map(field => <tr key={field.name}><td>{field.name}<small className="muted"> @{field.offset} {field.type}</small></td><td>{field.raw}</td><td>{field.value}</td></tr>)}</tbody></table></>}</aside></div></section>;
}

export function Automation({ state, notify }: { state: AppState; notify: Notify }) {
  const storageKey = hardwareTestStorageKey(state.activeDevice || '', state.devices?.find(device => device.id === state.activeDevice)?.projectRoot || '');
  const [script, setScript] = useState(() => localStorage.getItem(storageKey) || localStorage.getItem('signaldesk.test') || JSON.stringify(demoTest, null, 2)), [job, setJob] = useState<TestJob | null>(null);
  useEffect(() => { let active = true; const refresh = () => api<TestJob | null>('/automation').then(value => { if (active) setJob(value); }).catch(() => {}); void refresh(); const timer = setInterval(refresh, 400); return () => { active = false; clearInterval(timer); }; }, []);
  const run = async () => { try { const test = JSON.parse(script); localStorage.setItem(storageKey, script); setJob(await api<TestJob>('/automation/start', { ...test, deviceId: state.activeDevice })); } catch (error) { notify((error as Error).message, true); } };
  return <section className="lab-editor-page tool-panel"><div className="panel-toolbar"><div className="panel-title"><FlaskConical size={16} /><span>device-test.json</span></div><div className="toolbar-actions"><IconButton title="导出测试脚本" onClick={() => download('device-test.json', script, 'application/json')}><Download size={15} /></IconButton>{job?.status === 'running' ? <button className="quiet-button" onClick={() => api('/automation/stop', {}).catch(error => notify(error.message, true))}><Square size={14} />停止测试</button> : <button className="primary compact-button" disabled={!state.connected} onClick={run}><Play size={14} />运行测试</button>}</div></div><div className="lab-split"><div className="lab-editor"><Editor value={script} onChange={setScript} /></div><aside className="lab-inspector"><h2>测试结果</h2>{job ? <><span className="muted">{job.name} · {job.target}</span><div className={`test-status ${job.status}`}>{job.status.toUpperCase()}</div>{job.results.map(result => <div className="test-step" key={result.index}><span>{String(result.index).padStart(2, '0')} · {result.type}</span><b className={result.status}>{result.status}</b><code>{result.detail}</code></div>)}{job.error && <div className="inline-error">{job.error}</div>}<button className="quiet-button" onClick={() => download('test-report.json', JSON.stringify(job, null, 2), 'application/json')}><Download size={14} />导出报告</button></> : <div className="muted">尚无运行记录</div>}</aside></div></section>;
}
