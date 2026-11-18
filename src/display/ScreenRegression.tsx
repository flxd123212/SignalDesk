import { useEffect, useState, type RefObject } from 'react';
import { Circle, Download, Play, Square, Upload } from 'lucide-react';
import { hit, panelFor } from '../../shared/display-scene.mjs';
import { image, paint, type Scene } from './scene';

type Tap = { x: number; y: number; from: number; to: number; event: string };
type Step = Tap & { png: string };
type Sequence = { start: number; profile: string; steps: Step[] };
export type TapListener = ((tap: Tap) => void) | null;

async function difference(reference: string, actual: CanvasImageSource, w: number, h: number) {
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d', { willReadFrequently: true })!;
  const expected = await image(reference);
  if (expected.naturalWidth !== w || expected.naturalHeight !== h) throw new Error('基准与当前屏幕分辨率不同');
  ctx.drawImage(expected, 0, 0);
  const left = ctx.getImageData(0, 0, w, h);
  ctx.clearRect(0, 0, w, h);
  ctx.drawImage(actual, 0, 0);
  const right = ctx.getImageData(0, 0, w, h);
  let changed = 0;
  for (let i = 0; i < right.data.length; i += 4) {
    const mismatch = [0, 1, 2, 3].some((channel) => left.data[i + channel] !== right.data[i + channel]);
    if (mismatch) changed++;
    right.data[i] = mismatch ? 250 : 0;
    right.data[i + 1] = mismatch ? 90 : 0;
    right.data[i + 2] = mismatch ? 60 : 0;
    right.data[i + 3] = 255;
  }
  ctx.putImageData(right, 0, 0);
  return { changed, diff: changed ? canvas.toDataURL() : '' };
}

export function ScreenRegression({
  scene,
  index,
  scope,
  listener,
  preview,
  go,
}: {
  scene: Scene;
  index: number;
  scope: string;
  listener: RefObject<TapListener>;
  preview: () => void;
  go: (index: number) => void;
}) {
  const key = 'signaldesk.screen-test.' + scope;
  const [sequence, setSequence] = useState<Sequence | null>(() => {
    try {
      return JSON.parse(localStorage.getItem(key) || 'null');
    } catch {
      return null;
    }
  });
  const [recording, setRecording] = useState(false),
    [busy, setBusy] = useState(false),
    [message, setMessage] = useState(''),
    [diff, setDiff] = useState(''),
    [step, setStep] = useState(0),
    [source, setSource] = useState('固件帧缓冲');
  const panel = panelFor(scene.profile);
  useEffect(
    () => () => {
      listener.current = null;
    },
    [listener],
  );
  function record() {
    const taps: Tap[] = [];
    setMessage('已记录 0 步');
    setDiff('');
    setRecording(true);
    preview();
    listener.current = (tap) => {
      if (taps.length < 64) taps.push(tap);
      setMessage(`已记录 ${taps.length} 步`);
    };
    return { start: index, profile: scene.profile, taps };
  }
  const [draft, setDraft] = useState<ReturnType<typeof record> | null>(null);
  async function finish() {
    listener.current = null;
    setRecording(false);
    setDraft(null);
    if (!draft?.taps.length) {
      setMessage('没有记录到控件点击');
      return;
    }
    const steps: Step[] = [];
    for (const tap of draft.taps) {
      const frame = await paint(scene, tap.to, 0);
      steps.push({ ...tap, png: frame.canvas.toDataURL() });
    }
    const next = { start: draft.start, profile: draft.profile, steps };
    localStorage.setItem(key, JSON.stringify(next));
    setSequence(next);
    setStep(0);
    setMessage(`已保存 ${steps.length} 步基准`);
  }
  async function replay() {
    if (!sequence) return;
    if (scene.profile !== sequence.profile) throw new Error('屏幕型号与基准不同');
    let current = sequence.start;
    for (const [i, tap] of sequence.steps.entries()) {
      const page = scene.pages[current];
      const control = page && hit(page.layers, panel, tap.x, tap.y, true);
      if (!control || current !== tap.from || control.target !== tap.to || (control.event || '') !== tap.event)
        throw new Error(`第 ${i + 1} 步的控件、事件或跳转已变化`);
      current = control.target;
      const frame = await paint(scene, current, 0);
      const result = await difference(tap.png, frame.canvas, panel.w, panel.h);
      go(current);
      if (result.changed) {
        setStep(i);
        setDiff(result.diff);
        throw new Error(`第 ${i + 1} 步有 ${result.changed} 个像素变化`);
      }
    }
    setMessage(`设计器回放通过 · ${sequence.steps.length} 步`);
  }
  async function compare(file: File) {
    if (!sequence || file.size > 8 * 1024 * 1024) throw new Error('请选择 8 MiB 以内的图像');
    const bitmap = await createImageBitmap(file);
    try {
      if (bitmap.width !== panel.w || bitmap.height !== panel.h)
        throw new Error(`图像需为 ${panel.w} × ${panel.h} 像素`);
      const result = await difference(sequence.steps[step].png, bitmap, panel.w, panel.h);
      setDiff(result.diff);
      setMessage(`${source} · 第 ${step + 1} 步 · ${result.changed} 个差异像素`);
    } finally {
      bitmap.close();
    }
  }
  async function perform(fn: () => Promise<void>) {
    setBusy(true);
    setDiff('');
    try {
      await fn();
    } catch (e) {
      setMessage((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <details className="screen-regression">
      <summary>交互与画面回归</summary>
      <div className="studio-buttons">
        <button disabled={busy} onClick={() => (recording ? void perform(finish) : setDraft(record()))}>
          {recording ? <Square size={13} /> : <Circle size={13} />} {recording ? '保存录制' : '录制点击'}
        </button>
        <button disabled={busy || recording || !sequence} onClick={() => void perform(replay)}>
          <Play size={13} />
          重放
        </button>
      </div>
      {sequence && (
        <>
          <label>
            基准步骤
            <select
              value={step}
              onChange={(e) => {
                setStep(+e.target.value);
                setDiff('');
                setMessage('');
              }}
            >
              {sequence.steps.map((s, i) => (
                <option value={i} key={i}>
                  {i + 1} · {s.event || scene.pages[s.to]?.name || s.to}
                </option>
              ))}
            </select>
          </label>
          <label>
            图像来源
            <select value={source} onChange={(e) => setSource(e.target.value)}>
              <option>固件帧缓冲</option>
              <option>实屏照片</option>
            </select>
          </label>
          <div className="studio-buttons">
            <label className="file-button">
              <Upload size={14} />
              对比图像
              <input
                type="file"
                aria-label="对比屏幕图像"
                accept="image/png,image/jpeg"
                disabled={busy || recording}
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  e.target.value = '';
                  if (f) void perform(() => compare(f));
                }}
              />
            </label>
            <button
              title="下载基准图像"
              onClick={() => {
                const a = document.createElement('a');
                a.href = sequence.steps[step].png;
                a.download = `screen-step-${step + 1}.png`;
                a.click();
              }}
            >
              <Download size={14} />
            </button>
          </div>
        </>
      )}
      {message && <p role="status">{message}</p>}
      {diff && <img src={diff} alt="变化像素" style={{ maxWidth: '100%', imageRendering: 'pixelated' }} />}
    </details>
  );
}
