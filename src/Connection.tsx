import { useEffect, useState } from 'react';
import { portExample } from './platform';
import { Activity, ChevronDown, Plug, RefreshCw, Unplug, Waves } from 'lucide-react';
import { api, DEFAULT_CONFIG, usePorts, refreshPorts, showDeviceDiscovery } from './data';
import { Field, IconButton } from './ui';
import type { AppState, Config } from './types';
import { DeviceProject } from './ProjectTools';
import { BAUD_RATES } from '../shared/baud-rates.mjs';

export function Connection({ state, online, notify }: { state: AppState; online: boolean; notify: (message: string, error?: boolean) => void }) {
  const [config, setConfig] = useState<Config>(DEFAULT_CONFIG), [loading, setLoading] = useState(false), [details, setDetails] = useState(false);
  const { ports, error: discoveryError } = usePorts();
  useEffect(() => { setConfig(state.config); }, [JSON.stringify(state.config)]);
  const refresh = () => refreshPorts().then(value => { if (value.error) notify(value.error, true); }).catch(error => notify(error.message, true));
  const update = (patch: Partial<Config>) => setConfig(current => ({ ...current, ...patch }));
  const connect = async () => {
    setLoading(true);
    try { if (state.connected) await api('/disconnect', { deviceId: state.activeDevice }); else await api('/connect', { ...config, deviceId: state.activeDevice }); }
    catch (error) { notify((error as Error).message, true); }
    finally { setLoading(false); }
  };
  const signal = async (key: 'dtr' | 'rts', value: boolean) => {
    if (!state.connected) { update({ [key]: value }); return; }
    try { await api('/signals', { dtr: state.config.dtr, rts: state.config.rts, [key]: value }); }
    catch (error) { notify((error as Error).message, true); }
  };
  const locked = state.connected || loading || state.busy;
  const tcp = config.path.startsWith('tcp:');
  const bluetooth = config.transport === 'bluetooth';
  const identification = ports.find(port => port.path === config.path)?.identification;
  const selectProtocol = (protocol: string) => {
    try { update({ protocol, ...(protocol === 'custom' ? { schema: JSON.parse(localStorage.getItem('signaldesk.frame-schema') || 'null') } : {}) }); }
    catch { notify('请先在自定义帧页面保存有效配置', true); }
  };
  return <aside id="connection-settings" className="connection-sidebar" aria-label="设备连接设置">
    <div className="sidebar-heading"><span>设备连接</span><IconButton title="刷新串口列表" onClick={refresh}><RefreshCw size={14} /></IconButton></div>
    <button className="quiet-button discovery-open" onClick={showDeviceDiscovery}><Plug size={14} />发现设备 <span>{ports.length}</span></button>
    {discoveryError && <p className="discovery-error" role="alert">串口检测失败：{discoveryError}</p>}
    <div className="connection-action"><button className={`connect-button ${state.connected ? 'connected' : ''}`} disabled={!online || loading || state.busy || !state.connected && config.path === 'unassigned'} onClick={connect}>{loading || state.busy ? <RefreshCw size={16} className="spin" /> : state.connected ? <Unplug size={16} /> : <Plug size={16} />}{loading || state.busy ? '连接处理中' : state.connected ? '断开连接' : '连接设备'}</button></div>
    <div className="device-indicator"><span className={`status-dot ${state.connected ? 'live' : ''}`} /><div><b>{state.source === 'demo' ? '模拟信号发生器' : state.source === 'replay' ? '会话回放' : state.connected ? state.config.path : '未连接设备'}</b><small>{state.source === 'demo' ? 'SIMULATED DEVICE' : state.source === 'replay' ? 'RECORDED DATA' : state.connected ? 'SERIAL DEVICE' : 'NO CONNECTION'}</small></div>{state.connected && <Activity size={17} />}</div>
    <DeviceProject state={state} notify={notify} />
    <div className="sidebar-section"><Field label="连接方式"><select aria-label="连接方式" value={tcp ? 'tcp' : bluetooth ? 'bluetooth' : 'serial'} disabled={locked} onChange={event => update({ transport: event.target.value === 'bluetooth' ? 'bluetooth' : 'serial', path: event.target.value === 'tcp' ? 'tcp://192.168.1.100:5025' : event.target.value === 'bluetooth' ? ports.find(port => port.identification?.interface.startsWith('Bluetooth'))?.path || '' : 'demo', rtscts: false, dtr: false, rts: false })}><option value="serial">串口 / 模拟设备</option><option value="bluetooth">蓝牙 SPP / 虚拟串口</option><option value="tcp">TCP / 网络仪器</option></select></Field>
      {tcp ? <Field label="TCP 地址"><input aria-label="TCP 地址" value={config.path} disabled={locked} onChange={event => update({ path: event.target.value })} /></Field> : bluetooth ? <><Field label="蓝牙 SPP 串口"><input aria-label="蓝牙串口" list="bluetooth-ports" placeholder={portExample(state.hostPlatform, true)} value={config.path} disabled={locked} onChange={event => update({ path: event.target.value })} /><datalist id="bluetooth-ports">{ports.map(port => <option key={port.path} value={port.path}>{port.identification?.interface} {port.friendlyName}</option>)}</datalist></Field><div className="port-identity"><b>Bluetooth Classic · SPP</b><span>BLE GATT 未适配</span></div>{window.signaldeskDesktop && <button className="quiet-button" onClick={() => window.signaldeskDesktop?.openBluetoothSettings().catch(error => notify(error.message, true))}>蓝牙配对设置</button>}</> : <Field label="串口 / Port"><select aria-label="串口" value={config.path} disabled={locked} onChange={event => update({ path: event.target.value })}><option value="demo">模拟设备 · Demo</option>{ports.map(port => <option key={port.path} value={port.path}>{port.path}{port.manufacturer ? ` · ${port.manufacturer}` : ''}</option>)}{config.path !== 'demo' && !ports.some(port => port.path === config.path) && <option value={config.path}>{config.path === 'unassigned' ? '尚未匹配串口' : `${config.path} · 未发现`}</option>}</select></Field>}
      <Field label="波特率 / Baud"><input aria-label="波特率" title="支持 50..12000000 自定义整数；实际支持范围由串口硬件和驱动决定" type="number" min="50" max="12000000" step="1" list="baud-rates" value={config.baudRate} disabled={locked} onChange={event => update({ baudRate: Number(event.target.value) })} /><datalist id="baud-rates">{BAUD_RATES.map(value => <option key={value} value={value} />)}</datalist></Field>
      {identification && !tcp && <div className="port-identity" title={identification.evidence.join('\n')}><b>{identification.interface}</b><span>{identification.chip || identification.board || 'MCU 型号待确认'}</span></div>}
      {!tcp && <><button className="disclosure" aria-expanded={details} onClick={() => setDetails(!details)}><ChevronDown size={13} className={details ? 'rotated' : ''} />串口参数 · {config.dataBits}{config.parity[0].toUpperCase()}{config.stopBits}</button>{details && <div className="advanced-settings"><div className="field-grid"><Field label="数据位"><select value={config.dataBits} disabled={locked} onChange={event => update({ dataBits: Number(event.target.value) })}>{[5, 6, 7, 8].map(value => <option key={value}>{value}</option>)}</select></Field><Field label="停止位"><select value={config.stopBits} disabled={locked} onChange={event => update({ stopBits: Number(event.target.value) })}>{[1, 1.5, 2].map(value => <option key={value}>{value}</option>)}</select></Field></div>
      <Field label="校验位"><select value={config.parity} disabled={locked} onChange={event => update({ parity: event.target.value })}><option value="none">None · 无校验</option><option value="even">Even · 偶校验</option><option value="odd">Odd · 奇校验</option><option value="mark">Mark</option><option value="space">Space</option></select></Field></div>}</>}
    </div>
    <div className="sidebar-section"><div className="section-label"><Waves size={14} />协议引擎</div><Field label="数据格式"><select aria-label="数据协议" value={config.protocol} disabled={locked} onChange={event => selectProtocol(event.target.value)}><option value="firewater">FireWater / CSV</option><option value="justfloat">JustFloat</option><option value="json">JSON 数组 / 对象</option><option value="raw">Raw · 原始数据</option><option value="custom">自定义二进制帧</option></select></Field><Field label="配置采样率 / Hz"><input aria-label="配置采样率" type="number" min="1" max={config.path === 'demo' ? 2000 : 1000000} value={config.sampleRate} disabled={locked} onChange={event => update({ sampleRate: Number(event.target.value) })} /></Field>
      {details && !bluetooth && <div className="advanced-settings"><label className="checkbox"><input type="checkbox" checked={config.rtscts} disabled={locked} onChange={event => update({ rtscts: event.target.checked })} />RTS / CTS 硬件流控</label><div className="signal-controls"><label className="checkbox" title="部分开发板将 DTR 用于复位或下载模式"><input type="checkbox" checked={config.dtr} disabled={state.connected && state.source !== 'serial'} onChange={event => signal('dtr', event.target.checked)} />DTR</label><label className="checkbox" title="部分开发板将 RTS 用于复位或下载模式"><input type="checkbox" checked={config.rts} disabled={config.rtscts || (state.connected && state.source !== 'serial')} onChange={event => signal('rts', event.target.checked)} />RTS</label></div></div>}
    </div>
    <div className="sidebar-bottom"><div><span className={`status-dot ${online ? 'live' : ''}`} /><span>{online ? '本地服务在线' : '本地服务断开'}</span></div><small>USB-UART / USB CDC</small><div className="buffer-label"><span>显示缓存</span><span>12,000 点</span></div><div className="buffer-meter"><i style={{ width: `${Math.min(100, state.frames / 120)}%` }} /></div></div>
  </aside>;
}
