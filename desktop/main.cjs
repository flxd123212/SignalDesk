const { app, BrowserWindow, Menu, ipcMain, dialog, shell } = require('electron');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const fs = require('node:fs');
const { prepareExamples } = require('./resources.cjs');
const runtimes = new Set();
const trustedWindows = new Map();
let startServer, examplesDirectory, windowNumber = 0, quitting = false;
app.setName('SignalDesk');
app.setAppUserModelId('com.signaldesk.workbench');
if (process.env.SIGNALDESK_USER_DATA) app.setPath('userData', path.resolve(process.env.SIGNALDESK_USER_DATA));

async function openWindow(existingRuntime, panel) {
  const number = existingRuntime ? 0 : ++windowNumber;
  const directory = number === 1 ? path.join(app.getPath('userData'), 'sessions') : path.join(app.getPath('userData'), 'windows', String(number), 'sessions');
  const runtime = existingRuntime || await startServer({ port: 0, directory, examplesDirectory }); runtimes.add(runtime);
  const window = new BrowserWindow({
    width: panel ? 1100 : 1500, height: panel ? 800 : 980, minWidth: 720, minHeight: 540,
    backgroundColor: '#151719', title: `SignalDesk · 工作区 ${number}`,
    icon: path.join(__dirname, 'assets', 'icon.ico'),
    ...(process.platform === 'win32' ? { titleBarStyle: 'hidden', titleBarOverlay: { color: '#202429', symbolColor: '#cbd3dc', height: 40 } } : {}),
    webPreferences: { preload: path.join(__dirname, 'preload.cjs'), contextIsolation: true, nodeIntegration: false, sandbox: true, devTools: true, backgroundThrottling: false },
  });
  if (process.platform === 'win32') window.removeMenu();
  trustedWindows.set(window.webContents.id, { window, origin: runtime.address, runtime, panel });
  const fullscreenState = () => { if (!window.isDestroyed()) window.webContents.send('desktop:fullscreen', window.isFullScreen()); };
  window.on('enter-full-screen', fullscreenState);
  window.on('leave-full-screen', fullscreenState);
  let htmlFullscreen = false;
  window.on('enter-html-full-screen', () => { htmlFullscreen = true; });
  window.on('leave-html-full-screen', () => { htmlFullscreen = false; });
  window.webContents.on('before-input-event', (event, input) => {
    if (input.type !== 'keyDown') return;
    if (input.control && input.shift && input.key.toLowerCase() === 'n' && !input.isAutoRepeat) { event.preventDefault(); void openWindow().catch(console.error); return; }
    if (htmlFullscreen && ['Escape', 'F11'].includes(input.key)) { event.preventDefault(); window.webContents.send('desktop:exit-html-fullscreen'); return; }
    if (input.key === 'Escape' && window.isFullScreen()) {
      event.preventDefault(); window.setFullScreen(false);
    } else if (input.key === 'F11' && !input.isAutoRepeat) {
      event.preventDefault(); window.setFullScreen(!window.isFullScreen());
    }
  });
  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  window.webContents.on('will-navigate', (event, url) => { if (new URL(url).origin !== runtime.address) event.preventDefault(); });
  const contentsId = window.webContents.id;
  window.on('closed', () => { trustedWindows.delete(contentsId); if (![...trustedWindows.values()].some(entry => entry.runtime === runtime) && runtimes.delete(runtime)) void runtime.close(); });
  await window.loadURL(panel ? `${runtime.address}/?view=${panel}&detached=1` : runtime.address);
}

app.whenReady().then(async () => {
  const templates = app.isPackaged ? path.join(process.resourcesPath, 'firmware-examples') : path.join(__dirname, '..', 'firmware-examples');
  examplesDirectory = await prepareExamples(templates, app.getPath('userData'));
  const trustedWindow = event => {
    const entry = trustedWindows.get(event.sender.id);
    if (!entry || event.senderFrame !== event.sender.mainFrame || new URL(event.senderFrame.url).origin !== entry.origin) throw new Error('Untrusted desktop caller');
    return entry.window;
  };
  ipcMain.handle('desktop:fullscreen:get', event => trustedWindow(event).isFullScreen());
  ipcMain.handle('desktop:new-window', async event => { trustedWindow(event); await openWindow(); });
  ipcMain.handle('desktop:close-window', event => trustedWindow(event).close());
  ipcMain.handle('desktop:native-menu', (event, kind) => {
    const window = trustedWindow(event);
    const index = { edit: 1, view: 2 }[kind];
    if (index === undefined) throw new Error('Unknown menu');
    Menu.getApplicationMenu()?.items[index]?.submenu?.popup({ window });
  });
  const preferencesPath = path.join(app.getPath('userData'), 'preferences.json');
  ipcMain.on('desktop:preferences:read', event => {
    let preferences = null;
    if (trustedWindows.has(event.sender.id)) {
      try { preferences = JSON.parse(fs.readFileSync(preferencesPath, 'utf8')); } catch { /* First run uses defaults. */ }
    }
    event.returnValue = preferences;
  });
  ipcMain.handle('desktop:preferences:save', (event, preferences) => {
    trustedWindow(event);
    const value = JSON.stringify(preferences);
    if (value.length > 32768 || !preferences || typeof preferences !== 'object') throw new Error('Invalid preferences');
    fs.writeFileSync(preferencesPath + '.tmp', value); fs.renameSync(preferencesPath + '.tmp', preferencesPath);
    for (const entry of trustedWindows.values()) if (entry.window.webContents.id !== event.sender.id) entry.window.webContents.send('desktop:preferences', preferences);
  });
  ipcMain.handle('desktop:open-panel', async (event, panel) => {
    trustedWindow(event);
    if (!['workspace', 'terminal', 'editor', 'agent', 'attitude', 'graph', 'can', 'commands', 'widgets', 'script', 'instruments', 'sessions', 'frames', 'automation', 'alarms', 'chips', 'overview', 'logs', 'external'].includes(panel)) throw new Error('Unknown work page');
    const entry = trustedWindows.get(event.sender.id);
    const existing = [...trustedWindows.values()].find(item => item.runtime === entry.runtime && item.panel === panel);
    if (existing) { if (existing.window.isMinimized()) existing.window.restore(); existing.window.focus(); return; }
    await openWindow(entry.runtime, panel);
  });
  ipcMain.handle('desktop:bluetooth-settings', async event => { trustedWindow(event); if (process.platform !== 'win32') throw new Error('请在系统设置中配对蓝牙设备'); await shell.openExternal('ms-settings:bluetooth'); });
  ipcMain.handle('desktop:fullscreen:toggle', event => { const window = trustedWindow(event); window.setFullScreen(!window.isFullScreen()); });
  ipcMain.handle('desktop:choose-directory', async (event, initial) => {
    const window = trustedWindow(event);
    const result = await dialog.showOpenDialog(window, { title: '选择固件工程目录', defaultPath: typeof initial === 'string' && path.isAbsolute(initial) ? initial : undefined, properties: ['openDirectory'] });
    return result.canceled ? null : result.filePaths[0];
  });
  ({ startServer } = await import(pathToFileURL(path.join(__dirname, '../server/index.mjs')).href));
  Menu.setApplicationMenu(Menu.buildFromTemplate([
    { label: '文件', submenu: [{ label: '新建独立工作区窗口', accelerator: 'CmdOrCtrl+Shift+N', click: () => openWindow().catch(console.error) }, { role: 'close', label: '关闭当前窗口' }, { role: 'quit', label: '退出全部窗口' }] },
    { label: '编辑', submenu: [{ role: 'undo', label: '撤销' }, { role: 'redo', label: '重做' }, { type: 'separator' }, { role: 'cut', label: '剪切' }, { role: 'copy', label: '复制' }, { role: 'paste', label: '粘贴' }, { role: 'selectAll', label: '全选' }] },
    { label: '视图', submenu: [{ role: 'reload', label: '重新加载' }, { role: 'togglefullscreen', label: '切换全屏', accelerator: 'F11' }, { label: '退出全屏 (Esc)', click: (_item, window) => window?.setFullScreen(false) }, { role: 'resetZoom', label: '实际大小' }, { role: 'zoomIn', label: '放大' }, { role: 'zoomOut', label: '缩小' }] },
  ]));
  await openWindow();
}).catch(error => {
  console.error(error);
  try { fs.mkdirSync(app.getPath('userData'), { recursive: true }); fs.appendFileSync(path.join(app.getPath('userData'), 'startup-error.log'), `${new Date().toISOString()} ${error.stack || error}\n`); } catch { /* Preserve the original failure. */ }
  dialog.showErrorBox('SignalDesk 启动失败', `${error.message}\n\n日志目录：${app.getPath('userData')}`); app.quit();
});
app.on('window-all-closed', () => app.quit());
app.on('before-quit', event => {
  if (quitting || !runtimes.size) return;
  event.preventDefault(); quitting = true;
  const running = [...runtimes]; runtimes.clear();
  Promise.allSettled(running.map(runtime => runtime.close())).finally(() => app.quit());
});
