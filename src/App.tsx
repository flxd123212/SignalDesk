import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { CSSProperties, ReactNode } from 'react';
import { version } from '../package.json';
import { ArrowDown, ArrowUp, BookOpen, Bot, Check, Circle, CircuitBoard, FolderOpen, FolderPlus, FolderTree, Info, PanelBottom, PanelLeftClose, PanelLeftOpen, Plug, RotateCcw, Search, Settings, AppWindow, Square, X } from 'lucide-react';
import { api, formatBytes, useDevice, usePorts, showDeviceDiscovery } from './data';
import { Terminal } from './Terminal';
import { EngineeringLab, type LabKind } from './EngineeringLab';
import { CrashTraceDialog } from './CrashTraceDialog';
import { Connection } from './Connection';
import { Workspace } from './Workspace';
import { SendBar } from './SendBar';
import { AgentPanel } from './AgentPanel';
import { DeviceTabs } from './DeviceTabs';
import { Logs, Overview } from './ProjectTools';
import './instruments.css';
import { IconButton, useLayoutToggle } from './ui';
import { pages } from './navigation';
import { workspaces, workspaceFor, WorkspaceNavigation, ContextProperties, ShortcutHelp, type WorkspaceId } from './Workspaces';
import { InspectorContext } from './Inspector';
import { ValidationPanel } from './ValidationPanel';
import { CommandPalette } from './CommandPalette';
import { FullscreenButton } from './FullscreenButton';
import { AlarmBell, AlarmPanel } from './AlarmPanel';
import { DecodeQuality } from './DecodeQuality';
import { ProjectSetupDialog } from './ProjectSetupDialog';
import { BottomDock, PanelDivider, ProjectExplorer, QuickConnection, SourceWorkspace, usePanelSize } from './WorkbenchPanels';
import type { AgentRequest, DockTab } from './WorkbenchPanels';
import type { ValidationRequest } from './ValidationPanel';
import { ProjectSearch, QuickOpenFile } from './SourceNavigation';
import type { OutlineItem } from './SourceNavigation';
import { WorkbenchMenu } from './WorkbenchMenu';
import type { Page } from './types';
import { SettingsHub, type SettingsSection } from './SettingsHub';
import { getPreferences, setPreferences, usePreferences } from './preferences';
import { HelpCenter, LearningBar } from './HelpCenter';
import { tutorialForPage } from '../shared/tutorials.mjs';
import { DeviceDiscovery } from './DeviceDiscovery';
import { useSurfaceMotion } from './motion';
import { accentInk, useBackground } from './appearance';
import { desktopPlatform, shortcutLabel } from './platform';
import { matchWorkbenchShortcut, workbenchShortcuts, type ShortcutAction } from './workbenchShortcuts';

const Graph = lazy(() => import('./Graph').then(module => ({ default: module.Graph })));
const DisplayStudio = lazy(() => import('./display/Studio'));
const ToolCenter = lazy(() => import('./ToolCenter'));
const HardwareWorkbench = lazy(() => import('./HardwareWorkbench').then(module => ({ default: module.HardwareWorkbench })));
const Commands = lazy(() => import('./CommandLibrary').then(module => ({ default: module.CommandLibrary })));
const Instruments = lazy(() => import('./Tools').then(module => ({ default: module.Instruments })));
const Script = lazy(() => import('./Tools').then(module => ({ default: module.Script })));
const Sessions = lazy(() => import('./Tools').then(module => ({ default: module.Sessions })));
const FrameTools = lazy(() => import('./LabTools').then(module => ({ default: module.FrameTools })));
const Automation = lazy(() => import('./LabTools').then(module => ({ default: module.Automation })));
const Chips = lazy(() => import('./Chips').then(module => ({ default: module.Chips })));
const ExternalAgents = lazy(() => import('./ExternalAgents').then(module => ({ default: module.ExternalAgents })));
const CanAnalysis = lazy(() => import('./CanAnalysis').then(module => ({ default: module.CanAnalysis })));
const Attitude = lazy(() => import('./Attitude').then(module => ({ default: module.Attitude })));
const Widgets = lazy(() => import('./Widgets').then(module => ({ default: module.Widgets })));
const simplePages: Page[] = ['workspace', 'terminal', 'overview', 'commands', 'editor', 'agent', 'logs'];
const initialPage = () => pages.find(item => item.id === new URLSearchParams(location.search).get('view'))?.id || getPreferences().startup;

export default function App() {
  const [page, setPage] = useState<Page>(initialPage), [toast, setToast] = useState<{ message: string; error: boolean } | null>(null), [about, setAbout] = useState(false);
  const prefs = usePreferences(), detached = new URLSearchParams(location.search).get('detached') === '1';
  const background = useBackground(prefs.backgroundMode === 'image' ? prefs.backgroundImage : '');
  const [settingsSection, setSettingsSection] = useState<SettingsSection | null>(null);
  const [help, setHelp] = useState<string | null>(null), [learning, setLearning] = useState<string | null>(null);
  useEffect(() => { if (learning && prefs.tutorial.completed.includes(learning)) setLearning(null); }, [learning, prefs.tutorial.completed]);
  const [shortcutHelp, setShortcutHelp] = useState(false), [rightTab, setRightTab] = useState<'properties' | 'agent'>('properties'), [inspector, setInspector] = useState<ReactNode>(null);
  const [areaPages, setAreaPages] = useState<Partial<Record<WorkspaceId, Page>>>({});
  const toastTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const notify = useCallback((message: string, error = false) => { clearTimeout(toastTimer.current); setToast({ message, error }); toastTimer.current = setTimeout(() => setToast(null), error ? 6500 : 3000); }, []);
  const { state, online, ready } = useDevice(notify), detectedPorts = usePorts();
  useEffect(() => { window.signaldeskBoot?.configure(prefs); }, [prefs]);
  useEffect(() => { window.signaldeskBoot?.stage('service'); }, []);
  useEffect(() => { if (ready) window.signaldeskBoot?.ready(); }, [ready]);
  const [simple, setSimple] = useLayoutToggle('simple', false), [navExpanded, setNavExpanded] = useLayoutToggle('navigation', false);
  const [connectionOpen, setConnectionOpen] = useLayoutToggle('connection', window.innerWidth > 900), [simpleSideOpen, setSimpleSideOpen] = useState(false);
  const [sideTab, setSideTab] = useState<'project' | 'connection'>('project'), [fullAgentOpen, setFullAgentOpen] = useLayoutToggle('agent-panel', false), [fullDockOpen, setFullDockOpen] = useLayoutToggle('bottom-panel', false);
  const [simpleAgentOpen, setSimpleAgentOpen] = useState(false), [simpleDockOpen, setSimpleDockOpen] = useState(false);
  const [narrow, setNarrow] = useState(() => matchMedia('(max-width: 900px)').matches), [mobileSideOpen, setMobileSideOpen] = useState(false);
  useEffect(() => { const media = matchMedia('(max-width: 900px)'), update = () => { setNarrow(media.matches); setMobileSideOpen(false); }; media.addEventListener('change', update); return () => media.removeEventListener('change', update); }, []);
  const agentOpen = simple ? simpleAgentOpen : fullAgentOpen, setAgentOpen = simple ? setSimpleAgentOpen : setFullAgentOpen;
  const dockOpen = simple ? simpleDockOpen : fullDockOpen, setDockOpen = simple ? setSimpleDockOpen : setFullDockOpen;
  const [dockTab, setDockTab] = useState<DockTab>('logs'), [palette, setPalette] = useState(false), [setup, setSetup] = useState<boolean | string>(false);
  const [designLaunch, launchDesign] = useState(0);
  const [searchScope, setSearchScope] = useState('');
  const [engineeringLab,setEngineeringLab]=useState<LabKind|null>(null);
  const [probeSeed,setProbeSeed]=useState<{path:string;line:number}>();
  useEffect(()=>{const open=(e:Event)=>{const d=(e as CustomEvent).detail;setProbeSeed(d.path?{path:d.path,line:d.line}:undefined);setEngineeringLab(d.kind);};window.addEventListener('signaldesk-lab',open);return()=>window.removeEventListener('signaldesk-lab',open);},[]);
  useEffect(()=>{const open=()=>setEngineeringLab('size');window.addEventListener('signaldesk-size-diff',open);return()=>window.removeEventListener('signaldesk-size-diff',open);},[]);
  const [trace, setTrace] = useState<{ scope: string; snapshot?: string } | null>(null);
  const [validationRequests, setValidationRequests] = useState<Record<string, ValidationRequest | undefined>>({}), [sourceJump, setSourceJump] = useState<{ scope: string; file: string; id: number; line: number } | null>(null);
  const [quickFile, setQuickFile] = useState(false), [outlines, setOutlines] = useState<Record<string, { file: string; items: OutlineItem[] }>>({});
  const shortcuts = useRef<(event: KeyboardEvent) => void>(() => {});
  useEffect(() => { const key = (event: KeyboardEvent) => shortcuts.current(event); window.addEventListener('keydown', key); return () => window.removeEventListener('keydown', key); }, []);
  const [tabs, setTabs] = useState<Page[]>([initialPage()]), [fileTabs, setFileTabs] = useState<Record<string, { files: string[]; selected: string }>>({}), [agentRequests, setAgentRequests] = useState<Record<string, AgentRequest>>({});
  const sideSize = usePanelSize('explorer-width', 220, 200, 360), agentSize = usePanelSize('agent-width', 360, 300, 560), dockSize = usePanelSize('dock-height', 190, 150, 420);
  const [sourceSendOpen, setSourceSendOpen] = useLayoutToggle('source-send', false);
  const effectiveSide = narrow ? mobileSideOpen : simple ? simpleSideOpen : connectionOpen, setSideOpen = narrow ? setMobileSideOpen : simple ? setSimpleSideOpen : setConnectionOpen;
  const showConnection = effectiveSide && sideTab === 'connection', showProject = effectiveSide && sideTab === 'project', showAgent = agentOpen && rightTab === 'agent' && page !== 'agent';
  const showRight = agentOpen && (rightTab === 'properties' || page !== 'agent'), area = workspaceFor(page);
  const revealInspector = useCallback(() => { setRightTab('properties'); if (simple) setSimpleAgentOpen(true); else setFullAgentOpen(true); }, [simple]);
  const inspectorContext = useMemo(() => ({ publish: setInspector, show: revealInspector }), [revealInspector]);
  const navigate = (next: Page) => { if (narrow) setMobileSideOpen(false); setPage(next); setAreaPages(current => ({ ...current, [workspaceFor(next).id]: next })); if (next === 'editor' || next === 'hardware') setSideTab('project'); if (['hardware', 'circuit', 'graph'].includes(next) && innerWidth >= 1100) revealInspector(); setTabs(current => current.includes(next) ? current : [...current.slice(-11), next]); const url = new URL(location.href); url.searchParams.set('view', next); history.pushState(null, '', url); };
  useEffect(() => {
    const back = () => { const next = initialPage(); setPage(next); setTabs(current => current.includes(next) ? current : [...current.slice(-7), next]); };
    window.addEventListener('popstate', back); return () => { window.removeEventListener('popstate', back); clearTimeout(toastTimer.current); };
  }, []);
  const activePage = pages.find(item => item.id === page)!;
  const activeDevice = state.devices?.find(device => device.id === state.activeDevice), projectName = activeDevice?.projectRoot?.split(/[\\/]/).filter(Boolean).at(-1);
  const scopeKey = `${state.activeDevice}:${activeDevice?.projectRoot || ''}`;
  useEffect(() => setSearchScope(''), [scopeKey]);
  useEffect(() => setTrace(null), [scopeKey]);
  const openTrace = (snapshot?: string) => {
    if (!activeDevice?.projectRoot) { notify('请先添加或绑定固件工程'); return; }
    setTrace({ scope: scopeKey, snapshot });
  };
  useEffect(() => {
    const openDesign = () => { setAgentOpen(false); navigate('display'); launchDesign(n => n + 1); };
    window.addEventListener('signaldesk-open-display-assistant', openDesign);
    return () => window.removeEventListener('signaldesk-open-display-assistant', openDesign);
  }, [navigate]);
  const pageSurface = useSurfaceMotion(`${page}:${scopeKey}`);
  const sourceTabs = fileTabs[scopeKey] || { files: activeDevice?.projectProfile?.entryFile ? [activeDevice.projectProfile.entryFile] : [], selected: activeDevice?.projectProfile?.entryFile || '' };
  const openFile = (file: string) => { setFileTabs(current => ({ ...current, [scopeKey]: { files: [...new Set([...sourceTabs.files, file])].slice(-12), selected: file } })); setNavExpanded(false); navigate('editor'); };
  const closeFile = (file: string) => { const files = sourceTabs.files.filter(item => item !== file); setFileTabs(current => ({ ...current, [scopeKey]: { files, selected: sourceTabs.selected === file ? files.at(-1) || '' : sourceTabs.selected } })); };
  const reviewFile = (file: string) => { setAgentRequests(current => ({ ...current, [scopeKey]: { id: Date.now(), file, prompt: `请审查 ${file} 的正确性、实时性及串口数据发送逻辑。结合当前项目与设备，给出文件行号、证据和可验证的建议；先不要修改或执行。` } })); setNavExpanded(false); setDockOpen(false); setRightTab('agent'); setAgentOpen(true); };
  const configure = () => { setSideTab('connection'); setSideOpen(true); };
  const openTutorial = (id = prefs.tutorial.lastGuide) => { setPreferences({ tutorial: { ...prefs.tutorial, dismissed: true, lastGuide: id } }); setHelp(id); };
  const nodeSetup = () => { if (page === 'graph') window.dispatchEvent(new CustomEvent('signaldesk-graph-action', { detail: 'setup' })); else { sessionStorage.setItem('signaldesk.graph-command', 'setup'); navigate('graph'); } };
  const performTutorial = (action: string, guide: string) => {
    setHelp(null); setLearning(guide);
    requestAnimationFrame(() => {
      if (action === 'project') setSetup(true);
      else if (action === 'discovery') showDeviceDiscovery();
      else if (action === 'connect') configure();
      else if (action === 'files') setQuickFile(true);
      else if (action === 'nodes') nodeSetup();
      else if (action === 'simple') setSimple(true);
      else if (action.startsWith('page:')) navigate(action.slice(5) as Page);
      else if (action.startsWith('settings:')) setSettingsSection(action.slice(9) as SettingsSection);
    });
  };
  const validationRequest = validationRequests[scopeKey];
  const consumeValidation = () => setValidationRequests(current => ({ ...current, [scopeKey]: undefined }));
  const validate = (mode: ValidationRequest['mode']) => {
    setValidationRequests(current => ({ ...current, [scopeKey]: { id: Date.now(), mode } }));
    if (page === 'validation') return;
    setDockTab('verify'); setDockOpen(true); dockSize.update(Math.max(dockSize.size, 270));
  };
  const shortcutActions: Record<ShortcutAction, () => void> = {
    palette: () => setPalette(true), help: () => setShortcutHelp(true), discover: showDeviceDiscovery,
    terminal: () => navigate('terminal'), build: () => validate('build'), test: () => validate('test'),
    problems: () => validate('problems'), memory: () => validate('memory'),
    backtrace: () => openTrace(),
  };
  const jumpToDiagnostic = (file: string, line: number) => { openFile(file); setSourceJump({ scope: scopeKey, file, line, id: Date.now() }); };
  useEffect(()=>{const go=(e:Event)=>{const r=(e as CustomEvent).detail;if(r?.path)jumpToDiagnostic(r.path,r.line);};window.addEventListener('signaldesk-source-location',go);return()=>window.removeEventListener('signaldesk-source-location',go);});
  const analyzeValidation = (file: string, prompt: string) => { setAgentRequests(current => ({ ...current, [scopeKey]: { id: Date.now(), file, prompt } })); setNavExpanded(false); setDockOpen(false); setRightTab('agent'); setAgentOpen(true); };
  shortcuts.current = event => {
    if (event.defaultPrevented || event.repeat || event.isComposing || event.keyCode === 229 || event.getModifierState('AltGraph') || document.querySelector('dialog[open], [role="dialog"], [role="menu"]')) return;
    const action = matchWorkbenchShortcut(event);
    if (action) {
      event.preventDefault();
      if (['discover', 'build', 'test', 'problems', 'memory', 'backtrace'].includes(action) && !online) return;
      shortcutActions[action](); return;
    }
    if (event.key === 'F1' && !event.ctrlKey && !event.metaKey && !event.altKey && !event.shiftKey) { event.preventDefault(); openTutorial(tutorialForPage(page).id); return; }
    if ((event.ctrlKey || event.metaKey) && event.altKey && !event.shiftKey && /^Digit[1-4]$/.test(event.code)) { event.preventDefault(); const next = workspaces[Number(event.code.slice(-1)) - 1]; navigate(areaPages[next.id] || next.home); return; }
    if (!(event.ctrlKey || event.metaKey) || event.altKey) return;
    const key = event.key.toLowerCase();
    if (key === 'p' && !event.shiftKey) { event.preventDefault(); setQuickFile(true); }
    else if (key === 'f' && event.shiftKey && online && activeDevice?.projectRoot) { event.preventDefault(); setSearchScope(scopeKey); }
    else if (key === 'b' && !event.shiftKey) { event.preventDefault(); setSideOpen(!effectiveSide); }
    else if (key === ',') { event.preventDefault(); setSettingsSection('appearance'); }
    else if (key === 'j' && !event.shiftKey) { event.preventDefault(); setDockOpen(!dockOpen); }
  };
  const resetLayout = () => { { setNavExpanded(false); setConnectionOpen(false); setSimpleSideOpen(false); setFullAgentOpen(false); setSimpleAgentOpen(false); setFullDockOpen(false); setSimpleDockOpen(false); setSourceSendOpen(false); sideSize.update(sideSize.initial); agentSize.update(agentSize.initial); dockSize.update(dockSize.initial); } };
  const popOut = async (target: Page = page) => { try { if (window.signaldeskDesktop?.openPanel) await window.signaldeskDesktop.openPanel(target); else { const url = new URL(location.href); url.searchParams.set('detached', '1'); url.searchParams.set('view', target); const popup = window.open(url.href, 'signaldesk-' + target, 'popup,width=1100,height=800'); if (!popup) throw new Error('浏览器阻止了弹出窗口，请允许本站弹窗'); } } catch (error) { notify((error as Error).message, true); } };
  const autoSend = ['workspace', 'terminal', 'commands', 'instruments', 'frames', 'automation'].includes(page);
  const showSend = prefs.sendBar === 'always' || prefs.sendBar === 'auto' && (autoSend || sourceSendOpen);
  const [recordBusy, setRecordBusy] = useState(false);
  const record = async () => { setRecordBusy(true); try { await api(state.recording ? '/record/stop' : '/record/start', { deviceId: state.activeDevice, recordingId: state.recording?.id }); notify(state.recording ? '录制已保存' : '开始记录原始收发数据'); } catch (error) { notify((error as Error).message, true); } finally { setRecordBusy(false); } };
  const resetProcessing = async () => { try { await api('/processing', { mode: 'raw', deviceId: state.activeDevice }); notify('已恢复原始通道'); } catch (error) { notify((error as Error).message, true); } };
  const fileMenu = [
    ...(window.signaldeskDesktop ? [{ label: '新建独立工作区窗口', shortcut: 'Ctrl+Shift+N', action: () => { void window.signaldeskDesktop!.newWindow().catch(error => notify(error.message, true)); } }, { label: '关闭窗口', action: () => { void window.signaldeskDesktop!.closeWindow(); } }] : []),
    { label: '快速打开文件…', shortcut: 'Ctrl+P', action: () => setQuickFile(true) },
    { label: '添加项目…', action: () => setSetup(true), disabled: !online },
    { label: '项目资源管理器', action: () => { setSideTab('project'); setSideOpen(true); setNavExpanded(false); } },
    { label: '项目源码', action: () => { setSideTab('project'); setSideOpen(true); setNavExpanded(false); navigate('editor'); } },
    { label: '录制与回放', action: () => navigate('sessions') },
    { label: '设置…', shortcut: 'Ctrl+,', action: () => setSettingsSection('appearance') },
  ];
  const helpMenu = [
    { label: '使用教程…', action: () => openTutorial() },
    { label: '当前页面帮助', shortcut: 'F1', action: () => openTutorial(tutorialForPage(page).id) },
    { label: '键盘快捷操作…', shortcut: workbenchShortcuts.help.keys[0], action: shortcutActions.help },
    { label: '重看入门教程', action: () => openTutorial('first-device') },
    { label: '关于 SignalDesk', action: () => setAbout(true) },
  ];
  const viewMenu = [
    ...workspaces.map((item, index) => ({ label: `${item.label}工作区`, checked: area.id === item.id, shortcut: `Ctrl+Alt+${index + 1}`, action: () => navigate(areaPages[item.id] || item.home) })),
    { label: '属性面板', checked: showRight && rightTab === 'properties', action: () => { setRightTab('properties'); setAgentOpen(!(showRight && rightTab === 'properties')); } },
    ...(window.signaldeskDesktop ? [{ label: '窗口缩放与全屏…', action: () => { void window.signaldeskDesktop!.nativeMenu('view'); } }] : []),
    { label: '精简模式', checked: simple, action: () => setSimple(true) }, { label: '完整模式', checked: !simple, action: () => setSimple(false) },
    { label: '项目侧栏', shortcut: 'Ctrl+B', checked: showProject, action: () => { setSideTab('project'); setSideOpen(!showProject); } },
    { label: '连接设置', checked: showConnection, action: () => { setSideTab('connection'); setSideOpen(!showConnection); } },
    { label: 'Agent 分栏', checked: showAgent, action: () => { if (page === 'agent') navigate('workspace'); setRightTab('agent'); setAgentOpen(!showAgent); setNavExpanded(false); } },
    { label: '底部输出面板', shortcut: 'Ctrl+J', checked: dockOpen, action: () => setDockOpen(!dockOpen) },
    { label: '展开导航文字', checked: navExpanded, action: () => setNavExpanded(!navExpanded) },
    { label: '顶部布局快捷按钮', checked: prefs.toolbar, action: () => setSettingsSection('appearance') },
    { label: '在独立窗口打开当前页', action: () => { void popOut(); } },
    { label: '关闭其他工作页', action: () => setTabs([page]) },
    { label: '重置界面布局', action: resetLayout },
  ];
  const toolMenu = [
    { label: '工程实验工具…', action: () => setEngineeringLab(area.id==='hardware'?'rules':area.id==='integration'?'bus':area.id==='testing'?'matrix':'template') },
    { label: '节点一键配置', action: nodeSetup },
    { label: '发现设备…', shortcut: workbenchShortcuts.discover.keys[0], disabled: !online, action: shortcutActions.discover },
    { label: '屏幕设计器', action: () => navigate('display') },
    { label: '工具链中心', action: () => navigate('tooling') },
    { label: '编译当前工程', shortcut: workbenchShortcuts.build.keys[0], disabled: !online, action: shortcutActions.build },
    { label: '源码测试', shortcut: workbenchShortcuts.test.keys[0], disabled: !online, action: shortcutActions.test },
    { label: '编译问题', shortcut: workbenchShortcuts.problems.keys[0], disabled: !online, action: shortcutActions.problems },
    { label: '固件容量', shortcut: workbenchShortcuts.memory.keys[0], disabled: !online, action: shortcutActions.memory },
    { label: '崩溃回溯…', shortcut: workbenchShortcuts.backtrace.keys[0], disabled: !online, action: shortcutActions.backtrace },
    { label: '项目体检', disabled: !online, action: () => { setRightTab('agent'); setAgentOpen(true); setNavExpanded(false); void api('/ai/project-health', { deviceId: state.activeDevice }).catch(error => notify(error.message, true)); } },
    { label: '工具链命令', action: () => { setDockTab('build'); setDockOpen(true); } },
    ...pages.map(item => ({ label: item.label, group: item.group, shortcut: item.id === 'terminal' ? workbenchShortcuts.terminal.keys[0] : undefined, action: () => navigate(item.id) })),
    { label: '输出与日志面板', action: () => { setDockTab('logs'); setDockOpen(true); } },
  ];
  const graphAction = (action: string) => window.dispatchEvent(new CustomEvent('signaldesk-graph-action', { detail: action }));
  const editMenu = [
    { label: '查找工程正文…', shortcut: 'Ctrl+Shift+F', disabled: !online || !activeDevice?.projectRoot, action: () => setSearchScope(scopeKey) },
    ...(page === 'graph' ? [{ label: '撤销节点操作', shortcut: 'Ctrl+Z', action: () => graphAction('undo') }, { label: '重做节点操作', shortcut: 'Ctrl+Shift+Z', action: () => graphAction('redo') }, { label: '复制所选节点', shortcut: 'Ctrl+D', action: () => graphAction('duplicate') }, { label: '删除所选节点', shortcut: 'Delete', action: () => graphAction('delete') }, { label: '连接节点…', shortcut: 'C', action: () => graphAction('connect') }, { label: '自动排列节点', shortcut: 'L', action: () => graphAction('layout') }, { label: '适应节点视图', shortcut: 'F', action: () => graphAction('fit') }] : []),
    ...(window.signaldeskDesktop ? [{ label: '系统编辑操作…', action: () => { void window.signaldeskDesktop!.nativeMenu('edit'); } }] : []),
    { label: '快速定位文件…', shortcut: 'Ctrl+P', action: () => setQuickFile(true) }, { label: '键盘快捷操作…', action: () => setShortcutHelp(true) },
  ];
  const windowMenu = [{ label: '在独立窗口打开当前页', action: () => { void popOut(); } }, ...(['workspace', 'instruments', 'can', 'attitude'] as Page[]).map(id => ({ label: `独立窗口：${pages.find(item => item.id === id)!.label}`, action: () => { void popOut(id); } }))];
  return <InspectorContext.Provider value={inspectorContext}><div className={`app-shell studio-shell ide-shell four-workspaces ${window.signaldeskDesktop?.integratedTitlebar ? 'integrated-titlebar' : ''} ${detached ? 'detached-panel' : ''} ${prefs.toolbar ? 'expanded-toolbar' : 'quiet-toolbar'} ${simple ? 'simple-mode' : 'full-mode'} ${navExpanded ? 'nav-expanded' : 'nav-collapsed'} ${showConnection ? '' : 'connection-hidden'} ${showRight ? 'agent-split' : ''}`} inert={!ready} data-ready={ready} data-platform={desktopPlatform || 'browser'} data-motion={prefs.motion ? 'on' : 'off'} data-motion-style={prefs.motionStyle} data-background={prefs.backgroundMode} data-finish={prefs.finish} style={{ '--accent': prefs.accent, '--accent-ink': accentInk(prefs.accent), '--background-dim': prefs.backgroundDim / 100, '--editor-size': prefs.editorSize + 'px', '--explorer-width': `${sideSize.size}px`, '--agent-width': `${agentSize.size}px`, '--dock-height': `${dockSize.size}px` } as CSSProperties}>
    <div className="workbench-background" aria-hidden="true" style={{ backgroundColor: prefs.backgroundColor }}><div style={{ backgroundImage: background.url ? `url("${background.url}")` : undefined, backgroundSize: prefs.backgroundFit, filter: `blur(${prefs.backgroundBlur}px)` }} /></div>
    <header className="app-header"><div className="brand"><CircuitBoard size={23} /><span>Signal<span>Desk</span></span></div><div className="desktop-menus"><WorkbenchMenu label="文件" items={fileMenu} /><WorkbenchMenu label="编辑" items={editMenu} /><WorkbenchMenu label="视图" items={viewMenu} /><WorkbenchMenu label="工具" items={toolMenu} /><WorkbenchMenu label="窗口" items={windowMenu} /><WorkbenchMenu label="帮助" items={helpMenu} /><button className="menu-trigger" aria-label="设置" onClick={() => setSettingsSection('appearance')}>设置</button></div><div className="compact-menu"><WorkbenchMenu label="工作区菜单" items={[...fileMenu, ...editMenu, ...viewMenu, ...toolMenu, ...windowMenu, ...helpMenu]} icon /></div><div className="header-breadcrumb" title={activeDevice?.projectRoot}><FolderOpen size={14} /><span>{projectName || '本地工作区'}</span>{activeDevice?.chip && <span className="header-chip">{activeDevice.chip}</span>}</div>
      <button className="global-search" title={`查找功能或设备 (${shortcutLabel('Ctrl+K')})`} aria-label="打开功能搜索" onClick={() => setPalette(true)}><Search size={15} /><span>查找功能或设备</span></button>
      <button className="add-project-button" aria-label="添加项目" title="添加项目" disabled={!online} onClick={() => setSetup(true)}><FolderPlus size={16} /><span>添加项目</span></button>
      <div className="segmented layout-mode" hidden={!prefs.toolbar}><button aria-label="精简模式" aria-pressed={simple} className={simple ? 'active' : ''} onClick={() => setSimple(true)}>精简</button><button aria-label="完整模式" aria-pressed={!simple} className={!simple ? 'active' : ''} onClick={() => setSimple(false)}>完整</button></div>
      <div className="header-right"><IconButton title="发现设备" className="discover-header" onClick={showDeviceDiscovery}><Plug size={17} />{detectedPorts.ports.length > 0 && <small>{detectedPorts.ports.length}</small>}</IconButton><div className="layout-shortcuts" hidden={!prefs.toolbar}><IconButton title={showProject ? '收起项目导航' : '展开项目导航'} aria-expanded={showProject} className={showProject ? 'selected' : ''} onClick={() => { setSideTab('project'); setSideOpen(!showProject); }}><FolderTree size={17} /></IconButton><IconButton title={showConnection ? '收起连接设置' : '展开连接设置'} aria-expanded={showConnection} aria-controls="connection-settings" className={showConnection ? 'selected' : ''} onClick={() => { setSideTab('connection'); setSideOpen(!showConnection); }}><Plug size={17} /></IconButton><IconButton title={showAgent ? '收起 Agent 分栏' : '展开 Agent 分栏'} aria-expanded={showAgent} className={showAgent ? 'selected' : ''} onClick={() => { if (page === 'agent') navigate('workspace'); setRightTab('agent'); setAgentOpen(!showAgent); if (!showAgent) setNavExpanded(false); }}><Bot size={17} /></IconButton><IconButton title={dockOpen ? '关闭底部工具面板' : '打开底部工具面板'} aria-expanded={dockOpen} className={dockOpen ? 'selected' : ''} onClick={() => setDockOpen(!dockOpen)}><PanelBottom size={17} /></IconButton></div><IconButton title="在独立窗口打开当前页" onClick={() => void popOut()}><AppWindow size={17} /></IconButton><AlarmBell open={() => navigate('alarms')} /><FullscreenButton notify={notify} /><IconButton title="打开设置" onClick={() => setSettingsSection('appearance')}><Settings size={17} /></IconButton></div>
    </header>
    {!detached && <div className="workspace-strip">
      <nav className="workspace-switcher" aria-label="工作区导航">{workspaces.map((item, index) => <button key={item.id} data-area={item.id}
        title={`${item.label}工作区 (${shortcutLabel(`Ctrl+Alt+${index + 1}`)})`} aria-label={`${item.label}工作区`} aria-pressed={area.id === item.id}
        onClick={() => navigate(areaPages[item.id] || item.home)}><item.icon size={18} /><span>{item.label}</span></button>)}</nav>
      <div className="strip-tools"><IconButton title="展开项目导航" aria-pressed={showProject} onClick={() => { setSideTab('project'); setSideOpen(!showProject); }}><FolderTree size={16} /></IconButton>
        <IconButton title="打开属性面板" aria-pressed={showRight && rightTab === 'properties'} onClick={() => { if (showRight && rightTab === 'properties') setAgentOpen(false); else revealInspector(); }}><Info size={16} /></IconButton>
      </div>
      <LearningBar active={learning} start={() => openTutorial('first-device')} resume={() => openTutorial(learning || prefs.tutorial.lastGuide)} dismiss={() => { setLearning(null); setPreferences({ tutorial: { ...prefs.tutorial, dismissed: true } }); }} />
    </div>}
    <div className="app-body" data-area={area.id}>
      <aside className="ide-sidebar" hidden={!effectiveSide}><div className="side-tabs"><button className={sideTab === 'project' ? 'active' : ''} aria-pressed={sideTab === 'project'} onClick={() => setSideTab('project')}><FolderTree size={14} />项目</button><button className={sideTab === 'connection' ? 'active' : ''} aria-pressed={sideTab === 'connection'} onClick={() => setSideTab('connection')}><Plug size={14} />连接</button><IconButton title="收起侧栏" onClick={() => setSideOpen(false)}><X size={14} /></IconButton></div><div className="sidebar-page" hidden={sideTab !== 'project'}><WorkspaceNavigation page={page} navigate={navigate} expanded={navExpanded} /><ProjectExplorer key={scopeKey} state={state} selected={sourceTabs.selected} opened={sourceTabs.files} closeFile={closeFile} outline={outlines[scopeKey]?.file === sourceTabs.selected ? outlines[scopeKey].items : []} jump={jumpToDiagnostic} openHardware={() => navigate('hardware')} open={openFile} addProject={() => setSetup(true)} notify={notify} /></div><div className="sidebar-page" hidden={sideTab !== 'connection'}><Connection key={state.activeDevice || 'initial'} state={state} online={online} notify={notify} /></div></aside>{effectiveSide && <PanelDivider panel={sideSize} label="调整项目侧栏宽度" />}
      <main className={`main-shell ${['editor', 'agent', 'logs', 'external'].includes(page) ? 'source-focus' : ''}`}>
        <div className="session-ribbon"><DeviceTabs state={state} notify={notify} /><QuickConnection key={`quick:${state.activeDevice || 'initial'}`} state={state} online={online} notify={notify} configure={configure} /></div>
        <div className="workpage-tabs" aria-label="已打开工作页" hidden={!prefs.workTabs || tabs.filter(id => workspaceFor(id).id === area.id).length < 2}>{tabs.filter(id => workspaceFor(id).id === area.id).map(id => { const item = pages.find(page => page.id === id)!; return <div key={id} className={page === id ? 'active' : ''}><button aria-label={`工作页 ${item.label}`} aria-pressed={page === id} onClick={() => navigate(id)}><item.icon size={13} />{item.label}</button>{tabs.length > 1 && <IconButton title={`关闭工作页 ${item.label}`} onClick={() => { const rest = tabs.filter(tab => tab !== id); setTabs(rest); if (page === id) navigate(rest.filter(id => workspaceFor(id).id === area.id).at(-1) || area.home); }}><X size={12} /></IconButton>}</div>; })}</div>
        <div className="page-heading"><div className="page-title-row"><activePage.icon className="page-symbol" size={22} /><h1>{activePage.label}</h1></div>
          <div className="page-actions">{state.processingMode !== 'raw' && <button className="quiet-button" onClick={resetProcessing}><RotateCcw size={14} />原始通道</button>}
            {(area.id === 'integration' || state.recording) && <><span className="session-status"><span className={`status-dot ${state.connected || state.replay?.playing ? 'live' : ''}`} />{state.connected ? '采集中' : state.source === 'replay' ? '回放模式' : '待连接'}</span><button className={`record-button ${state.recording ? 'is-recording' : ''}`} disabled={recordBusy || (!state.recording && !state.connected)} onClick={record}>{state.recording ? <Square size={13} /> : <Circle size={13} />}<span>{state.recording ? '停止录制' : '开始录制'}</span></button></>}
          </div>
        </div>
        <div ref={pageSurface} className={`page-content page-${page}`}><Suspense key={scopeKey} fallback={<div className="page-loading" role="status">正在加载工作区</div>}>
          {tabs.includes('workspace') && <div className="cached-workspace" hidden={page !== 'workspace'}><Workspace state={state} notify={notify} simple={simple} active={page === 'workspace'} configure={configure} recordings={() => navigate('sessions')} /></div>}
          {page === 'terminal' && <><DecodeQuality state={state} /><Terminal onTrace={openTrace} /></>}
          {page === 'editor' && <div className="editor-page"><div className="source-tabs">{sourceTabs.files.map(file => <div key={file} className={sourceTabs.selected === file ? 'active' : ''}><button title={file} onClick={() => openFile(file)}>{file.split('/').at(-1)}</button><IconButton title={`关闭文件 ${file}`} onClick={() => closeFile(file)}><X size={12} /></IconButton></div>)}</div><SourceWorkspace browse={() => setQuickFile(true)} addProject={() => setSetup(true)} file={sourceTabs.selected} state={state} analyze={reviewFile} notify={notify} validate={validate} outlineChange={(file, items) => setOutlines(current => ({ ...current, [scopeKey]: { file, items } }))} jump={sourceJump?.scope === scopeKey && sourceJump.file === sourceTabs.selected ? sourceJump : undefined} /></div>}
          {page === 'graph' && <Graph state={state} notify={notify} openWorkspace={() => navigate('workspace')} />}
          {page === 'display' && <DisplayStudio key={scopeKey} launch={designLaunch} consumeLaunch={()=>launchDesign(0)} deviceId={state.activeDevice || ''} root={activeDevice?.projectRoot || ''} review={prompt => analyzeValidation('', prompt)} tools={() => navigate('tooling')} openProject={setSetup} />}
          {page === 'tooling' && <ToolCenter />}
          {(page === 'hardware' || page === 'circuit') && <HardwareWorkbench key={`${scopeKey}:${page}`} state={state} live={page === 'circuit'} notify={notify} openSource={jumpToDiagnostic} openTests={() => navigate('automation')} />}
          {page === 'validation' && <ValidationPanel key={scopeKey} deviceId={state.activeDevice || ''} root={activeDevice?.projectRoot || ''} request={validationRequest} consume={consumeValidation} openSource={jumpToDiagnostic} analyze={analyzeValidation} deviceTests={() => navigate('automation')} />}
          {page === 'can' && <CanAnalysis notify={notify} openWave={()=>navigate('workspace')} />}
          {page === 'attitude' && <Attitude state={state} />}
          {page === 'widgets' && <Widgets state={state} notify={notify} />}
          {page === 'script' && <Script state={state} notify={notify} />}
          {page === 'commands' && <Commands state={state} notify={notify} />}
          {page === 'instruments' && <Instruments connected={state.connected && state.source !== 'replay'} deviceId={state.activeDevice} notify={notify} />}
          {page === 'sessions' && <Sessions state={state} notify={notify} />}
          {page === 'agent' && <AgentPanel device={state} notify={notify} openSource={jumpToDiagnostic} request={agentRequests[scopeKey]} />}
          {page === 'frames' && <FrameTools state={state} notify={notify} />}
          {page === 'automation' && <Automation state={state} notify={notify} />}
          {page === 'alarms' && <AlarmPanel key={scopeKey} state={state} notify={notify} review={prompt=>analyzeValidation('',prompt)}/>}
          {page === 'chips' && <Chips key={scopeKey} notify={notify} device={state} />}
          {page === 'overview' && <Overview notify={notify} openWorkspace={() => navigate('workspace')} />}
          {page === 'logs' && <Logs state={state} notify={notify} />}
          {page === 'external' && <ExternalAgents state={state} notify={notify} />}
        </Suspense></div>
        {dockOpen && !(page === 'validation' && dockTab === 'verify') && <><PanelDivider panel={dockSize} label="调整底部面板高度" horizontal reverse /><BottomDock state={state} notify={notify} close={() => setDockOpen(false)} tab={dockTab} select={setDockTab} validationRequest={page === 'validation' ? undefined : validationRequest} consumeValidation={consumeValidation} openSource={jumpToDiagnostic} analyze={analyzeValidation} deviceTests={() => navigate('automation')} /></>}
        {!autoSend && prefs.sendBar === 'auto' && <div className="send-reveal"><button aria-expanded={sourceSendOpen} onClick={() => setSourceSendOpen(!sourceSendOpen)}><Plug size={13} />{sourceSendOpen ? '收起串口发送栏' : '串口发送'}<span>{state.config.path === 'unassigned' ? '未匹配串口' : state.config.path}</span></button></div>}
        <div className="context-sendbar" hidden={!showSend}><SendBar key={`send:${state.activeDevice || 'initial'}`} state={state} notify={notify} /></div>
      </main>
      {showRight && <><PanelDivider panel={agentSize} label="调整属性与 Agent 面板宽度" reverse /><aside className="agent-dock inspector-dock" aria-label="属性与 Agent 面板"><div className="agent-dock-heading"><button className={rightTab === 'properties' ? 'active' : ''} aria-pressed={rightTab === 'properties'} onClick={() => setRightTab('properties')}>属性</button><button className={rightTab === 'agent' ? 'active' : ''} aria-pressed={rightTab === 'agent'} onClick={() => setRightTab('agent')}><Bot size={14} />Agent</button><span>{activeDevice?.name}</span><IconButton title="关闭 Agent 面板" onClick={() => setAgentOpen(false)}><X size={15} /></IconButton></div>{rightTab === 'agent' ? <AgentPanel key={scopeKey} device={state} notify={notify} openSource={jumpToDiagnostic} compact request={agentRequests[scopeKey]} /> : <div className="properties-content">{inspector || <ContextProperties state={state} page={page} configure={configure} openHardware={() => navigate('hardware')} />}</div>}</aside></>}
    </div>
    <footer className="status-bar"><span className="footer-brand"><span className={`status-dot ${online ? 'live' : ''}`} />{online ? 'READY' : 'OFFLINE'}</span><span>{state.source === 'demo' ? 'DEMO' : state.config.path === 'unassigned' ? '未匹配串口' : state.config.path} <span className="footer-divider">/</span> {state.config.baudRate} <span className="footer-divider">/</span> {state.config.dataBits}{state.config.parity[0].toUpperCase()}{state.config.stopBits}</span><span className="status-counters"><span><ArrowDown size={11} />RX <b>{formatBytes(state.rxBytes)}</b></span><span><ArrowUp size={11} />TX <b>{formatBytes(state.txBytes)}</b></span><span>解析跳过 <b>{state.parseErrors}</b></span>{state.dropped > 0 && <span className="warning">显示丢弃 {state.dropped}</span>}</span><span className="footer-version">{simple ? '精简工作区' : '完整工作区'} · SignalDesk</span></footer>
    {toast && <div role="status" className={`toast ${toast.error ? 'error' : ''}`}>{toast.error ? <Info size={17} /> : <Check size={17} />}<span>{toast.message}</span><IconButton title="关闭消息" onClick={() => setToast(null)}><X size={15} /></IconButton></div>}
    <DeviceDiscovery state={state} online={online} detached={detached} addProject={() => setSetup(true)} notify={notify} />
    {shortcutHelp && <ShortcutHelp close={() => setShortcutHelp(false)} />}
    {engineeringLab && <EngineeringLab key={scopeKey} initial={engineeringLab} seed={probeSeed} state={state} close={()=>{setEngineeringLab(null);setProbeSeed(undefined);}} openProject={setSetup} problems={()=>validate('problems')} review={prompt=>analyzeValidation('',prompt)}/>}
    {trace?.scope === scopeKey && activeDevice?.projectRoot && <CrashTraceDialog deviceId={activeDevice.id} root={activeDevice.projectRoot} snapshot={trace.snapshot} close={() => setTrace(null)} open={(file, line) => { setTrace(null); jumpToDiagnostic(file, line); }} />}
    {help && <HelpCenter initial={help} close={() => setHelp(null)} perform={performTutorial} />}
    {palette && <CommandPalette actions={[{ id: 'backtrace', name: '崩溃回溯', terms: 'F9 HardFault ELF backtrace 异常 指令地址 调用栈', icon: Search, run: () => openTrace() }, { id: 'help', name: '使用教程', terms: '帮助 教程 tutorial help 入门 新手', icon: BookOpen, run: () => { requestAnimationFrame(() => openTutorial()); } }, { id: 'project', name: '添加项目', terms: '导入 工程 一键配置', icon: FolderPlus, run: () => { requestAnimationFrame(() => setSetup(true)); } }, { id: 'connect', name: '连接设置', terms: '串口 波特率 参数', icon: Plug, run: configure }, { id: 'settings', name: '设置', terms: '外观 主题 背景 偏好', icon: Settings, run: () => { requestAnimationFrame(() => setSettingsSection('appearance')); } }, { id: 'simple', name: simple ? '切换完整模式' : '切换精简模式', terms: '精简 完整 面板 布局', icon: PanelLeftClose, run: () => setSimple(!simple) }]} devices={state.devices || []} navigate={navigate} selectDevice={async id => { try { await api('/devices/select', { id }); } catch (error) { notify((error as Error).message, true); } }} close={() => setPalette(false)} />}
    {searchScope === scopeKey && activeDevice?.projectRoot && <ProjectSearch key={scopeKey} root={activeDevice.projectRoot} deviceId={activeDevice.id} close={() => setSearchScope('')} open={jumpToDiagnostic}/>}
    {quickFile && state.activeDevice && <QuickOpenFile key={scopeKey} deviceId={state.activeDevice || ''} close={() => setQuickFile(false)} open={(file, line) => { if (line) jumpToDiagnostic(file, line); else openFile(file); setSideTab('project'); }} />}
    {setup && <ProjectSetupDialog initialRoot={typeof setup === 'string' ? setup : ''} close={() => setSetup(false)} completed={result => { const generated = typeof setup === 'string'; setSetup(false); setNavExpanded(false); setSideTab('project'); if (!simple) setConnectionOpen(true); navigate(generated ? 'validation' : result.protocol === 'raw' ? 'terminal' : 'workspace'); notify(`${result.reused ? '已打开项目' : '项目已添加'}${result.connected ? '，设备已连接' : '，设备未连接'}${result.warnings.length ? `。${result.warnings.join('；')}` : ''}`); }} />}
    {settingsSection && <SettingsHub openTutorial={() => { setSettingsSection(null); requestAnimationFrame(() => openTutorial()); }} key={scopeKey} device={state} initial={settingsSection} simple={simple} setSimple={setSimple} navExpanded={navExpanded} setNavExpanded={setNavExpanded} resetLayout={resetLayout} close={() => setSettingsSection(null)} configure={configure} navigate={navigate} notify={notify} />}{about && <div className="modal-backdrop" onClick={() => setAbout(false)}><section role="dialog" aria-modal="true" aria-label="关于 SignalDesk" className="about-dialog" onClick={event => event.stopPropagation()}><div className="panel-toolbar"><span>关于 SignalDesk</span><IconButton title="关闭关于窗口" onClick={() => setAbout(false)}><X size={17} /></IconButton></div><div className="about-content"><CircuitBoard size={38} /><h2>SignalDesk</h2><p>嵌入式开发工作台 · {version}</p><div className="about-libraries">React · uPlot · React Flow · CodeMirror<br />serialport · Electron · fft.js</div><p className="muted">架构参考：Lissio（Apache-2.0）</p></div></section></div>}
  </div></InspectorContext.Provider>;
}
