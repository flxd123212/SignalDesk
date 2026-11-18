import { z } from 'zod';

export const panels = [
  { id: 'oled96', label: '0.96″ OLED', driver: 'SSD1306', w: 128, h: 64, mono: true },
  { id: 'oled91', label: '0.91″ OLED', driver: 'SSD1306', w: 128, h: 32, mono: true },
  { id: 'oled130', label: '1.3″ OLED', driver: 'SH1106G', w: 128, h: 64, mono: true },
  { id: 'tft114', label: '1.14″ IPS', driver: 'ST7789', w: 135, h: 240, mono: false },
  { id: 'tft154', label: '1.54″ IPS', driver: 'ST7789', w: 240, h: 240, mono: false },
  { id: 'tft20', label: '2.0″ IPS', driver: 'ST7789', w: 240, h: 320, mono: false },
  { id: 'tft28', label: '2.8″ TFT', driver: 'ILI9341', w: 240, h: 320, mono: false },
];
export const panelFor = id => panels.find(panel => panel.id === id) || panels[0];
const percent = z.number().min(0).max(100), color = z.string().regex(/^#[\da-f]{6}$/i);
export const eventName = z.string().regex(/^[A-Za-z][A-Za-z0-9_]{0,31}$/);
const layer = z.object({ id: z.string().min(1).max(80), type: z.enum(['text', 'button', 'bar', 'box', 'hotspot']), text: z.string().max(80), x: percent, y: percent, w: percent.positive(), h: percent.positive(), color, ink: color, value: percent, target: z.number().int().min(0).max(7), event: eventName.optional() });
const frame = z.object({ png: z.string().max(900000).regex(/^data:image\/png;base64,[A-Za-z0-9+/=]+$/), ms: z.number().int().min(20).max(60000) });
const axis = z.number().int().min(0).max(4095);
export const calibration = z.object({ x0: axis, x1: axis, y0: axis, y1: axis, rotation: z.number().int().min(0).max(3) }).refine(v => v.x0 !== v.x1 && v.y0 !== v.y1, '触摸每个轴的两个端点必须不同');
export const defaultCalibration = { x0: 200, x1: 3800, y0: 200, y1: 3800, rotation: 0 };
export const sceneSchema = z.object({ version: z.literal(1), profile: z.string().refine(id => panels.some(p => p.id === id)), codec: z.enum(['auto', 'raw', 'rle']), dither: z.boolean().optional(), calibration: calibration.optional(), threshold: z.number().int().min(1).max(254), address: z.enum(['0x3C', '0x3D']), cs: z.number().int().min(0).max(127), dc: z.number().int().min(0).max(127), rst: z.number().int().min(-1).max(127), touch: z.enum(['none', 'xpt2046']), touchCs: z.number().int().min(0).max(127), pages: z.array(z.object({ name: z.string().min(1).max(60), bg: color, layers: z.array(layer).max(64), frames: z.array(frame).max(48) })).min(1).max(8) }).superRefine((scene, ctx) => {
  for (const page of scene.pages) {
    if (new Set(page.layers.map(n => n.id)).size !== page.layers.length || page.layers.some(n => n.target >= scene.pages.length)) ctx.addIssue({ code: 'custom', message: '图层标识或跳转目标无效' });
  }
  if (scene.pages.reduce((total, p) => total + p.frames.reduce((n, f) => n + f.png.length, 0), 0) > 8 * 1024 * 1024) ctx.addIssue({ code: 'custom', message: '设计素材合计超过 8 MiB' });
});
export function pixels(n, p) {
  return { x: Math.round(n.x * p.w / 100), y: Math.round(n.y * p.h / 100), w: Math.max(1, Math.round(n.w * p.w / 100)), h: Math.max(1, Math.round(n.h * p.h / 100)) };
}
export function hit(layers, panel, x, y, activeOnly = true) {
  return [...layers].reverse().find(n => { const b = pixels(n, panel); return (!activeOnly || ['button', 'hotspot'].includes(n.type)) && x >= b.x && y >= b.y && x < b.x + b.w && y < b.y + b.h; });
}

// RGB565 is stored high byte first. Mono rows are MSB first and byte padded.
const bayer = [0,8,2,10,12,4,14,6,3,11,1,9,15,7,13,5];
export function raster(rgba, width, height, mono, threshold, dither = false) {
  const stride = mono ? Math.ceil(width / 8) : width * 2, bytes = new Uint8Array(stride * height);
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const i = (y * width + x) * 4, r = rgba[i], g = rgba[i + 1], b = rgba[i + 2];
    if (mono) {
      const level = dither ? Math.min(254, Math.max(1, threshold + (bayer[(y % 4) * 4 + x % 4] - 7.5) * 12)) : threshold;
      const lit = (54 * r + 183 * g + 19 * b) >= level * 256;
      if (lit) bytes[y * stride + (x >> 3)] |= 128 >> (x & 7);
      rgba[i] = rgba[i + 1] = rgba[i + 2] = lit ? 255 : 0;
    } else {
      const rgb = ((r >> 3) << 11) | ((g >> 2) << 5) | (b >> 3), j = y * stride + x * 2;
      bytes[j] = rgb >> 8; bytes[j + 1] = rgb & 255;
      rgba[i] = (r & 248) | (r >> 5); rgba[i + 1] = (g & 252) | (g >> 6); rgba[i + 2] = (b & 248) | (b >> 5);
    }
    rgba[i + 3] = 255;
  }
  return bytes;
}
export function encodeRaster(bytes, unit, codec) {
  if (codec === 'raw') return { bytes, rle: false };
  const runs = [];
  for (let i = 0; i < bytes.length;) {
    let count = 1;
    while (count < 255 && i + count * unit < bytes.length && bytes[i] === bytes[i + count * unit] && (unit === 1 || bytes[i + 1] === bytes[i + count * unit + 1])) count++;
    runs.push(count, bytes[i]); if (unit === 2) runs.push(bytes[i + 1]); i += count * unit;
  }
  return codec === 'rle' || runs.length < bytes.length ? { bytes: Uint8Array.from(runs), rle: true } : { bytes, rle: false };
}

// Later animation frames inherit the previous pixels. Frame zero always restores the whole page.
export function changedTile(before, after, width, height) {
  let left = width, top = height, right = -1, bottom = -1;
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const offset = (y * width + x) * 2;
    if (before[offset] === after[offset] && before[offset + 1] === after[offset + 1]) continue;
    left = Math.min(left, x); right = Math.max(right, x); top = Math.min(top, y); bottom = y;
  }
  if (right < 0) return {x:0, y:0, w:0, h:0, bytes:new Uint8Array()};
  const w = right - left + 1, h = bottom - top + 1, bytes = new Uint8Array(w * h * 2);
  for (let row = 0; row < h; row++) {
    const offset = ((top + row) * width + left) * 2;
    bytes.set(after.subarray(offset, offset + w * 2), row * w * 2);
  }
  return { x:left, y:top, w, h, bytes };
}
