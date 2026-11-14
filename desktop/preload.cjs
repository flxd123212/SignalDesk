const { contextBridge, ipcRenderer } = require('electron');
ipcRenderer.on('desktop:exit-html-fullscreen', () => { if (document.fullscreenElement) void document.exitFullscreen().catch(() => {}); });

contextBridge.exposeInMainWorld('signaldeskDesktop', {
  integratedTitlebar: process.platform === 'win32',
  newWindow: () => ipcRenderer.invoke('desktop:new-window'),
  closeWindow: () => ipcRenderer.invoke('desktop:close-window'),
  nativeMenu: kind => ipcRenderer.invoke('desktop:native-menu', kind),
  savedPreferences: ipcRenderer.sendSync('desktop:preferences:read'),
  savePreferences: value => ipcRenderer.invoke('desktop:preferences:save', value),
  onPreferences: callback => { const handler = (_event, value) => callback(value); ipcRenderer.on('desktop:preferences', handler); return () => ipcRenderer.removeListener('desktop:preferences', handler); },
  chooseDirectory: initial => ipcRenderer.invoke('desktop:choose-directory', initial),
  openBluetoothSettings: () => ipcRenderer.invoke('desktop:bluetooth-settings'),
  openPanel: page => ipcRenderer.invoke('desktop:open-panel', page),
  getFullscreen: () => ipcRenderer.invoke('desktop:fullscreen:get'),
  toggleFullscreen: () => ipcRenderer.invoke('desktop:fullscreen:toggle'),
  onFullscreen: callback => {
    const handler = (_event, value) => callback(value);
    ipcRenderer.on('desktop:fullscreen', handler);
    return () => ipcRenderer.removeListener('desktop:fullscreen', handler);
  },
});
