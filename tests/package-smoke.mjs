import { _electron as electron } from 'playwright';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import http from 'node:http';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

const exec = promisify(execFile);
const executablePath = path.resolve(process.env.SIGNALDESK_TEST_EXE || 'release/win-unpacked/SignalDesk.exe');
const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'signaldesk-package-'));
const environment = { ...process.env, SIGNALDESK_USER_DATA: directory };
delete environment.ELECTRON_RUN_AS_NODE;
const launch = () => electron.launch({ executablePath, args: [], cwd: directory, env: environment, timeout: 60000 });
let desktop;
try {
  desktop = await launch();
  const window = await desktop.firstWindow();
  await window.getByRole('heading', { name: '实时监测', exact: true }).waitFor();
  const origin = new URL(window.url()).origin;
  const call = async (route, body) => {
    const response = await fetch(origin + '/api' + route, body === undefined ? {} : { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    const value = await response.json(); assert.ok(response.ok, JSON.stringify(value)); return value;
  };
  assert.equal(await desktop.evaluate(({ app }) => app.isPackaged), true);
  const startup = await call('/state'); assert.equal(startup.connected, false); assert.equal(startup.config.path, 'unassigned');
  assert.equal(await desktop.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].isMenuBarVisible()), false);
  await call('/connect', { path: 'demo' });
  const ai = await call('/ai/state');
  assert.equal(ai.config.root, path.join(directory, 'examples', 'SignalGenerator'));
  const largeSource = '#include <Arduino.h>\n' + '// Sensor calibration data retained.\n'.repeat(5000) + 'void verifyLargeSource() { Serial.println("large-source-ready"); }\n';
  await fs.writeFile(path.join(ai.config.root, 'LargeSource.ino'), largeSource);
  const largeFile = await call(`/ai/file?deviceId=${startup.activeDevice}&path=LargeSource.ino`);
  assert.equal(largeFile.content, largeSource); assert.ok(largeFile.bytes > 96 * 1024);
  await fs.access(path.join(directory, 'examples', 'CrossCompileCheck', 'CMakeLists.txt'));
  assert.ok(Array.isArray(await call('/ports')));
  const widget = await call('/widgets/evaluate', { inputs: [21], code: '{ render(ctx) { return { kind: "number", value: ctx.inputs[0] * 2 }; } }' });
  assert.equal(widget.view.value, 42);
  const model = await fetch(origin + '/models/royalblue54l/board.glb');
  assert.equal(model.status, 200); assert.equal(Buffer.from(await model.arrayBuffer()).toString('ascii', 0, 4), 'glTF');
  await window.waitForFunction(() => document.querySelector('.uplot canvas')?.width > 100);
  const before = await window.locator('.uplot canvas').evaluate(canvas => canvas.toDataURL());
  await window.waitForFunction(value => document.querySelector('.uplot canvas')?.toDataURL() !== value, before);
  await window.getByRole('button', { name: '打开设置', exact: true }).click();
  await window.getByRole('button', { name: '晴空蓝', exact: true }).click();
  await window.getByRole('checkbox', { name: '展开导航文字', exact: true }).check();
  await window.getByRole('button', { name: '关闭设置', exact: true }).click();
  const opened = desktop.waitForEvent('window');
  await window.getByRole('button', { name: '在独立窗口打开当前页', exact: true }).click();
  const panel = await opened; await panel.locator('.uplot canvas').waitFor();
  assert.equal(new URL(panel.url()).origin, origin);
  assert.equal(await panel.locator('.navigation').isVisible(), false);
  await panel.getByRole('button', { name: '打开设置', exact: true }).click();
  await panel.getByRole('button', { name: '玫瑰粉', exact: true }).click();
  await window.waitForFunction(() => document.querySelector('.app-shell').style.getPropertyValue('--accent') === '#eea6bf');
  await panel.getByRole('button', { name: '关闭设置', exact: true }).click();
  await panel.close(); assert.equal((await call('/state')).connected, true);
  const connection = await call('/external/create', { name: 'Package smoke', permissions: ['read'] });
  const external = await call('/external/state');
  const clientEnvironment = { ...process.env, ...external.env, SIGNALDESK_URL: external.url, SIGNALDESK_TOKEN: connection.token };
  const cli = await exec(external.command, [external.cli, 'status'], { cwd: directory, env: clientEnvironment, windowsHide: true, timeout: 15000 });
  assert.equal(JSON.parse(cli.stdout).deviceId, (await call('/state')).activeDevice);
  const client = new Client({ name: 'package-smoke', version: '1.0.0' });
  const transport = new StdioClientTransport({ command: external.command, args: [external.bridge], env: clientEnvironment, cwd: directory, stderr: 'pipe' });
  try { await client.connect(transport); assert.ok((await client.listTools()).tools.some(tool => tool.name === 'get_device_snapshot')); }
  finally { await client.close(); }
  await call('/ai/sessions/select', { id: ai.sessionId });
  await window.getByRole('button', { name: '工具', exact: true }).click(); await window.getByRole('menuitem', { name: 'AI 与 Agent', exact: true }).click();
  await window.locator('.agent-console').waitFor();
  const prompt = window.getByLabel('Agent 分析请求'); await prompt.fill('/');
  await window.getByRole('listbox', { name: 'Agent 斜杠指令' }).waitFor();
  await prompt.press('Escape'); await prompt.fill('');
  await window.getByLabel('Agent 工作模式').selectOption('review');
  await window.getByRole('button', { name: '分析数据', exact: true }).click();
  await window.waitForFunction(() => document.querySelector('[aria-label="Agent 运行状态"]')?.textContent?.includes('本地检查完成'));
  assert.equal((await call('/ai/state')).progress.phase, 'complete');
  let planMode = false, planCalls = 0;
  const modelServer = http.createServer((request, response) => {
    request.resume(); request.on('end', () => {
      response.setHeader('Content-Type', 'application/json'); response.setHeader('x-request-id', 'package-trace');
      const message = planMode && ++planCalls === 1 ? {
        tool_calls: [{
          id: 'package-plan',
          type: 'function',
          function: { name: 'update_task_plan', arguments: JSON.stringify({ steps: [{ title: 'Review source after restart', status: 'pending' }] }) },
        }],
      } : { content: '调用来源测试完成。此回复来自本机测试接口。' };
      response.end(JSON.stringify({ model: 'package-resolved', id: 'package-response', choices: [{ message, finish_reason: message.tool_calls ? 'tool_calls' : 'stop' }], usage: { prompt_tokens: 10, completion_tokens: 6 } }));
    });
  });
  await new Promise(resolve => modelServer.listen(0, '127.0.0.1', resolve));
  try {
    await call('/ai/config', { baseUrl: `http://127.0.0.1:${modelServer.address().port}/v1`, model: 'package-requested', apiStyle: 'chat', apiKey: 'package-fixture-key' });
    const result = await call('/ai/run', { mode: 'ai', message: 'Verify call metadata', selectedFile: 'LargeSource.ino' });
    assert.equal(result.messages.at(-1).provenance.reportedModel, 'package-resolved'); assert.equal(result.context.turns, 1);
    assert.ok(!JSON.stringify(result).includes('package-fixture-key'));
    const details = window.locator('.agent-call-details').last(); await details.locator('summary').click(); await details.locator('p').scrollIntoViewIfNeeded();
    assert.match(await details.innerText(), /package-trace/);
    await window.screenshot({ path: path.resolve('artifacts/packaged-agent-call-record.png') });
    const reset = await call('/ai/context/reset', { sessionId: result.sessionId }); assert.equal(reset.context.turns, 0); assert.ok(reset.messages.some(message => message.provenance?.reportedModel === 'package-resolved'));
    planMode = true;
    const paused = await call('/ai/run', { mode: 'ai', message: 'Package unfinished plan fixture', agentMode: 'review' });
    assert.equal(paused.progress.phase, 'paused'); assert.equal(paused.canResume, true); assert.equal(planCalls, 2);
    await window.getByRole('button', { name: '继续任务', exact: true }).waitFor();
    await window.screenshot({ path: path.resolve('artifacts/packaged-agent-paused.png') });
  } finally { modelServer.closeAllConnections(); await new Promise(resolve => modelServer.close(resolve)); }
  await window.screenshot({ path: path.resolve('artifacts/packaged-agent-console.png') });
  await window.keyboard.press('Control+p');
  await window.getByRole('combobox', { name: '搜索项目文件' }).fill('LargeSource.ino:5002');
  await window.getByRole('option', { name: /LargeSource\.ino/ }).waitFor();
  await window.getByRole('combobox', { name: '搜索项目文件' }).press('Enter');
  try { await window.locator('.cm-activeLine', { hasText: 'verifyLargeSource' }).waitFor(); }
  catch (error) { await window.screenshot({ path: path.resolve('artifacts/packaged-source-jump-failure.png') }); console.error(await window.locator('.source-workspace').innerText()); throw error; }
  assert.equal(await window.locator('.source-workspace .inline-error').count(), 0);
  await window.screenshot({ path: path.resolve('artifacts/packaged-large-source.png') });
  await window.keyboard.press('F1');
  const tutorial = window.getByRole('dialog', { name: '帮助与教程', exact: true });
  await tutorial.getByRole('heading', { name: '导入工程与编译', exact: true }).waitFor();
  await tutorial.getByRole('button', { name: '第 3 步：核对编译配置', exact: true }).click();
  await window.screenshot({ path: path.resolve('artifacts/packaged-tutorial.png') });
  await tutorial.getByRole('button', { name: '关闭教程', exact: true }).click();
  await window.getByRole('button', { name: '工具', exact: true }).click(); await window.getByRole('menuitem', { name: '实时监测', exact: true }).click();
  await window.getByRole('button', { name: '打开设置', exact: true }).click();
  await window.getByRole('checkbox', { name: '展开导航文字', exact: true }).check();
  await window.getByRole('button', { name: '关闭设置', exact: true }).click();
  await window.screenshot({ path: path.resolve('artifacts/packaged-desktop.png') });
  console.log('Package smoke: main window verified; checking detached window and restart.');
  await fs.appendFile(path.join(ai.config.root, 'SignalGenerator.ino'), '\n// User modification retained during restart.\n');
  const savedPreferences = JSON.parse(await fs.readFile(path.join(directory, 'preferences.json'), 'utf8'));
  assert.equal(savedPreferences.accent, '#eea6bf');
  const remainingWindow = desktop.waitForEvent('window', { timeout: 20000 });
  await window.getByRole('button', { name: '在独立窗口打开当前页', exact: true }).click();
  const remaining = await remainingWindow; await remaining.locator('.uplot canvas').waitFor();
  console.log('Package smoke: detached window opened.');
  await window.close();
  assert.equal((await call('/state')).connected, true);
  const remainingCanvas = await remaining.locator('.uplot canvas').evaluate(canvas => canvas.toDataURL());
  await remaining.waitForFunction(value => document.querySelector('.uplot canvas')?.toDataURL() !== value, remainingCanvas);
  console.log('Package smoke: detached waveform stayed live; restarting app.');
  await desktop.close(); desktop = await launch();
  console.log('Package smoke: app relaunched.');
  const restarted = await desktop.firstWindow(); await restarted.locator('.uplot canvas').waitFor();
  assert.equal(await restarted.evaluate(() => window.signaldeskDesktop?.savedPreferences?.accent), '#eea6bf');
  assert.equal(await restarted.locator('.app-shell').evaluate(element => element.classList.contains('nav-expanded')), true);
  assert.equal(await restarted.locator('.app-shell').evaluate(element => element.style.getPropertyValue('--accent')), '#eea6bf');
  assert.match(await fs.readFile(path.join(ai.config.root, 'SignalGenerator.ino'), 'utf8'), /User modification retained/);
  await restarted.getByRole('button', { name: '帮助', exact: true }).click();
  await restarted.getByRole('menuitem', { name: '使用教程…', exact: true }).click();
  const restoredTutorial = restarted.getByRole('dialog', { name: '帮助与教程', exact: true });
  await restoredTutorial.getByRole('heading', { name: '导入工程与编译', exact: true }).waitFor();
  assert.equal(await restoredTutorial.getByRole('button', { name: '第 3 步：核对编译配置', exact: true }).getAttribute('aria-current'), 'step');
  assert.equal(JSON.parse(await fs.readFile(path.join(directory, 'preferences.json'), 'utf8')).tutorial.dismissed, true);
  await restoredTutorial.getByRole('button', { name: '关闭教程', exact: true }).click();
  await restarted.getByRole('button', { name: '工具', exact: true }).click(); await restarted.getByRole('menuitem', { name: 'AI 与 Agent', exact: true }).click();
  const resumed = await restarted.evaluate(async () => (await fetch('/api/ai/state')).json());
  assert.equal(resumed.busy, false); assert.equal(resumed.canResume, true); assert.equal(resumed.progress.phase, 'paused');
  assert.equal(resumed.sessionId, ai.sessionId); assert.equal(resumed.sessions.find(session => session.name === 'Package smoke').readOnly, true);
  await restarted.getByRole('button', { name: '继续任务', exact: true }).waitFor();
  assert.ok(resumed.context.turns > 0); assert.equal(resumed.config.hasApiKey, true);
  console.log('Packaged EXE passed: clean cwd, writable examples, large-source browsing, Agent attachment and paused-task restart, tutorials, native serial enumeration, QuickJS worker/WASM, GLB asset, live waveform, shared detached window, CLI, MCP, restart preferences and preserved user edits.');
} finally {
  await desktop?.close();
  await fs.rm(directory, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
}
