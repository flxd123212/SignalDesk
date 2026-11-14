import { BoardGeometry } from './board-geometry';

export function createReferenceBoard(id: string, name: string, color: number) {
  const b = new BoardGeometry(name, color);
  if (id === 'uno') {
    b.pcb(53.4, 68.6, [[-23, -28], [23, -26], [-22, 28], [22, 25]]);
    b.header('DIGITAL A', 8, -23, 10, true); b.header('DIGITAL B', 6, -23, -11, true);
    b.header('POWER', 8, 23, -15, true); b.header('ANALOG', 6, 23, 10, true);
    b.usb('USB', -12, -29, 'b');
    const power = b.part('DC IN', '直流插座 / 外形参考'); b.box(power, [9, 13, 10], [13, -28, 5.8]); const socket = b.cylinder(power, 3.1, 0.2, [13, -34.6, 6], b.plastic); socket.rotation.x = 0; const rim = b.ring(power, 3.4, 0.45, [13, -34.7, 6], b.silver); rim.rotation.x = Math.PI / 2;
    const mcu = b.part('U1 / ATmega328P', 'DIP-28 / socket'); b.box(mcu, [10, 36, 2.8], [5, 6, 2.3]); b.box(mcu, [7, 34, 3], [5, 6, 5]); b.label(mcu, 'ATMEGA328P', 6, 2, [5, 6, 6.52]);
    for (let i = 0; i < 14; i++) for (const side of [-1, 1]) { b.box(mcu, [1.5, 0.6, 0.35], [5 + side * 4.2, 6 + (i - 6.5) * 2.54, 4.1], b.silver); b.box(mcu, [0.5, 0.6, 2.6], [5 + side * 4.8, 6 + (i - 6.5) * 2.54, 2.8], b.silver); }
    b.chip('U2', 'ATMEGA16U2', -10, -11, 7, 7, 8); b.crystal('Y1', -10, 1); b.button('SW1', 'RESET', -14, 22); b.led('L', -6, 20, 0xe4a85b); b.led('ON', 16, 25);
    b.header('ICSP', 3, -12, 11); b.header('ICSP B', 3, -9.46, 11);
    for (let i = 0; i < 6; i++) b.passive(`C${i + 1}`, 15 + (i % 2) * 3, -8 + Math.floor(i / 2) * 4);
    b.label(b.root, 'UNO R3', 15, 3, [0, 28, 0.83]);
  } else if (id === 'mpu6050') {
    b.pcb(20, 16, [[-7, 5], [7, 5]]); b.header('J1', 8, 0, -6.3, false, true); b.chip('U1 / MPU6050', 'MPU6050', 1, 0, 4, 4, 6); b.chip('U2', 'LDO', -6, 0, 2.4, 3, 2, false); b.led('D1', 6.7, 0);
    b.passive('C1', -3, 1); b.passive('C2', -3, -2); b.passive('R1', 4.8, 1, false); b.label(b.root, 'GY-521', 7.5, 1.3, [0, 5.4, 0.83]);
  } else {
    const pico = id === 'pico', blue = id === 'bluepill', esp = id === 'esp32';
    const width = esp ? 28 : blue ? 23 : pico ? 21 : 27, length = esp ? 55 : blue ? 53 : pico ? 51 : 43;
    b.pcb(width, length, pico ? [[-5.7, -23.5], [5.7, -23.5], [-5.7, 23.5], [5.7, 23.5]] : esp ? [[-10, -24], [10, -24]] : []);
    const count = pico || blue ? 20 : esp ? 15 : 12;
    b.header('J1', count, -width / 2 + 1.5, esp ? 5 : 0); b.header('J2', count, width / 2 - 1.5, esp ? 5 : 0);
    b.usb('USB', 0, -length / 2 + 2.5, id === 'generic' ? 'c' : 'micro');
    if (esp) {
      b.module(0, 14); b.chip('U2', 'CP2102', 0, -11, 5, 5, 7); b.button('SW1', 'EN', -7, -18); b.button('SW2', 'BOOT', 7, -18); b.led('D1', -7.5, -10, 0xdb6557);
      for (let i = 0; i < 6; i++) b.passive(`C${i + 1}`, -7 + i * 2.8, -4.5, i % 3 !== 0);
    } else if (blue) {
      b.chip('U1 / STM32F103', 'STM32F103', 0, 1, 7, 7, 12); b.crystal('Y1', -5.5, -8); b.crystal('Y2', 5, 10); b.button('SW1', 'RESET', 0, -15); b.header('SWD', 4, 0, 24.3, false, true);
      for (const [i, x] of [[0, -3], [1, 3]]) { b.header(`BOOT${i}`, 3, x, 15.5); const jumper = b.part(`JP${i}`, '启动跳线 / 示意'); b.box(jumper, [2.4, 4.8, 2.5], [x, 15, 3], b.material(0xd7b13d)); }
      b.led('PWR', 6.5, -14); b.led('PC13', 6.5, -10, 0x68a3ed); for (let i = 0; i < 6; i++) b.passive(`C${i + 1}`, -6 + i * 2.4, -5, i % 2 === 0);
    } else if (pico) {
      b.chip('U1 / RP2040', 'RP2040', 0, 0, 7, 7, 14); b.chip('U2', 'FLASH', 0, 10, 3.5, 5, 4, false); b.crystal('Y1', -4.5, -7.5); b.button('SW1', 'BOOTSEL', 1.5, -15.5); b.led('LED', -5.5, -18.2); b.header('DEBUG', 3, 0, 23, false, true);
      for (let i = 0; i < 10; i++) b.passive(`C${i + 1}`, i < 5 ? -5.8 : 5.8, 3 + (i % 5) * 3.7, i % 3 !== 0); b.label(b.root, 'PICO', 8, 1.7, [0, 18, 0.83]);
    } else {
      b.chip('U1 / MCU', 'MCU', 0, 2, 8, 8, 10); b.chip('U2', 'USB UART', 0, -11, 4, 4, 5); b.crystal('Y1', -6.8, 3); b.button('SW1', 'RESET', -6, -14); b.button('SW2', 'BOOT', 6, -14); b.led('PWR', 6.5, 14); for (let i = 0; i < 5; i++) b.passive(`C${i + 1}`, -5 + i * 2.5, 10, i % 2 === 0); b.label(b.root, 'MCU REFERENCE', 16, 1.5, [0, 18, 0.83]);
    }
  }
  return b.root;
}
