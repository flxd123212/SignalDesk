import { useEffect, useRef, useState } from 'react';
import { Bot, Check, Grid2X2, ImagePlus, LayoutTemplate, LoaderCircle, Sparkles, ToggleLeft, X } from 'lucide-react';
import { appendBlueprint, designPreset } from '../../shared/display-blueprint.mjs';
import { panelFor } from '../../shared/display-scene.mjs';
import { hotspots, makeLayer, paint, type Scene } from './scene';

const skills = [
  { key: 'menu', name: '多级菜单', icon: Grid2X2 }, { key: 'switch', name: '状态切换', icon: ToggleLeft },
  { key: 'image', name: '图像热区', icon: ImagePlus }, { key: 'model', name: '自然语言', icon: Bot },
] as const;
type Skill = typeof skills[number]['key'];
interface Props { scene: Scene; current: number; deviceId: string; root: string; close: () => void; apply: (draft: Scene, entry: number) => void }

async function imageDraft(scene: Scene, current: number) {
  const base = scene.pages[current], available = 8 - scene.pages.length;
  if (!base.frames.length) throw new Error('请先在当前页导入图片或 GIF');
  if (!available) throw new Error('页面已满');
  const regions = (await hotspots(base.frames[0].png, current)).slice(0, Math.min(available, 64 - base.layers.length));
  if (!regions.length) throw new Error('没有可用的矩形热区，请在画布中手动添加');
  const links = regions.map((n,i) => ({...n, target: scene.pages.length + i, event: `REGION_${i + 1}`}));
  const pages = scene.pages.map((pg,i) => i === current ? {...pg, layers:[...pg.layers,...links]} : pg);
  for (const link of links) pages.push({ name:link.text, bg:'#122029', frames:[], layers:[makeLayer('text',{text:link.text,w:85,h:33}), makeLayer('button',{text:'返回',y:64,target:current,color:'#92ecd2',ink:'#102224'})] });
  return { ...scene, pages };
}

function Thumbnail({scene,index}: {scene:Scene; index:number}) {
  const ref=useRef<HTMLCanvasElement>(null), panel=panelFor(scene.profile);
  useEffect(()=>{ let live=true; void paint(scene,index,0).then(result=>{if(live) ref.current?.getContext('2d')?.drawImage(result.canvas,0,0);}).catch(()=>{}); return ()=>{live=false;}; },[scene,index]);
  return <canvas ref={ref} aria-label="设计草案预览" width={panel.w} height={panel.h}/>;
}

export function DesignAssistant({scene,current,deviceId,root,close,apply}: Props) {
  const modal=useRef<HTMLDialogElement>(null), request=useRef<AbortController | null>(null);
  const [skill,setSkill]=useState<Skill>('menu'), [prompt,setPrompt]=useState(''), [error,setError]=useState(''), [busy,setBusy]=useState(false);
  const [draft,setDraft]=useState<Scene | null>(null), [preview,setPreview]=useState(0), [boot,setBoot]=useState(false);
  const entry=skill==='image' ? current : scene.pages.length;
  useEffect(()=>{modal.current?.showModal(); return ()=>{request.current?.abort();};},[]);
  async function generate() {
    const controller=new AbortController(); request.current=controller;
    setBusy(true); setError(''); setDraft(null);
    try {
      let next: Scene;
      if(skill==='image') next=await imageDraft(scene,current);
      else {
        let plan;
        if(skill==='model') {
          if (!prompt.trim()) throw new Error('请输入要生成的界面');
          if (scene.pages.length >= 8) throw new Error('页面已满');
          const response=await fetch('/api/display/proposal',{method:'POST',headers:{'Content-Type':'application/json'},signal:controller.signal,body:JSON.stringify({deviceId,root,prompt,profile:scene.profile,capacity:Math.min(4,8-scene.pages.length)})});
          const body=await response.json(); if(!response.ok) throw new Error(body.error || '生成失败'); plan=body;
        } else plan=designPreset(skill,prompt);
        next=appendBlueprint(scene,plan,()=>crypto.randomUUID());
      }
      if (!controller.signal.aborted) { setDraft(next); setPreview(entry); }
    } catch(err) { if(!controller.signal.aborted) setError((err as Error).message); } finally { if(!controller.signal.aborted) setBusy(false); }
  }
  function accept() {
    if (!draft) return;
    if (!boot || !entry) { apply(draft,entry); return; }
    const order=[entry,...draft.pages.map((_,i)=>i).filter(i=>i!==entry)];
    apply({...draft,pages:order.map(i=>({...draft.pages[i],layers:draft.pages[i].layers.map(n=>({...n,target:order.indexOf(n.target)}))}))},0);
  }
  return <dialog ref={modal} className="hmi-assistant" aria-label="界面设计助手" onCancel={close}>
    <header><Sparkles size={19}/><h2>界面设计助手</h2><button title="关闭设计助手" onClick={close}><X size={17}/></button></header>
    <div className="hmi-assistant-body"><nav aria-label="设计技能">{skills.map(({key,name,icon:Icon})=><button key={key} aria-pressed={skill===key} disabled={busy} onClick={()=>{setSkill(key);setDraft(null);setError('');setPrompt('');}}><Icon size={17}/>{name}</button>)}</nav>
      <section><label>{skill==='model'?'设计需求':skill==='image'?'图像来源':'界面标题'}{skill==='image'?<span>{scene.pages[current].name} · {scene.pages[current].frames.length} 帧</span>:<textarea value={prompt} maxLength={skill==='model'?900:40} disabled={busy} onChange={e=>{setPrompt(e.target.value);setDraft(null);}} placeholder={skill==='model'?'例如：温控面板，首页显示温度，点击启动进入运行页。':'使用默认标题'}/>}</label>
      <p>{skill==='model'?'需求和屏幕规格将发送给当前配置的模型。':skill==='image'?'从底图首帧提取矩形热区，为每个热区生成详情页和返回按钮。':skill==='switch'?'待机和运行两页，按钮绑定 START、STOP 串口事件。':'菜单、状态和设置三页，带导航和返回按钮。'}</p>
      <button className="quiet-button" disabled={busy} onClick={generate}>{busy?<LoaderCircle className="spin" size={15}/>:<LayoutTemplate size={15}/>}生成草案</button>
      {error && <p role="alert">{error}</p>}{draft && <div className="hmi-draft"><Thumbnail scene={draft} index={preview}/><select aria-label="草案页面" value={preview} onChange={e=>setPreview(+e.target.value)}>{draft.pages.map((pg,i)=>(i>=scene.pages.length || i===entry) && <option key={i} value={i}>{pg.name}</option>)}</select><label className="checkbox"><input type="checkbox" checked={boot} onChange={e=>setBoot(e.target.checked)}/>将草案首页设为开机页</label></div>}</section></div>
    <footer><span>{draft ? `新增 ${draft.pages.length-scene.pages.length} 页` : panelFor(scene.profile).driver}</span><button className="primary" disabled={!draft || busy} onClick={accept}><Check size={14}/>应用到设计</button></footer>
  </dialog>;
}
