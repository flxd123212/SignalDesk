import { useEffect, useRef, useState } from 'react';
import { AppWindow, Bot, BoxSelect, Download, FileInput, ImagePlus, Layers, MousePointer2, Play, Plus, RectangleHorizontal, Save, Scan, SlidersHorizontal, Square, SquareMousePointer, Trash2, Type, Undo2 } from 'lucide-react';
import { api, download } from '../data';
import { panels, panelFor, hit, pixels, sceneSchema, encodeRaster } from '../../shared/display-scene.mjs';
import { hotspots, importArt, layerNames, makeLayer, paint, template, type Scene, type Layer, type Screen } from './scene';
import { firmware } from './firmware';
import { DesignAssistant } from './DesignAssistant';
import { defaultCalibration } from '../../shared/display-scene.mjs';
import { AlignHorizontalJustifyCenter, ArrowDown, ArrowUp, CopyPlus, Grid2X2, Redo2, Sparkles } from 'lucide-react';
import './studio.css';
import './designer-layout.css';
import { ScreenRegression, type TapListener } from './ScreenRegression';

const icons = { text: Type, button: SquareMousePointer, bar: RectangleHorizontal, box: Square, hotspot: BoxSelect };
type Props = { deviceId: string; root: string; launch: number; consumeLaunch: () => void; review: (prompt: string) => void; tools: () => void; openProject: (root: string) => void };
const bounded = (n: number, max: number) => Math.max(0, Math.min(max, n));
export default function Studio({ deviceId, root, review, tools, openProject, launch, consumeLaunch }: Props) {
  const [scene, setScene] = useState(template), [index, setIndex] = useState(0), [selected, select] = useState(''), [play, setPlay] = useState(false), [frame, setFrame] = useState(0);
  const [ready, setReady] = useState(false), [busy, setBusy] = useState(false), [message, report] = useState(''), [size, setSize] = useState(0), [saved, setSaved] = useState(true);
  const history = useRef<Scene[]>([]), canvas = useRef<HTMLCanvasElement>(null), asset = useRef<HTMLInputElement>(null), project = useRef<HTMLInputElement>(null);
  const drag = useRef<{ id: string; dx: number; dy: number; moved: boolean; before: Scene } | null>(null);
  const p = panelFor(scene.profile), page = scene.pages[index], node = page.layers.find(n => n.id === selected);
  const tapListener=useRef<TapListener>(null);
  const rect = node && pixels(node, p);
  const [assistant,setAssistant] = useState(false), [grid,setGrid] = useState(true), [zoom,setZoom] = useState(100);
  const redoStack = useRef<Scene[]>([]);
  const touchMap = scene.calibration || defaultCalibration;
  useEffect(()=>{if(ready && launch){setAssistant(true);consumeLaunch();}},[ready,launch,consumeLaunch]);
  const resize = useRef<{left:number; top:number; width:number; height:number; id:string} | null>(null);
  useEffect(() => {
    let live = true; if (!deviceId) return;
    api<Scene | null>('/display/design?' + new URLSearchParams({ deviceId, root })).then(value => { if (live) { if (value) setScene(sceneSchema.parse(value)); setReady(true); } }).catch(e => { if (live) report(e.message); });
    return () => { live = false; };
  }, [deviceId, root]);
  useEffect(() => {
    let live = true;
    paint(scene, index, frame).then(result => { if (!live || !canvas.current) return; canvas.current.getContext('2d')!.drawImage(result.canvas, 0, 0); setSize(encodeRaster(result.bytes, p.mono ? 1 : 2, scene.codec).bytes.length); }).catch(e => { if (live) report(e.message); });
    return () => { live = false; };
  }, [scene, index, frame, p.mono]);
  useEffect(() => {
    if (!play || page.frames.length < 2) return;
    const timer = setTimeout(() => setFrame((frame + 1) % page.frames.length), page.frames[frame % page.frames.length].ms); return () => clearTimeout(timer);
  }, [play, page, frame]);
  function remember(s: Scene) { history.current = [...history.current.slice(-15), s]; redoStack.current=[]; }
  function edit(s: Scene) { remember(scene); setScene(s); setSaved(false); }
  function updatePage(part: Partial<Screen>) { edit({ ...scene, pages: scene.pages.map((a, i) => i === index ? { ...a, ...part } : a) }); }
  function updateLayer(part: Partial<Layer>) { updatePage({ layers: page.layers.map(n => n.id === selected ? { ...n, ...part } : n) }); }
  function goto(i: number) { setIndex(i); setFrame(0); select(''); }
  function add(type: Layer['type']) {
    if (page.layers.length >= 64) return report('每页最多 64 个图层');
    const n = makeLayer(type, { x: 15, y: 36, target: (index + 1) % scene.pages.length }); updatePage({ layers: [...page.layers, n] }); select(n.id);
  }
  function undo() { const last = history.current.pop(); if (!last) return; redoStack.current.push(scene); setScene(last); setSaved(false); goto(Math.min(index, last.pages.length - 1)); }
  function redo() { const next=redoStack.current.pop(); if (!next) return; history.current.push(scene); setScene(next); setSaved(false); goto(Math.min(index,next.pages.length-1)); }
  function shiftLayer(direction: number) {
    const layers=page.layers.slice(), from=layers.findIndex(n=>n.id===selected), to=from+direction;
    if (from<0 || to<0 || to>=layers.length) return;
    [layers[from],layers[to]]=[layers[to],layers[from]]; updatePage({layers});
  }
  async function action(fn: () => Promise<void>) { setBusy(true); report(''); try { await fn(); } catch (e) { report((e as Error).message); } finally { setBusy(false); } }
  const point = (event: React.PointerEvent) => { const b = event.currentTarget.getBoundingClientRect(); return { x: (event.clientX - b.left) * p.w / b.width, y: (event.clientY - b.top) * p.h / b.height }; };
  const save = () => action(async () => { await api('/display/design', { deviceId, root, scene }); setSaved(true); report('设计已保存到当前设备工程'); });
  const assist = () => review(`请按显示驱动、显存/Flash、总线预算、触控与实板验证步骤审查此屏幕设计。结合工程读取相关源码。将估计和实测分开。\n${JSON.stringify({ panel: p, codec: scene.codec, touch: scene.touch, pins: { cs: scene.cs, dc: scene.dc, rst: scene.rst, touchCs: scene.touchCs }, address: scene.address, pages: scene.pages.map(pg => ({ name: pg.name, frames: pg.frames.length, controls: pg.layers.map(n => ({ type: n.type, label: n.text, ...pixels(n, p), target: n.target })) })), currentFrameBytes: size }).slice(0, 5800)}`);
  return <fieldset className="display-studio" disabled={!ready || busy}><div className="studio-bar"><AppWindow size={18}/><select aria-label="屏幕型号" value={scene.profile} disabled={play} onChange={e => edit({ ...scene, profile: e.target.value })}>{panels.map(a => <option key={a.id} value={a.id}>{a.label} · {a.driver} · {a.w}×{a.h}</option>)}</select><div className="studio-spacer"/><button className="quiet-button" onClick={() => { setPlay(!play); setFrame(0); select(''); }}>{play ? <MousePointer2 size={14}/> : <Play size={14}/>} {play ? '返回设计' : '交互预览'}</button><button className="quiet-button" onClick={save}><Save size={14}/>保存</button><button className="primary" onClick={() => action(async () => { const result = await firmware(scene); download('SignalDeskUI.ino', result.code); report(`已导出 Arduino 草图 · 像素资源 ${result.total.toLocaleString()} B`); })}><Download size={14}/>导出固件源码</button></div>
    <div className="studio-layout"><div className="studio-artboard"><div className="studio-pages">{scene.pages.map((pg, i) => <button key={i} className={index === i ? 'current' : ''} onClick={() => goto(i)}>{pg.name}</button>)}<button title="添加屏幕页面" disabled={play || scene.pages.length >= 8} onClick={() => { edit({ ...scene, pages: [...scene.pages, { name: `页面 ${scene.pages.length + 1}`, bg: '#101820', layers: [], frames: [] }] }); goto(scene.pages.length); }}><Plus size={14}/></button></div>
      <div className="studio-bed" data-grid={grid}><div className="studio-glass" style={{ aspectRatio: `${p.w}/${p.h}`, width: `min(${zoom*.8}%, ${p.w / p.h * 3.4*zoom}px, ${p.w*.04*zoom}px)` }}><canvas ref={canvas} width={p.w} height={p.h} aria-label="屏幕像素画布" tabIndex={0} onKeyDown={e => { if (play || !node) return; const d = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] }[e.key]; if (d) { e.preventDefault(); updateLayer({ x: bounded(node.x + d[0] * 100 / p.w, 100 - node.w), y: bounded(node.y + d[1] * 100 / p.h, 100 - node.h) }); } if (e.key === 'Delete') updatePage({ layers: page.layers.filter(n => n.id !== selected) }); }} onPointerDown={e => {
        const pt = point(e), n = hit(page.layers, p, pt.x, pt.y, play) as Layer | undefined;
        if (play) { if (n) { tapListener.current?.({x:pt.x,y:pt.y,from:index,to:n.target,event:n.event||''}); report(n.event ? `触摸事件 · UI:${n.event}` : ''); goto(n.target); } return; } select(n?.id || ''); if (!n) return;
        e.currentTarget.focus(); e.currentTarget.setPointerCapture(e.pointerId); drag.current = { id: n.id, dx: pt.x * 100 / p.w - n.x, dy: pt.y * 100 / p.h - n.y, moved: false, before: scene };
      }} onPointerMove={e => { const d = drag.current; if (!d || !node || d.id !== node.id) return; const pt = point(e); if (!d.moved) { remember(d.before); d.moved = true; } setSaved(false); setScene({ ...scene, pages: scene.pages.map((pg, i) => i !== index ? pg : { ...pg, layers: pg.layers.map(n => n.id !== d.id ? n : { ...n, x: bounded(pt.x * 100 / p.w - d.dx, 100 - n.w), y: bounded(pt.y * 100 / p.h - d.dy, 100 - n.h) }) }) }); }} onLostPointerCapture={() => { drag.current = null; }} />
      {!play && page.layers.filter(n => n.type === 'hotspot' || n.id === selected).map(n => <i key={n.id} className={n.id === selected ? 'chosen' : ''} style={{ left: `${n.x}%`, top: `${n.y}%`, width: `${n.w}%`, height: `${n.h}%` }}/>) }
      {!play && node && <button className="hmi-resize" title="拖动调整控件尺寸" aria-label="拖动调整控件尺寸" style={{left:`${node.x+node.w}%`,top:`${node.y+node.h}%`}} onPointerDown={e=>{
        const bounds=canvas.current!.getBoundingClientRect(); remember(scene); resize.current={left:bounds.left,top:bounds.top,width:bounds.width,height:bounds.height,id:node.id}; e.currentTarget.setPointerCapture(e.pointerId);
      }} onLostPointerCapture={()=>{resize.current=null;}} onPointerMove={e=>{
        const handle=resize.current; if(!handle || handle.id!==node.id) return;
        const w=Math.max(100/p.w,bounded((e.clientX-handle.left)*100/handle.width-node.x,100-node.x));
        const h=Math.max(100/p.h,bounded((e.clientY-handle.top)*100/handle.height-node.y,100-node.y));
        setScene(old=>({...old,pages:old.pages.map((pg,i)=>i!==index?pg:{...pg,layers:pg.layers.map(n=>n.id===handle.id?{...n,w,h}:n)})}));setSaved(false);
      }}/>}</div></div>
      <div className="hmi-viewbar"><button className="quiet-button" disabled={play} onClick={()=>setAssistant(true)}><Sparkles size={15}/>设计助手</button><span>{play?'交互预览':'设计画布'}</span><button title="画布网格" aria-pressed={grid} onClick={()=>setGrid(!grid)}><Grid2X2 size={14}/></button><select aria-label="画布缩放" value={zoom} onChange={e=>setZoom(+e.target.value)}>{[60,80,100,120].map(n=><option key={n} value={n}>{n}%</option>)}</select></div>
      <div className="studio-status"><span>{p.w} × {p.h} · {p.mono ? '1-bit' : 'RGB565'}</span><span>{size.toLocaleString()} B / 当前帧</span><span>{page.frames.length || 1} 帧</span><span>{saved ? '已载入' : '有未保存更改'}</span></div></div>
    <aside className="studio-inspector"><fieldset disabled={play}><h3><Layers size={15}/>图层</h3><div className="studio-palette">{(Object.keys(icons) as Layer['type'][]).map(type => { const Icon = icons[type]; return <button key={type} title={`添加${layerNames[type]}`} aria-label={`添加${layerNames[type]}`} onClick={() => add(type)}><Icon size={16}/></button>; })}<button title="撤销设计修改" disabled={!history.current.length} onClick={undo}><Undo2 size={16}/></button></div>
    <div className="studio-list">{[...page.layers].reverse().map(n => <button key={n.id} className={selected === n.id ? 'current' : ''} onClick={() => select(n.id)}>{layerNames[n.type]}<span>{['bar','box'].includes(n.type) ? '' : n.text}</span></button>)}</div>
    <div className="hmi-layer-tools"><button title="重做设计修改" disabled={!redoStack.current.length} onClick={redo}><Redo2 size={15}/></button><button title="复制图层" disabled={!node || page.layers.length>=64} onClick={()=>{if(!node)return;const copy={...node,id:crypto.randomUUID(),x:bounded(node.x+2,100-node.w),y:bounded(node.y+2,100-node.h)};updatePage({layers:[...page.layers,copy]});select(copy.id);}}><CopyPlus size={15}/></button><button title="水平居中" disabled={!node} onClick={()=>node && updateLayer({x:(100-node.w)/2})}><AlignHorizontalJustifyCenter size={15}/></button><button title="向上一层" disabled={!node || node===page.layers.at(-1)} onClick={()=>shiftLayer(1)}><ArrowUp size={15}/></button><button title="向下一层" disabled={!node || node===page.layers[0]} onClick={()=>shiftLayer(-1)}><ArrowDown size={15}/></button></div>
    {node && rect && <div className="studio-props"><label>图层名称 / 文案<input value={node.text} maxLength={80} onChange={e => updateLayer({ text: e.target.value })}/></label><div className="studio-fields">{(['x','y','w','h'] as const).map(key => <label key={key}>{key.toUpperCase()} / px<input type="number" value={rect[key]} min={key === 'w' || key === 'h' ? 1 : 0} onChange={e => { const extent = key === 'x' || key === 'w' ? p.w : p.h; const limit = { x: 100-node.w, y: 100-node.h, w: 100-node.x, h: 100-node.y }[key]; updateLayer({ [key]: Math.max(key === 'w' || key === 'h' ? 100 / extent : 0, bounded(e.target.valueAsNumber * 100 / extent || 0, limit)) }); }}/></label>)}</div>
    <div className="studio-fields">{(['color','ink'] as const).map(k => <label key={k}>{k === 'ink' ? '文字色' : '填充色'}<input type="color" value={node[k]} onChange={e => updateLayer({ [k]: e.target.value })}/></label>)}</div>{node.type === 'bar' && <label>进度 {node.value}%<input type="range" value={node.value} onChange={e => updateLayer({ value: +e.target.value })}/></label>}
    {['hotspot','button'].includes(node.type) && <><label>点击跳转<select value={node.target} onChange={e => updateLayer({ target: +e.target.value })}>{scene.pages.map((pg,i) => <option value={i} key={i}>{pg.name}</option>)}</select></label><label>串口事件标识<input key={node.id+String(node.event)} defaultValue={node.event || ''} maxLength={32} placeholder="START" onBlur={e=>{const v=e.target.value.trim();if(v && !/^[A-Za-z][A-Za-z0-9_]{0,31}$/.test(v)){report('事件名以英文字母开头，可包含字母、数字和下划线');e.target.value=node.event || '';return;}if(v!==(node.event || '')) updateLayer({event:v || undefined});}}/></label></>}<button className="quiet-button" onClick={() => { updatePage({ layers: page.layers.filter(n => n.id !== selected) }); select(''); }}><Trash2 size={14}/>删除图层</button></div>}
    <details open><summary>页面与素材</summary><label>页面名称<input value={page.name} maxLength={60} onChange={e => updatePage({ name: e.target.value || `页面 ${index+1}` })}/></label><label>画布底色<input type="color" value={page.bg} onChange={e => updatePage({ bg: e.target.value })}/></label><div className="studio-buttons"><button onClick={() => asset.current?.click()}><ImagePlus size={14}/>导入图像 / GIF</button><button disabled={!page.frames.length} onClick={() => action(async () => { const found = await hotspots(page.frames[0].png, (index+1)%scene.pages.length); const added = found.slice(0, 64-page.layers.length); updatePage({ layers: [...page.layers,...added] }); report(`已提取 ${added.length} 个候选热区，请核对位置和跳转目标`); })}><Scan size={14}/>识别热区</button>{!!page.frames.length && <button onClick={() => updatePage({frames: []})}>移除底图</button>}</div></details>
    <details><summary>屏幕接口与编码</summary><p className="muted">{p.mono ? `显示缓冲 ${Math.ceil(p.w/8)*p.h} B` : `扫描行缓冲 ${p.w*2} B`} · 全屏传输 {p.mono ? Math.ceil(p.w/8)*p.h : p.w*p.h*2} B</p><label>像素压缩<select value={scene.codec} onChange={e => edit({...scene, codec: e.target.value as Scene['codec']})}><option value="auto">逐帧择小</option><option value="raw">原始像素</option><option value="rle">游程编码 RLE</option></select></label>{p.mono ? <><label>二值化阈值 {scene.threshold}<input type="range" min="1" max="254" value={scene.threshold} onChange={e => edit({...scene,threshold: +e.target.value})}/></label><label>I²C 地址<select value={scene.address} onChange={e => edit({...scene,address: e.target.value as Scene['address']})}><option>0x3C</option><option>0x3D</option></select></label></> : null}
    {p.mono && <label className="checkbox"><input type="checkbox" checked={!!scene.dither} onChange={e=>edit({...scene,dither:e.target.checked})}/>灰阶有序抖动</label>}
    <label>触摸控制器<select value={scene.touch} onChange={e => edit({...scene,touch: e.target.value as Scene['touch']})}><option value="none">无 / 外部调用 uiTap</option><option value="xpt2046">XPT2046 · SPI</option></select></label><div className="studio-fields">{(['cs','dc','rst','touchCs'] as const).filter(k => k==='touchCs' ? scene.touch==='xpt2046' : !p.mono).map(k => <label key={k}>{k.toUpperCase()} / GPIO<input type="number" value={scene[k]} onChange={e => edit({...scene,[k]: Math.max(k==='rst' ? -1 : 0, Math.min(127, +e.target.value || 0))})}/></label>)}</div>
    {scene.touch==='xpt2046' && <><label>触摸轴旋转<select value={touchMap.rotation} onChange={e=>edit({...scene,calibration:{...touchMap,rotation:+e.target.value}})}>{[0,1,2,3].map(n=><option key={n} value={n}>{n*90}°</option>)}</select></label><div className="studio-fields">{(['x0','x1','y0','y1'] as const).map(k=><label key={k}>{k.toUpperCase()} 原始值<input type="number" min={0} max={4095} value={touchMap[k]} onChange={e=>edit({...scene,calibration:{...touchMap,[k]:bounded(Math.round(+e.target.value),4095)}})}/></label>)}</div></>}</details></fieldset>
    <ScreenRegression scene={scene} index={index} scope={deviceId+':'+root} listener={tapListener} preview={()=>{setPlay(true);setFrame(0);select('');}} go={goto}/>
    <div className="studio-buttons"><button onClick={assist}><Bot size={15}/>Agent 设计审查</button><button onClick={tools}><SlidersHorizontal size={14}/>工具链</button><button onClick={() => download('screen.design.json', JSON.stringify(scene), 'application/json')}><Download size={14}/>导出设计</button><button disabled={play} onClick={() => project.current?.click()}><FileInput size={14}/>打开设计</button></div></aside></div>
    <input ref={asset} type="file" hidden accept="image/png,image/jpeg,image/gif" onChange={e => { const f=e.target.files?.[0]; e.target.value=''; if (f) void action(async () => { const frames=await importArt(f,p); const next={...scene,pages:scene.pages.map((pg,i)=>i===index ? {...pg,frames} : pg)}; sceneSchema.parse(next); edit(next); setFrame(0); }); }}/><input ref={project} hidden type="file" accept=".json" onChange={e=>{const f=e.target.files?.[0]; e.target.value=''; if (f) void action(async()=>{ if(f.size>10*1024*1024) throw new Error('设计文件超过 10 MiB'); edit(sceneSchema.parse(JSON.parse(await f.text()))); goto(0); }); }}/>
    <button className="quiet-button" onClick={() => action(async () => {
      const { code } = await firmware(scene);
      await api('/display/design', {deviceId, root, scene}); setSaved(true);
      const project = await api<{root: string}>('/display/sketch', {deviceId, root, code}); openProject(project.root);
    })}><AppWindow size={14}/>生成并打开编译工程</button>
    {(message || busy) && <output aria-live="polite">{busy ? '正在处理…' : message}</output>}
    {assistant && <DesignAssistant scene={scene} current={index} deviceId={deviceId} root={root} close={()=>setAssistant(false)} apply={(next,start)=>{edit(next);goto(start);setAssistant(false);report('已应用设计草案');}}/>}
  </fieldset>;
}
