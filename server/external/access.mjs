import { randomBytes, randomUUID, createHash } from 'node:crypto';
import { AGENT_TOOLS, READ_ONLY_TOOLS } from '../ai/tools.mjs';
import { captureSnapshot } from '../ai/analysis.mjs';

const digest = token => createHash('sha256').update(token).digest('hex');
const object = properties => ({ type: 'object', properties, required: Object.keys(properties), additionalProperties: false });
const string = { type: 'string' };
export const PERMISSIONS = ['read', 'propose', 'write', 'serial', 'toolchain'];
const baseTools = AGENT_TOOLS.filter(tool => !['propose_build', 'get_serial_logs'].includes(tool.name)).map(tool => ({ ...tool, permission: READ_ONLY_TOOLS.has(tool.name) ? 'read' : 'propose' }));
export const EXTERNAL_TOOLS = [
  ...baseTools,
  { name: 'submit_advice', description: 'Record an external Agent recommendation in the bound device conversation.', permission: 'propose', parameters: object({ message: string }) },
  { name: 'get_proposal', description: 'Read the status and diff of a proposal from this connection.', permission: 'read', parameters: object({ id: string }) },
  { name: 'write_project_file', description: 'Directly edit an existing UTF-8 project source file with hash check, backup and before/after history. Requires write permission.', permission: 'write', parameters: AGENT_TOOLS.find(tool => tool.name === 'propose_file_change').parameters },
  { name: 'apply_file_change', description: 'Apply this connection\'s pending file proposal. Requires write permission.', permission: 'write', parameters: object({ id: string }) },
  { name: 'send_serial', description: 'Send one command to the bound, unchanged device connection. Requires serial permission. Never guesses firmware commands.', permission: 'serial', parameters: AGENT_TOOLS.find(tool => tool.name === 'propose_serial_command').parameters },
  { name: 'run_toolchain', description: 'Run a supported compile or inspection command in the bound project. No shell, flash or install. Requires toolchain permission.', permission: 'toolchain', parameters: object({ commandLine: string, reason: string }) },
  { name: 'get_toolchain_status', description: 'Read the most recent toolchain job output for this connection.', permission: 'read', parameters: object({}) },
];

export class ExternalAccess {
  constructor(hub, registry, logs) { this.hub = hub; this.registry = registry; this.logs = logs; this.tokens = new Map(); }
  permissions(input) { if (!Array.isArray(input) || input.some(value => !PERMISSIONS.includes(value))) throw new Error('外部 Agent 权限无效'); return [...new Set(input)]; }
  create({ name = 'External Agent', permissions = ['read', 'propose'] }) {
    const scopes = this.permissions(permissions);
    if (this.tokens.size >= 30) throw new Error('连接数量达到上限');
    const device = this.hub.activeId, session = this.registry.create({ name: String(name).slice(0, 40), external: true });
    const entry = this.registry.sessions.get(session), token = randomBytes(32).toString('hex'), id = randomUUID();
    const record = { id, name: String(name).slice(0, 40), device, session, root: entry.agent.workspace.root, permissions: scopes, hash: digest(token), connected: true, lastSeen: null, generation: entry.agent.engine.generation, createdAt: new Date().toISOString(), calls: 0, busy: false };
    this.tokens.set(id, record); this.logs.secrets.add(token);
    this.logs.write({ category: 'external', device, message: '已授权外部 Agent 连接', data: { id, name: record.name, permissions: scopes, root: record.root } });
    return { token, connection: this.public(record) };
  }
  public({ hash, generation, ...record }) { return record; }
  list() { return [...this.tokens.values()].map(record => this.public(record)); }
  update({ id, permissions, connected, revoke = false }) {
    const record = this.tokens.get(id); if (!record) throw new Error('外部连接不存在');
    const agent = this.registry.sessions.get(record.session)?.agent;
    if (revoke) { agent?.cancel(); agent?.builder.stop(); this.tokens.delete(id); }
    else {
      const next = permissions === undefined ? record.permissions : this.permissions(permissions);
      if (connected !== undefined && typeof connected !== 'boolean') throw new Error('连接状态无效');
      if (connected === true) {
        const device = this.hub.devices.get(record.device);
        if (!agent || !device || device.projectRoot !== record.root || agent.workspace.root !== record.root) throw new Error('工程或会话已变化，请重新创建连接');
        if (record.busy) throw new Error('请等待上次请求结束后重新连接');
        record.generation = agent.engine.generation;
      }
      if (!next.includes('toolchain') || connected === false) agent?.builder.stop();
      if (connected === false) agent?.cancel();
      record.permissions = next;
      if (connected !== undefined) record.connected = connected;
    }
    this.logs.write({ category: 'external', device: record.device, message: revoke ? '外部连接已撤销' : connected === false ? '外部连接已断开' : connected === true ? '外部连接已启用' : '外部权限已更新', data: { id, connected: record.connected, permissions: record.permissions } });
    return this.list();
  }
  authenticate(header) {
    const token = typeof header === 'string' && header.startsWith('Bearer ') ? header.slice(7) : '';
    const hash = digest(token), record = [...this.tokens.values()].find(entry => entry.hash === hash);
    if (!record || !record.connected) throw Object.assign(new Error('外部 Agent 连接已断开或令牌无效'), { status: 401 });
    const entry = this.registry.sessions.get(record.session), device = this.hub.devices.get(record.device);
    if (!entry || !device || entry.agent.workspace.root !== record.root || device.projectRoot !== record.root) throw new Error('绑定设备、工程或会话已变化，请重新授权');
    record.lastSeen = new Date().toISOString();
    return { record, agent: entry.agent };
  }
  tools(header) { const { record } = this.authenticate(header); return EXTERNAL_TOOLS.filter(tool => record.permissions.includes(tool.permission)).map(({ parameters, permission, ...tool }) => ({ ...tool, inputSchema: parameters })); }
  async call(header, { tool, arguments: args = {} }) {
    const { record, agent } = this.authenticate(header), definition = EXTERNAL_TOOLS.find(item => item.name === tool);
    if (!definition || !record.permissions.includes(definition.permission)) throw Object.assign(new Error(`未授权工具：${tool}`), { status: 403 });
    if (record.busy) throw new Error('该外部连接仍有任务正在处理');
    if (!args || typeof args !== 'object' || Array.isArray(args)) throw new Error('工具参数必须为对象');
    if (agent.busy) throw new Error('会话正在运行内置 Agent');
    const authorizeExecution = () => { const current = this.authenticate(header); if (current.record !== record || !record.permissions.includes(definition.permission)) throw new Error('执行权限已撤销'); };
    record.busy = true; record.calls++;
    try {
      let result;
      if (tool === 'get_device_snapshot') result = { ...captureSnapshot(agent.engine, false), deviceId: record.device, chip: this.hub.devices.get(record.device).chip, projectRoot: record.root };
      else if (tool === 'submit_advice') { if (typeof args.message !== 'string' || !args.message.trim() || args.message.length > 16000) throw new Error('建议内容应为 1..16000 字符'); agent.message('assistant', args.message, 'external'); result = { recorded: true }; }
      else if (tool === 'get_proposal') { const action = agent.workspace.proposals.get(args.id) || agent.actions.get(args.id); if (!action) throw new Error('该连接没有此提案'); const { content, beforeContent, expectedHash, ...safe } = action; result = safe; }
      else if (tool === 'write_project_file') {
        const proposal = await agent.workspace.propose(args); authorizeExecution(); await agent.execute(proposal.id);
        result = { id: proposal.id, status: proposal.status, path: proposal.path, diff: proposal.diff, backup: proposal.backup };
      } else if (tool === 'apply_file_change') {
        if (!agent.workspace.proposals.has(args.id)) throw new Error('只能应用当前外部连接的文件提案');
        authorizeExecution(); await agent.execute(args.id); result = { applied: true, id: args.id };
      } else if (tool === 'send_serial') {
        if (agent.engine.generation !== record.generation || !agent.engine.connected) throw new Error('设备连接已变化，请重新创建授权');
        const proposal = await agent.tool('propose_serial_command', args, { includeLogs: false }); authorizeExecution(); await agent.execute(proposal.id);
        result = { sent: true, id: proposal.id };
      } else if (tool === 'run_toolchain') {
        const proposal = await agent.tool('propose_toolchain_command', args, { includeLogs: false }); authorizeExecution(); await agent.execute(proposal.id); result = agent.builder.job;
      } else if (tool === 'get_toolchain_status') result = agent.builder.job;
      else result = await agent.tool(tool, args, { includeLogs: false });
      agent.changed(); this.logs.write({ category: 'external', device: record.device, message: `${record.name} · ${tool} · 成功`, data: { connection: record.id, path: args.path, proposal: result?.id, reason: args.reason } });
      return { result };
    } catch (error) { this.logs.write({ level: 'error', category: 'external', device: record.device, message: `${record.name} · ${tool} · ${error.message}`, data: { connection: record.id } }); throw error; }
    finally { record.busy = false; }
  }
}
