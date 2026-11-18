import { useRef, useState } from 'react';
import { Check, ImagePlus, RotateCcw, Trash2 } from 'lucide-react';
import { accents, defaults, setPreferences, usePreferences } from './preferences';
import { accentInk, normalizeColor, removeBackground, saveBackground, useBackground } from './appearance';
import { Field } from './ui';
import type { CSSProperties } from 'react';

function ColorControl({ label, value, change }: { label: string; value: string; change: (value: string) => void }) {
  const [draft, setDraft] = useState<string | null>(null), [error, setError] = useState('');
  const commit = () => {
    const next = normalizeColor(draft ?? value, '');
    if (!next) { setError('请输入有效颜色，例如 #73D8BB'); return; }
    change(next); setDraft(null); setError('');
  };
  return <div className="theme-color-control"><label>{label}</label><div><input aria-label={`${label}选择器`} type="color" value={value} onChange={event => { change(event.target.value); setDraft(null); setError(''); }} /><input aria-label={`${label} HEX`} type="text" maxLength={7} value={draft ?? value.toUpperCase()} spellCheck={false} aria-invalid={Boolean(error)} onChange={event => { setDraft(event.target.value); setError(''); }} onBlur={commit} onKeyDown={event => { if (event.key === 'Enter') commit(); if (event.key === 'Escape') { setDraft(null); setError(''); } }} /></div>{error && <small role="alert">{error}</small>}</div>;
}

export function AppearanceSettings({ notify }: { notify: (message: string, error?: boolean) => void }) {
  const prefs = usePreferences(), upload = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false), [error, setError] = useState('');
  const background = useBackground(prefs.backgroundImage);
  const update = (value: Parameters<typeof setPreferences>[0]) => { if (!setPreferences(value)) notify('设置已生效，但未能保存到浏览器', true); };
  const image = prefs.backgroundMode === 'image' && background.url;
  return <div className="appearance-settings">
    <div className="theme-preview" aria-label="主题效果预览" style={{ '--preview-accent': prefs.accent, '--preview-ink': accentInk(prefs.accent), backgroundColor: prefs.backgroundColor } as CSSProperties}>
      {image && <div className="theme-preview-image" style={{ backgroundImage: `url("${image}")`, backgroundSize: prefs.backgroundFit, filter: `blur(${prefs.backgroundBlur / 3}px)` }} />}
      <div className="theme-preview-shade" style={{ opacity: prefs.backgroundMode === 'default' ? 1 : prefs.backgroundDim / 100 }} />
      <div className="theme-preview-toolbar"><i /><span>SignalDesk</span><span>main.cpp</span></div>
      <div className="theme-preview-code"><span>void</span> setup() {'{'}<br />&nbsp; Serial.begin(<b>115200</b>);<br />{'}'}</div>
      <div className="theme-preview-bottom"><span>READY</span><b>运行</b></div>
    </div>
    <h4>界面风格</h4>
    <div className="finish-options" role="group" aria-label="界面风格">
      {(['lab', 'graphite'] as const).map(finish => <button key={finish} aria-pressed={prefs.finish === finish} onClick={() => update({ finish })}>
        <i data-finish-sample={finish} aria-hidden="true" />{finish === 'lab' ? '银灰仪器台' : '深色石墨'}{prefs.finish === finish && <Check size={14} />}
      </button>)}
    </div>
    <h4>主题色</h4>
    <div className="theme-presets">{accents.map((color, index) => <button key={color} title={['薄荷绿', '晴空蓝', '琥珀金', '玫瑰粉'][index]} aria-label={`主题预设 ${index + 1}`} aria-pressed={prefs.accent === color} style={{ background: color }} onClick={() => update({ accent: color })}>{prefs.accent === color && <Check size={14} />}</button>)}</div>
    <ColorControl label="自定义主题色" value={prefs.accent} change={accent => update({ accent })} />
    <h4>工作区背景</h4>
    <Field label="背景类型"><select aria-label="背景类型" disabled={busy} value={prefs.backgroundMode} onChange={event => update({ backgroundMode: event.target.value as typeof prefs.backgroundMode })}><option value="default">默认</option><option value="color">纯色</option><option value="image">本地图片</option></select></Field>
    {prefs.backgroundMode !== 'default' && <>
      <ColorControl label="背景颜色" value={prefs.backgroundColor} change={backgroundColor => update({ backgroundColor })} />
      {prefs.backgroundMode === 'image' && <>
        <div className="background-file-actions"><button className="quiet-button" disabled={busy} onClick={() => upload.current?.click()}><ImagePlus size={15} />{busy ? '正在处理…' : prefs.backgroundImage ? '更换背景图片' : '选择背景图片'}</button><button className="quiet-button" disabled={busy || !prefs.backgroundImage} onClick={async () => { setBusy(true); setError(''); try { await removeBackground(prefs.backgroundImage); update({ backgroundImage: '', backgroundMode: 'default' }); } catch (error) { setError((error as Error).message); } finally { setBusy(false); } }}><Trash2 size={14} />移除图片</button></div>
        <input ref={upload} type="file" hidden accept="image/png,image/jpeg,image/webp" aria-label="上传背景图片" onChange={async event => { const file = event.target.files?.[0]; event.target.value = ''; if (!file) return; setBusy(true); setError(''); try { const id = await saveBackground(file); update({ backgroundImage: id, backgroundMode: 'image' }); notify('背景图片已保存到本机'); } catch (error) { setError((error as Error).message); } finally { setBusy(false); } }} />
        <Field label="图片显示"><select aria-label="图片显示" value={prefs.backgroundFit} onChange={event => update({ backgroundFit: event.target.value as typeof prefs.backgroundFit })}><option value="cover">填充</option><option value="contain">完整显示</option></select></Field>
        <label className="theme-slider"><span>背景模糊</span><input aria-label="背景模糊" type="range" min="0" max="12" value={prefs.backgroundBlur} onChange={event => update({ backgroundBlur: Number(event.target.value) })} /><output>{prefs.backgroundBlur} px</output></label>
      </>}
      <label className="theme-slider"><span>背景遮罩</span><input aria-label="背景遮罩" type="range" min="20" max="90" value={prefs.backgroundDim} onChange={event => update({ backgroundDim: Number(event.target.value) })} /><output>{prefs.backgroundDim}%</output></label>
    </>}
    {(error || prefs.backgroundMode === 'image' && background.error) && <p className="appearance-error" role="alert">{error || background.error}</p>}
    <button className="quiet-button theme-reset" disabled={busy} onClick={() => update({ finish: defaults.finish, accent: defaults.accent, backgroundMode: 'default', backgroundColor: defaults.backgroundColor, backgroundDim: defaults.backgroundDim, backgroundBlur: defaults.backgroundBlur, backgroundFit: defaults.backgroundFit })}><RotateCcw size={14} />恢复默认主题</button>
  </div>;
}
