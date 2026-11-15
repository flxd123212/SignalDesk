const path = require('node:path');

function windowChrome(platform = process.platform) {
  if (platform === 'darwin') return { titleBarStyle: 'hiddenInset', trafficLightPosition: { x: 14, y: 13 } };
  return { titleBarStyle: 'hidden', titleBarOverlay: { color: '#202429', symbolColor: '#cbd3dc', height: 40 } };
}

function electronExecutable(root, platform = process.platform) {
  const file = platform === 'darwin' ? 'Electron.app/Contents/MacOS/Electron' : platform === 'win32' ? 'electron.exe' : 'electron';
  return path.join(root, 'node_modules', 'electron', 'dist', file);
}

function packagedExecutable(root, platform = process.platform, arch = process.arch) {
  if (platform === 'darwin') return path.join(root, 'release', arch === 'arm64' ? 'mac-arm64' : 'mac', 'SignalDesk.app/Contents/MacOS/SignalDesk');
  if (platform === 'linux') return path.join(root, 'release', arch === 'arm64' ? 'linux-arm64-unpacked' : 'linux-unpacked', 'signaldesk');
  return path.join(root, 'release/win-unpacked/SignalDesk.exe');
}

module.exports = { windowChrome, electronExecutable, packagedExecutable };
