import { useEffect, useRef, useState } from 'react';
import { Check, Circle, Clock3, Copy, FileCode2, ListChecks, LoaderCircle, ShieldCheck, Wrench, X } from 'lucide-react';
import { IconButton } from './ui';

export type TaskStep = { title: string; status: 'pending' | 'in_progress' | 'completed' | 'skipped' };
export type ToolEvent = { name: string; status: string; input: string; output: string; durationMs: number; root: string; locations: { path: string; line: number }[] };
const tools: Record<string, [string, string]> = {
  inspect_development_environment: ['开发环境检查', '读取本机工具链或 USB 开发板、探针与启动模式'],
  get_device_snapshot: ['设备数据快照', '连接、通道统计与有界采样窗口'], list_firmware_files: ['列出项目文件', '工程范围内的源码文件'],
  read_firmware_file: ['读取完整源码', 'UTF-8 正文与 SHA256'], search_firmware: ['搜索源码内容', '匹配文字、文件与行号'],
  get_build_status: ['构建输出', '实际状态、退出码与输出尾部'], get_project_overview: ['项目概览', '文件类型、开发板信息与构建目标'],
  find_firmware_files: ['查找文件', '按文件名或相对路径检索'], read_firmware_lines: ['按行读取源码', '指定行段、行号与文件校验值'],
  get_build_diagnostics: ['编译问题定位', '错误、警告与源码位置'], get_recent_changes: ['最近修改记录', '本工程的修改状态与历史'],
  get_change_detail: ['查看修改差异', '修改前后的代码差异'], get_serial_logs: ['查询串口报文', '筛选最近 RX / TX 正文'],
  update_task_plan: ['更新任务计划', '维护本会话的执行步骤'], propose_source_patch: ['局部代码补丁', '唯一文本替换与 SHA256 校验'],
  propose_file_change: ['文件修改提案', '完整文件差异与备份'], propose_serial_command: ['串口指令提案', '向当前设备发送指令'],
  propose_build: ['项目编译提案', '运行已配置的构建目标'], propose_toolchain_command: ['工具链命令提案', '受支持的构建或 Git 命令'],
};
const statuses: Record<string, string> = { running: '执行中', completed: '完成', error: '失败', interrupted: '已中断', pending: '待处理', in_progress: '进行中', skipped: '跳过' };

export function AgentToolEvent({ event, root, openSource, notify }: { event: ToolEvent; root: string; openSource?: (file: string, line: number) => void; notify: (message: string, error?: boolean) => void }) {
  return <details className={`agent-tool-event ${event.status}`}>
    <summary>{event.status === 'running' ? <LoaderCircle size={13} className="spin" /> : event.status === 'completed' ? <Check size={13} /> : <X size={13} />}<span>{tools[event.name]?.[0] || event.name}</span><small>{statuses[event.status] || event.status}</small>{event.status !== 'running' && <time>{event.durationMs < 1000 ? `${event.durationMs} ms` : `${(event.durationMs / 1000).toFixed(1)} s`}</time>}</summary>
    <div className="tool-event-body"><div className="tool-event-title"><code>{event.name}</code><IconButton title="复制工具记录" onClick={async () => { try { await navigator.clipboard.writeText(`${event.name}\n${event.input}\n${event.output}`); notify('工具记录已复制'); } catch { notify('无法访问剪贴板', true); } }}><Copy size={13} /></IconButton></div>
      <div className="tool-event-section"><b>参数</b><pre>{event.input || '{}'}</pre></div>
      {event.output && <div className="tool-event-section"><b>结果</b><pre>{event.output}</pre></div>}
      {!!event.locations?.length && openSource && event.root === root && <div className="tool-source-links">{event.locations.map((location, index) => <button key={index} aria-label={`打开 ${location.path}:${location.line}`} title={`打开 ${location.path}:${location.line}`} onClick={() => openSource(location.path, location.line)}><FileCode2 size={12} /><span>{location.path}:{location.line}</span></button>)}</div>}
    </div>
  </details>;
}

export function AgentTaskPlan({ steps, busy, clear }: { steps: TaskStep[]; busy: boolean; clear: () => void }) {
  if (!steps.length) return null;
  return <details className="agent-task-plan" open><summary><ListChecks size={14} /><span>Agent 计划</span><small>{steps.filter(step => step.status === 'completed').length} / {steps.length}</small></summary><div className="task-plan-body"><ol>{steps.map((step, index) => <li key={index} className={step.status}>{step.status === 'completed' ? <Check size={13} /> : step.status === 'in_progress' && busy ? <LoaderCircle size={13} className="spin" /> : <Circle size={11} />}<span>{step.title}</span><small>{step.status === 'in_progress' && !busy ? '待继续' : statuses[step.status]}</small></li>)}</ol><IconButton title="清除任务计划" disabled={busy} onClick={clear}><X size={13} /></IconButton></div></details>;
}

export function AgentToolbox({ capabilities, readOnly, includeLogs, close }: { capabilities: { name: string; readOnly: boolean }[]; readOnly: boolean; includeLogs: boolean; close: () => void }) {
  const [group, setGroup] = useState('all');
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => { const previous = document.activeElement; dialog.current?.showModal(); return () => { dialog.current?.close(); if (previous instanceof HTMLElement && previous.isConnected) previous.focus(); }; }, []);
  return <dialog ref={dialog} className="agent-toolbox" aria-label="Agent 工具箱" onCancel={close}><header><Wrench size={16} /><h3>Agent 工具箱</h3><span>{capabilities.length} 个工具</span><IconButton title="关闭工具箱" onClick={close}><X size={16} /></IconButton></header><nav className="agent-tool-filter" aria-label="工具权限筛选">{[['all','全部'],['read','观察与诊断'],['propose','修改与执行']].map(([id,label]) => <button key={id} aria-pressed={group===id} onClick={() => setGroup(id)}>{label}</button>)}</nav><div className="agent-toolbox-list">{capabilities.filter(tool => group === 'all' || (group === 'read') === tool.readOnly).map(tool => {
    const unavailable = readOnly && !tool.readOnly || tool.name === 'get_serial_logs' && !includeLogs;
    return <div className={unavailable ? 'unavailable' : ''} key={tool.name}><div><b>{tools[tool.name]?.[0] || tool.name}</b><small>{!tool.readOnly ? <ShieldCheck size={12} /> : <Clock3 size={12} />}{!tool.readOnly ? readOnly ? '只读模式不可用' : '确认后执行' : tool.name === 'get_serial_logs' && !includeLogs ? '需附带原始日志' : '已启用'}</small></div><p>{tools[tool.name]?.[1]}</p><code>{tool.name}</code></div>;
  })}</div></dialog>;
}
