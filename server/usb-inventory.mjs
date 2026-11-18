import fs from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import path from 'node:path';

const run = promisify(execFile);
const id = value => String(value || '').match(/(?:0x)?([0-9a-f]{4})/i)?.[1].toLowerCase();

export function classifyUsb({ vid, pid, name = '', instance = '' }) {
  const vendor = id(vid), product = id(pid);
  if (!vendor || !product) return null;
  const pair = `${vendor}:${product}`;
  let label, kind;
  if (pair === '0483:df11') [label, kind] = ['STM32 系列 DFU', 'USB DFU'];
  else if (['2e8a:0003', '2e8a:000f'].includes(pair)) [label, kind] = [pair.endsWith('0003') ? 'RP2040 BOOTSEL' : 'RP2350 BOOTSEL', 'UF2 启动盘'];
  else if (vendor === '0483' && (/ST-?LINK/i.test(name) || ['3744', '3748', '374b', '374d', '374e', '374f', '3753', '3754'].includes(product))) [label, kind] = ['ST-LINK', 'SWD / JTAG 探针'];
  else if (vendor === '1366' && /J-Link/i.test(name)) [label, kind] = ['SEGGER J-Link', 'SWD / JTAG 探针'];
  else if (/CMSIS.DAP|DAPLink/i.test(name)) [label, kind] = ['CMSIS-DAP', '调试探针'];
  else if (pair === '303a:1001') [label, kind] = ['Espressif USB Serial/JTAG', '原生 USB'];
  else if (/bootloader|DFU|UF2/i.test(name)) [label, kind] = [name, '固件描述符'];
  else return null;
  return { key: `${pair}/${instance}`, vid: vendor, pid: product, name: label, kind, descriptor: name };
}

export function windowsUsb(rows) {
  return [rows].flat().flatMap(row => {
    const match = /^USB\\VID_([\da-f]{4})&PID_([\da-f]{4})([^\\]*)\\(.+)$/i.exec(row?.InstanceId || '');
    if (!match || /&MI_/.test(match[3])) return [];
    return [{ vid: match[1], pid: match[2], instance: match[4], name: row.FriendlyName }];
  });
}

export function macUsb(tree) {
  const rows = [];
  function visit(items) {
    for (const item of items || []) {
      if (item.vendor_id && item.product_id) rows.push({ vid: item.vendor_id, pid: item.product_id, name: item._name, instance: item.location_id || item.serial_num });
      visit(item._items);
    }
  }
  visit(tree.SPUSBDataType);
  return rows;
}

async function enumerate() {
  const opts = { timeout: 12000, windowsHide: true, maxBuffer: 4 * 1024 * 1024 };
  if (process.platform === 'win32') {
    const sys = path.win32.join(process.env.SystemRoot || 'C:\\Windows', 'System32');
    try {
      const { stdout } = await run(path.win32.join(sys, 'pnputil.exe'), ['/enum-devices', '/connected', '/bus', 'USB'], opts);
      const rows = stdout.split(/\r?\n\s*\r?\n/).flatMap(block => {
        const instance = block.match(/USB\\VID_[^\s]+/i)?.[0];
        return instance ? [{ InstanceId: instance, FriendlyName: block.split(/\r?\n/)[1]?.replace(/^[^:：]*[:：]\s*/, '') || '' }] : [];
      });
      return windowsUsb(rows);
    } catch { /* Older Windows builds may lack the bus filter. */ }
    const cmd = `$ErrorActionPreference='Stop'; [Console]::OutputEncoding=[Text.UTF8Encoding]::new($false); Get-PnpDevice -PresentOnly | Where-Object { $_.InstanceId -like 'USB\\VID_*' } | Select-Object InstanceId,FriendlyName | ConvertTo-Json -Compress`;
    let stdout;
    try { ({ stdout } = await run(path.win32.join(process.env.SystemRoot || 'C:\\Windows', 'System32/WindowsPowerShell/v1.0/powershell.exe'), ['-NoProfile', '-NonInteractive', '-Command', cmd], opts)); }
    catch { throw new Error('Windows USB 设备枚举失败，请检查设备管理器和本机 WMI 服务权限'); }
    return windowsUsb(JSON.parse(stdout.trim() || '[]'));
  }
  if (process.platform === 'darwin') {
    const { stdout } = await run('/usr/sbin/system_profiler', ['SPUSBDataType', '-json'], opts);
    return macUsb(JSON.parse(stdout));
  }
  const base = '/sys/bus/usb/devices';
  return Promise.all((await fs.readdir(base)).filter(entry => /^\d+-[\d.]+$/.test(entry)).map(async instance => {
    const read = key => fs.readFile(path.join(base, instance, key), 'utf8').then(s => s.trim()).catch(() => '');
    const [vid, pid, name] = await Promise.all(['idVendor', 'idProduct', 'product'].map(read));
    return { vid, pid, name, instance };
  }));
}

export function usbScanner(list = enumerate) {
  let pending, last = 0;
  return () => {
    if (pending && Date.now() - last < 5000) return pending;
    last = Date.now();
    pending = list().then(rows => rows.map(classifyUsb).filter(Boolean));
    return pending;
  };
}
export const scanHostUsb = usbScanner();
