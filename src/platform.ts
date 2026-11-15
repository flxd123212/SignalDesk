export const desktopPlatform = window.signaldeskDesktop?.platform;
export const isMac = desktopPlatform ? desktopPlatform === 'darwin' : /Mac/.test(navigator.platform);
export const shortcutLabel = (keys: string) => isMac ? keys.replaceAll('Ctrl+', 'Cmd+').replaceAll('Alt+', 'Option+') : keys;
export const portExample = (platform?: string, bluetooth = false) => platform === 'darwin' ? bluetooth ? '/dev/cu.设备名称' : '/dev/cu.usbmodem14101' : platform === 'linux' ? bluetooth ? '/dev/rfcomm0' : '/dev/ttyUSB0' : 'COM3';
