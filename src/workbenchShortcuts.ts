import { isMac } from './platform';

export const workbenchShortcuts = {
  palette: { label: '查找功能或设备', keys: ['Ctrl+K', 'Ctrl+Shift+P'] },
  help: { label: '键盘快捷操作', keys: ['Shift+F1'] },
  discover: { label: '发现设备', keys: ['F6'] },
  terminal: { label: '串口终端', keys: [isMac ? 'Control+`' : 'Ctrl+`'] },
  build: { label: '编译当前工程', keys: ['F7', 'Ctrl+Shift+B'] },
  test: { label: '选择源码测试', keys: ['Shift+F7'] },
  problems: { label: '编译问题', keys: ['F8'] },
  memory: { label: '固件容量', keys: ['Shift+F8'] },
  backtrace: { label: '崩溃回溯', keys: ['F9'] },
} as const;

export type ShortcutAction = keyof typeof workbenchShortcuts;

export function matchWorkbenchShortcut(event: KeyboardEvent): ShortcutAction | undefined {
  if (isMac && event.ctrlKey && !event.metaKey && !event.altKey && !event.shiftKey && event.code === 'Backquote') return 'terminal';
  if (event.altKey || (isMac ? event.ctrlKey : event.metaKey)) return;
  const modifier = isMac ? event.metaKey : event.ctrlKey;
  const key = event.code === 'Backquote' ? '`' : event.key.toUpperCase();
  const chord = `${modifier ? 'Ctrl+' : ''}${event.shiftKey ? 'Shift+' : ''}${key}`;
  return (Object.keys(workbenchShortcuts) as ShortcutAction[]).find(id => workbenchShortcuts[id].keys.some(binding => binding === chord));
}
