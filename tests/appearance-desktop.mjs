import { _electron as electron } from 'playwright';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';

const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'signaldesk-appearance-test-'));
const environment = { ...process.env, SIGNALDESK_USER_DATA: directory };
delete environment.ELECTRON_RUN_AS_NODE;
const executablePath = path.resolve(process.env.SIGNALDESK_TEST_EXE || 'node_modules/electron/dist/electron.exe');
let desktop, window;
const launch = async () => {
  desktop = await electron.launch({ executablePath, args: process.env.SIGNALDESK_TEST_EXE ? [] : ['.'], cwd: process.cwd(), env: environment, timeout: 60000 });
  window = await desktop.firstWindow(); await window.locator('.app-shell').waitFor();
  await window.locator('#signaldesk-startup').waitFor({ state: 'hidden' });
};
const close = async () => { const closed = desktop.waitForEvent('close'); await window.close(); await closed; desktop = null; };
try {
  await launch();
  const state = await window.evaluate(async () => {
    const canvas = document.createElement('canvas'); canvas.width = 320; canvas.height = 180;
    const context = canvas.getContext('2d'); context.fillStyle = '#426d64'; context.fillRect(0, 0, 320, 180);
    const id = await window.signaldeskDesktop.saveBackground(canvas.toDataURL('image/webp'));
    const preferences = { ...JSON.parse(localStorage.getItem('signaldesk.preferences.v1') || '{}'), motion: false, startupAnimation: false, accent: '#de897b', backgroundMode: 'image', backgroundImage: id, backgroundDim: 45, backgroundBlur: 2, backgroundFit: 'cover' };
    await window.signaldeskDesktop.savePreferences(preferences);
    const invalid = await window.signaldeskDesktop.readBackground('../../agent-state.json');
    let refused = false; try { await window.signaldeskDesktop.saveBackground('data:image/svg+xml;base64,PHN2Zy8+'); } catch { refused = true; }
    return { id, invalid, refused };
  });
  assert.equal(state.invalid, null); assert.equal(state.refused, true); assert.match(state.id, /^[a-f0-9]{64}$/);
  assert.ok((await fs.stat(path.join(directory, 'appearance/background.webp'))).size > 0);
  assert.ok((await fs.stat(path.join(directory, 'preferences.json'))).size < 2048);
  await close(); await launch();
  assert.equal(await window.locator('.app-shell').getAttribute('data-motion'), 'off');
  assert.equal(await window.locator('.app-shell').evaluate(element => getComputedStyle(element).getPropertyValue('--accent')), '#de897b');
  await window.waitForFunction(() => getComputedStyle(document.querySelector('.workbench-background > div')).backgroundImage.includes('blob:'));
  const restored = await window.evaluate(async id => {
    const data = await window.signaldeskDesktop.readBackground(id);
    const image = new Image(); image.src = data; await image.decode();
    return { width: image.naturalWidth, height: image.naturalHeight };
  }, state.id);
  assert.deepEqual(restored, { width: 320, height: 180 });
  assert.equal(await window.locator('#signaldesk-startup').isVisible(), false);
  await window.screenshot({ path: 'artifacts/theme-desktop-restored.png', animations: 'disabled' });
  await window.evaluate(async id => { await window.signaldeskDesktop.removeBackground('0'.repeat(64)); if (!await window.signaldeskDesktop.readBackground(id)) throw new Error('Wrong ID removed background'); await window.signaldeskDesktop.removeBackground(id); }, state.id);
  await assert.rejects(fs.stat(path.join(directory, 'appearance/background.webp')), { code: 'ENOENT' });
  await close();
  console.log('Desktop appearance: WebP persisted across restart, theme and disabled startup restored, invalid payload/path rejected, removal verified.');
} finally { if (desktop) await desktop.close(); await fs.rm(directory, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 }); }
