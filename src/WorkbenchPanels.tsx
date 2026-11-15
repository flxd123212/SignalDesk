import { useEffect, useRef, useState } from 'react';
import { Bot, ChevronDown, Code2, FileCode2, FlaskConical, Folder, FolderPlus, FolderTree, Hammer, Plug, RefreshCw, ScrollText, Search, TerminalSquare, Unplug, X } from 'lucide-react';
import type { AppState } from './types';
import { api } from './data';
import { IconButton } from './ui';
import { Editor } from './Editor';
import { languages, languageForFile, type LanguageId } from './languages';
import { ToolchainConsole } from './AgentExtras';
import { Logs } from './ProjectTools';
import { ValidationPanel } from './ValidationPanel';
import type { ValidationRequest } from './ValidationPanel';
import { sourceOutline } from './SourceNavigation';
import type { OutlineItem } from './SourceNavigation';
import { getPreferences, setPreferences, usePreferences } from './preferences';

type Notify = (message: string, error?: boolean) => void;
type FileEntry = { path: string; bytes: number };
export type AgentRequest = { id: number; file: string; prompt: string };

export function usePanelSize(key: string, initial: number, min: number, max: number) {
  const preferences = usePreferences();
  const [fallback] = useState(() => { try { const value = Number(localStorage.getItem(`signaldesk.layout.${key}`)); return value >= min && value <= max ? value : initial; } catch { return initial; } });
  const stored = preferences.layout[key], size = typeof stored === 'number' ? Math.max(min, Math.min(max, stored)) : fallback;
  const update = (value: number) => { const next = Math.max(min, Math.min(max, Math.round(value))); setPreferences({ layout: { ...getPreferences().layout, [key]: next } }); };
  return { size, update, initial, min, max };
}
export function PanelDivider({ panel, label, horizontal = false, reverse = false }: { panel: ReturnType<typeof usePanelSize>; label: string; horizontal?: boolean; reverse?: boolean }) {
  const drag = useRef<{ position: number; size: number } | null>(null), sign = reverse ? -1 : 1;
  return <div role="separator" tabIndex={0} aria-label={label} aria-orientation={horizontal ? 'horizontal' : 'vertical'} aria-valuenow={panel.size} aria-valuemin={panel.min} aria-valuemax={panel.max} className={`panel-divider ${horizontal ? 'horizontal' : ''}`}
    onPointerDown={event => { if (event.button !== 0) return; drag.current = { position: horizontal ? event.clientY : event.clientX, size: panel.size }; event.currentTarget.setPointerCapture(event.pointerId); event.preventDefault(); }}
    onPointerMove={event => { if (drag.current) panel.update(drag.current.size + ((horizontal ? event.clientY : event.clientX) - drag.current.position) * sign); }}
    onPointerUp={() => { drag.current = null; }} onLostPointerCapture={() => { drag.current = null; }} onDoubleClick={() => panel.update(panel.initial)}
    onKeyDown={event => { const previous = horizontal ? 'ArrowUp' : 'ArrowLeft', next = horizontal ? 'ArrowDown' : 'ArrowRight'; if ([previous, next, 'Home', 'End'].includes(event.key)) { event.preventDefault(); panel.update(event.key === 'Home' ? panel.min : event.key === 'End' ? panel.max : panel.size + (event.key === next ? 16 : -16) * sign); } }} />;
}

function Files({ files, prefix = '', selected, open, filtered }: { files: FileEntry[]; prefix?: string; selected: string; open: (file: string) => void; filtered: boolean }) {
  const directories = [...new Set(files.map(file => file.path.slice(prefix.length)).filter(file => file.includes('/')).map(file => file.split('/')[0]))];
  return <>{directories.map(directory => <details key={directory} open={filtered || undefined} className="explorer-folder"><summary><ChevronDown size={12} /><Folder size={14} />{directory}</summary><Files files={files.filter(file => file.path.startsWith(`${prefix}${directory}/`))} prefix={`${prefix}${directory}/`} selected={selected} open={open} filtered={filtered} /></details>)}{files.filter(file => !file.path.slice(prefix.length).includes('/')).map(file => <button className={`explorer-file ${selected === file.path ? 'active' : ''}`} key={file.path} title={file.path} aria-label={`打开文件 ${file.path}`} onClick={() => open(file.path)}><FileCode2 size={14} /><span>{file.path.slice(prefix.length)}</span></button>)}</>;
}
export function ProjectExplorer({ state, selected, open, addProject, notify, opened, closeFile, outline, jump, openHardware }: { state: AppState; selected: string; open: (file: string) => void; addProject: () => void; notify: Notify; opened: string[]; closeFile: (file: string) => void; outline: OutlineItem[]; jump: (file: string, line: number) => void; openHardware: () => void }) {
  const [hardwareFiles, setHardwareFiles] = useState<FileEntry[]>([]);
  const device = state.devices?.find(item => item.id === state.activeDevice), [files, setFiles] = useState<FileEntry[]>([]), [search, setSearch] = useState(''), [error, setError] = useState(''), [revision, setRevision] = useState(0);
  useEffect(() => { let current = true; setFiles([]); setError(''); api<FileEntry[]>(`/ai/files?deviceId=${encodeURIComponent(state.activeDevice || '')}`).then(value => { if (current) setFiles(value); }).catch(error => { if (current) setError(error.message); }); return () => { current = false; }; }, [state.activeDevice, device?.projectRoot, revision]);
  useEffect(() => { let current = true; setHardwareFiles([]); api<{ files: FileEntry[] }>(`/hardware?deviceId=${encodeURIComponent(state.activeDevice || '')}`).then(value => { if (current) setHardwareFiles(value.files); }).catch(() => {}); return () => { current = false; }; }, [state.activeDevice, device?.projectRoot, revision]);
  const filtered = files.filter(file => file.path.toLowerCase().includes(search.toLowerCase()));
  return <section className="project-explorer" aria-label="项目资源管理器"><div className="explorer-heading"><FolderTree size={15} /><b>项目与设备</b><IconButton title="刷新项目文件" onClick={() => setRevision(value => value + 1)}><RefreshCw size={14} /></IconButton><IconButton title="导入项目" onClick={addProject}><FolderPlus size={15} /></IconButton></div>
    <details className="explorer-opened" open><summary>打开的编辑器 <small>{opened.length}</small></summary><div>{opened.map(file => <div className={selected === file ? 'active' : ''} key={file}><button title={file} aria-label={`切换已打开文件 ${file}`} onClick={() => open(file)}><FileCode2 size={13} /><span>{file.split('/').at(-1)}</span><small>{file.includes('/') ? file.slice(0, file.lastIndexOf('/')) : ''}</small></button><IconButton title={`从编辑器列表关闭 ${file}`} onClick={() => closeFile(file)}><X size={12} /></IconButton></div>)}</div></details>
    <details className="explorer-device-list"><summary>设备 <span>{state.devices?.length || 0}</span></summary><div className="explorer-devices">{state.devices?.map(item => <button key={item.id} title={item.projectRoot} className={item.id === state.activeDevice ? 'active' : ''} onClick={() => api('/devices/select', { id: item.id }).catch(error => notify(error.message, true))}><span className={`status-dot ${item.connected ? 'live' : ''}`} /><span>{item.name}<small>{item.chip || '芯片待标记'} · {item.path === 'unassigned' ? '未匹配串口' : item.path}</small></span></button>)}</div></details>
    <div className="explorer-root" title={device?.projectRoot}><Folder size={14} /><span>{device?.projectRoot?.split(/[\\/]/).at(-1) || '未绑定工程'}</span><small>{files.length}</small></div>
    <div className="explorer-search"><Search size={13} /><input aria-label="筛选项目文件" value={search} onChange={event => setSearch(event.target.value)} placeholder="查找文件" /></div>
    <div className="explorer-files"><Files files={filtered} selected={selected} open={open} filtered={!!search} />{!filtered.length && <p className="muted">{error || (search ? '没有匹配文件' : '暂无可读取的源码文件')}</p>}</div>
    <details className="explorer-hardware"><summary>硬件文件 <small>{hardwareFiles.length}</small></summary><div>{hardwareFiles.map(file => <button key={file.path} className="explorer-file" title={file.path} onClick={openHardware}><FileCode2 size={13} /><span>{file.path}</span></button>)}<button className="explorer-file" onClick={openHardware}><Folder size={13} />网表与引脚映射</button></div></details>
    <details className="explorer-outline" open><summary>大纲 <small>{outline.length}</small></summary><div>{outline.length ? outline.map(item => <button key={`${item.line}:${item.name}`} aria-label={`跳转到 ${item.name}，第 ${item.line} 行`} title={`${selected}:${item.line}`} onClick={() => jump(selected, item.line)}><span className={`symbol-kind ${item.kind}`}>{item.kind === 'function' ? 'ƒ' : 'T'}</span><span>{item.name}</span><small>{item.line}</small></button>) : <span className="outline-empty">暂无可识别符号</span>}</div></details>
    {device?.projectProfile && <div className="explorer-target"><span>活动构建目标</span><b>{device.projectProfile.target}</b><code title={device.projectProfile.buildCommand}>{device.projectProfile.buildCommand || '构建工具待配置'}</code></div>}
  </section>;
}

export function SourceWorkspace({ file, state, analyze, notify, validate, jump, outlineChange }: { file: string; state: AppState; analyze: (file: string) => void; notify: Notify; validate: (mode: 'build' | 'test') => void; jump?: { id: number; line: number }; outlineChange: (file: string, items: OutlineItem[]) => void }) {
  const [languageOverride, setLanguageOverride] = useState<LanguageId | ''>('');
  const sourceLanguage = languageOverride || languageForFile(file);
  useEffect(() => setLanguageOverride(''), [file]);
  const [searchOpen, setSearchOpen] = useState(false);
  const [cursor, setCursor] = useState({ line: 1, column: 1 });
  const [content, setContent] = useState(''), [hash, setHash] = useState(''), [loading, setLoading] = useState(false), [revision, setRevision] = useState(0), [search, setSearch] = useState(''), [line, setLine] = useState(0), [error, setError] = useState('');
  useEffect(() => { let current = true; setContent(''); setHash(''); setLine(0); setError(''); if (!file) return; setLoading(true); api<{ content: string; hash: string }>(`/ai/file?deviceId=${encodeURIComponent(state.activeDevice || '')}&path=${encodeURIComponent(file)}`).then(value => { if (current) { setContent(value.content); setHash(value.hash); } }).catch(error => { if (current) setError(error.message); }).finally(() => { if (current) setLoading(false); }); return () => { current = false; }; }, [file, state.activeDevice, revision]);
  const find = () => { if (!search) return; const lines = content.split('\n'), matches = lines.map((text, index) => text.toLowerCase().includes(search.toLowerCase()) ? index + 1 : 0).filter(Boolean); if (!matches.length) { notify('当前文件中未找到匹配内容'); return; } setLine(matches.find(index => index > line) || matches[0]); };
  useEffect(() => { if (jump) { setSearchOpen(true); setLine(jump.line); setRevision(value => value + 1); } }, [jump?.id]);
  useEffect(() => { if (jump && !loading) setLine(jump.line); }, [loading, jump?.id]);
  useEffect(() => { outlineChange(file, sourceOutline(file, content)); }, [file, content]);
  return <section className="source-workspace" aria-label="项目源码浏览"><div className="source-breadcrumb"><FileCode2 size={15} /><span>{file || '未打开文件'}</span><small>只读</small><IconButton title="编译当前工程" onClick={() => validate('build')}><Hammer size={15} /></IconButton><IconButton title="选择并运行测试" onClick={() => validate('test')}><FlaskConical size={15} /></IconButton><IconButton title="搜索与跳转源码" aria-expanded={searchOpen} onClick={() => setSearchOpen(!searchOpen)}><Search size={14} /></IconButton><IconButton title="刷新当前源码" disabled={!file || loading} onClick={() => setRevision(value => value + 1)}><RefreshCw size={14} /></IconButton><button className="quiet-button" disabled={!file || loading || !!error} onClick={() => analyze(file)}><Bot size={14} />交给 Agent 审查</button></div>
    {file ? <><div className="source-search" hidden={!searchOpen}><Search size={14} /><input aria-label="搜索源码" placeholder="搜索当前文件" value={search} onChange={event => setSearch(event.target.value)} onKeyDown={event => { if (event.key === 'Enter' && !event.nativeEvent.isComposing) find(); }} /><button className="quiet-button" onClick={find}>下一个</button><label>行<input aria-label="跳转源码行" type="number" min={1} max={content.split('\n').length} value={line || ''} onChange={event => setLine(Math.max(1, Number(event.target.value) || 1))} /></label></div>{error && <p className="inline-error" role="alert">{error}</p>}{loading ? <div className="page-loading">正在读取源码</div> : <Editor key={file} value={content} onChange={() => {}} language={sourceLanguage} onCursor={(line, column) => setCursor({ line, column })} readOnly line={line} />}<div className="source-footer"><span>{content ? content.split('\n').length : 0} 行 <span className="source-cursor">行 {cursor.line}，列 {cursor.column}</span></span><select aria-label="源码语言" value={languageOverride} onChange={event => setLanguageOverride(event.target.value as LanguageId | '')}><option value="">自动 · {languages[languageForFile(file)].label}</option>{Object.entries(languages).map(([id, language]) => <option value={id} key={id}>{language.label}</option>)}</select><code>SHA256 {hash.slice(0, 16) || '—'}</code></div></> : <div className="source-empty"><Code2 size={32} /><span>未打开源码文件</span></div>}
  </section>;
}

export function QuickConnection({ state, configure, online, notify }: { state: AppState; configure: () => void; online: boolean; notify: Notify }) {
  const [busy, setBusy] = useState(false), device = state.devices?.find(item => item.id === state.activeDevice);
  const toggle = async () => { if (state.config.path === 'unassigned') { configure(); return; } setBusy(true); try { await api(state.connected ? '/disconnect' : '/connect', { ...(!state.connected ? state.config : {}), deviceId: state.activeDevice }); } catch (error) { notify((error as Error).message, true); } finally { setBusy(false); } };
  return <div className="project-quickbar"><span className={`status-dot ${state.connected ? 'live' : ''}`} /><strong title={device?.projectRoot}>{device?.board || device?.chip || device?.name || '设备'}</strong><button className="quick-port" title="打开连接参数" onClick={configure}>{state.config.path === 'unassigned' ? '匹配串口' : state.config.path}<ChevronDown size={12} /></button><span>{state.config.baudRate} baud</span><span className="quick-protocol">{state.config.protocol.toUpperCase()}</span><button className={`quick-connect ${state.connected ? 'connected' : ''}`} aria-label={state.connected ? '快捷断开设备' : '快捷连接设备'} disabled={busy || state.busy || !online} onClick={toggle}>{state.connected ? <Unplug size={14} /> : <Plug size={14} />}{state.connected ? '断开' : state.config.path === 'unassigned' ? '配置连接' : '连接'}</button></div>;
}

function BuildOutput({ state, notify }: { state: AppState; notify: Notify }) {
  const [agent, setAgent] = useState<{ config: { root: string }; readOnly?: boolean; build: { command: string; output: string; status: string; exitCode: number | null } | null } | null>(null);
  const profile = state.devices?.find(item => item.id === state.activeDevice)?.projectProfile;
  useEffect(() => { let active = true; api<typeof agent>('/ai/state').then(value => { if (active) setAgent(value); }).catch(error => notify(error.message, true)); const update = (event: Event) => setAgent((event as CustomEvent).detail); window.addEventListener('signaldesk-ai', update); return () => { active = false; window.removeEventListener('signaldesk-ai', update); }; }, [state.activeDevice]);
  return <div className="dock-build"><ToolchainConsole deviceId={state.activeDevice} readOnly={!agent || agent.readOnly} root={agent?.config.root || ''} defaultCommand={profile?.buildCommand} notify={notify} /><pre className="dock-output">{agent?.build ? `${agent.build.command}\n${agent.build.output}\n${agent.build.status}${agent.build.exitCode !== null ? ` · exit ${agent.build.exitCode}` : ''}` : '暂无构建输出'}</pre></div>;
}
export type DockTab = 'logs' | 'build' | 'verify';
export function BottomDock({ state, notify, close, tab, select, validationRequest, consumeValidation, openSource, analyze, deviceTests }: { state: AppState; notify: Notify; close: () => void; tab: DockTab; select: (tab: DockTab) => void; validationRequest?: ValidationRequest; consumeValidation: () => void; openSource: (file: string, line: number) => void; analyze: (file: string, prompt: string) => void; deviceTests: () => void }) {
  const root = state.devices?.find(item => item.id === state.activeDevice)?.projectRoot || '';
  return <section className="bottom-dock" aria-label="底部工具面板"><div className="dock-tabs"><button className={tab === 'verify' ? 'active' : ''} aria-pressed={tab === 'verify'} onClick={() => select('verify')}><Hammer size={14} />构建与测试</button><button className={tab === 'logs' ? 'active' : ''} aria-pressed={tab === 'logs'} onClick={() => select('logs')}><ScrollText size={14} />运行日志</button><button className={tab === 'build' ? 'active' : ''} aria-pressed={tab === 'build'} onClick={() => select('build')}><TerminalSquare size={14} />工具链</button><IconButton title="收起底部面板" onClick={close}><X size={14} /></IconButton></div><div className="dock-content">{tab === 'verify' ? <ValidationPanel key={`${state.activeDevice}:${root}`} deviceId={state.activeDevice || ''} root={root} request={validationRequest} consume={consumeValidation} openSource={openSource} analyze={analyze} deviceTests={deviceTests} /> : tab === 'logs' ? <Logs state={state} notify={notify} /> : <BuildOutput key={state.activeDevice} state={state} notify={notify} />}</div></section>;
}
