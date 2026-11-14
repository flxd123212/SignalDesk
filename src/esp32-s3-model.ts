import * as THREE from 'three';
import { esp32s3Board as spec } from '../shared/esp32-s3-board.mjs';
import { BoardGeometry } from './board-geometry';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';

// Outline and header pitch follow the drawing. Package heights/placements are visual approximations.
export function createEsp32S3Board() {
  const root = new THREE.Group(); root.name = spec.name; root.scale.setScalar(0.001);
  root.userData = { board: spec.name, geometryUnit: 'mm', exportedWorldUnit: 'm', dimensions: { widthMm: spec.widthMm, lengthMm: spec.lengthMm, pitchMm: spec.pitchMm }, source: spec.dimensions, fidelity: 'Dimensioned outline and headers; approximate component geometry. Not mechanical CAD.' };
  const material = (color: number, metalness = 0) => new THREE.MeshStandardMaterial({ color, metalness, roughness: metalness ? 0.38 : 0.7 });
  const pcb = material(0x17232d), plastic = material(0x1c2025), silver = material(0xbec7ce, 0.75), gold = material(0xd8b458, 0.7), ceramic = material(0xb4a18b);
  const evidence = '官方 v1.1 原理图 / 用户指南；元件外形、高度和位置为近似建模';
  const group = (reference: string, value: string, pins = '', parent: THREE.Object3D = root) => { const node = new THREE.Group(); node.name = reference; node.userData = { reference, value, pins, evidence, source: spec.schematic }; parent.add(node); return node; };
  const box = (parent: THREE.Object3D, size: number[], position: number[], mat: THREE.Material) => { const mesh = new THREE.Mesh(new THREE.BoxGeometry(...size as [number, number, number]), mat); mesh.position.set(...position as [number, number, number]); parent.add(mesh); return mesh; };
  const cylinder = (parent: THREE.Object3D, radius: number, height: number, position: number[], mat: THREE.Material) => { const mesh = new THREE.Mesh(new THREE.CylinderGeometry(radius, radius, height, 16), mat); mesh.rotateX(Math.PI / 2); mesh.position.set(...position as [number, number, number]); parent.add(mesh); return mesh; };
  const plane = (parent: THREE.Object3D, width: number, height: number, position: number[], draw: (ctx: CanvasRenderingContext2D, w: number, h: number) => void, flip = false) => { const canvas = document.createElement('canvas'); canvas.width = 1024; canvas.height = Math.round(1024 * height / width); const ctx = canvas.getContext('2d')!; draw(ctx, canvas.width, canvas.height); const map = new THREE.CanvasTexture(canvas); map.colorSpace = THREE.SRGBColorSpace; map.anisotropy = 4; const mesh = new THREE.Mesh(new THREE.PlaneGeometry(width, height), new THREE.MeshStandardMaterial({ map, transparent: true, depthWrite: false, roughness: 0.65 })); mesh.position.set(...position as [number, number, number]); if (flip) mesh.rotateY(Math.PI); parent.add(mesh); };
  const board = group('PCB', '25.40 x 62.74 mm / v1.1'); board.userData.evidence = '板框、排针间距按官方尺寸图；1.6 mm 板厚与圆角为近似';
  const outline = new THREE.Shape(), x = -12.7, y = -31.37, w = 25.4, h = 62.74, r = 0.8;
  outline.moveTo(x + r, y); outline.lineTo(x + w - r, y); outline.quadraticCurveTo(x + w, y, x + w, y + r); outline.lineTo(x + w, y + h - r); outline.quadraticCurveTo(x + w, y + h, x + w - r, y + h); outline.lineTo(x + r, y + h); outline.quadraticCurveTo(x, y + h, x, y + h - r); outline.lineTo(x, y + r); outline.quadraticCurveTo(x, y, x + r, y);
  const plate = new THREE.Mesh(new THREE.ExtrudeGeometry(outline, { depth: 1.6, bevelEnabled: false, curveSegments: 8 }), pcb); plate.position.z = -0.8; board.add(plate);
  const silk = (ctx: CanvasRenderingContext2D, width: number, height: number) => {
    const px = (mm: number) => (mm + 12.7) / 25.4 * width, py = (mm: number) => (31.37 - mm) / 62.74 * height;
    ctx.fillStyle = '#d8dddc'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.font = `${width / 25.4 * 0.85}px Consolas`;
    spec.left.forEach((pin, i) => ctx.fillText(pin === 'GND' ? 'G' : pin, px(-9.3), py(29.97 - i * 2.54)));
    spec.right.forEach((pin, i) => ctx.fillText(pin === 'GND' ? 'G' : pin, px(9.3), py(29.97 - i * 2.54)));
    ctx.font = `${width / 25.4 * 1.15}px Consolas`; for (const [text, sx, sy] of [['BOOT', -5.2, -15], ['RESET', 5.2, -15], ['UART', -6.6, -24.2], ['USB', 6.6, -24.2], ['RGB / IO38', -4.4, 0.7]] as const) ctx.fillText(text, px(sx), py(sy));
    ctx.strokeStyle = '#d8dddc'; ctx.lineWidth = 1.5; ctx.strokeRect(px(-8.5), py(11.3), width / 25.4 * 9.2, height / 62.74 * 6.7);
  }; plane(board, 25.4, 62.74, [0, 0, 0.815], silk);
  plane(board, 25.4, 62.74, [0, 0, -0.815], (ctx, width, height) => { ctx.fillStyle = '#d9e3df'; ctx.textAlign = 'center'; ctx.font = '52px Consolas'; ctx.fillText('ESP32-S3', width / 2, height * 0.4); ctx.font = '38px Consolas'; ctx.fillText('DevKitC-1 v1.1', width / 2, height * 0.46); ctx.font = '24px Consolas'; ctx.fillText('DIMENSIONED REFERENCE MODEL', width / 2, height * 0.51); }, true);
  for (const [side, names, ref] of [[-1, spec.left, 'J1'], [1, spec.right, 'J3']] as const) {
    const header = group(ref, 'CON22X1 / 2.54 mm', names.map((pin, i) => `${i + 1}:${pin}`).join(', ')); header.userData.evidence = '官方用户指南 J1/J3 名称及顺序；未核对具体模块内存变体的复用限制';
    names.forEach((name, i) => {
      const px = side * 11.43, py = 29.97 - i * 2.54, pin = group(`${ref}.${i + 1}`, name, `${ref} pin ${i + 1} = ${name}`, header);
      box(pin, [2.45, 2.5, 2.0], [px, py, -1.8], plastic); box(pin, [0.64, 0.64, 10], [px, py, -2.6], gold);
      const ring = new THREE.Mesh(new THREE.TorusGeometry(0.83, 0.19, 8, 20), gold); ring.position.set(px, py, 0.84); pin.add(ring); cylinder(pin, 0.65, 0.35, [px, py, 0.98], silver);
    });
  }
  const module = group('U4', 'ESP32-S3-WROOM-1', 'EN; GPIO0; USB GPIO19/20; header mapping in J1/J3');
  box(module, [18, 25.5, 0.8], [0, 24.7, 1.25], pcb); const shield = new THREE.Mesh(new RoundedBoxGeometry(16.2, 17.3, 2.1, 3, 0.22), silver); shield.position.set(0, 21, 2.65); module.add(shield);
  for (let i = 0; i < 14; i++) for (const side of [-1, 1]) box(module, [0.55, 0.65, 0.85], [side * 8.75, 12.4 + i * 1.27, 1.28], gold);
  for (let i = 0; i < 12; i++) box(module, [0.65, 0.55, 0.85], [-7 + i * 1.27, 12.1, 1.28], gold);
  plane(module, 16.1, 17.2, [0, 21, 3.71], (ctx, width, height) => { ctx.fillStyle = '#536069'; ctx.textAlign = 'center'; ctx.font = '90px Consolas'; ctx.fillText('ESP32-S3', width / 2, height * 0.35); ctx.font = '80px Consolas'; ctx.fillText('WROOM-1', width / 2, height * 0.52); ctx.font = '42px Consolas'; ctx.fillText('U4 / REFERENCE', width / 2, height * 0.72); });
  const antennaMaterial = material(0x6d775d, 0.25); for (let i = 0; i < 5; i++) { box(module, [0.3, 4.2, 0.03], [-6.5 + i * 2.6, 34.2, 1.67], antennaMaterial); if (i < 4) box(module, [2.6, 0.3, 0.03], [-5.2 + i * 2.6, 34.2 + (i % 2 ? -1.95 : 1.95), 1.67], antennaMaterial); }
  const ldo = group('U2', 'SGM2212-3.3XKC3G/TR / 3.3 V LDO'); box(ldo, [6.5, 3.5, 1.6], [-0.5, 6.2, 1.7], plastic); box(ldo, [4, 1.7, 0.3], [-0.5, 9, 1.0], silver); for (const offset of [-2.3, 0, 2.3]) box(ldo, [0.7, 2.2, 0.3], [-0.5 + offset, 3.7, 1], silver);
  const bridge = group('U3', 'CP2102N-A02-GQFN28 / USB-UART'); box(bridge, [5, 5, 0.9], [0.5, -10.8, 1.3], plastic);
  for (let i = 0; i < 7; i++) for (const side of [-1, 1]) { box(bridge, [0.35, 0.65, 0.15], [-1.3 + i * 0.6, -10.8 + side * 2.65, 0.91], silver); box(bridge, [0.65, 0.35, 0.15], [0.5 + side * 2.65, -12.6 + i * 0.6, 0.91], silver); }
  plane(bridge, 4.7, 4.7, [0.5, -10.8, 1.76], (ctx, width, height) => { ctx.fillStyle = '#d5d8d4'; ctx.textAlign = 'center'; ctx.font = '120px Consolas'; ctx.fillText('CP2102N', width / 2, height * 0.48); ctx.font = '90px Consolas'; ctx.fillText('U3', width / 2, height * 0.7); });
  for (const [ref, px, action] of [['SW1', -5.2, 'BOOT / GPIO0'], ['SW2', 5.2, 'RESET / CHIP_PU']] as const) { const button = group(ref, action); box(button, [4.6, 3.8, 1.5], [px, -18, 1.55], silver); cylinder(button, 1.2, 0.85, [px, -18, 2.6], plastic); for (const side of [-1, 1]) box(button, [0.7, 3, 0.2], [px + side * 2.5, -18, 0.95], silver); }
  const detail = new BoardGeometry(spec.name, 0x17232d);
  for (const [ref, px, type] of [['J2', -6.7, 'Micro-USB / UART bridge'], ['J4', 6.7, 'Micro-USB / ESP32-S3 USB']] as const) { const usb = detail.usb(ref, px, -28.6, 'micro'); usb.userData = { reference: ref, value: type, pins: 'VBUS, D-, D+, GND', evidence, source: spec.schematic }; root.add(usb); }
  const rgb = group('D6', 'SK68XXMINI-HS / RGB LED', 'DIN: GPIO38 (v1.1)'); box(rgb, [3.5, 3.5, 1.1], [-5.4, -3.6, 1.4], material(0xe5e8db)); cylinder(rgb, 1.1, 0.3, [-5.4, -3.6, 2.1], material(0xb3dfd0));
  const power = group('D5', 'RED LED / power indicator'); box(power, [1.7, 1.0, 0.65], [5.9, 5.1, 1.2], material(0xc65d50));
  for (const [ref, px, py] of [['C1', -6.2, 11], ['C6', 0, 11], ['C7', -6.2, 4], ['C10', -5.8, 7.5], ['C11', -5.5, -9], ['C12', -5.5, -12.8], ['R7', 6.8, -10], ['R9', 6.8, -12], ['R11', 6.5, 9.5], ['R18', -5.5, -11]] as const) { const part = group(ref, ref.startsWith('C') ? '电容 / 近似外形' : '电阻 / 近似外形'); box(part, [1.0, 1.8, 0.65], [px, py, 1.15], ref.startsWith('C') ? ceramic : plastic); for (const side of [-1, 1]) box(part, [1.05, 0.3, 0.7], [px, py + side * 0.75, 1.15], silver); }
  for (const [ref, px] of [['Q2', 0], ['Q1', 5]] as const) { const transistor = group(ref, 'L8050QLT1G / auto reset'); box(transistor, [2.8, 1.6, 1], [px, -3.5, 1.4], plastic); for (const offset of [-0.9, 0.9]) box(transistor, [0.45, 0.7, 0.2], [px + offset, -4.6, 0.95], silver); box(transistor, [0.45, 0.7, 0.2], [px, -2.4, 0.95], silver); }
  return root;
}
