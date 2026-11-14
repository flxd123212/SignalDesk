import { EventEmitter } from 'node:events';
import net from 'node:net';

export function tcpTarget(value) {
  const url = new URL(value);
  if (url.protocol !== 'tcp:' || !url.hostname || !url.port || url.username || url.password || url.search || url.hash || (url.pathname && url.pathname !== '/')) throw new Error('TCP 地址应为 tcp://主机:端口');
  return { host: url.hostname.replace(/^\[|\]$/g, ''), port: Number(url.port) };
}

export class TcpPort extends EventEmitter {
  constructor({ path }) { super(); this.target = tcpTarget(path); this.isOpen = false; }
  open(callback) {
    let settled = false;
    const complete = error => { if (!settled) { settled = true; callback(error); } };
    const socket = this.socket = net.createConnection(this.target);
    socket.setNoDelay(true);
    const timeout = setTimeout(() => socket.destroy(new Error('TCP 连接超时')), 5000);
    socket.once('connect', () => { clearTimeout(timeout); this.isOpen = true; complete(); });
    socket.on('data', bytes => this.emit('data', bytes));
    socket.on('error', error => { complete(error); this.emit('error', error); });
    socket.on('close', () => { clearTimeout(timeout); complete(new Error('TCP 连接关闭')); this.isOpen = false; this.emit('close'); });
  }
  set(_signals, callback) { callback(); }
  write(bytes, callback) { this.socket.write(bytes, callback); }
  drain(callback) { callback(); }
  close(callback) { this.socket.destroy(); callback(); }
}
