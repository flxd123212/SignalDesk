import downloads from '../shared/tool-downloads.cjs';
import { findExecutable, findIdfInvoker } from './ai/build.mjs';
import { findKeilExecutable } from './keil.mjs';
import { findIarExecutable } from './iar.mjs';

const names = { 'arduino-cli': 'Arduino CLI', 'esp-idf': 'ESP-IDF', 'arm-none-eabi-gcc': 'Arm GNU Toolchain', keil: 'Keil µVision', iar: 'IAR Build', cmake: 'CMake', ninja: 'Ninja', platformio: 'PlatformIO', openocd: 'OpenOCD', 'dfu-util': 'dfu-util' };
export function toolInventory() {
  const special = { 'esp-idf': async () => (await findIdfInvoker()).script, keil: findKeilExecutable, iar: findIarExecutable };
  return Promise.all(Object.entries(downloads.sources()).map(async ([id, url]) => {
    let executable = '';
    try { executable = special[id] ? await special[id]() : await findExecutable(id); } catch { /* Optional installation. */ }
    return { id, name: names[id], executable, url, direct: url.startsWith('https://downloads.arduino.cc/') };
  }));
}
