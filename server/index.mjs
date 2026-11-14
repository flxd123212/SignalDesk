import express from 'express';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { WebSocketServer, WebSocket } from 'ws';
import { SerialPort } from 'serialport';
import { DeviceHub } from './devices.mjs';
import { inspectFrame, inspectModbus, validateSchema } from './frames.mjs';
import { TestRunner } from './automation.mjs';
import { ChipService } from './chips.mjs';
import { importSSCOM, crc16Modbus, parseHex } from './protocol.mjs';
import { AgentRegistry } from './ai/registry.mjs';
import { commandPlan } from './ai/build.mjs';
import { EventLog } from './logs.mjs';
import { WorkspaceStore } from './workspace.mjs';
import { ExternalAccess } from './external/access.mjs';
import { readKeilProject } from './keil.mjs';
import { readIarProject } from './iar.mjs';
import { discoverToolchains } from './toolchains.mjs';
import { chipCatalog } from './catalog.mjs';
import { PortDiscovery, identifyBootLog, inspectProject, matchBinding } from './identification.mjs';
import { graphTest } from './testing.mjs';
import { AlarmService } from './alarms.mjs';
import { CommandQueues } from './command-queue.mjs';
import { analyzeCan } from './can-analysis.mjs';
import { WidgetSandbox } from './widgets.mjs';
import { ProjectSetup } from './project-setup.mjs';
import { ProjectValidation } from './validation.mjs';
import { discoverGcc } from './gcc.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

export async function startServer({ port = 4780, dev = false, autoDemo = false, directory = path.join(root, '.data', 'sessions'), examplesDirectory = path.join(root, 'firmware-examples'), listPorts = () => SerialPort.list(), Port = SerialPort } = {}) {
  const app = express(), server = http.createServer(app);
  const engine = new DeviceHub({ directory, Port });
  const discovery = new PortDiscovery(engine, listPorts);
  const workspace = new WorkspaceStore(path.join(directory, '..', 'devices.json'), engine); await workspace.load();
  if (!autoDemo) for (const device of engine.devices.values()) if (device.engine.config.path === 'demo') device.engine.config = { ...device.engine.config, path: 'unassigned', protocol: 'raw' };
  const automation = new TestRunner();
  const chips = new ChipService(path.join(directory, '..', 'firmware'), engine);
  const detectedTools = await discoverToolchains();
  const agent = new AgentRegistry(engine, path.join(examplesDirectory, 'SignalGenerator'), path.join(directory, '..', 'changes'), detectedTools);
  const logs = new EventLog(path.join(directory, '..', 'logs')); await logs.init();
  const alarms = new AlarmService(engine, logs);
  const commandQueues = new CommandQueues(engine, logs);
  const widgets = new WidgetSandbox();
  const external = new ExternalAccess(engine, agent, logs);
  const projects = new ProjectSetup(engine, agent, discovery, workspace, logs);
  const validation = new ProjectValidation(engine, agent, logs);
  if (workspace.failure) logs.write({ level: 'error', category: 'workspace', message: workspace.failure });
  for (const entry of agent.sessions.values()) if (entry.agent.config.apiKey) logs.secrets.add(entry.agent.config.apiKey);
  engine.on('state', () => workspace.save()); workspace.save();
  agent.on('audit', record => logs.write(record));
  engine.on('notice', notice => logs.write({ level: notice.level, category: 'device', device: engine.activeId, message: notice.message }));
  const instrumented = new WeakSet();
  const observeDevices = () => {
    for (const { id, engine: device } of engine.devices.values()) {
      if (instrumented.has(device)) continue; instrumented.add(device);
      device.on('notice', notice => { if (id !== engine.activeId) logs.write({ level: notice.level, category: 'device', device: id, message: notice.message }); });
      let lastErrors = 0, connection = false;
      device.on('state', state => {
        if (connection !== state.connected) { logs.write({ category: 'connection', device: id, message: state.connected ? '设备已连接' : '设备已断开', data: { path: state.config.path, source: state.source } }); connection = state.connected; }
        if (state.parseErrors > lastErrors && (lastErrors === 0 || state.parseErrors - lastErrors >= 100)) { logs.write({ level: 'warn', category: 'parser', device: id, message: '存在未解析行或帧', data: { count: state.parseErrors } }); lastErrors = state.parseErrors; }
        if (!state.parseErrors) lastErrors = 0;
      });
    }
  };
  observeDevices(); engine.on('state', observeDevices);
  automation.on('update', () => { if (automation.job?.status !== 'running') logs.write({ category: 'test', level: automation.job?.status === 'failed' ? 'error' : 'info', message: '自动测试结束', data: automation.job }); });
  chips.on('update', () => { if (chips.job?.status !== 'running') logs.write({ category: 'flash', level: chips.job?.status === 'failed' ? 'error' : 'info', message: '烧录任务结束', data: chips.job }); });
  const sockets = new WebSocketServer({ noServer: true, maxPayload: 1024 });
  let address;
  const validOrigin = origin => !origin || origin === address;
  app.use((request, response, next) => {
    const host = request.headers.host?.split(':')[0];
    if (host !== '127.0.0.1' && host !== 'localhost') return response.status(403).json({ error: '仅允许本机访问' });
    if (!validOrigin(request.headers.origin)) return response.status(403).json({ error: '来源不受信任' });
    response.setHeader('X-Content-Type-Options', 'nosniff');
    if (request.path.startsWith('/api/')) response.setHeader('Cache-Control', 'no-store');
    next();
  });
  app.use(express.json({ limit: '34mb' }));
  app.use((request, response, next) => {
    const device = engine.activeId;
    if (typeof request.body?.apiKey === 'string' && request.body.apiKey.trim()) logs.secrets.add(request.body.apiKey.trim());
    response.on('finish', () => {
      if (request.method !== 'POST') return;
      const details = {};
      for (const key of ['path', 'name', 'chip', 'root', 'id', 'mode', 'baudRate', 'sampleRate', 'protocol', 'action', 'commandLine']) if (request.body?.[key] !== undefined) details[key] = request.body[key];
      logs.write({ category: /\/ai\//.test(request.path) ? 'agent' : /\/chips\//.test(request.path) ? 'flash' : 'operation', device, level: response.statusCode >= 400 ? 'error' : 'info', message: `${request.path} · HTTP ${response.statusCode}`, data: details });
    });
    next();
  });
  app.get('/api/state', (_request, response) => response.json(engine.state()));
  app.get('/api/alarms', (_request, response) => response.json(alarms.state()));
  app.get('/api/commands/queue', (_request, response) => response.json(commandQueues.state()));
  app.post('/api/commands/start', async (request, response) => response.json(await commandQueues.start(request.body)));
  app.post('/api/commands/stop', (_request, response) => response.json(commandQueues.stop()));
  app.post('/api/alarms/config', (request, response) => response.json(alarms.configure(request.body)));
  app.post('/api/alarms/acknowledge', (request, response) => response.json(alarms.acknowledge(request.body.id)));
  app.post('/api/alarms/test', (_request, response) => response.json(alarms.record(engine.devices.get(engine.activeId), { kind: 'test', name: '测试通知', message: '报警通知测试（非设备故障）' })));
  app.get('/api/ports', async (_request, response) => response.json(await discovery.scan()));
  app.get('/api/ports/state', async (_request, response) => { await discovery.scan().catch(() => {}); response.json(discovery.snapshot); });
  app.post('/api/ports/attach', async (request, response) => {
    const expected = request.body.expectedActiveDevice;
    const guard = () => { if (!expected || expected !== engine.activeId) throw new Error('当前设备已切换，请重新打开设备弹窗'); if (agent.busy) throw new Error('请先停止 Agent 分析'); };
    guard();
    const deviceId = await discovery.attach(request.body, guard);
    if (expected === engine.activeId && !agent.busy) engine.select(deviceId);
    response.json({ deviceId, state: engine.state() });
  });
  app.get('/api/chips/catalog', (_request, response) => response.json(chipCatalog));
  app.post('/api/projects/inspect', async (request, response) => response.json(await inspectProject(request.body.root)));
  app.post('/api/projects/prepare', async (request, response) => response.json(await projects.prepare(request.body.root)));
  app.post('/api/projects/apply', async (request, response) => response.json(await projects.apply(request.body)));
  app.post('/api/ai/project-health', async (request, response) => response.json(await projects.health(request.body.deviceId)));
  app.post('/api/devices/bind-port', async (request, response) => {
    if (request.body.deviceId && request.body.deviceId !== engine.activeId) throw new Error('当前设备已切换');
    await discovery.bind(engine.activeId, request.body); response.json(engine.state());
  });
  app.get('/api/devices/identify', async (_request, response) => {
    const device = engine.devices.get(engine.activeId), ports = await discovery.scan();
    const port = ports.find(port => port.path === device.engine.config.path);
    const candidates = identifyBootLog(device.engine.recentPackets), warnings = [];
    if (port) candidates.push({ ...port.identification, source: 'usb', evidence: port.identification.evidence.join(' · ') });
    if (device.projectRoot) {
      try { const project = await inspectProject(device.projectRoot); candidates.push(...project.candidates); warnings.push(...project.warnings); }
      catch (error) { warnings.push(error.message); }
    }
    const families = new Set(candidates.map(candidate => candidate.family).filter(Boolean));
    if (families.size > 1) warnings.push('USB / 启动日志与工程的芯片系列不一致，请核对设备和工程');
    response.json({ deviceId: device.id, candidates, warnings, binding: matchBinding(device.portBinding, ports).status });
  });
  app.post('/api/devices/add', (request, response) => { const id = engine.add(request.body.name); agent.cancel(); engine.select(id); response.json(engine.state()); });
  app.post('/api/devices/select', (request, response) => { if (agent.busy) throw new Error('请先停止 Agent 分析'); agent.cancel(); engine.select(request.body.id); response.json(engine.state()); });
  app.post('/api/devices/remove', async (request, response) => { if (agent.busy) throw new Error('请先停止 Agent 分析'); agent.cancel(); await engine.remove(request.body.id); response.json(engine.state()); });
  app.post('/api/devices/config', async (request, response) => {
    const entry = engine.devices.get(engine.activeId);
    if (request.body.deviceId && request.body.deviceId !== entry.id) throw new Error('当前设备已切换，请重新打开设置');
    for (const key of ['name', 'chip', 'board']) if (request.body[key] !== undefined && (typeof request.body[key] !== 'string' || request.body[key].length > 80)) throw new Error('设备标识无效');
    if (request.body.root !== undefined) await agent.configure({ root: request.body.root });
    for (const key of ['name', 'chip', 'board']) if (request.body[key] !== undefined) entry[key] = request.body[key];
    engine.emitState(); response.json(engine.state());
  });
  app.get('/api/devices/overview', (_request, response) => response.json(engine.list().map(entry => ({ ...entry, samples: engine.devices.get(entry.id).engine.history.slice(-300) }))));
  app.get('/api/logs', (request, response) => response.json(logs.list(request.query)));
  app.get('/api/external/state', (_request, response) => response.json({ connections: external.list(), command: process.execPath, env: process.versions.electron ? { ELECTRON_RUN_AS_NODE: '1' } : {}, bridge: path.join(root, 'server', 'external', 'mcp.mjs'), cli: path.join(root, 'server', 'external', 'cli.mjs'), url: address }));
  app.post('/api/external/create', (request, response) => response.json(external.create(request.body)));
  app.post('/api/external/update', (request, response) => response.json(external.update(request.body)));
  app.get('/api/external/tools', (request, response) => response.json(external.tools(request.headers.authorization)));
  app.post('/api/external/call', async (request, response) => response.json(await external.call(request.headers.authorization, request.body)));
  app.get('/api/logs/export', async (request, response) => { response.setHeader('Content-Disposition', 'attachment; filename="signaldesk-events.jsonl"'); response.type('text/plain').send(await logs.export(request.query)); });
  app.post('/api/connect', async (request, response) => { const deviceId = engine.activeId; if (request.body.deviceId && request.body.deviceId !== deviceId) throw new Error('当前设备已切换'); await discovery.checkConnection(deviceId, request.body); if (engine.activeId !== deviceId) throw new Error('当前设备已切换'); await engine.connect(request.body); response.json(engine.state()); });
  app.post('/api/disconnect', async (request, response) => { if (request.body.deviceId && request.body.deviceId !== engine.activeId) throw new Error('当前设备已切换'); await engine.disconnect(); response.json(engine.state()); });
  app.post('/api/send', async (request, response) => { if (request.body.deviceId && request.body.deviceId !== engine.activeId) throw new Error('当前设备已切换'); response.json({ bytes: await engine.send(request.body) }); });
  app.post('/api/signals', async (request, response) => { await engine.setSignals(request.body); response.json(engine.state()); });
  app.post('/api/timer', async (request, response) => {
    if (request.body.deviceId && request.body.deviceId !== engine.activeId) throw new Error('当前设备已切换');
    if (request.body.active) await engine.startTimedSend(request.body.payload, request.body.interval);
    else { engine.stopTimedSend(); engine.emitState(); }
    response.json(engine.state());
  });
  app.post('/api/processing', (request, response) => { engine.setProcessing(request.body); response.json(engine.state()); });
  app.post('/api/testing/graph', (request, response) => response.json(graphTest(request.body)));
  app.post('/api/can/analyze', (request, response) => response.json(analyzeCan(request.body)));
  app.post('/api/widgets/evaluate', async (request, response) => response.json(await widgets.run(request.body)));
  app.post('/api/record/start', async (_request, response) => response.json({ id: await engine.startRecording() }));
  app.post('/api/record/stop', async (_request, response) => { const id = await engine.store.stop(); engine.emitState(); response.json({ id }); });
  app.get('/api/sessions', async (_request, response) => { const active = new Set(engine.list().map(device => device.recording)); response.json((await engine.store.list()).map(record => ({ ...record, active: active.has(record.id) }))); });
  app.post('/api/sessions/import', async (request, response) => response.json({ id: await engine.store.import(request.body.text) }));
  app.get('/api/sessions/:id', (request, response) => {
    if (engine.list().some(device => device.recording === request.params.id)) return response.status(409).json({ error: '请先停止录制' });
    response.download(engine.store.resolve(request.params.id));
  });
  app.post('/api/replay/load', async (request, response) => { if (engine.list().some(device => device.recording === request.body.id)) throw new Error('请先停止录制'); await engine.loadReplay(request.body.id); response.json(engine.state()); });
  app.post('/api/replay/control', (request, response) => { engine.controlReplay(request.body); response.json(engine.state()); });
  app.post('/api/import-sscom', (request, response) => {
    if (typeof request.body.data !== 'string' || request.body.data.length > 2 * 1024 * 1024) throw new Error('指令文件过大');
    const bytes = Buffer.from(request.body.data, 'base64');
    let text;
    try { text = new TextDecoder('utf-8', { fatal: true }).decode(bytes); }
    catch { text = new TextDecoder('gb18030').decode(bytes); }
    response.json(importSSCOM(text));
  });
  app.post('/api/crc', (request, response) => { const crc = crc16Modbus(parseHex(request.body.text)); response.json({ crc, hex: [crc & 255, crc >>> 8].map(value => value.toString(16).padStart(2, '0').toUpperCase()).join(' ') }); });
  app.post('/api/frames/inspect', (request, response) => response.json(inspectFrame(parseHex(request.body.hex), validateSchema(request.body.schema))));
  app.post('/api/frames/validate', (request, response) => response.json(validateSchema(request.body.schema)));
  app.post('/api/modbus/inspect', (request, response) => response.json(inspectModbus(request.body.hex, request.body.direction)));
  app.get('/api/frames/latest', (_request, response) => response.json(engine.parser.lastFrame || null));
  app.get('/api/automation', (_request, response) => response.json(automation.state()));
  app.post('/api/automation/start', async (request, response) => response.json(await automation.start(engine.active, request.body)));
  app.post('/api/automation/stop', (_request, response) => { automation.stop(); response.json(automation.state()); });
  app.get('/api/chips', async (_request, response) => response.json({ images: await chips.list(), job: chips.job }));
  app.post('/api/keil/project', async (request, response) => response.json(await readKeilProject(agent.workspace.root, request.body.path)));
  app.post('/api/iar/project', async (request, response) => response.json(await readIarProject(agent.workspace.root, request.body.path)));
  app.get('/api/toolchains', async (_request, response) => response.json(await discoverToolchains()));
  app.post('/api/chips/upload', async (request, response) => response.json(await chips.upload(request.body)));
  app.post('/api/chips/prepare', async (request, response) => response.json(await chips.prepare(request.body)));
  app.post('/api/chips/execute', async (request, response) => response.json(await chips.execute(request.body)));
  app.post('/api/chips/stop', (_request, response) => { chips.stop(); response.json(chips.job); });
  app.get('/api/ai/state', (_request, response) => response.json(agent.state()));
  app.get('/api/validation/capabilities', async (request, response) => response.json(await validation.capabilities(request.query)));
  app.get('/api/validation/state', (request, response) => response.json(validation.state(request.query)));
  app.post('/api/validation/prepare', async (request, response) => response.json(await validation.prepare(request.body)));
  app.post('/api/validation/execute', async (request, response) => response.json(await validation.execute(request.body)));
  app.post('/api/validation/cancel', (request, response) => response.json(validation.cancel(request.body)));
  app.post('/api/validation/config', async (request, response) => response.json(await validation.configure(request.body)));
  app.get('/api/toolchains/gcc', async (_request, response) => response.json(await discoverGcc()));
  app.post('/api/ai/sessions/create', (request, response) => { agent.create({ name: request.body.name }); response.json(agent.state()); });
  app.post('/api/ai/sessions/select', (request, response) => { agent.select(request.body.id); response.json(agent.state()); });
  app.post('/api/ai/sessions/close', (request, response) => { agent.closeSession(request.body.id); response.json(agent.state()); });
  app.post('/api/ai/delegate', async (request, response) => response.json(await agent.delegate(request.body)));
  app.post('/api/ai/cancel-all', (_request, response) => { agent.cancelAll(); response.json(agent.state()); });
  app.get('/api/ai/changes', async (_request, response) => response.json(await agent.workspace.history()));
  app.get('/api/ai/changes/:id', async (request, response) => response.json(await agent.workspace.change(request.params.id)));
  const checkAgentContext = input => { if (input.deviceId && input.deviceId !== engine.activeId) throw new Error('当前设备已切换'); if (input.root && input.root !== agent.workspace.root) throw new Error('当前工程已变化'); };
  app.post('/api/ai/command/preview', (request, response) => { checkAgentContext(request.body); response.json(commandPlan(request.body.commandLine, agent.workspace.root)); });
  app.post('/api/ai/command/run', async (request, response) => {
    checkAgentContext(request.body);
    if (agent.active.readOnly) throw new Error('子代理会话不可执行工具链命令');
    if (request.body.confirm !== true) throw new Error('请先确认工具链命令');
    response.json(await agent.builder.start({ buildPreset: 'command', commandLine: request.body.commandLine, keilExecutable: agent.config.keilExecutable, iarExecutable: agent.config.iarExecutable }, agent.workspace.root));
  });
  app.post('/api/ai/config', async (request, response) => {
    const { deviceId, sessionId, expectedRoot, ...config } = request.body;
    if (deviceId && deviceId !== engine.activeId) throw new Error('当前设备已切换');
    if (sessionId && sessionId !== agent.active.id) throw new Error('当前会话已切换');
    if (expectedRoot && expectedRoot !== agent.workspace.root) throw new Error('当前工程已变化');
    if (sessionId && agent.active.readOnly) throw new Error('只读会话不能修改设置，请切换主会话');
    response.json(await agent.configure(config));
  });
  app.post('/api/ai/test', async (_request, response) => response.json(await agent.testConnection()));
  app.post('/api/ai/models', async (_request, response) => response.json(await agent.models()));
  app.get('/api/ai/files', async (request, response) => { if (request.query.deviceId && request.query.deviceId !== engine.activeId) throw new Error('当前设备已切换'); response.json(await agent.workspace.list()); });
  app.get('/api/ai/file', async (request, response) => { if (request.query.deviceId && request.query.deviceId !== engine.activeId) throw new Error('当前设备已切换'); response.json(await agent.workspace.read(request.query.path)); });
  app.post('/api/ai/run', async (request, response) => { await agent.run(request.body); response.json(agent.state()); });
  app.post('/api/ai/retry', async (_request, response) => { await agent.retry(); response.json(agent.state()); });
  app.post('/api/ai/cancel', (_request, response) => { agent.cancel(); agent.changed(); response.json(agent.state()); });
  app.post('/api/ai/clear', (_request, response) => { agent.clear(); response.json(agent.state()); });
  app.post('/api/ai/continuous', (request, response) => { if (request.body.active) agent.startContinuous(request.body); else { agent.stopContinuous(); agent.changed(); } response.json(agent.state()); });
  app.post('/api/ai/execute', async (request, response) => { await agent.execute(request.body.id); response.json(agent.state()); });
  app.post('/api/ai/reject', async (request, response) => { await agent.reject(request.body.id); response.json(agent.state()); });
  app.post('/api/ai/build', async (request, response) => { checkAgentContext(request.body); if (agent.active.readOnly) throw new Error('子代理会话不可执行工具链命令'); response.json(await agent.builder.start(agent.config, agent.workspace.root)); });
  app.post('/api/ai/build/cancel', (_request, response) => { agent.builder.stop(); response.json(agent.state()); });

  let samples = [], packets = [], recent = [], recentPackets = [], pendingDropped = 0;
  const broadcast = data => {
    const message = JSON.stringify(data);
    for (const client of sockets.clients) {
      if (client.readyState !== WebSocket.OPEN) continue;
      if (client.bufferedAmount > 2 * 1024 * 1024) { client.close(1013, 'UI consumer is too slow'); continue; }
      client.send(message);
    }
  };
  engine.on('state', state => broadcast({ type: 'state', state }));
  discovery.on('change', state => {
    broadcast({ type: 'ports', state });
    if (state.error) logs.write({ category: 'connection', level: 'error', message: `串口检测失败：${state.error}` });
    for (const port of state.added) logs.write({ category: 'connection', message: `发现串口 ${port.path}`, data: { path: port.path, interface: port.identification.interface } });
    for (const port of state.removed) logs.write({ category: 'connection', message: `串口已移除 ${port.path}`, data: { path: port.path } });
  });
  alarms.on('alarm', event => broadcast({ type: 'alarm', event }));
  agent.on('state', state => broadcast({ type: 'ai', state }));
  engine.on('notice', notice => broadcast({ type: 'notice', ...notice }));
  engine.on('reset', () => { samples = []; packets = []; recent = []; recentPackets = []; broadcast({ type: 'reset' }); });
  engine.on('samples', values => {
    samples.push(...values);
    if (samples.length > 4000) { pendingDropped += samples.length - 4000; samples = samples.slice(-4000); }
  });
  engine.on('packet', packet => {
    packets.push(packet);
    if (packets.length > 100) { pendingDropped += packets.length - 100; packets = packets.slice(-100); }
  });
  let tick = 0;
  const flush = setInterval(() => {
    if (pendingDropped) { engine.active.dropped += pendingDropped; pendingDropped = 0; }
    if (samples.length || packets.length) {
      recent = recent.concat(samples).slice(-2000); recentPackets = recentPackets.concat(packets).slice(-30);
      broadcast({ type: 'batch', samples, packets }); samples = []; packets = [];
    }
    if (++tick % 5 === 0) engine.emitState();
  }, 50);
  server.on('upgrade', (request, socket, head) => {
    if (request.url !== '/stream' || !request.headers.origin || !validOrigin(request.headers.origin)) { socket.destroy(); return; }
    sockets.handleUpgrade(request, socket, head, connection => sockets.emit('connection', connection));
  });
  sockets.on('connection', socket => {
    socket.send(JSON.stringify({ type: 'state', state: engine.state() }));
    socket.send(JSON.stringify({ type: 'ports', state: { ...discovery.snapshot, added: [], removed: [] } }));
    socket.send(JSON.stringify({ type: 'batch', samples: recent, packets: recentPackets }));
    socket.send(JSON.stringify({ type: 'ai', state: agent.state() }));
    socket.on('close', () => { if (sockets.clients.size === 0) { agent.cancelAll(); agent.changed(); } });
  });

  let vite;
  if (dev) {
    const { createServer } = await import('vite');
    vite = await createServer({ root, server: { middlewareMode: true }, appType: 'spa' });
    app.use(vite.middlewares);
  } else {
    const dist = path.join(root, 'dist');
    if (!fs.existsSync(path.join(dist, 'index.html'))) throw new Error('请先运行 npm run build');
    app.use(express.static(dist));
    app.get('/', (_request, response) => response.sendFile(path.join(dist, 'index.html')));
  }
  app.use((error, _request, response, _next) => {
    console.error(error.message);
    logs.write({ level: 'error', category: 'server', device: engine.activeId, message: error.message, data: { route: _request.path } });
    response.status(error.status || 400).json({ error: error.message || '操作失败' });
  });
  await new Promise((resolve, reject) => {
    const onError = error => {
      if (error.code === 'EADDRINUSE' && port && port < 4790) { port++; server.listen(port, '127.0.0.1'); }
      else reject(error);
    };
    server.on('error', onError);
    server.once('listening', () => { server.off('error', onError); resolve(); });
    server.listen(port, '127.0.0.1');
  });
  address = `http://127.0.0.1:${server.address().port}`;
  await discovery.start();
  if (autoDemo && engine.config.path === 'demo') await engine.connect(engine.config);
  console.log(`SignalDesk running at ${address}`);
  const close = async () => {
    await discovery.dispose();
    clearInterval(flush); alarms.dispose(); agent.dispose(); automation.stop(); chips.stop(); await widgets.dispose(); await commandQueues.dispose(); await engine.dispose(); await automation.completion; for (const client of sockets.clients) client.terminate();
    sockets.close(); await vite?.close(); await new Promise(resolve => server.close(resolve)); await validation.dispose(); await logs.queue; await workspace.queue;
  };
  return { address, close, engine, discovery };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const runtime = await startServer({ dev: process.argv.includes('--dev'), port: Number(process.env.PORT || 4780), directory: process.env.SIGNALDESK_DATA_DIR ? path.join(path.resolve(process.env.SIGNALDESK_DATA_DIR), 'sessions') : undefined });
  let closing = false;
  const stop = async () => { if (closing) return; closing = true; await runtime.close(); process.exit(0); };
  process.on('SIGINT', stop); process.on('SIGTERM', stop);
}
