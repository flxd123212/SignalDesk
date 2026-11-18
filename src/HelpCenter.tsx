import { useEffect, useRef, useState } from 'react';
import { ArrowLeft, ArrowRight, BookOpen, Check, CheckCircle2, ExternalLink, RotateCcw, Search, ShieldCheck, X } from 'lucide-react';
import { tutorials } from '../shared/tutorials.mjs';
import { setPreferences, usePreferences } from './preferences';
import { IconButton } from './ui';
import { useSurfaceMotion } from './motion';
import './help.css';

export function HelpCenter({ initial, close, perform }: { initial: string; close: () => void; perform: (action: string, guide: string) => void }) {
  const dialog = useRef<HTMLDialogElement>(null), searchInput = useRef<HTMLInputElement>(null), content = useRef<HTMLElement>(null), prefs = usePreferences();
  const [selected, setSelected] = useState(initial), [query, setQuery] = useState(''), [advanced, setAdvanced] = useState(tutorials.some(item => item.id === initial && item.group === '进阶'));
  const guide = tutorials.find(item => item.id === selected) || tutorials[0], position = prefs.tutorial.positions[guide.id] || 0, step = guide.steps[position];
  const finished = prefs.tutorial.completed.includes(guide.id), surface = useSurfaceMotion(`${guide.id}:${position}`);
  useEffect(() => {
    const previous = document.activeElement, element = dialog.current;
    element?.showModal(); searchInput.current?.focus();
    return () => { element?.close(); if (previous instanceof HTMLElement && previous.isConnected) previous.focus(); };
  }, []);
  useEffect(() => { content.current?.scrollTo({ top: 0 }); }, [guide.id, position]);
  useEffect(() => { dialog.current?.querySelector('.help-library [aria-current="page"]')?.scrollIntoView({ block: 'nearest', inline: 'nearest' }); }, [guide.id, advanced, query]);
  const save = (index: number) => setPreferences({ tutorial: { ...prefs.tutorial, dismissed: true, lastGuide: guide.id, positions: { ...prefs.tutorial.positions, [guide.id]: index } } });
  const choose = (id: string) => { setSelected(id); setPreferences({ tutorial: { ...prefs.tutorial, lastGuide: id } }); };
  const matches = tutorials.filter(item => (advanced || query.trim() || item.group !== '进阶') && query.toLowerCase().trim().split(/\s+/).every(word => `${item.title} ${item.summary} ${item.group} ${item.steps.map(step => step.title + step.body).join(' ')}`.toLowerCase().includes(word)));
  return <dialog ref={dialog} className="help-center" aria-label="帮助与教程" onCancel={close} onClick={event => { if (event.target === dialog.current) close(); }}>
    <header className="help-header"><BookOpen size={19} /><h2>帮助与教程</h2><span>SignalDesk</span><IconButton title="关闭教程" onClick={close}><X size={18} /></IconButton></header>
    <div className="help-body"><aside className="help-library" aria-label="教程目录"><label className="help-search"><Search size={15} /><input ref={searchInput} aria-label="搜索教程" placeholder="搜索教程与问题" value={query} onChange={event => setQuery(event.target.value)} />{query && <IconButton title="清除教程搜索" onClick={() => setQuery('')}><X size={13} /></IconButton>}</label>
      <div className="help-library-status">已完成 {prefs.tutorial.completed.length} / {tutorials.length}</div><nav aria-label="选择教程">{matches.map(item => <button key={item.id} aria-current={guide.id === item.id ? 'page' : undefined} onClick={() => choose(item.id)}><span className="help-guide-name">{item.title}{prefs.tutorial.completed.includes(item.id) && <CheckCircle2 size={14} aria-label="已完成" />}</span><small>{item.group} · {item.steps.length} 步</small></button>)}{!query.trim() && <button className="help-advanced-toggle" aria-expanded={advanced} onClick={() => setAdvanced(!advanced)}>{advanced ? '收起进阶教程' : '更多进阶教程'}<span>{tutorials.filter(item => item.group === '进阶').length}</span></button>}</nav>{!matches.length && <p className="help-no-results">没有匹配的教程，试试“串口”“编译”或“AI”。</p>}</aside>
      <div className="help-lesson"><section ref={content} className="help-lesson-scroll"><div className="help-lesson-heading"><span>{guide.group} / {guide.steps.length} 步</span>{finished && <span className="help-finished"><Check size={13} />已完成</span>}<h3>{guide.title}</h3><p>{guide.summary}</p></div>
        <ol className="help-steps" aria-label="教程步骤">{guide.steps.map((item, index) => <li key={item.title}><button aria-label={`第 ${index + 1} 步：${item.title}`} aria-current={position === index ? 'step' : undefined} onClick={() => save(index)}><span>{index + 1}</span><span>{item.title}</span></button></li>)}</ol>
        <article ref={surface} className="help-step" aria-label={`教程内容：${step.title}`}><div className="help-step-number">STEP {String(position + 1).padStart(2, '0')}</div><h4>{step.title}</h4><p>{step.body}</p>{step.code && <pre><code>{step.code}</code></pre>}<div className="help-expectation"><CheckCircle2 size={17} /><div><strong>确认结果</strong><p>{step.expected}</p></div></div>{step.caution && <div className="help-caution"><ShieldCheck size={16} /><p>{step.caution}</p></div>}<button className="primary help-action" onClick={() => perform(step.action, guide.id)}><ExternalLink size={15} />{step.label}</button></article>
      </section><footer className="help-footer"><button className="quiet-button" aria-label="从头学习本教程" onClick={() => { setPreferences({ tutorial: { ...prefs.tutorial, dismissed: true, lastGuide: guide.id, positions: { ...prefs.tutorial.positions, [guide.id]: 0 }, completed: prefs.tutorial.completed.filter(id => id !== guide.id) } }); }}><RotateCcw size={14} /><span>重学</span></button><span className="help-step-count" aria-live="polite">{position + 1} / {guide.steps.length}</span><button className="quiet-button" disabled={position === 0} onClick={() => save(position - 1)}><ArrowLeft size={14} /><span>上一步</span></button>{position < guide.steps.length - 1 ? <button className="primary" onClick={() => save(position + 1)}>下一步<ArrowRight size={14} /></button> : <button className="primary" disabled={finished} onClick={() => setPreferences({ tutorial: { ...prefs.tutorial, dismissed: true, lastGuide: guide.id, completed: [...prefs.tutorial.completed, guide.id] } })}><Check size={14} />{finished ? '已完成' : '完成教程'}</button>}</footer></div>
    </div>
  </dialog>;
}

export function LearningBar({ active, start, resume, dismiss }: { active: string | null; start: () => void; resume: () => void; dismiss: () => void }) {
  const prefs = usePreferences(), guide = tutorials.find(item => item.id === active);
  if (!guide && prefs.tutorial.dismissed) return null;
  return <section className={`learning-bar ${guide ? 'learning-active' : ''}`} aria-label={guide ? '当前教程' : '新手入门提示'}><BookOpen size={17} /><div><strong>{guide ? guide.title : '第一次使用 SignalDesk？'}</strong><span>{guide ? guide.steps[prefs.tutorial.positions[guide.id] || 0].title : '从一个任务开始'}</span></div><button className="quiet-button" onClick={guide ? resume : start}>{guide ? '继续教程' : '开始入门'}<ArrowRight size={14} /></button><IconButton title={guide ? '结束本次引导' : '暂不显示入门提示'} onClick={dismiss}><X size={15} /></IconButton></section>;
}
