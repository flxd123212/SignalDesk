import { useEffect, useRef, useState } from 'react';
import { Bot, Check, Cpu, FileCode2, FolderOpen, FolderPlus, Plug, RefreshCw, Wrench, X } from 'lucide-react';
import { api } from './data';
import { Field, IconButton } from './ui';

type Candidate = { path: string; chip: string; interface: string; reason: string; blocked: string; key: string };
type Target = { id: string; name: string; label: string; kind: string; root: string; entryFile: string; chip: string; board: string; serial: { baudRate: number; sampleRate: number; protocol: string }; toolchain: { buildPreset: string; fqbn?: string }; tool: { available: boolean; message: string; executable: string }; command: string; ports: Candidate[]; recommendedPort: string; existingDeviceId: string; evidence: string[]; warnings: string[] };
type Plan = { id: string; targets: Target[]; recommendedTarget: string; warnings: string[]; scannedFiles: number; ai: { configured: boolean; model: string; apiStyle: string } };
export type SetupResult = { deviceId: string; connected: boolean; reused?: boolean; protocol: string; warnings: string[] };

export function ProjectSetupDialog({ close, completed, initialRoot = '' }: { close: () => void; completed: (result: SetupResult) => void; initialRoot?: string }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [root, setRoot] = useState(initialRoot), [plan, setPlan] = useState<Plan | null>(null), [targetId, setTargetId] = useState('');
  const [port, setPort] = useState(''), [name, setName] = useState(''), [connect, setConnect] = useState(true), [reuseAI, setReuseAI] = useState(true), [newDevice, setNewDevice] = useState(false);
  const [serial, setSerial] = useState({ baudRate: 115200, sampleRate: 200, protocol: 'raw' }), [fqbn, setFqbn] = useState(''), [busy, setBusy] = useState(false), [error, setError] = useState('');
  const target = plan?.targets.find(item => item.id === targetId), candidate = target?.ports.find(item => item.path === port), reuse = !!target?.existingDeviceId && !newDevice;
  useEffect(() => { const previous = document.activeElement as HTMLElement | null; dialog.current?.showModal(); return () => previous?.focus(); }, []);
  const chooseTarget = (target?: Target) => { setTargetId(target?.id || ''); setPort(target?.recommendedPort || ''); setName(target?.name.slice(0, 40) || ''); setConnect(true); setNewDevice(false); if (target) setSerial({ baudRate: target.serial.baudRate, sampleRate: target.serial.sampleRate, protocol: target.serial.protocol }); setFqbn(target?.toolchain.fqbn || ''); };
  const scan = async (path = root) => {
    setBusy(true); setError(''); setPlan(null);
    try { const result = await api<Plan>('/projects/prepare', { root: path.trim() }); setPlan(result); chooseTarget(result.targets.find(item => item.id === result.recommendedTarget)); setReuseAI(result.ai.configured); }
    catch (error) { setError((error as Error).message); } finally { setBusy(false); }
  };
  const browse = async () => { try { const selected = await window.signaldeskDesktop!.chooseDirectory(root); if (selected) { setRoot(selected); await scan(selected); } } catch (error) { setError((error as Error).message); } };
  const apply = async () => {
    if (!plan || !target) return;
    setBusy(true); setError('');
    try { const result = await api<SetupResult>('/projects/apply', { id: plan.id, targetId, name, port, serial, connect: !!port && connect, reuseAI, newDevice, ...(target.kind === 'arduino' ? { fqbn } : {}) }); completed(result); }
    catch (error) { setError((error as Error).message); } finally { setBusy(false); }
  };
  return <dialog ref={dialog} className="project-setup-dialog" aria-label="添加项目" onCancel={event => { if (busy) event.preventDefault(); else close(); }} onClose={close}>
    <div className="panel-toolbar"><div className="panel-title"><FolderPlus size={17} />添加项目</div><IconButton title="关闭项目导入" disabled={busy} onClick={close}><X size={17} /></IconButton></div>
    <div className="project-setup-body"><fieldset disabled={busy}>
      <div className="setup-path"><Field label="工程目录或工程文件"><input autoFocus aria-label="导入工程路径" placeholder="D:\Projects\MyDevice" value={root} onChange={event => { setRoot(event.target.value); setPlan(null); setError(''); }} onKeyDown={event => { if (event.key === 'Enter' && !event.nativeEvent.isComposing && root.trim()) void scan(); }} /></Field>{window.signaldeskDesktop && <IconButton title="浏览项目目录" onClick={browse}><FolderOpen size={18} /></IconButton>}<IconButton title="重新识别项目" disabled={!root.trim()} onClick={() => void scan()}><RefreshCw size={16} /></IconButton></div>
      {plan && <><Field label={`工程目标 · ${plan.scannedFiles} 个文件已扫描`}><select aria-label="导入工程目标" value={targetId} onChange={event => chooseTarget(plan.targets.find(item => item.id === event.target.value))}><option value="" disabled>选择构建目标</option>{plan.targets.map(item => <option key={item.id} value={item.id}>{item.name} / {item.label} · {item.kind}</option>)}</select></Field>
        {target && <><div className="setup-summary"><div><Cpu size={16} /><span>芯片 / 开发板</span><strong>{target.chip || '待确认'}</strong><small>{target.board || '未识别开发板'}</small></div><div><Wrench size={16} /><span>构建工具</span><strong>{target.toolchain.buildPreset === 'none' ? '待配置' : target.toolchain.buildPreset}</strong><small className={target.tool.available ? '' : 'warning'} title={target.tool.message}>{target.tool.available ? '已发现工具' : '工具需配置'}</small></div><div><FileCode2 size={16} /><span>主文件</span><strong title={target.entryFile}>{target.entryFile || '未识别'}</strong><small>{target.label}</small></div></div>
          {target.existingDeviceId && <div className="setup-existing"><Check size={15} />已导入此工程目标<label className="checkbox"><input type="checkbox" checked={newDevice} onChange={event => setNewDevice(event.target.checked)} />为另一块板新建设备</label></div>}
          {!reuse && <><Field label="匹配串口"><select aria-label="项目匹配串口" value={port} onChange={event => setPort(event.target.value)}><option value="">暂不绑定 · 离线项目</option>{target.ports.map(item => <option key={item.path} value={item.path} disabled={!!item.blocked}>{item.path} · {item.chip || item.interface}{item.blocked ? ` · ${item.blocked}` : ''}</option>)}</select></Field><div className="setup-port-reason"><Plug size={14} /><span>{candidate ? `${candidate.reason} · ${candidate.key ? '按 USB 身份跟踪 COM 号' : '固定端口，无唯一身份'}` : target.ports.length ? '可选择串口后连接，也可先查看工程' : '未发现串口；可先查看工程与源码'}</span></div>
          <label className="checkbox"><input type="checkbox" checked={!!port && connect} disabled={!port} onChange={event => setConnect(event.target.checked)} />添加后连接 {port}</label>
          <label className="checkbox setup-ai"><Bot size={14} /><input type="checkbox" checked={reuseAI && plan.ai.configured} disabled={!plan.ai.configured} onChange={event => setReuseAI(event.target.checked)} />{plan.ai.configured ? `复用 AI 接口 · ${plan.ai.model}` : 'AI 接口未配置 · 可使用本地体检'}</label>
          <details className="setup-details"><summary>核对参数与识别依据</summary><Field label="项目设备名称"><input aria-label="导入设备名称" maxLength={40} value={name} onChange={event => setName(event.target.value)} /></Field><div className="field-grid"><Field label="波特率"><input aria-label="导入波特率" type="number" min={50} max={12000000} value={serial.baudRate} onChange={event => setSerial({ ...serial, baudRate: +event.target.value })} /></Field><Field label="配置采样率 / Hz"><input aria-label="导入采样率" type="number" min={1} max={1000000} value={serial.sampleRate} onChange={event => setSerial({ ...serial, sampleRate: +event.target.value })} /></Field></div><Field label="数据格式"><select aria-label="导入协议" value={serial.protocol} onChange={event => setSerial({ ...serial, protocol: event.target.value })}><option value="raw">Raw · 原始字节</option><option value="firewater">FireWater / CSV</option><option value="justfloat">JustFloat</option><option value="json">JSON</option>{serial.protocol === 'custom' && <option value="custom">项目自定义帧</option>}</select></Field>{target.kind === 'arduino' && <Field label="开发板 FQBN"><input aria-label="导入开发板 FQBN" value={fqbn} onChange={event => setFqbn(event.target.value)} placeholder="esp32:esp32:esp32s3" /></Field>}<code>{target.command || '构建命令待配置'}</code><ul>{target.evidence.map((line, index) => <li key={index}>{line}</li>)}</ul><p>{target.tool.message}</p></details></>}
          {[...plan.warnings, ...target.warnings].length > 0 && <div className="setup-warnings">{[...new Set([...plan.warnings, ...target.warnings])].map(line => <p key={line}>{line}</p>)}</div>}
        </>}
      </>}
    </fieldset>{error && <div role="alert" className="inline-error">{error}</div>}</div>
    <div className="setup-footer"><span>{busy ? '正在处理项目…' : target && !reuse ? `${serial.baudRate} baud · ${serial.protocol} · ${serial.sampleRate} Hz` : '项目与设备工作区'}</span><button className="primary" disabled={busy || !root.trim() || !!plan && (!target || !name.trim())} onClick={() => plan ? void apply() : void scan()}>{busy ? <RefreshCw size={15} className="spin" /> : plan ? <Check size={15} /> : <FolderPlus size={15} />}{!plan ? '识别项目' : reuse ? '打开现有项目' : port && connect ? `添加并连接 ${port}` : '添加项目'}</button></div>
  </dialog>;
}
