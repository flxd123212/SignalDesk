import { useEffect, useRef } from 'react';
import { Code2, CircuitBoard, Activity, FlaskConical, X, SlidersHorizontal } from 'lucide-react';
import type { AppState, Page } from './types';
import { pages } from './navigation';
import { IconButton } from './ui';
import { usePreferences } from './preferences';
import { WorkbenchMenu } from './WorkbenchMenu';
import { shortcutLabel } from './platform';

export const workspaces = [
  { id: 'software', label: '软件', icon: Code2, home: 'editor', pages: ['editor', 'tooling', 'chips', 'script', 'widgets', 'agent', 'external'] },
  { id: 'hardware', label: '硬件', icon: CircuitBoard, home: 'hardware', pages: ['hardware', 'display', 'attitude'] },
  { id: 'integration', label: '联调', icon: Activity, home: 'workspace', pages: ['workspace', 'terminal', 'overview', 'graph', 'circuit', 'commands', 'instruments', 'frames', 'can'] },
  { id: 'testing', label: '测试', icon: FlaskConical, home: 'validation', pages: ['validation', 'automation', 'alarms', 'sessions', 'logs'] },
] as const;
export type WorkspaceId = typeof workspaces[number]['id'];
export const workspaceFor = (page: Page) => workspaces.find(area => (area.pages as readonly string[]).includes(page)) || workspaces[2];

export function WorkspaceNavigation({ page, navigate, expanded = false }: { page: Page; navigate: (page: Page) => void; expanded?: boolean }) {
  const area = workspaceFor(page), preferences = usePreferences();
  const visible = area.pages.filter(id => expanded || preferences.favorites.includes(id) || id === page || id === area.home);
  return <details className="workspace-functions" open><summary>{area.label}工作区</summary><div>{visible.map(id => { const item = pages.find(item => item.id === id)!; return <button key={id} aria-label={item.label} aria-current={page === id ? 'page' : undefined} className={page === id ? 'active' : ''} onClick={() => navigate(id)}><item.icon size={14} /><span>{item.label}</span></button>; })}{visible.length < area.pages.length && <WorkbenchMenu label="更多工作区功能" items={area.pages.filter(id => !visible.includes(id)).map(id => ({ label: pages.find(item => item.id === id)!.label, action: () => navigate(id) }))} />}</div></details>;
}

export function ContextProperties({ state, page, configure, openHardware }: { state: AppState; page: Page; configure: () => void; openHardware: () => void }) {
  const device = state.devices?.find(device => device.id === state.activeDevice);
  return <div className="context-properties"><SlidersHorizontal size={22} /><h2>{pages.find(item => item.id === page)?.label}属性</h2><dl><dt>当前设备</dt><dd>{device?.name || '未选择'}</dd><dt>芯片 / 开发板</dt><dd>{device?.board || device?.chip || '待确认'}</dd><dt>工程</dt><dd>{device?.projectRoot || '未绑定'}</dd><dt>连接</dt><dd>{state.config.path === 'unassigned' ? '未匹配串口' : state.config.path} · {state.connected ? '已连接' : '未连接'}</dd><dt>数据协议</dt><dd>{state.config.protocol}</dd><dt>采样配置</dt><dd>{state.config.sampleRate} Hz</dd></dl><button className="quiet-button" onClick={configure}>连接设置</button><button className="quiet-button" onClick={openHardware}>硬件与引脚映射</button></div>;
}

export function ShortcutHelp({ close }: { close: () => void }) {
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => { dialog.current?.showModal(); }, []);
  return <dialog ref={dialog} className="binding-dialog shortcut-dialog" aria-label="键盘快捷操作" onCancel={close}><div className="panel-toolbar"><span>键盘快捷操作</span><IconButton title="关闭快捷操作" onClick={close}><X size={16} /></IconButton></div><div className="binding-content"><table><tbody>{[['当前页面帮助', 'F1'], ['切换软件 / 硬件 / 联调 / 测试', 'Ctrl+Alt+1 / 2 / 3 / 4'], ['查找功能', 'Ctrl+K'], ['快速打开文件', 'Ctrl+P'], ['项目树 / 底部输出', 'Ctrl+B / Ctrl+J'], ['设置', 'Ctrl+,'], ['编译当前工程', 'Ctrl+Shift+B'], ['节点：撤销 / 重做', 'Ctrl+Z / Ctrl+Shift+Z'], ['节点：复制所选 / 全选', 'Ctrl+D / Ctrl+A'], ['节点：添加 / 连接', 'N / C'], ['节点：自动排列 / 适应视图', 'L / F'], ['节点：应用 / 删除所选', 'Ctrl+S / Delete'], ['节点：移动', 'Tab 聚焦，Enter 选择，方向键移动'], ['关闭弹窗 / 退出全屏', 'Esc']].map(([label, key]) => <tr key={label}><td>{label}</td><td><kbd>{shortcutLabel(key)}</kbd></td></tr>)}</tbody></table></div></dialog>;
}
