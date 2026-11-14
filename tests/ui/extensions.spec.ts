import { clickWorkbench } from './workbench-actions';
import { expect, test } from '@playwright/test';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import http from 'node:http';
import { createHash } from 'node:crypto';

test.beforeEach(async ({ request }) => {
  await request.post('/api/connect', { data: { path: 'demo' } });
  await request.post('/api/processing', { data: { mode: 'raw' } });
});

test('multiple devices keep collecting and show simultaneous canvases with project bindings', async ({ page, request }) => {
  const first = (await (await request.get('/api/state')).json()).activeDevice;
  let added = '';
  try {
    await page.goto('/'); await page.getByRole('button', { name: '添加设备', exact: true }).click();
    await expect(page.getByRole('tab')).toHaveCount(2);
    added = (await (await request.get('/api/state')).json()).activeDevice;
    await page.getByRole('button', { name: '连接设备', exact: true }).click();
    await expect(page.getByRole('button', { name: '断开连接', exact: true })).toBeEnabled();
    await page.locator('.project-summary').click();
    await page.getByLabel('设备名称', { exact: true }).fill('ESP32 测试台');
    await page.getByLabel('设备芯片型号').fill('ESP32-S3');
    await page.getByRole('button', { name: '保存绑定', exact: true }).click();
    await clickWorkbench(page, '多设备总览');
    await expect(page.locator('.device-summary')).toHaveCount(2);
    await expect(page.locator('.overview-identity')).toContainText(['芯片型号未标记', 'ESP32-S3']);
    await expect.poll(async () => (await (await request.get('/api/devices/overview')).json()).every((device: { samples: unknown[] }) => device.samples.length > 100)).toBe(true);
    await page.screenshot({ path: 'artifacts/multi-device-desktop.png', fullPage: true });
    const sizes = await page.locator('.device-mini-plot').evaluateAll(canvases => canvases.map(canvas => { const element = canvas as HTMLCanvasElement; return element.width * element.height; }));
    expect(sizes.every(size => size > 10000)).toBe(true);
  } finally { if (added) await request.post('/api/devices/remove', { data: { id: added } }); await request.post('/api/devices/select', { data: { id: first } }); }
});

test('single trigger holds a waveform, terminal encoding and automatic testing work', async ({ page }) => {
  await page.goto('/');
  await page.getByLabel('波形时间窗口').selectOption('2');
  await page.getByLabel('触发模式').selectOption('single');
  await expect(page.locator('.trigger-bar')).toContainText('已捕获');
  const captured = await page.locator('.uplot canvas').evaluate((canvas: HTMLCanvasElement) => canvas.toDataURL());
  await page.waitForTimeout(350);
  expect(await page.locator('.uplot canvas').evaluate((canvas: HTMLCanvasElement) => canvas.toDataURL())).toBe(captured);
  await clickWorkbench(page, '串口终端');
  await page.getByLabel('接收编码').selectOption('gb18030');
  await expect(page.getByLabel('接收编码')).toHaveValue('gb18030');
  await page.getByLabel('发送编码').selectOption('gb18030');
  await clickWorkbench(page, '自动测试');
  await page.getByRole('button', { name: '运行测试', exact: true }).click();
  await expect(page.locator('.lab-inspector > .test-status')).toHaveText('PASSED');
  await expect(page.locator('.test-step')).toHaveCount(6);
  await page.screenshot({ path: 'artifacts/automation-desktop.png', fullPage: true });
});

test('custom frame editor validates fields and Modbus decoder reports registers', async ({ page, request }) => {
  await page.goto('/'); await clickWorkbench(page, '自定义帧');
  await page.getByRole('button', { name: '保存帧配置', exact: true }).click();
  await page.getByRole('button', { name: '附加 CRC 并解析', exact: true }).click();
  await expect(page.locator('.lab-inspector .test-status')).toHaveText('帧有效');
  await expect(page.locator('.lab-inspector tbody')).toContainText('voltage');
  await page.screenshot({ path: 'artifacts/frames-desktop.png', fullPage: true });
  const body = '01 03 04 00 01 FF FF';
  const { hex } = await (await request.post('/api/crc', { data: { text: body } })).json();
  await clickWorkbench(page, '协议与仪器');
  await page.getByLabel('Modbus 待解析帧').fill(body + ' ' + hex);
  await page.getByRole('button', { name: '解析帧', exact: true }).click();
  await expect(page.locator('.instrument-section').filter({ hasText: 'Modbus 字段解析' }).locator('tbody')).toContainText('-1');
});

test('firmware UI imports a binary, blocks missing toolchains, and exports error logs', async ({ page, request }) => {
  await page.goto('/'); await clickWorkbench(page, '芯片与固件');
  await page.getByLabel('固件版本').fill('UI-TEST-NOT-FOR-HARDWARE');
  await page.locator('.chips-page input[type=file]').setInputFiles({ name: 'ui-test-only.bin', mimeType: 'application/octet-stream', buffer: Buffer.from([1, 2, 3, 4]) });
  await expect(page.locator('.firmware-list')).toContainText('ui-test-only.bin');
  await page.getByLabel('下载串口', { exact: true }).fill('COM999');
  await page.getByLabel('烧录工具路径').fill('D:\\NONEXISTENT\\esptool.exe');
  await page.getByRole('button', { name: '预览烧录任务', exact: true }).click();
  await expect(page.getByRole('status')).toContainText('未找到');
  await expect(page.getByRole('button', { name: '确认写入', exact: true })).toHaveCount(0);
  await page.screenshot({ path: 'artifacts/chips-desktop.png', fullPage: true });
  await clickWorkbench(page, '运行日志');
  await page.getByLabel('日志级别').selectOption('error');
  await expect(page.locator('.event-list')).toContainText('未找到');
  const exported = await (await request.get('/api/logs/export?level=error')).text();
  expect(exported).toContain('未找到'); expect(exported).not.toContain('ui-fixture-secret');
});

test('Agent sessions, local subagents and toolchain command previews remain isolated', async ({ page, request }) => {
  const original = await (await request.get('/api/ai/state')).json();
  const created: string[] = [];
  try {
    await page.goto('/'); await clickWorkbench(page, 'AI 与 Agent');
    await page.getByRole('button', { name: '展开会话与分析设置', exact: true }).click();
    await page.getByRole('button', { name: '项目与执行', exact: true }).click();
    await page.getByRole('button', { name: '新建 Agent 会话', exact: true }).click();
    await expect(page.locator('.agent-messages')).toContainText('等待分析');
    await page.getByLabel('Agent 分析请求').fill('检查模拟采样');
    await page.getByRole('button', { name: '启动子代理', exact: true }).click();
    await expect.poll(async () => (await (await request.get('/api/ai/state')).json()).sessions.length).toBe(original.sessions.length + 4);
    await expect(page.locator('.agent-message.assistant')).toHaveCount(3);
    const state = await (await request.get('/api/ai/state')).json();
    created.push(...state.sessions.filter((session: { id: string }) => !original.sessions.some((old: { id: string }) => old.id === session.id)).map((session: { id: string }) => session.id));
    await page.getByLabel('工具链命令', { exact: true }).fill('cmake --build build');
    await page.getByRole('button', { name: '预览工具链命令', exact: true }).click();
    await expect(page.locator('.command-plan')).toContainText('cmake');
    await expect(page.getByRole('button', { name: '确认执行', exact: true })).toBeVisible();
    await page.screenshot({ path: 'artifacts/agent-sessions-desktop.png', fullPage: true });
    await page.getByLabel('Agent 会话', { exact: true }).selectOption(original.sessionId);
    await expect(page.locator('.agent-message.assistant')).toHaveCount(original.messages.filter((message: { role: string }) => message.role === 'assistant').length);
  } finally { await request.post('/api/ai/cancel-all', { data: {} }); await request.post('/api/ai/sessions/select', { data: { id: original.sessionId } }); for (const id of created) await request.post('/api/ai/sessions/close', { data: { id } }); }
});

test('Agent file proposals show before/after code, jump to source, persist and apply a reviewed edit', async ({ page, request }) => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'signaldesk-ui-'));
  const before = 'int sample_interval_ms = 20;\nint channel_count = 3;\n';
  const after = 'int sample_interval_ms = 10;\nint channel_count = 3;\n';
  await fs.writeFile(path.join(directory, 'main.c'), before);
  const hash = createHash('sha256').update(before).digest('hex');
  const original = await (await request.get('/api/ai/state')).json();
  let call = 0;
  const model = http.createServer((incoming, outgoing) => {
    incoming.resume(); incoming.on('end', () => {
      outgoing.setHeader('Content-Type', 'application/json');
      const message = ++call === 1 ? { role: 'assistant', content: '已生成采样间隔修改提案。', tool_calls: [{ id: 'fixture-call', type: 'function', function: { name: 'propose_file_change', arguments: JSON.stringify({ path: 'main.c', expectedHash: hash, content: after, reason: 'UI 测试：采样间隔从 20 ms 改为 10 ms，需实机验证负载。' }) } }] } : { role: 'assistant', content: '请审查差异后决定是否应用。' };
      outgoing.end(JSON.stringify({ choices: [{ message }] }));
    });
  });
  await new Promise<void>(resolve => model.listen(0, '127.0.0.1', resolve));
  try {
    await request.post('/api/ai/clear', { data: {} });
    await request.post('/api/ai/config', { data: { root: directory, model: 'local-test-fixture', baseUrl: `http://127.0.0.1:${(model.address() as { port: number }).port}/v1`, apiStyle: 'chat', clearKey: true } });
    await page.goto('/'); await clickWorkbench(page, 'AI 与 Agent');
    await page.getByRole('button', { name: '展开会话与分析设置', exact: true }).click();
    await page.getByRole('button', { name: '项目与执行', exact: true }).click();
    await page.getByRole('button', { name: 'AI Agent', exact: true }).click();
    await expect(page.getByLabel('固件源文件')).toHaveValue('main.c');
    await page.getByRole('button', { name: '生成优化补丁', exact: true }).click();
    await expect(page.locator('.history-record')).toHaveCount(1);
    expect(await fs.readFile(path.join(directory, 'main.c'), 'utf8')).toBe(before);
    await page.locator('.history-record').click();
    const dialog = page.getByRole('dialog', { name: '代码修改对照' });
    await expect(dialog.locator('.diff-columns > div').nth(0)).toContainText('= 20');
    await expect(dialog.locator('.diff-columns > div').nth(1)).toContainText('= 10');
    await dialog.getByRole('button', { name: '定位当前文件', exact: true }).click();
    await expect(dialog.locator('.current-source .highlight-line')).toContainText('= 20');
    await page.screenshot({ path: 'artifacts/code-review-desktop.png', fullPage: true });
    await page.getByRole('button', { name: '关闭代码对照', exact: true }).click();
    await page.getByRole('button', { name: '应用修改', exact: true }).click();
    await expect.poll(() => fs.readFile(path.join(directory, 'main.c'), 'utf8')).toBe(after);
    const history = await (await request.get('/api/ai/changes')).json(); expect(history[0].status).toBe('applied');
    await request.post('/api/ai/clear', { data: {} });
    expect((await (await request.get('/api/ai/changes')).json()).length).toBe(1);
  } finally {
    await request.post('/api/ai/config', { data: { ...original.config, clearKey: true } });
    await request.post('/api/ai/clear', { data: {} });
    await new Promise<void>(resolve => model.close(() => resolve())); await fs.rm(directory, { recursive: true, force: true });
  }
});

test('all added pages fit desktop and narrow layouts without document overflow', async ({ page }) => {
  for (const viewport of [{ width: 1500, height: 950 }, { width: 390, height: 844 }]) {
    await page.setViewportSize(viewport); await page.goto('/');
    for (const name of ['多设备总览', '自定义帧', '自动测试', '芯片与固件', 'AI 与 Agent', '运行日志']) {
      await clickWorkbench(page, name);
      await expect(page.getByRole('navigation', { name: '工作区导航' }).getByRole('button', { name, exact: true })).toHaveAttribute('aria-current', 'page');
      await page.waitForTimeout(150);
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), name).toBe(true);
      if (name === 'AI 与 Agent' && viewport.width === 390) await page.screenshot({ path: 'artifacts/agent-mobile.png', fullPage: true });
    }
  }
});
