import { useEffect, useRef, useState } from 'react';
import { Cpu, FolderOpen, Link2, RefreshCw, Save, Unlink, X } from 'lucide-react';
import { api } from './data';
import { Field, IconButton } from './ui';
import type { AppState, ChipFamily, Device, Identification, Port } from './types';

const sources: Record<string, string> = { usb: 'USB 描述符', project: '工程目标', 'boot-log': '设备启动日志' };
export function ProjectBinding({ state, notify }: { state: AppState; notify: (message: string, error?: boolean) => void }) {
  const scope = state as AppState & { devices?: Device[]; activeDevice?: string };
  const device = scope.devices?.find(item => item.id === scope.activeDevice);
  const [open, setOpen] = useState(false);
  useEffect(() => setOpen(false), [device?.id]);
  return <div className="device-project"><button className="project-summary" onClick={() => setOpen(true)} title={device?.projectRoot}><FolderOpen size={15} /><span>{device?.chip || '未标记芯片'}<small>{device?.board || device?.projectRoot?.split(/[\\/]/).at(-1) || '未绑定工程'}</small></span><span className="muted">设置</span></button>{open && device && <BindingDialog device={device} notify={notify} close={() => setOpen(false)} />}</div>;
}

function BindingDialog({ device, notify, close }: { device: Device; notify: (message: string, error?: boolean) => void; close: () => void }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [name, setName] = useState(device.name), [chip, setChip] = useState(device.chip || ''), [board, setBoard] = useState(device.board || ''), [root, setRoot] = useState(device.projectRoot || '');
  const [catalog, setCatalog] = useState<ChipFamily[]>([]), [family, setFamily] = useState(''), [ports, setPorts] = useState<Port[]>([]), [port, setPort] = useState(device.path), [autoMatch, setAutoMatch] = useState(true);
  const [candidates, setCandidates] = useState<Identification[]>([]), [warnings, setWarnings] = useState<string[]>([]), [busy, setBusy] = useState(false), [error, setError] = useState('');
  const [binding, setBinding] = useState(device.portBinding), [bindingStatus, setBindingStatus] = useState('');
  const operate = async (work: () => Promise<void>) => { setBusy(true); setError(''); try { await work(); } catch (error) { setError((error as Error).message); } finally { setBusy(false); } };
  useEffect(() => { dialog.current?.showModal(); }, []);
  useEffect(() => {
    let active = true;
    Promise.all([api<ChipFamily[]>('/chips/catalog'), api<Port[]>('/ports'), api<{ deviceId: string; candidates: Identification[]; warnings: string[]; binding: string }>('/devices/identify')]).then(([catalog, ports, report]) => {
      if (!active || report.deviceId !== device.id) return;
      setCatalog(catalog); setPorts(ports); setCandidates(report.candidates); setWarnings(report.warnings); setBindingStatus(report.binding);
    }).catch(error => { if (active) setError(error.message); });
    return () => { active = false; };
  }, [device.id]);
  const selectedPort = ports.find(item => item.path === port);
  const save = () => operate(async () => { await api('/devices/config', { deviceId: device.id, name, chip, board, root }); notify('设备与工程绑定已更新'); close(); });
  const inspect = () => operate(async () => {
    const result = await api<{ candidates: Identification[]; warnings: string[] }>('/projects/inspect', { root });
    setCandidates(current => [...current.filter(item => item.source !== 'project'), ...result.candidates]); setWarnings(result.warnings);
    if (!result.candidates.length && !result.warnings.length) setWarnings(['目录中未找到带芯片目标的 Keil / IAR 工程']);
  });
  const bind = (clear = false) => operate(async () => {
    const result = await api<AppState & { devices: Device[] }>('/devices/bind-port', { deviceId: device.id, clear, path: port, autoMatch: autoMatch && Boolean(selectedPort?.identification?.key) });
    setBinding(result.devices.find(item => item.id === device.id)?.portBinding); setBindingStatus(clear ? 'unbound' : selectedPort?.identification?.key ? 'matched' : 'manual'); notify(clear ? '已解除串口绑定' : '串口已绑定，未自动打开连接');
  });
  const choices = family ? catalog.filter(item => item.id === family) : catalog;
  return <dialog ref={dialog} className="binding-dialog" onCancel={close} onClose={close} aria-label="设备与工程设置"><div className="panel-toolbar"><div className="panel-title"><Cpu size={16} />设备与工程</div><IconButton title="关闭设备设置" onClick={close}><X size={17} /></IconButton></div><div className="binding-content">
    <div className="binding-grid"><Field label="设备名称"><input autoFocus aria-label="设备名称" maxLength={80} value={name} onChange={event => setName(event.target.value)} /></Field><Field label="芯片系列"><select aria-label="标记芯片系列" value={family} onChange={event => setFamily(event.target.value)}><option value="">全部系列 / 自定义</option>{catalog.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</select></Field><Field label="芯片型号"><input aria-label="设备芯片型号" list="chip-models" maxLength={80} value={chip} onChange={event => setChip(event.target.value)} /><datalist id="chip-models">{choices.flatMap(item => item.chips).map(value => <option key={value} value={value} />)}</datalist></Field><Field label="开发板型号"><input aria-label="开发板型号" list="board-models" maxLength={80} value={board} onChange={event => setBoard(event.target.value)} /><datalist id="board-models">{choices.flatMap(item => item.boards).map(value => <option key={value} value={value} />)}</datalist></Field></div>
    <div className="project-path-field"><Field label="工程目录"><input aria-label="设备工程目录" value={root} onChange={event => setRoot(event.target.value)} /></Field><IconButton title={window.signaldeskDesktop ? '选择工程目录' : '浏览器模式：输入工程绝对路径'} disabled={!window.signaldeskDesktop || busy} onClick={() => operate(async () => { const selected = await window.signaldeskDesktop!.chooseDirectory(root); if (selected) setRoot(selected); })}><FolderOpen size={18} /></IconButton><IconButton title="识别工程芯片" disabled={!root || busy} onClick={inspect}><RefreshCw size={16} /></IconButton></div><code className="full-project-path">{root || '未选择工程'}</code>
    <section className="binding-section"><h3>识别结果</h3><div className="identity-results">{candidates.map((item, index) => <div className="identity-result" key={index}><div><span className="identity-source">{sources[item.source || ''] || item.source}</span><b>{item.chip || item.board || (item.family ? `${item.family.toUpperCase()} 系列候选` : '未确认 MCU')}</b><small>{item.evidence}</small></div>{(item.chip || item.board) && <button className="quiet-button" onClick={() => { if (item.chip) setChip(item.chip); if (item.board) setBoard(item.board); if (item.family) setFamily(item.family); }}>采用</button>}</div>)}{!candidates.length && <span className="muted">暂无芯片识别依据</span>}</div>{warnings.map((warning, index) => <p className="warning" key={index}>{warning}</p>)}</section>
    <section className="binding-section"><h3>串口身份绑定 <span className="muted">{({ unbound: '未绑定', matched: '身份匹配', manual: '固定端口', missing: '设备离线', ambiguous: '身份重复' } as Record<string, string>)[bindingStatus]}</span></h3><div className="project-path-field"><Field label="绑定串口"><select aria-label="绑定串口" value={port} onChange={event => setPort(event.target.value)}><option value="demo">选择真实串口</option>{ports.map(item => <option key={item.path} value={item.path}>{item.path} · {item.identification?.interface || item.manufacturer || '串口'}</option>)}{port !== 'demo' && !ports.some(item => item.path === port) && <option value={port}>{port} · 离线</option>}</select></Field><IconButton title="刷新设备识别" disabled={busy} onClick={() => operate(async () => setPorts(await api<Port[]>('/ports')))}><RefreshCw size={16} /></IconButton></div>
    <div className="port-facts">{selectedPort?.identification?.evidence.map((text, index) => <code key={index}>{text}</code>)}{selectedPort && !selectedPort.identification?.key && <span className="warning">无唯一序列号，COM 号变化后需手动确认</span>}</div><label className="checkbox"><input type="checkbox" checked={autoMatch && Boolean(selectedPort?.identification?.key)} disabled={!selectedPort?.identification?.key} onChange={event => setAutoMatch(event.target.checked)} />按 USB 身份更新 COM 号</label><div className="lab-actions"><button className="quiet-button" disabled={busy || !selectedPort} onClick={() => bind()}><Link2 size={14} />绑定此串口</button><button className="quiet-button" disabled={busy || !binding} onClick={() => bind(true)}><Unlink size={14} />解除绑定</button>{binding && <code className="muted">{binding.path} · {binding.serialNumber || '固定端口'}</code>}</div></section>
    {error && <div role="alert" className="inline-error">{error}</div>}
  </div><div className="binding-footer"><button className="quiet-button" onClick={close}>取消</button><button className="primary" disabled={busy || !name.trim() || !root.trim()} onClick={save}><Save size={15} />保存绑定</button></div></dialog>;
}
