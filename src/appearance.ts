import { useEffect, useState } from 'react';

export function normalizeColor(value: unknown, fallback: string) {
  if (typeof value !== 'string') return fallback;
  const color = value.trim();
  if (/^#[\da-f]{6}$/i.test(color)) return color.toLowerCase();
  if (/^#[\da-f]{3}$/i.test(color)) return '#' + [...color.slice(1)].map(character => character.repeat(2)).join('').toLowerCase();
  return fallback;
}

export function accentInk(color: string) {
  const values = [1, 3, 5].map(index => parseInt(color.slice(index, index + 2), 16) / 255).map(value => value <= .04045 ? value / 12.92 : ((value + .055) / 1.055) ** 2.4);
  return values[0] * .2126 + values[1] * .7152 + values[2] * .0722 > .179 ? '#101719' : '#ffffff';
}

async function database() {
  return new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open('signaldesk-appearance', 1);
    request.onupgradeneeded = () => { request.result.createObjectStore('assets'); };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error || new Error('无法打开背景存储'));
  });
}
async function withAsset<T>(mode: IDBTransactionMode, action: (store: IDBObjectStore) => IDBRequest<T>) {
  const db = await database();
  try {
    return await new Promise<T>((resolve, reject) => {
      const transaction = db.transaction('assets', mode), request = action(transaction.objectStore('assets'));
      transaction.oncomplete = () => resolve(request.result);
      transaction.onerror = () => reject(transaction.error || new Error('无法保存背景图片'));
      transaction.onabort = () => reject(transaction.error || new Error('背景保存已取消'));
    });
  } finally { db.close(); }
}

async function dataUrl(blob: Blob) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader(); reader.onload = () => resolve(String(reader.result)); reader.onerror = () => reject(new Error('无法读取背景图片')); reader.readAsDataURL(blob);
  });
}
export async function saveBackground(file: File) {
  if (!['image/png', 'image/jpeg', 'image/webp'].includes(file.type)) throw new Error('请选择 PNG、JPG 或 WebP 图片');
  if (file.size > 8 * 1024 * 1024) throw new Error('背景图片不能超过 8 MiB');
  const bitmap = await createImageBitmap(file).catch(() => { throw new Error('图片无法解码，请选择有效的图片文件'); });
  try {
    if (bitmap.width * bitmap.height > 40000000) throw new Error('图片分辨率过高，请使用不超过 4000 万像素的图片');
    const scale = Math.min(1, 2048 / Math.max(bitmap.width, bitmap.height));
    const canvas = document.createElement('canvas'); canvas.width = Math.max(1, Math.round(bitmap.width * scale)); canvas.height = Math.max(1, Math.round(bitmap.height * scale));
    const context = canvas.getContext('2d'); if (!context) throw new Error('无法处理背景图片');
    context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    const blob = await new Promise<Blob>((resolve, reject) => canvas.toBlob(value => value ? resolve(value) : reject(new Error('无法转换背景图片')), 'image/webp', .86));
    if (blob.type !== 'image/webp' || blob.size > 2 * 1024 * 1024) throw new Error('图片转换后过大，请缩小图片后重试');
    if (window.signaldeskDesktop) return window.signaldeskDesktop.saveBackground(await dataUrl(blob));
    const hash = await crypto.subtle.digest('SHA-256', await blob.arrayBuffer());
    const id = [...new Uint8Array(hash)].map(value => value.toString(16).padStart(2, '0')).join('');
    await withAsset('readwrite', store => store.put({ id, blob }, 'background'));
    return id;
  } finally { bitmap.close(); }
}
export async function removeBackground(id: string) {
  if (window.signaldeskDesktop) return window.signaldeskDesktop.removeBackground(id);
  const db = await database();
  try {
    await new Promise<void>((resolve, reject) => {
      const transaction = db.transaction('assets', 'readwrite'), store = transaction.objectStore('assets');
      const request = store.get('background'); request.onsuccess = () => { if (request.result?.id === id) store.delete('background'); };
      transaction.oncomplete = () => resolve(); transaction.onabort = transaction.onerror = () => reject(new Error('无法移除背景图片'));
    });
  } finally { db.close(); }
}
async function readBackground(id: string) {
  if (window.signaldeskDesktop) {
    const data = await window.signaldeskDesktop.readBackground(id);
    return data ? (await fetch(data)).blob() : null;
  }
  const asset = await withAsset<{ id: string; blob: Blob } | undefined>('readonly', store => store.get('background'));
  return asset?.id === id ? asset.blob : null;
}
export function useBackground(id: string) {
  const [state, setState] = useState({ id: '', url: '', error: '' });
  useEffect(() => {
    let current = true, url = '';
    if (!id) { setState({ id, url, error: '' }); return; }
    void readBackground(id).then(blob => {
      if (!current) return;
      if (!blob) { setState({ id, url, error: '本机没有这张背景图片，请重新选择' }); return; }
      url = URL.createObjectURL(blob); setState({ id, url, error: '' });
    }).catch(error => { if (current) setState({ id, url, error: error.message || '无法读取背景图片' }); });
    return () => { current = false; if (url) URL.revokeObjectURL(url); };
  }, [id]);
  return state.id === id ? state : { id, url: '', error: '' };
}
