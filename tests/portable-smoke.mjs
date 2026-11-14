import { chromium } from 'playwright';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import net from 'node:net';
import { spawn, execFile } from 'node:child_process';
import { setTimeout as delay } from 'node:timers/promises';

const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'signaldesk-portable-'));
const reservation = net.createServer();
await new Promise(resolve => reservation.listen(0, '127.0.0.1', resolve));
const port = reservation.address().port;
await new Promise(resolve => reservation.close(resolve));
const env = { ...process.env, SIGNALDESK_USER_DATA: directory };
delete env.ELECTRON_RUN_AS_NODE;
const { version } = JSON.parse(await fs.readFile(path.resolve('package.json'), 'utf8'));
const executable = path.resolve(`release/SignalDesk-Portable-${version}-x64.exe`);
const child = spawn(executable, [`--remote-debugging-port=${port}`], { cwd: directory, env, windowsHide: true, stdio: 'ignore' });
let exited = false, launchError, browser;
child.on('error', error => { launchError = error; });
child.on('exit', () => { exited = true; });
try {
  let ready = false;
  // The NSIS wrapper does not forward Node's inspector pipes; attach to Chromium after extraction.
  for (let count = 0; count < 600; count++) {
    if (launchError) throw launchError;
    if (exited) throw new Error('Portable launcher exited before opening the app');
    try { const response = await fetch(`http://127.0.0.1:${port}/json/version`, { signal: AbortSignal.timeout(500) }); if (response.ok) { ready = true; break; } } catch { /* Extraction may still be running. */ }
    await delay(200);
  }
  assert.ok(ready, 'Portable Chromium did not become ready');
  browser = await chromium.connectOverCDP(`http://127.0.0.1:${port}`);
  let window;
  for (let count = 0; count < 100; count++) { window = browser.contexts()[0]?.pages().find(page => page.url().startsWith('http://127.0.0.1:')); if (window) break; await delay(100); }
  assert.ok(window, 'Portable app window not found');
  await window.locator('.uplot canvas').waitFor();
  const data = await window.evaluate(async () => ({ state: await (await fetch('/api/state')).json(), ai: await (await fetch('/api/ai/state')).json() }));
  assert.equal(data.state.connected, false); assert.equal(data.state.config.path, 'unassigned');
  await window.evaluate(async () => fetch('/api/connect', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ path: 'demo' }) }));
  assert.equal(data.ai.config.root, path.join(directory, 'examples', 'SignalGenerator'));
  const initial = await window.locator('.uplot canvas').evaluate(canvas => canvas.toDataURL());
  await window.waitForFunction(value => document.querySelector('.uplot canvas')?.toDataURL() !== value, initial);
  await window.getByRole('button', { name: '打开设置', exact: true }).click();
  await window.getByRole('button', { name: '琥珀金', exact: true }).click();
  await window.getByRole('button', { name: '关闭设置', exact: true }).click();
  assert.equal(JSON.parse(await fs.readFile(path.join(directory, 'preferences.json'), 'utf8')).accent, '#e8bd78');
  await window.screenshot({ path: path.resolve('artifacts/portable-desktop.png') });
  await window.close();
  for (let count = 0; count < 200 && !exited; count++) await delay(100);
  assert.ok(exited, 'Portable launcher did not exit after closing its window');
  console.log('Portable single EXE passed: extraction, isolated user data, moving waveform, settings persistence and clean close.');
} finally {
  await browser?.close();
  if (!exited && child.pid) await new Promise(resolve => execFile('taskkill.exe', ['/PID', String(child.pid), '/T', '/F'], { windowsHide: true }, () => resolve()));
  await fs.rm(directory, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
}
