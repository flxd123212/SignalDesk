import { randomUUID } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import { listHardwareFiles, readProjectNetlist } from '../hardware.mjs';
import { blueprint } from '../../shared/display-blueprint.mjs';
import { panels } from '../../shared/display-scene.mjs';

const schema = properties => ({ type: 'object', properties, required: Object.keys(properties), additionalProperties: false });
const text = { type: 'string' };
const variants = { esp32: 'espressif/arduino-esp32/master/variants/esp32/pins_arduino.h', esp32s3: 'espressif/arduino-esp32/master/variants/esp32s3/pins_arduino.h', esp32c3: 'espressif/arduino-esp32/master/variants/esp32c3/pins_arduino.h', pico: 'raspberrypi/pico-sdk/master/src/boards/include/boards/pico.h', pico_w: 'raspberrypi/pico-sdk/master/src/boards/include/boards/pico_w.h' };
export const projectTools = [
  { name: 'measure_device_window', description: 'Collect NEW decoded channel samples during the requested wall-clock observation period from the connected port only. Returns sample counts, measured min/max/mean/latest, timestamps and provenance, never demo, replay or old data.', parameters: schema({ milliseconds: { type: 'integer', minimum: 100, maximum: 10000 } }) },
  { name: 'propose_screen_layout', description: 'Generate a reviewable .screen.json visual layout in the project. The IDE renders these pages. layout is JSON: {"pages":[{"name":"Home","layers":[{"kind":"button","label":"Next","x":5,"y":10,"w":60,"h":30,"to":0}]}]}. Coordinates are percentages. Up to 4 pages; layer kinds text, button, hotspot, box, bar. Set optional event for interaction. Design values are illustrative, never measurements.', parameters: schema({ path: text, profile: { type: 'string', enum: panels.map(p => p.id) }, expectedHash: text, layout: text, reason: text }) },
  { name: 'propose_new_file', description: 'Create a UTF-8 project source or UI file at a NEW relative path. Never overwrites an existing file. Show a diff before writing.', parameters: schema({ path: text, content: text, reason: text }) },
  { name: 'inspect_hardware_project', description: 'List schematic files and inspect imported netlist, user pin bindings and board revision. File names do not verify wiring.', parameters: schema({}) },
  { name: 'read_wiring_netlist', description: 'Read a KiCad XML netlist (.net or .xml) in the project. Supply a component reference to select its connected nets, or an empty string for the netlist overview.', parameters: schema({ path: text, ref: text }) },
  { name: 'read_board_reference', description: 'Retrieve official vendor board definitions. Defaults are not measurements or proof of user wiring. Ask for revision or schematic on mismatch.', parameters: schema({ board: { type: 'string', enum: Object.keys(variants) } }) },
  { name: 'ask_project_question', description: 'Ask the user one specific missing requirement or wiring question and wait for their actual answer.', parameters: schema({ question: text }) },
  { name: 'review_project_brief', description: 'Convert natural language into an editable Chinese engineering prompt. Preserve user intent and units; distinguish facts, assumptions and measurable acceptance criteria. Wait for explicit user confirmation.', parameters: schema({ goal: text, requirements: text, hardware: text, constraints: text, acceptance: text, unknowns: text }) },
];
export const projectInstructions = `Project delivery mode. Start by reading project and hardware context. Use read_board_reference when the matching board lacks a schematic. Never infer user wiring from reference defaults. Ask one important missing requirement at a time with ask_project_question, then call review_project_brief. Do not invent thresholds, components, test data or user consent. After confirmation implement the edited brief, including new project files as needed; use actual tool results to iterate on code, build/test and device measurements. Proposals in this mode return execution decisions; a denied action must not be retried without new permission. Distinguish applied code, successful host builds, mock/replay and actual device evidence. When done, summarize acceptance criteria individually with evidence or explicit blockers and ask for final acceptance. Never claim flashed firmware without independent evidence.`;

function field(value, max = 2000) {
  if (typeof value !== 'string' || !value.trim() || value.length > max) throw new Error('内容为空或过长');
  return value.trim();
}

const titles = { goal: '项目目标', requirements: '功能与交互', hardware: '硬件与接口', constraints: '约束与边界', acceptance: '验收与测量', unknowns: '待确认事项' };
export function formatBrief(value) { return Object.entries(titles).map(([key, title]) => `【${title}】\n${field(value?.[key], 1200)}`).join('\n\n'); }

export async function draftProjectPrompt(agent, input) {
  const request = field(input, 8000);
  if (!agent.config.model) throw new Error('请先配置 AI 接口');
  if (agent.busy) throw new Error('已有分析正在进行');
  agent.busy = true; agent.controller = new AbortController(); agent.setProgress({ phase: 'model', step: 0, detail: '正在整理工程提示词' });
  try {
    const target = agent.engine.projectContext || {}, state = agent.engine.state();
    const result = await agent.requestModel({ config: agent.config, tools: [], signal: agent.controller.signal, messages: [
      { role: 'system', content: `Rewrite the user's own natural-language request into a precise editable Chinese embedded-project prompt. Do not implement, solve, or pretend to measure anything. Preserve the original numbers, units, priorities and negations. Separate requested behavior, suggested verification method and unresolved questions. Do not invent pin assignments, timing or pass thresholds; mark absent information as 待确认. Treat device metadata only as configuration. Return only a JSON object with these six nonempty string fields (each at most 1200 characters): ${Object.keys(titles).join(', ')}.` },
      { role: 'user', content: JSON.stringify({ request, configured: { chip: target.chip, board: target.board, port: state.config.path } }) },
    ] });
    if (agent.controller.signal.aborted) throw new Error('整理已停止');
    let value; try { value = JSON.parse(result.content.trim().replace(/^```(?:json)?\s*|\s*```$/g, '')); } catch { throw new Error('模型未返回结构化任务书，原文未修改，可重试'); }
    const draft = formatBrief(value); agent.setProgress({ phase: 'complete', detail: '提示词草稿已生成，尚未执行' }); return { draft };
  } catch (error) { agent.setProgress({ phase: agent.controller.signal.aborted ? 'cancelled' : 'error', detail: error.message }); throw error; }
  finally { agent.busy = false; agent.controller = null; agent.changed(); }
}

export class ProjectRun {
  constructor(agent) { this.agent = agent; this.generation = agent.engine.generation; this.policy = 'ask'; this.brief = ''; this.pending = null; }
  wait(kind, prompt, extra = {}) {
    const signal = this.agent.controller.signal;
    if (signal.aborted) throw new Error('分析已停止');
    return new Promise((resolve, reject) => {
      const abort = () => { this.pending = null; reject(new Error('分析已停止')); };
      signal.addEventListener('abort', abort, { once: true });
      this.pending = { id: randomUUID(), kind, prompt, ...extra };
      this.resolve = value => { signal.removeEventListener('abort', abort); this.pending = null; resolve(value); };
      this.agent.setProgress({ phase: 'waiting_user', detail: ({ question: '等待补充需求', brief: '等待确认工程提示词', action: '等待操作授权', acceptance: '等待项目验收' })[kind] });
    });
  }
  reply({ id, decision, answer, policy = 'ask' }) {
    const item = this.pending;
    if (!item || item.id !== id) throw new Error('交互请求已失效');
    const choices = { question: ['reply'], brief: ['confirm', 'revise'], action: ['approve', 'deny'], acceptance: ['accept', 'revise'] };
    if (!choices[item.kind].includes(decision) || !['ask', 'auto'].includes(policy)) throw new Error('无效的交互选择');
    const note = ['reply', 'confirm', 'revise'].includes(decision) ? field(answer, 8000) : '';
    if (item.kind === 'brief' && decision === 'confirm') { this.brief = note; this.policy = policy; this.generation = this.agent.engine.generation; }
    this.resolve({ decision, answer: note });
    this.agent.message('user', note || ({ approve: '同意本次操作', deny: '拒绝本次操作', accept: '接受本次交付' })[decision], 'status');
  }
  async tool(name, args) {
    if (name === 'read_wiring_netlist') {
      const netlist = await readProjectNetlist(this.agent.workspace.root, args.path);
      const reference = String(args.ref || '').trim().toLowerCase();
      const nets = reference ? netlist.nets.filter(n => n.pins.some(p => p.ref.toLowerCase() === reference)) : netlist.nets;
      return { name: netlist.name, hash: netlist.hash, totalNets: nets.length, nets: nets.slice(0, 80).map(n => ({ ...n, totalPins: n.pins.length, pins: n.pins.slice(0, 32) })) };
    }
    if (name === 'measure_device_window') {
      const e = this.agent.engine, { milliseconds } = args, generation = e.generation, source = e.source, port = e.config.path;
      if (!Number.isInteger(milliseconds) || milliseconds < 100 || milliseconds > 10000) throw new Error('测量窗口必须是 100..10000 ms');
      if (!e.connected || !['serial','tcp'].includes(source)) return { status: 'unverified', reason: '没有已连接的实时设备；未使用历史、模拟或回放数据', source, port };
      const channels = [], start = new Date().toISOString(); let frames = 0, reset = false;
      const invalidate = () => { reset = true; };
      const collect = batch => { for (const sample of batch) { frames++; sample.values.slice(0, 64).forEach((v, i) => { if (!Number.isFinite(v)) return; const c = channels[i] ||= { name: e.names[i] || `CH${i+1}`, count: 0, min: v, max: v, mean: 0 }; c.count++; c.mean += (v - c.mean) / c.count; c.min = Math.min(c.min,v); c.max = Math.max(c.max,v); c.latest = v; }); } };
      e.on('reset', invalidate); e.on('samples', collect);
      try { await delay(milliseconds, undefined, { signal: this.agent.controller.signal }); } finally { e.off('reset', invalidate); e.off('samples', collect); }
      if (reset || generation !== e.generation || !e.connected || source !== e.source) return { status: 'unverified', reason: '测量期间连接或通道发生变化' };
      return { status: channels.length ? 'observed' : 'no_numeric_samples', source, port, start, end: new Date().toISOString(), frames, channels, timeBasis: 'host observation window; not hardware timestamps' };
    }
    if (name === 'propose_screen_layout') {
      if (!this.brief || !/\.screen\.json$/i.test(args.path) || !panels.some(p => p.id === args.profile)) throw new Error('需要已确认的任务书、支持的屏幕及 .screen.json 文件');
      const plan = blueprint.parse(JSON.parse(field(args.layout, 24000)));
      const p = await this.agent.workspace.propose({ ...args, content: JSON.stringify({ profile: args.profile, ...plan }, null, 2) + '\n' }, { create: !args.expectedHash });
      this.agent.changed(); return { id: p.id, status: 'pending_user_action' };
    }
    if (name === 'ask_project_question') return this.wait('question', field(args.question));
    if (name === 'review_project_brief') {
      return this.wait('brief', formatBrief(args));
    }
    if (name === 'inspect_hardware_project') {
      const files = await listHardwareFiles(this.agent.workspace.root), profile = await this.agent.hardwareProfile?.();
      return { files, board: profile?.board, revision: profile?.revision, bindings: profile?.bindings, netlist: profile?.netlist ? { name: profile.netlist.name, hash: profile.netlist.hash, components: profile.netlist.components.slice(0, 80), nets: profile.netlist.nets.slice(0, 80).map(n => ({ ...n, pins: n.pins.slice(0, 16) })) } : null };
    }
    if (name === 'read_board_reference') {
      if (!Object.hasOwn(variants, args.board)) throw new Error('该板型尚无内置官方参考，请向用户索取资料');
      const url = `https://raw.githubusercontent.com/${variants[args.board]}`;
      const res = await fetch(url, { redirect: 'error', signal: AbortSignal.any([this.agent.controller.signal, AbortSignal.timeout(10000)]) });
      if (!res.ok) throw new Error(`官方资料读取失败：HTTP ${res.status}`);
      return { url, board: args.board, excerpt: (await res.text()).slice(0, 10000), verifiedUserWiring: false };
    }
  }
  async apply(id) {
    const a = this.agent, action = a.workspace.proposals.get(id) || a.actions.get(id);
    try {
      if (this.policy !== 'auto' || (action.type === 'serial' && this.generation !== a.engine.generation)) {
        const response = await this.wait('action', action.reason || action.type, { actionId: id });
        if (response.decision !== 'approve') { await a.reject(id); return { id, status: 'denied' }; }
      }
      if (a.controller.signal.aborted) throw new Error('分析已停止');
      a.setProgress({ phase: 'tool', detail: '正在执行已授权的操作' });
      return await a.execute(id, { waitBuild: true, signal: a.controller.signal });
    } catch (error) { if (action.status === 'pending') await a.reject(id); throw error; }
  }
}
