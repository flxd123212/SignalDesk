import path from 'node:path';
import { parseDiagnostics } from '../diagnostics.mjs';
import { readSourceLines } from './firmware.mjs';

export function validateTaskPlan(steps) {
  if (!Array.isArray(steps) || !steps.length || steps.length > 8 || steps.filter(step => step?.status === 'in_progress').length > 1) throw new Error('计划需要 1 - 8 步，同时只能有一个进行中的步骤');
  return steps.map(step => {
    if (typeof step?.title !== 'string' || !step.title.trim() || step.title.length > 160 || !['pending', 'in_progress', 'completed', 'skipped'].includes(step.status)) throw new Error('计划步骤格式无效');
    return { title: step.title.trim(), status: step.status };
  });
}
export async function projectTool(agent, name, args, context) {
  const workspace = agent.workspace;
  if (name === 'update_task_plan') {
    agent.taskPlan = validateTaskPlan(args.steps); agent.changed(); return { steps: agent.taskPlan, evidence: 'Agent-authored plan, not proof of build or hardware success' };
  }
  if (name === 'get_project_overview') {
    const files = await workspace.list(), extensions = {};
    for (const file of files) { const extension = path.extname(file.path).toLowerCase(); extensions[extension] = (extensions[extension] || 0) + 1; }
    const { buildPreset, fqbn, platformioEnvironment, keilProject, keilTarget, iarProject, iarConfig, gccCompiler, gccToolchainFile } = agent.config;
    return { root: workspace.root, project: agent.engine.projectContext || null, build: { buildPreset, fqbn, platformioEnvironment, keilProject, keilTarget, iarProject, iarConfig, gccCompiler, gccToolchainFile },
      fileCount: files.length, extensions, files: files.slice(0, 80), truncated: files.length > 80 || files.length === 300, buildExecuted: !!agent.builder.job };
  }
  if (name === 'find_firmware_files') {
    if (typeof args.query !== 'string' || !args.query.trim() || args.query.length > 200) throw new Error('文件名查询需要 1 - 200 个字符');
    const files = await workspace.list(), matches = files.filter(file => file.path.toLowerCase().includes(args.query.trim().toLowerCase()));
    return { files: matches.slice(0, 100), truncated: matches.length > 100 || files.length === 300 };
  }
  if (name === 'read_firmware_lines') {
    const { startLine, endLine } = args;
    if (!Number.isInteger(startLine) || !Number.isInteger(endLine) || startLine < 1 || endLine < startLine || endLine - startLine >= 200) throw new Error('行号从 1 开始，一次最多读取 200 行');
    return readSourceLines(await workspace.read(args.path), startLine, endLine);
  }
  if (name === 'get_build_diagnostics') {
    const job = agent.builder.job;
    if (!job) return { status: 'not_run', diagnostics: [], message: '本会话尚未执行构建，不能判定源码通过编译' };
    return { status: job.status, exitCode: job.exitCode, command: job.command, finishedAt: job.finishedAt, sourceState: job.validation?.sourceState || 'not_rechecked', diagnostics: job.diagnostics || parseDiagnostics(job.output, workspace.root) };
  }
  if (name === 'get_recent_changes') return { changes: (await workspace.history()).slice(0, 50) };
  if (name === 'get_change_detail') {
    const change = await workspace.change(args.id);
    return { id: change.id, path: change.path, status: change.status, reason: change.reason, expectedHash: change.expectedHash, afterHash: change.afterHash, createdAt: change.createdAt, diff: String(change.diff || '').slice(0, 16000), truncated: String(change.diff || '').length > 16000 };
  }
  if (name === 'get_serial_logs') {
    if (!context.includeLogs) throw new Error('请先启用“附带原始日志”，才可读取报文正文');
    if (typeof args.query !== 'string' || args.query.length > 200 || !['all', 'rx', 'tx'].includes(args.direction)) throw new Error('报文筛选参数无效');
    const packets = agent.engine.recentPackets.slice(-200).map(packet => ({ direction: String(packet.dir).toLowerCase(), time: packet.time, text: Buffer.from(packet.data, 'base64').subarray(0, 512).toString('utf8') }));
    const matches = packets.filter(packet => (args.direction === 'all' || packet.direction === args.direction) && packet.text.toLowerCase().includes(args.query.toLowerCase()));
    return { packets: matches.slice(-30), bounded: true, source: agent.engine.source, port: agent.engine.config.path };
  }
  if (name === 'propose_source_patch') {
    if (typeof args.oldText !== 'string' || !args.oldText || args.oldText.length > 8000 || typeof args.newText !== 'string' || args.newText.length > 32000) throw new Error('替换目标需要 1 - 8000 字符，新文本最多 32000 字符');
    const file = await workspace.read(args.path), original = file.content.replace(/\r\n/g, '\n'), oldText = args.oldText.replace(/\r\n/g, '\n');
    if (file.hash !== args.expectedHash) throw new Error('文件已经变化，请重新读取后生成补丁');
    const offset = original.indexOf(oldText);
    if (offset < 0 || original.indexOf(oldText, offset + 1) !== -1) throw new Error('替换目标不存在或不唯一，请提供足够的上下文');
    const content = original.slice(0, offset) + args.newText.replace(/\r\n/g, '\n') + original.slice(offset + oldText.length);
    const proposal = await workspace.propose({ ...args, content }, { partialEdit: true }); agent.changed();
    return { id: proposal.id, path: proposal.path, status: 'pending_user_action', reason: proposal.reason };
  }
}

export function toolActivity(agent, name, args, output, startedAt, error = '') {
  const preview = value => {
    let text = JSON.stringify(value, null, 2) || '';
    if (agent.config.apiKey) text = text.split(JSON.stringify(agent.config.apiKey).slice(1, -1)).join('[REDACTED]');
    return text.length > 6000 ? text.slice(0, 6000) + '\n[预览已截断]' : text;
  };
  const locations = [];
  for (const candidate of [args, ...(output?.matches || []), ...(output?.diagnostics || []), ...(output?.files || [])]) {
    if (typeof candidate?.path === 'string' && candidate.path && !path.isAbsolute(candidate.path) && !candidate.path.split(/[\\/]/).some(part => part === '..' || part.startsWith('.')) && !locations.some(item => item.path === candidate.path && item.line === (candidate.line || candidate.startLine || 1))) {
      locations.push({ path: candidate.path.slice(0, 400), line: candidate.line || candidate.startLine || 1 });
      if (locations.length >= 6) break;
    }
  }
  return { name, status: error ? 'error' : output === undefined ? 'running' : 'completed', root: agent.workspace.root,
    input: preview(args), output: output === undefined ? '' : preview(output), durationMs: Math.max(0, Date.now() - startedAt), locations };
}
