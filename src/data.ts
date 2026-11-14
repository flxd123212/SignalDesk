import { useEffect, useState, useSyncExternalStore } from 'react';
import type { AppState, Packet, Sample, PortSnapshot } from './types';

export const COLORS = ['#60d6b2', '#eebd70', '#a897ef', '#6cb6ed', '#e98f9b', '#cad479'];
export const DEFAULT_CONFIG = { path: 'unassigned', baudRate: 115200, dataBits: 8, stopBits: 1, parity: 'none', rtscts: false, dtr: false, rts: false, protocol: 'firewater', sampleRate: 200 };
const emptyState: AppState = { connected: false, busy: false, source: 'none', config: DEFAULT_CONFIG, rxBytes: 0, txBytes: 0, frames: 0, parseErrors: 0, processingErrors: 0, dropped: 0, latest: [], names: [], processingMode: 'raw', recording: null, timedSend: null, replay: null };

class DataStore {
  encoding = 'utf-8';
  samples: Sample[] = [];
  packets: Packet[] = [];
  listeners = new Set<() => void>();
  decoders = { RX: new TextDecoder(), TX: new TextDecoder() };
  append(samples: Sample[], packets: Packet[]) {
    if (samples.length) this.samples = this.samples.concat(samples).slice(-12000);
    if (packets.length) this.packets = this.packets.concat(packets.map(packet => {
      const bytes = Uint8Array.from(atob(packet.data), character => character.charCodeAt(0));
      return { ...packet, text: this.decoders[packet.dir].decode(bytes, { stream: true }).replace(/\r\n/g, '\n').replace(/\r/g, '\n'), hex: Array.from(bytes, byte => byte.toString(16).padStart(2, '0').toUpperCase()).join(' ') };
    })).slice(-1000);
    this.notify();
  }
  setEncoding(encoding: string) {
    this.encoding = encoding; this.decoders = { RX: new TextDecoder(encoding), TX: new TextDecoder(encoding) };
    const packets = this.packets; this.packets = []; this.append([], packets);
  }
  clear() { this.samples = []; this.packets = []; this.decoders = { RX: new TextDecoder(this.encoding), TX: new TextDecoder(this.encoding) }; this.notify(); }
  clearLogs() { this.packets = []; this.notify(); }
  notify() { this.listeners.forEach(listener => listener()); }
  subscribe = (listener: () => void) => { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; };
}
export const dataStore = new DataStore();

let portsState: PortSnapshot = { ports: [], initialized: false, revision: 0, checkedAt: null, error: '' };
const portListeners = new Set<() => void>();
const subscribePorts = (listener: () => void) => { portListeners.add(listener); return () => { portListeners.delete(listener); }; };
function setPortsState(value: PortSnapshot) { portsState = value; portListeners.forEach(listener => listener()); }
export const usePorts = () => useSyncExternalStore(subscribePorts, () => portsState);
export async function refreshPorts() { const value = await api<PortSnapshot>('/ports/state'); setPortsState(value); return value; }
export const showDeviceDiscovery = () => window.dispatchEvent(new CustomEvent('signaldesk-discover-devices'));

export async function api<T = AppState>(url: string, body?: unknown): Promise<T> {
  const response = await fetch(`/api${url}`, body === undefined ? undefined : { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || '请求失败');
  return data;
}

export function useDevice(onNotice: (message: string, error?: boolean) => void) {
  const [state, setState] = useState<AppState>(emptyState);
  const [online, setOnline] = useState(false);
  useEffect(() => {
    let socket: WebSocket, retry: ReturnType<typeof setTimeout>, disposed = false;
    const connect = () => {
      socket = new WebSocket(`${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/stream`);
      socket.onopen = () => { setOnline(true); dataStore.clear(); };
      socket.onmessage = event => {
        const message = JSON.parse(event.data);
        if (message.type === 'state') setState(message.state);
        else if (message.type === 'ports') { setPortsState(message.state); window.dispatchEvent(new CustomEvent('signaldesk-port-change', { detail: message.state })); }
        else if (message.type === 'batch') dataStore.append(message.samples, message.packets);
        else if (message.type === 'reset') dataStore.clear();
        else if (message.type === 'notice') onNotice(message.message, message.level === 'error');
        else if (message.type === 'alarm') {
          window.dispatchEvent(new CustomEvent('signaldesk-alarm', { detail: message.event }));
          if (message.event.kind !== 'recovered') {
            const text = `${message.event.deviceName}: ${message.event.message}`;
            onNotice(text, true);
            if (localStorage.getItem('signaldesk.alarm-notifications') === 'true' && typeof Notification !== 'undefined' && Notification.permission === 'granted') {
              try { new Notification('SignalDesk 设备报警', { body: text, tag: message.event.id }); } catch { /* In-app notification remains available. */ }
            }
          }
        }
        else if (message.type === 'ai') window.dispatchEvent(new CustomEvent('signaldesk-ai', { detail: message.state }));
      };
      socket.onclose = () => { setOnline(false); if (!disposed) retry = setTimeout(connect, 1500); };
    };
    connect();
    return () => { disposed = true; clearTimeout(retry); socket?.close(); };
  }, [onNotice]);
  return { state, online };
}

export function useDataRevision() {
  const [revision, setRevision] = useState(0);
  useEffect(() => dataStore.subscribe(() => setRevision(value => value + 1)), []);
  return revision;
}

export function download(name: string, content: string, type = 'text/plain;charset=utf-8') {
  const url = URL.createObjectURL(new Blob([content], { type }));
  const anchor = document.createElement('a'); anchor.href = url; anchor.download = name; anchor.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function downloadPacketBytes(packets: Packet[], direction: 'RX' | 'TX') {
  const parts = packets.filter(packet => packet.dir === direction).map(packet => Uint8Array.from(atob(packet.data), character => character.charCodeAt(0)));
  const url = URL.createObjectURL(new Blob(parts, { type: 'application/octet-stream' }));
  const anchor = document.createElement('a'); anchor.href = url; anchor.download = `serial-${direction}-${Date.now()}.bin`; anchor.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function exportCSV(names: string[], samples: Sample[] = dataStore.samples) {
  const escape = (text: string) => '"' + text.replaceAll('"', '""') + '"';
  download(`signaldesk-${Date.now()}.csv`, ['time_s,' + names.map(escape).join(','), ...samples.map(sample => [sample.time, ...sample.values].join(','))].join('\r\n'), 'text/csv;charset=utf-8');
}

export function formatBytes(value: number) {
  if (value < 1024) return `${value} B`;
  if (value < 1024 ** 2) return `${(value / 1024).toFixed(1)} KiB`;
  return `${(value / 1024 ** 2).toFixed(2)} MiB`;
}

export function number(value: number | undefined, precision = 3) {
  return value !== undefined && Number.isFinite(value) ? value.toFixed(precision) : '--';
}

export function measure(samples: Sample[], channel: number) {
  const points = samples.slice(-2048).filter(sample => Number.isFinite(sample.values[channel]));
  if (!points.length) return { min: NaN, max: NaN, mean: NaN, rms: NaN, vpp: NaN, frequency: NaN };
  const values = points.map(sample => sample.values[channel]);
  const min = Math.min(...values), max = Math.max(...values), mean = values.reduce((sum, value) => sum + value, 0) / values.length;
  const crossings: number[] = [];
  for (let index = 1; index < values.length; index++) {
    if (values[index - 1] < mean && values[index] >= mean) {
      const fraction = (mean - values[index - 1]) / (values[index] - values[index - 1]);
      crossings.push(points[index - 1].time + fraction * (points[index].time - points[index - 1].time));
    }
  }
  return { min, max, mean, rms: Math.sqrt(values.reduce((sum, value) => sum + value * value, 0) / values.length), vpp: max - min, frequency: crossings.length > 1 && max - min > 1e-8 ? (crossings.length - 1) / (crossings.at(-1)! - crossings[0]) : NaN };
}
