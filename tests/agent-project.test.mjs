import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { SerialEngine } from '../server/engine.mjs';
import { AgentService } from '../server/ai/agent.mjs';
import { draftProjectPrompt } from '../server/ai/project-run.mjs';
import { ProjectRun } from '../server/ai/project-run.mjs';

const brief = { goal: '显示温度', requirements: '按键切换', hardware: 'SSD1306', constraints: '不改协议', acceptance: '实测按键事件', unknowns: '待确认：引脚' };
const tool = (id, name, args = {}) => ({ content: '', toolCalls: [{ id, name, arguments: JSON.stringify(args) }] });
const final = { content: '等待验收；未验证硬件。', toolCalls: [] };
async function fixture(t, provider) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(),'project-delivery-')), engine = new SerialEngine({ directory: root });
  const a = new AgentService(engine,root,{ provider }); await a.configure({model:'fixture'});
  t.after(async () => { a.dispose(); await engine.dispose(); await fs.rm(root,{force:true,recursive:true}); }); return a;
}
function respond(a, fn) {
  const seen = new Set(); a.on('state', s => { const q = s.interaction; if (!q || seen.has(q.id)) return; seen.add(q.id); queueMicrotask(() => fn(q)); });
}
test('natural language drafts only, retains units and unknowns; malformed answer makes no changes', async t => {
  const a = await fixture(t, async req => { assert.deepEqual(req.tools,[]); assert.match(req.messages[1].content,/10 ms/); return {...final,content:JSON.stringify({...brief,constraints:'10 ms，不改协议'})}; });
  const { draft } = await draftProjectPrompt(a,'每 10 ms 看一次，不改协议'); assert.match(draft,/10 ms，不改协议/); assert.match(draft,/待确认：引脚/); assert.equal(a.actions.size,0); assert.equal(a.modelTurns.length,0);
  a.provider = async () => ({...final,content:'invalid'}); await assert.rejects(draftProjectPrompt(a,'重新整理'),/原文未修改/); assert.equal(a.busy,false);
});
for (const policy of ['ask', 'auto']) test(`project delivery ${policy}: ask, revise brief, create file, run real test, verify and accept feedback`, async t => {
  // A separate project test subprocess is not a child of this node:test suite.
  const testContext = process.env.NODE_TEST_CONTEXT; delete process.env.NODE_TEST_CONTEXT;
  t.after(() => { if (testContext !== undefined) process.env.NODE_TEST_CONTEXT = testContext; });
  let n = 0, briefs = 0, reviews = 0, decisions = 0;
  const a = await fixture(t, async ({messages,tools}) => {
    const last = messages.at(-1);
    switch (++n) {
      case 1: assert.ok(!tools.some(t => t.name.startsWith('propose_'))); return tool('q','ask_project_question',{question:'使用哪个屏幕？'});
      case 2: assert.match(last.content,/SSD1306/); return tool('b','review_project_brief',brief);
      case 3: assert.ok(!tools.some(t => t.name.startsWith('propose_'))); assert.match(last.content,/revise/); return tool('b2','review_project_brief',brief);
      case 4: assert.match(messages[0].content,/确认后的接口/); return tool('file','propose_new_file',{path:'tests/adc.test.mjs',content:"import test from 'node:test'; import assert from 'node:assert/strict'; test('adc', () => assert.equal(1+1,2));",reason:'创建本机测试'});
      case 5: assert.equal(JSON.parse(last.content).status,'applied'); return tool('run','propose_toolchain_command',{commandLine:'node --test',reason:'执行本机测试'});
      case 6: { const build = JSON.parse(last.content); assert.equal(build.status,'succeeded'); assert.equal(build.exitCode,0); assert.match(build.output,/adc/); return tool('measure','measure_device_window',{milliseconds:100}); }
      case 7: assert.equal(JSON.parse(last.content).status,'unverified'); return final;
      case 8: assert.equal(last.content,'再看一遍'); return final;
      default: throw Error('unexpected call');
    }
  });
  respond(a,q => {
    if(q.kind==='question') a.projectRun.reply({id:q.id,decision:'reply',answer:'SSD1306'});
    if(q.kind==='brief') a.projectRun.reply({id:q.id,decision:++briefs===1?'revise':'confirm',answer:'确认后的接口',policy});
    if(q.kind==='action') { decisions++; a.projectRun.reply({id:q.id,decision:'approve'}); }
    if(q.kind==='acceptance') a.projectRun.reply({id:q.id,decision:++reviews===1?'revise':'accept',answer:'再看一遍'});
  });
  await a.run({mode:'ai',agentMode:'project',message:'交付一个采样显示项目'}); assert.equal(decisions,policy==='ask'?2:0); assert.equal(a.progress.reason,'accepted'); assert.equal(a.projectRun,null); assert.equal(a.workspace.proposals.size,1);
});
test('denied creation and cancellation while awaiting approval leave disk untouched',async t=>{
  let n=0; const a=await fixture(t,async ({messages})=>{n++; if(n===1)return tool('brief','review_project_brief',brief); if(n===3)assert.equal(JSON.parse(messages.at(-1).content).status,'denied'); return tool(`f${n}`,'propose_new_file',{path:`src/unused${n}.c`,content:'int a;',reason:'create'});});
  let count=0; respond(a,q=>{if(q.kind==='brief') a.projectRun.reply({id:q.id,decision:'confirm',answer:q.prompt}); else if(++count===1)a.projectRun.reply({id:q.id,decision:'deny'}); else a.cancel();});
  await assert.rejects(a.run({mode:'ai',agentMode:'project'}),/停止/); assert.deepEqual(await a.workspace.list(),[]); assert.ok([...a.workspace.proposals.values()].every(p=>p.status==='rejected')); assert.equal(a.state().interaction,null);
});
test('new files never replace existing paths including files created after approval draft',async t=>{
  const a=await fixture(t,async()=>final); const args={path:'screen.c',reason:'new',content:'int a;'};
  const p=await a.workspace.propose(args,{create:true}); await fs.writeFile(path.join(a.workspace.root,args.path),'user edits'); await assert.rejects(a.execute(p.id),/已存在/); assert.equal((await a.workspace.read(args.path)).content,'user edits');
  for(const name of ['../outside.c','.git/hook.c','NUL.c','c:secret.c','build/out.c']) await assert.rejects(a.workspace.propose({...args,path:name},{create:true}));
});

test('fresh measurement window ignores old samples, simulated data and a changing connection', async t => {
  const a = await fixture(t, async () => final), run = new ProjectRun(a), engine = a.engine;
  a.controller = new AbortController(); engine.connected = true; engine.source = 'demo';
  assert.equal((await run.tool('measure_device_window', {milliseconds:100})).status, 'unverified');
  engine.source = 'serial'; engine.history = [{time:0, values:[999]}];
  const measured = run.tool('measure_device_window', {milliseconds:100});
  engine.emit('samples', [{values:[4]}, {values:[8]}]);
  const result = await measured; assert.equal(result.channels[0].mean, 6); assert.equal(result.channels[0].max, 8); assert.equal(result.frames, 2);
  assert.equal((await run.tool('measure_device_window',{milliseconds:100})).status,'no_numeric_samples');
  const stale = run.tool('measure_device_window',{milliseconds:100}); engine.generation++; assert.equal((await stale).status,'unverified');
  a.controller = null; engine.connected = false; engine.source = 'none';
});
