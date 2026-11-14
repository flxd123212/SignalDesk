import { useState } from 'react';
import { Plus, X } from 'lucide-react';
import { api } from './data';
import { IconButton } from './ui';
import type { AppState } from './types';

export function DeviceTabs({ state, notify }: { state: AppState; notify: (message: string, error?: boolean) => void }) {
  const [busy, setBusy] = useState(false);
  const act = async (url: string, body: object) => { if (busy) return; setBusy(true); try { await api(url, body); } catch (error) { notify((error as Error).message, true); } finally { setBusy(false); } };
  return <div className="device-tabs" role="tablist" aria-label="连接设备">{state.devices?.map((device, index, all) => <div className={device.id === state.activeDevice ? 'active' : ''} key={device.id}>
    <button role="tab" aria-selected={device.id === state.activeDevice} tabIndex={device.id === state.activeDevice ? 0 : -1} title={[device.name, device.connected ? '已连接' : '未连接', device.chip, device.board, device.projectRoot].filter(Boolean).join('\n')} disabled={busy} onClick={() => act('/devices/select', { id: device.id })} onKeyDown={event => {
      if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
      event.preventDefault();
      const next = event.key === 'Home' ? 0 : event.key === 'End' ? all.length - 1 : (index + (event.key === 'ArrowRight' ? 1 : -1) + all.length) % all.length;
      const tab = event.currentTarget.closest('[role="tablist"]')?.querySelectorAll<HTMLButtonElement>('[role="tab"]')[next];
      void act('/devices/select', { id: all[next].id }).then(() => tab?.focus());
    }}><span className={`status-dot ${device.connected ? 'live' : ''}`} /><span className="device-tab-name">{device.name}</span><small>{device.path === 'demo' ? 'DEMO' : device.path}</small>{device.chip && <small className="device-tab-chip">{device.chip}</small>}{device.recording && <span className="status-dot recording" />}</button>
    <IconButton title={`关闭 ${device.name}`} disabled={busy || all.length < 2} onClick={() => act('/devices/remove', { id: device.id })}><X size={12} /></IconButton>
  </div>)}<IconButton title="添加设备" disabled={busy || (state.devices?.length || 0) >= 8} onClick={() => act('/devices/add', {})}><Plus size={16} /></IconButton></div>;
}
