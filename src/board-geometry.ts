import * as THREE from 'three';

type Vec = [number, number, number];
const evidence = '内置外观参考；封装、尺寸、位号与引脚顺序未核对具体实板，不用于机械装配';

// Geometry is authored in millimetres. Child meshes stay unnamed so picking selects a component.
export class BoardGeometry {
  root = new THREE.Group();
  silver = this.material(0xb5bec7, 0.88, 0.26);
  solder = this.material(0x8d969e, 0.8, 0.4);
  gold = this.material(0xe0b75c, 0.78, 0.3);
  plastic = this.material(0x14191e, 0.08, 0.65);
  ceramic = this.material(0xb9ab8d, 0.05, 0.72);
  mask: THREE.MeshStandardMaterial;
  constructor(name: string, color: number) {
    this.root.name = name; this.root.scale.setScalar(0.001);
    this.root.userData = { geometryUnit: 'mm', exportedWorldUnit: 'm', fidelity: 'Illustrative component layout, not verified CAD or electrical mapping.' };
    this.mask = this.material(color, 0.12, 0.48);
  }
  material(color: number, metalness = 0, roughness = 0.6) { return new THREE.MeshStandardMaterial({ color, metalness, roughness }); }
  part(name: string, kind: string, parent: THREE.Object3D = this.root) {
    const part = new THREE.Group(); part.name = name; part.userData = { kind, evidence }; parent.add(part); return part;
  }
  box(parent: THREE.Object3D, size: Vec, pos: Vec, material = this.plastic) {
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(...size), material); mesh.position.set(...pos); parent.add(mesh); return mesh;
  }
  cylinder(parent: THREE.Object3D, radius: number, height: number, pos: Vec, material = this.silver) {
    const mesh = new THREE.Mesh(new THREE.CylinderGeometry(radius, radius, height, 24), material); mesh.rotateX(Math.PI / 2); mesh.position.set(...pos); parent.add(mesh); return mesh;
  }
  ring(parent: THREE.Object3D, radius: number, thickness: number, pos: Vec, mat = this.gold) {
    const mesh = new THREE.Mesh(new THREE.TorusGeometry(radius, thickness, 8, 24), mat); mesh.position.set(...pos); parent.add(mesh); return mesh;
  }
  label(parent: THREE.Object3D, text: string, width: number, height: number, pos: Vec, color = '#e0e8e4') {
    const canvas = document.createElement('canvas'); canvas.width = 512; canvas.height = 128;
    const ctx = canvas.getContext('2d')!; ctx.fillStyle = color; ctx.font = 'bold 70px Consolas, monospace'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText(text, 256, 64, 490);
    const map = new THREE.CanvasTexture(canvas); map.colorSpace = THREE.SRGBColorSpace; map.anisotropy = 4;
    const mesh = new THREE.Mesh(new THREE.PlaneGeometry(width, height), new THREE.MeshStandardMaterial({ map, transparent: true, depthWrite: false, roughness: 0.8 })); mesh.position.set(...pos); parent.add(mesh); return mesh;
  }
  pcb(width: number, length: number, holes: [number, number][] = []) {
    const board = this.part('PCB', '阻焊 / 基材 / 安装孔'), shape = new THREE.Shape(), x = -width / 2, y = -length / 2, r = 1.1;
    shape.moveTo(x + r, y); shape.lineTo(-x - r, y); shape.quadraticCurveTo(-x, y, -x, y + r); shape.lineTo(-x, -y - r); shape.quadraticCurveTo(-x, -y, -x - r, -y); shape.lineTo(x + r, -y); shape.quadraticCurveTo(x, -y, x, -y - r); shape.lineTo(x, y + r); shape.quadraticCurveTo(x, y, x + r, y);
    holes.forEach(([hx, hy]) => { const hole = new THREE.Path(); hole.absarc(hx, hy, 1.45, 0, Math.PI * 2, true); shape.holes.push(hole); this.ring(board, 1.85, 0.3, [hx, hy, 0.82]); this.ring(board, 1.85, 0.3, [hx, hy, -0.82]); });
    const mesh = new THREE.Mesh(new THREE.ExtrudeGeometry(shape, { depth: 1.6, bevelEnabled: false, curveSegments: 10 }), [this.mask, this.material(0x8b8766, 0.1, 0.8)]); mesh.position.z = -0.8; board.add(mesh);
    this.label(board, 'REFERENCE / NOT CAD', Math.min(width - 6, 22), 1.3, [0, -length / 2 + 2, 0.825]);
    return board;
  }
  header(name: string, count: number, x: number, y: number, female = false, horizontal = false) {
    const header = this.part(name, `${count} pin / 2.54 mm / 几何排针，未绑定 GPIO`);
    for (let i = 0; i < count; i++) {
      const px = x + (horizontal ? (i - (count - 1) / 2) * 2.54 : 0), py = y + (horizontal ? 0 : (i - (count - 1) / 2) * 2.54);
      const pin = this.part(`${name}.${i + 1}`, '排针位置，电气功能待映射', header);
      this.ring(pin, 0.85, 0.16, [px, py, 0.83]); this.ring(pin, 0.8, 0.15, [px, py, -0.83], this.solder);
      if (female) {
        for (const side of [-1, 1]) { this.box(pin, [0.6, 2.5, 7], [px + side * 0.95, py, 4.3]); this.box(pin, [1.3, 0.6, 7], [px, py + side * 0.95, 4.3]); }
        this.box(pin, [0.6, 0.6, 5], [px, py, 0], this.gold);
      } else { this.box(pin, [2.45, 2.45, 2], [px, py, -1.8]); this.box(pin, [0.64, 0.64, 10], [px, py, -2.3], this.gold); }
    }
    return header;
  }
  chip(name: string, text: string, x: number, y: number, width = 7, height = 7, leads = 8, qfp = true) {
    const part = this.part(name, text); this.box(part, [width, height, 1.1], [x, y, 1.5]);
    for (let i = 0; i < leads; i++) for (const side of [-1, 1]) {
      const offset = (i - (leads - 1) / 2) * (width - 1) / leads;
      this.box(part, [0.32, 1.3, 0.22], [x + offset, y + side * (height / 2 + 0.4), 1.02], this.silver);
      if (qfp) this.box(part, [1.3, 0.32, 0.22], [x + side * (width / 2 + 0.4), y + offset * height / width, 1.02], this.silver);
    }
    this.label(part, text, width * 0.88, Math.min(1.5, height / 3), [x, y, 2.06], '#adb5bc'); this.cylinder(part, 0.3, 0.03, [x - width / 2 + 0.7, y + height / 2 - 0.7, 2.065], this.material(0x747d85)); return part;
  }
  passive(name: string, x: number, y: number, capacitor = true) {
    const part = this.part(name, capacitor ? '贴片电容 / 外形参考' : '贴片电阻 / 外形参考'); this.box(part, [1.1, 2.0, 0.75], [x, y, 1.2], capacitor ? this.ceramic : this.plastic);
    for (const side of [-1, 1]) { this.box(part, [1.2, 0.6, 0.2], [x, y + side * 0.9, 0.95], this.solder); this.box(part, [1.13, 0.35, 0.8], [x, y + side * 0.85, 1.2], this.silver); }
  }
  crystal(name: string, x: number, y: number) {
    const part = this.part(name, '晶振 / 金属壳'); this.box(part, [3.4, 5.6, 0.35], [x, y, 1.0]); this.box(part, [3.1, 5.2, 1.0], [x, y, 1.65], this.silver); this.label(part, 'XTAL', 2.6, 0.7, [x, y, 2.16], '#46525c');
  }
  button(name: string, text: string, x: number, y: number) {
    const part = this.part(name, text); this.box(part, [4.5, 3.5, 1.2], [x, y, 1.5]); this.box(part, [4.2, 3.2, 0.2], [x, y, 2.15], this.silver); this.cylinder(part, 1.05, 0.75, [x, y, 2.6]);
    for (const side of [-1, 1]) this.box(part, [0.5, 3.8, 0.2], [x + side * 2.4, y, 1], this.silver);
    this.label(this.root, text, 5.5, 0.9, [x, y - 2.7, 0.83]);
  }
  led(name: string, x: number, y: number, color = 0x7bdf8c) {
    const part = this.part(name, '状态 LED / 外观，不表示实板通电'); this.box(part, [1.5, 2.2, 0.75], [x, y, 1.3], this.material(0xe2e6de)); const lens = this.material(color, 0.08, 0.3); this.box(part, [1.1, 1.3, 0.3], [x, y, 1.83], lens);
  }
  usb(name: string, x: number, y: number, kind: 'micro' | 'c' | 'b' = 'micro') {
    const part = this.part(name, kind === 'b' ? 'USB Type-B' : kind === 'c' ? 'USB Type-C' : 'Micro USB');
    const w = kind === 'b' ? 12 : kind === 'c' ? 9 : 7.6, h = kind === 'b' ? 10 : kind === 'c' ? 3.4 : 2.8, d = kind === 'b' ? 15 : 6;
    const contour = (width: number, height: number, radius: number) => {
      const p = new THREE.Shape(), left = -width / 2, bottom = -height / 2;
      p.moveTo(left + radius, bottom); p.lineTo(-left - radius, bottom); p.quadraticCurveTo(-left, bottom, -left, bottom + radius); p.lineTo(-left, -bottom - radius); p.quadraticCurveTo(-left, -bottom, -left - radius, -bottom); p.lineTo(left + radius, -bottom); p.quadraticCurveTo(left, -bottom, left, -bottom - radius); p.lineTo(left, bottom + radius); p.quadraticCurveTo(left, bottom, left + radius, bottom); return p;
    };
    const radius = kind === 'c' ? h / 2 : 0.6, shell = contour(w, h, radius); shell.holes.push(contour(w - 0.6, h - 0.6, Math.max(0.2, radius - 0.3)));
    const housing = new THREE.Mesh(new THREE.ExtrudeGeometry(shell, { depth: d, bevelEnabled: false, curveSegments: 8 }), this.silver); housing.rotateX(Math.PI / 2); housing.position.set(x, y + d / 2, 1 + h / 2); part.add(housing);
    this.box(part, [w - 0.5, 0.4, h - 0.1], [x, y + d / 2 - 0.3, 1 + h / 2]);
    this.box(part, [w * 0.7, d * 0.75, h * 0.3], [x, y + 0.5, 1 + h * 0.4], this.plastic);
    const count = kind === 'b' ? 4 : kind === 'c' ? 12 : 5;
    for (let i = 0; i < count; i++) this.box(part, [0.22, d * 0.6, 0.14], [x + (i - (count - 1) / 2) * (w * 0.6 / count), y, 1 + h * 0.57], this.gold);
    for (const side of [-1, 1]) { this.box(part, [1.2, 2, 0.2], [x + side * w / 2, y + 1.8, 0.94], this.solder); this.box(part, [1.1, 1.6, 0.03], [x + side * w * 0.25, y, 1.015 + h], this.plastic); }
    return part;
  }
  module(x: number, y: number) {
    const part = this.part('U1 / ESP32-WROOM', 'ESP32-WROOM 模块 / 屏蔽罩 / PCB 天线'); this.box(part, [18, 25.5, 0.8], [x, y, 1.25], this.mask); this.box(part, [16, 17, 2.1], [x, y - 3.5, 2.7], this.silver);
    this.label(part, 'ESP32-WROOM', 14.7, 2, [x, y - 2, 3.76], '#475460'); this.label(part, 'RF MODULE', 10, 1.1, [x, y - 6, 3.76], '#576470');
    for (let i = 0; i < 12; i++) for (const side of [-1, 1]) this.box(part, [0.6, 0.75, 0.8], [x + side * 8.8, y - 11.4 + i * 1.7, 1.27], this.gold);
    for (let i = 0; i < 5; i++) { this.box(part, [0.35, 5, 0.03], [x - 6.2 + i * 3, y + 8.7, 1.67], this.gold); if (i < 4) this.box(part, [3, 0.35, 0.03], [x - 4.7 + i * 3, y + 8.7 + (i % 2 ? -2.33 : 2.33), 1.67], this.gold); }
  }
}
