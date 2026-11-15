import { _electron as electron } from 'playwright';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { electronExecutable, packagedExecutable } from '../desktop/platform.cjs';

const packaged = process.env.SIGNALDESK_TEST_PACKAGED === '1', root = process.cwd();
const executablePath = process.env.SIGNALDESK_TEST_EXE || (packaged ? packagedExecutable(root) : electronExecutable(root));
const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'signaldesk-platform-desktop-'));
const env = { ...process.env, SIGNALDESK_USER_DATA: directory }; delete env.ELECTRON_RUN_AS_NODE;
const launch = () => electron.launch({ executablePath, args: packaged ? [] : [root], cwd: root, env, timeout: 60000 });
let desktop;
try {
  desktop = await launch(); let window = await desktop.firstWindow();
  const waitReady = async () => { await window.locator('.app-shell[data-ready=true]').waitFor(); await window.locator('#signaldesk-startup').waitFor({ state: 'hidden' }); };
  await waitReady();
  assert.equal(await window.evaluate(() => window.signaldeskDesktop.platform), process.platform);
  assert.equal(await desktop.evaluate(({ app }) => app.isPackaged), packaged);
  const origin = new URL(window.url()).origin;
  const ports = await fetch(origin + '/api/ports'); assert.ok(ports.ok); assert.ok(Array.isArray(await ports.json()));
  const widget = await fetch(origin + '/api/widgets/evaluate', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ inputs: [21], code: '{ render(ctx) { return { kind: "number", value: ctx.inputs[0] * 2 }; } }' }) });
  assert.equal((await widget.json()).view.value, 42);
  const modifier = process.platform === 'darwin' ? 'Meta' : 'Control';
  await window.keyboard.press(`${modifier}+Alt+2`); await window.getByRole('region', { name: '硬件工程工作台' }).waitFor();
  await window.keyboard.press(`${modifier}+,`); await window.getByRole('dialog', { name: '设置', exact: true }).waitFor(); await window.keyboard.press('Escape');
  await window.evaluate(async () => window.signaldeskDesktop.savePreferences({ startupAnimation: false, accent: '#87bfff' }));
  const panelEvent = desktop.waitForEvent('window'); await window.evaluate(() => window.signaldeskDesktop.openPanel('workspace'));
  const panel = await panelEvent; await panel.locator('.app-shell[data-ready=true]').waitFor(); assert.equal(new URL(panel.url()).origin, origin);
  await panel.close();
  if (process.platform === 'darwin') {
    await window.close(); const reopened = desktop.waitForEvent('window'); await desktop.evaluate(({ app }) => app.emit('activate')); window = await reopened; await waitReady();
    assert.equal((await window.evaluate(async () => (await fetch('/api/ai/state')).json())).config.root, path.join(directory, 'examples', 'SignalGenerator'));
  }
  await desktop.close(); desktop = await launch(); window = await desktop.firstWindow(); await waitReady();
  assert.equal(await window.evaluate(() => window.signaldeskDesktop.savedPreferences.accent), '#87bfff');
  assert.equal((await window.evaluate(async () => (await fetch('/api/state')).json())).connected, false);
  await fs.mkdir('artifacts', { recursive: true }); await window.screenshot({ path: `artifacts/platform-${process.platform}-${process.arch}${packaged ? '-packaged' : ''}.png` });
  console.log(`${process.platform}/${process.arch}${packaged ? ' package' : ''}: native serial binding, QuickJS, windows, shortcuts and restart passed.`);
} finally { await desktop?.close(); await fs.rm(directory, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 }); }
