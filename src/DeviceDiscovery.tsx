import { useEffect, useRef, useState } from 'react';
import { Cable, Check, FolderPlus, Plug, RefreshCw, X } from 'lucide-react';
import { api, refreshPorts, usePorts } from './data';
import { Field, IconButton } from './ui';
import { getPreferences, setPreferences, usePreferences } from './preferences';
import type { AppState, Port, PortSnapshot } from './types';
import './discovery.css';

const identity = (port: Port) => JSON.stringify([port.path, port.identification?.key || '', port.vendorId || '', port.productId || '']);
export function DeviceDiscovery({ state, online, detached, addProject, notify }: { state: AppState; online: boolean; detached: boolean; addProject: () => void; notify: (message: string, error?: boolean) => void }) {
  const [opened, setOpened] = useState<{ path: string; automatic: boolean } | null>(null);
  const queued = useRef<string[]>([]), latestPorts = usePorts(), latest = useRef(latestPorts);
  latest.current = latestPorts;
  useEffect(() => {
    const manual = () => { queued.current = []; setOpened({ path: '', automatic: false }); };
    const change = (event: Event) => {
      if (detached || !getPreferences().devicePopup) return;
      const value = (event as CustomEvent<PortSnapshot>).detail;
      queued.current = [...new Set([...queued.current, ...(value.added || []).map(port => port.path)])];
    };
    const timer = setInterval(() => {
      if (!getPreferences().devicePopup) { queued.current = []; return; }
      queued.current = queued.current.filter(path => latest.current.ports.some(port => port.path === path));
      if (!queued.current.length || document.querySelector('dialog[open], [role="dialog"], [role="menu"]') || document.fullscreenElement) return;
      const path = queued.current[0]; queued.current = []; setOpened({ path, automatic: true });
    }, 400);
    window.addEventListener('signaldesk-discover-devices', manual); window.addEventListener('signaldesk-port-change', change);
    return () => { clearInterval(timer); window.removeEventListener('signaldesk-discover-devices', manual); window.removeEventListener('signaldesk-port-change', change); };
  }, [detached]);
  return opened && <DiscoveryDialog state={state} online={online} initial={opened.path} automatic={opened.automatic} close={() => { queued.current = []; setOpened(null); }} addProject={() => { queued.current = []; setOpened(null); addProject(); }} notify={notify} />;
}

function DiscoveryDialog({ state, online, initial, automatic, close, addProject, notify }: { state: AppState; online: boolean; initial: string; automatic: boolean; close: () => void; addProject: () => void; notify: (message: string, error?: boolean) => void }) {
  const dialog = useRef<HTMLDialogElement>(null), snapshot = usePorts(), prefs = usePreferences();
  const [selected, setSelected] = useState(() => snapshot.ports.find(port => port.path === initial) || snapshot.ports[0]);
  const owner = (port?: Port) => state.devices?.find(device => !!port && (device.portBinding?.key && device.portBinding.key === port.identification?.key || device.portBinding?.path === port.path));
  const initialTarget = owner(selected)?.id || (state.devices?.find(device => device.id === state.activeDevice && device.projectRoot && !device.connected)?.id || 'new');
  const [target, setTarget] = useState(initialTarget), [baud, setBaud] = useState(initialTarget === state.activeDevice ? state.config.baudRate : 115200);
  const [protocol, setProtocol] = useState(initialTarget === state.activeDevice ? state.config.protocol : 'raw');
  const [busy, setBusy] = useState(false), [refreshing, setRefreshing] = useState(false), [error, setError] = useState('');
  const expectedActive = useRef(state.activeDevice), active = state.devices?.find(device => device.id === target);
  const root = useRef(active?.projectRoot || '');
  const port = snapshot.ports.find(item => selected && identity(item) === identity(selected));
  useEffect(() => { const previous = document.activeElement; dialog.current?.showModal(); return () => { if (previous instanceof HTMLElement && previous.isConnected) previous.focus(); }; }, []);
  useEffect(() => { if (!selected && snapshot.ports.length) setSelected(snapshot.ports[0]); }, [snapshot.ports, selected]);
  const chooseTarget = (id: string) => {
    const device = state.devices?.find(item => item.id === id); setTarget(id); root.current = device?.projectRoot || '';
    const config = id === state.activeDevice ? state.config : device?.projectProfile?.serial;
    setBaud(config?.baudRate || 115200); setProtocol(config?.protocol || 'raw'); setError('');
  };
  const refresh = async () => { setRefreshing(true); setError(''); try { await refreshPorts(); } catch (error) { setError((error as Error).message); } finally { setRefreshing(false); } };
  const stale = expectedActive.current !== state.activeDevice || target !== 'new' && (!active || active.projectRoot !== root.current);
  const occupied = active?.connected || active?.busy || active?.recording;
  const disabled = busy || !online || !port || !!snapshot.error || stale || !!occupied || !Number.isInteger(baud) || baud < 50 || baud > 12000000;
  const attach = async (connect: boolean) => {
    if (disabled || !port) return; setBusy(true); setError('');
    try {
      await api('/ports/attach', { expectedActiveDevice: expectedActive.current, deviceId: target === 'new' ? undefined : target, expectedRoot: root.current, path: port.path, identity: identity(port), baudRate: baud, protocol, connect });
      close(); notify(`${port.path} ${connect ? '已连接' : '已绑定'}`);
    } catch (error) { setError((error as Error).message); } finally { setBusy(false); }
  };
  return <dialog ref={dialog} className="discovery-dialog" aria-label="发现设备" onCancel={event => { if (busy) event.preventDefault(); else close(); }}>
    <header><Cable size={19} /><h2>{automatic ? '发现新设备' : '发现设备'}</h2><span>{snapshot.ports.length} 个串口</span><IconButton title="关闭设备发现" disabled={busy} onClick={close}><X size={18} /></IconButton></header>
    <div className="discovery-body"><div className="discovery-toolbar"><span>{snapshot.error ? '检测失败' : !snapshot.initialized ? '正在检测系统串口' : '系统串口'}</span><button className="quiet-button" disabled={refreshing || busy || !online} onClick={() => void refresh()}><RefreshCw size={14} className={refreshing ? 'spin' : ''} />重新检测</button></div>
      {snapshot.error && <p role="alert" className="discovery-error">{snapshot.error}。以下为上次检测结果。</p>}
      <div className="discovery-port-list" role="listbox" aria-label="发现的串口">{snapshot.ports.map(item => <button role="option" aria-selected={!!selected && identity(item) === identity(selected)} key={identity(item)} disabled={busy} onClick={() => { setSelected(item); const bound = owner(item); if (bound) chooseTarget(bound.id); setError(''); }}><Plug size={17} /><span><strong>{item.path}</strong><small>{item.friendlyName || item.identification?.interface || item.manufacturer || '串口接口'}</small></span>{owner(item) && <em>{owner(item)?.name}</em>}{selected && identity(item) === identity(selected) && <Check size={16} />}</button>)}</div>
      {!snapshot.ports.length && snapshot.initialized && !snapshot.error && <div className="discovery-empty"><Cable size={30} /><h3>系统尚未提供可用串口</h3><p>请检查设备供电、USB 数据线和系统设备管理器中的端口。未枚举为 COM 的 USB 设备暂不在此列表中。</p></div>}
      {selected && <><dl className="discovery-identity"><dt>接口</dt><dd>{selected.identification?.interface || '串口'}</dd><dt>芯片 / 开发板</dt><dd>{selected.identification?.board || selected.identification?.chip || '未确认'}{!selected.identification?.chip && <small>USB 转串口接口不能确定下游芯片型号</small>}</dd><dt>USB 标识</dt><dd>{selected.vendorId || '--'} : {selected.productId || '--'}</dd><dt>设备序列号</dt><dd>{selected.serialNumber || '未提供，仅按端口绑定'}</dd></dl>
        {!port && <p role="alert" className="discovery-error">所选串口已移除或身份变化，请重新选择。</p>}
        <Field label="绑定到设备与工程"><select aria-label="发现设备绑定目标" disabled={busy} value={target} onChange={event => chooseTarget(event.target.value)}><option value="new">新建设备</option>{state.devices?.map(device => <option key={device.id} value={device.id}>{device.name}{device.projectRoot ? ` · ${device.projectRoot.split(/[\\/]/).pop()}` : ''}{device.connected ? ' · 已连接' : ''}</option>)}</select></Field>
        {active?.projectRoot && <p className="discovery-project" title={active.projectRoot}>{active.projectRoot}</p>}
        <div className="field-grid"><Field label="波特率"><input aria-label="发现设备波特率" type="number" min="50" max="12000000" value={baud} disabled={busy} onChange={event => setBaud(Number(event.target.value))} /></Field><Field label="数据格式"><select aria-label="发现设备数据格式" value={protocol} disabled={busy} onChange={event => setProtocol(event.target.value)}><option value="raw">Raw · 原始数据</option><option value="firewater">FireWater / CSV</option><option value="justfloat">JustFloat</option><option value="json">JSON</option>{protocol === 'custom' && <option value="custom">工程自定义帧</option>}</select></Field></div>
        {occupied && <p className="discovery-error">目标设备正在使用，请先断开或选择“新建设备”。</p>}
        {stale && <p role="alert" className="discovery-error">设备或工程已切换，请重新打开此弹窗。</p>}
      </>}
      {error && <p role="alert" className="discovery-error">{error}</p>}
      <label className="checkbox discovery-preference"><input type="checkbox" checked={prefs.devicePopup} onChange={event => setPreferences({ devicePopup: event.target.checked })} />插入新串口时弹窗</label>
    </div><footer><button className="quiet-button" disabled={busy} onClick={addProject}><FolderPlus size={15} />添加工程</button><div><button className="quiet-button" disabled={disabled} onClick={() => void attach(false)}>仅绑定</button><button className="primary" disabled={disabled} onClick={() => void attach(true)}><Plug size={15} />{busy ? '处理中' : '绑定并连接'}</button></div></footer>
  </dialog>;
}
