import type { z } from 'zod';
import { panelFor, pixels, raster, sceneSchema } from '../../shared/display-scene.mjs';

export type Scene = z.infer<typeof sceneSchema>;
export type Screen = Scene['pages'][number];
export type Layer = Screen['layers'][number];
export type Panel = ReturnType<typeof panelFor>;
export const layerNames = { text: '文字', button: '按钮', bar: '进度条', box: '色块', hotspot: '触摸热区' };
export function makeLayer(type: Layer['type'], extra: Partial<Layer> = {}): Layer {
  return { id: crypto.randomUUID(), type, text: type === 'button' ? 'NEXT' : 'Label', x: 7, y: 10, w: 48, h: 24, ink: '#ffffff', color: '#399d98', value: 65, target: 0, ...extra };
}
export function template(): Scene {
  return { version: 1, profile: 'oled96', codec: 'auto', threshold: 115, address: '0x3C', cs: 5, dc: 16, rst: -1, touch: 'none', touchCs: 4, pages: [
    { name: '仪表', bg: '#07171e', frames: [], layers: [makeLayer('text', { text: 'SENSOR  /  01', y: 5, w: 80, h: 17 }), makeLayer('text', { text: '24.8 C', y: 25, w: 78, h: 39 }), makeLayer('bar', { y: 78, w: 48, h: 9, color: '#71ddbf' }), makeLayer('button', { text: 'SET', x: 65, y: 70, w: 29, h: 23, ink: '#07171e', color: '#71ddbf', target: 1 })] },
    { name: '设置', bg: '#13252d', frames: [], layers: [makeLayer('text', { text: 'SETTINGS', w: 85, h: 32 }), makeLayer('button', { text: 'BACK', y: 62, color: '#f4b761', ink: '#101917' })] },
  ] };
}
const bitmapCache = new Map<string, Promise<HTMLImageElement>>();
export function image(src: string) {
  let pending = bitmapCache.get(src);
  if (!pending) {
    const bitmap = new Image(); bitmap.src = src; pending = bitmap.decode().then(() => bitmap);
    if (bitmapCache.size >= 50) bitmapCache.delete(bitmapCache.keys().next().value!);
    bitmapCache.set(src, pending);
  }
  return pending;
}
function surface(p: Panel) { const c = document.createElement('canvas'); c.width = p.w; c.height = p.h; return c; }
export async function paint(scene: Scene, index: number, frame = 0) {
  const p = panelFor(scene.profile), page = scene.pages[index], c = surface(p), ctx = c.getContext('2d', { willReadFrequently: true })!;
  ctx.fillStyle = page.bg; ctx.fillRect(0, 0, p.w, p.h);
  if (page.frames.length) ctx.drawImage(await image(page.frames[frame % page.frames.length].png), 0, 0, p.w, p.h);
  for (const n of page.layers) {
    if (n.type === 'hotspot') continue;
    const { x, y, w, h } = pixels(n, p);
    ctx.save(); ctx.beginPath(); ctx.rect(x, y, w, h); ctx.clip(); ctx.fillStyle = n.color;
    if (n.type === 'bar') {
      ctx.fillRect(x, y, Math.round(w * n.value / 100), h); ctx.strokeStyle = n.color; ctx.strokeRect(x + .5, y + .5, w - 1, h - 1);
    } else {
      if (n.type !== 'text') ctx.fillRect(x, y, w, h);
      if (n.type !== 'box') {
        ctx.fillStyle = n.ink; ctx.font = `600 ${Math.max(5, Math.floor(h * .73))}px sans-serif`; ctx.textBaseline = 'middle';
        ctx.textAlign = n.type === 'button' ? 'center' : 'left'; ctx.fillText(n.text, n.type === 'button' ? x + w / 2 : x, y + h / 2, w);
      }
    }
    ctx.restore();
  }
  const data = ctx.getImageData(0, 0, p.w, p.h), bytes = raster(data.data, p.w, p.h, p.mono, scene.threshold, scene.dither);
  ctx.putImageData(data, 0, 0); return { canvas: c, bytes };
}

interface Decoder { tracks: { ready: Promise<void>; selectedTrack: { frameCount: number } }; completed: Promise<void>; decode(args: { frameIndex: number }): Promise<{ image: VideoFrame }>; close(): void }
export async function importArt(file: File, p: Panel): Promise<Screen['frames']> {
  if (file.size > 8 * 1024 * 1024) throw new Error('素材文件超过 8 MiB');
  const c = surface(p), ctx = c.getContext('2d')!;
  const capture = (source: CanvasImageSource, ms = 1000) => { ctx.clearRect(0, 0, p.w, p.h); ctx.drawImage(source, 0, 0, p.w, p.h); return { png: c.toDataURL('image/png'), ms }; };
  if (file.type === 'image/gif' || /\.gif$/i.test(file.name)) {
    const DecoderClass = (window as unknown as { ImageDecoder?: new (options: unknown) => Decoder }).ImageDecoder;
    if (!DecoderClass) throw new Error('当前浏览器无法解码 GIF，请使用桌面版或 Chromium');
    const decoder = new DecoderClass({ data: await file.arrayBuffer(), type: 'image/gif', desiredWidth: p.w, desiredHeight: p.h });
    try {
      await decoder.tracks.ready; await decoder.completed;
      const count = decoder.tracks.selectedTrack.frameCount;
      if (count < 1 || count > 48) throw new Error('GIF 支持 1 至 48 帧');
      const frames = [];
      for (let i = 0; i < count; i++) { const { image } = await decoder.decode({ frameIndex: i }); try { frames.push(capture(image, Math.min(60000, Math.max(20, Math.round((image.duration || 100000) / 1000))))); } finally { image.close(); } }
      return frames;
    } finally { decoder.close(); }
  }
  if (!['image/jpeg', 'image/png'].includes(file.type)) throw new Error('请选择 PNG、JPEG 或 GIF 素材');
  const bitmap = await createImageBitmap(file, { resizeWidth: p.w, resizeHeight: p.h });
  try { return [capture(bitmap)]; } finally { bitmap.close(); }
}

// Find bounded flat-color regions in a downsampled mockup. Users can move or remove every candidate.
export async function hotspots(png: string, target: number) {
  const c = document.createElement('canvas'); c.width = 64; c.height = 48;
  const ctx = c.getContext('2d')!; ctx.drawImage(await image(png), 0, 0, 64, 48);
  const data = ctx.getImageData(0, 0, 64, 48).data, seen = new Uint8Array(3072);
  const key = (i: number) => ((data[i * 4] >> 5) << 6) | ((data[i * 4 + 1] >> 5) << 3) | (data[i * 4 + 2] >> 5);
  const found: { x: number; y: number; w: number; h: number; area: number }[] = [];
  for (let i = 0; i < seen.length; i++) {
    if (seen[i]) continue;
    const queue = [i], color = key(i); seen[i] = 1;
    let l = 64, t = 48, r = 0, b = 0;
    for (let j = 0; j < queue.length; j++) { const k = queue[j], x = k % 64, y = Math.floor(k / 64); l = Math.min(l, x); r = Math.max(r, x); t = Math.min(t, y); b = Math.max(b, y);
      for (const n of [x ? k - 1 : -1, x < 63 ? k + 1 : -1, k - 64, k + 64]) if (n >= 0 && n < seen.length && !seen[n] && key(n) === color) { seen[n] = 1; queue.push(n); }
    }
    const w = r - l + 1, h = b - t + 1, area = w * h;
    if (w >= 6 && h >= 4 && area <= 1024 && queue.length / area > .68) found.push({ x: l / 64 * 100, y: t / 48 * 100, w: w / 64 * 100, h: h / 48 * 100, area });
  }
  return found.sort((a, b) => b.area - a.area).slice(0, 8).map(({ x, y, w, h }, i) => makeLayer('hotspot', { x, y, w, h, text: `热区 ${i + 1}`, target }));
}
