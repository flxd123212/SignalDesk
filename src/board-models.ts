import * as THREE from 'three';
import { createEsp32S3Board } from './esp32-s3-model';
import { createReferenceBoard } from './reference-boards';
export const boardPresets = [
  { id: 'generic', name: '通用开发板', chip: 'MCU', color: 0x218c65, width: 3.8, height: 2.2, pins: 12 },
  { id: 'esp32', name: 'ESP32 DevKit', chip: 'ESP32-WROOM 模块', color: 0x232b30, width: 4.1, height: 2.1, pins: 15 },
  { id: 'esp32s3', name: 'ESP32-S3-DevKitC-1 v1.1', chip: 'ESP32-S3-WROOM-1', color: 0x242d33, width: 25.4, height: 62.74, pins: 22 },
  { id: 'bluepill', name: 'STM32 Blue Pill', chip: 'STM32F103', color: 0x2864ad, width: 4.2, height: 1.8, pins: 20 },
  { id: 'uno', name: 'Arduino Uno R3', chip: 'ATmega328P', color: 0x258f9a, width: 4.2, height: 3.2, pins: 14 },
  { id: 'pico', name: 'Raspberry Pi Pico', chip: 'RP2040', color: 0x238a63, width: 4.4, height: 1.8, pins: 20 },
  { id: 'mpu6050', name: 'GY-521 / MPU6050', chip: 'MPU6050 IMU', color: 0x275fba, width: 2.3, height: 1.8, pins: 8 },
];
export function suggestedBoard(board: string, chip: string) {
  const label = `${board} ${chip}`; if (/GY-521|MPU6050/i.test(label)) return 'mpu6050'; if (/Blue.?Pill/i.test(board)) return 'bluepill'; if (/Uno/i.test(board)) return 'uno'; if (/Pico/i.test(board)) return 'pico'; if (/ESP32.?S3/i.test(label)) return 'esp32s3'; if (/ESP32/i.test(label)) return 'esp32'; return null;
}
export function createBoard(id: string) {
  if (id === 'esp32s3') return createEsp32S3Board();
  const preset = boardPresets.find(item => item.id === id) || boardPresets[0];
  return createReferenceBoard(preset.id, preset.name, preset.color);
}
export function disposeModel(root: THREE.Object3D) {
  root.traverse(object => { if (object instanceof THREE.Mesh || object instanceof THREE.LineSegments) { object.geometry.dispose(); const materials = Array.isArray(object.material) ? object.material : [object.material]; materials.forEach(material => { for (const value of Object.values(material)) if (value instanceof THREE.Texture) value.dispose(); material.dispose(); }); } });
}
