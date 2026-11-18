import { test, expect } from '@playwright/test';
import http from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';

test('Agent shows unfinished plan after model finishes, continues with evidence and reports DSML rather than silently completing', async ({ page, request }) => {
  const original = (await (await request.get('/api/ai/state')).json()).config;
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'signaldesk-recovery-ui-'));
  await fs.writeFile(path.join(root, 'main.c'), 'int sensorValue = 42;\nint main(void) { return sensorValue; }\n');
  let count = 0, invalid = false;
  const received: any[] = [];
  const server = http.createServer((incoming, outgoing) => {
    let text = ''; incoming.on('data', chunk => text += chunk);
    incoming.on('end', () => {
      const body = JSON.parse(text); received.push(body); count++;
      const tool = (name: string, args: object) => ({ id: `${name}-${count}`, type: 'function', function: { name, arguments: JSON.stringify(args) } });
      const calls = count === 1 ? [tool('update_task_plan', { steps: [{ title: '读取传感器源码', status: 'completed' }, { title: '检查返回值', status: 'pending' }] }), tool('read_firmware_lines', { path: 'main.c', startLine: 1, endLine: 2 })]
        : count === 3 ? [tool('update_task_plan', { steps: [{ title: '读取传感器源码', status: 'completed' }, { title: '检查返回值', status: 'completed' }] })] : [];
      outgoing.setHeader('Content-Type', 'application/json');
      outgoing.end(JSON.stringify({ model: 'fixture-resolved', choices: [{ message: invalid ? { content: '</｜DSML｜calls>' } : calls.length ? { tool_calls: calls } : { content: '已核对读取到的返回值，尚未修改源码或执行硬件测试。' }, finish_reason: calls.length && !invalid ? 'tool_calls' : 'stop' }] }));
    });
  });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  try {
    await request.post('/api/ai/config', { data: { root, baseUrl: `http://127.0.0.1:${(server.address() as { port: number }).port}/v1`, apiStyle: 'chat', model: 'recovery-fixture' } });
    await request.post('/api/ai/clear', { data: {} });
    await page.goto('/?view=agent');
    await page.getByRole('button', { name: '展开会话与分析设置', exact: true }).click();
    await expect(page.getByLabel('Agent 步骤上限')).toHaveCount(0);
    await page.getByLabel('Agent 工作模式').selectOption('review');
    await page.getByRole('button', { name: '收起会话与分析设置', exact: true }).click();
    const input = page.getByLabel('Agent 分析请求'); await input.fill('检查传感器返回值'); await input.press('Control+Enter');
    await expect(page.getByLabel('Agent 运行状态')).toContainText('计划仍有未完成项');
    const recovery = page.getByLabel('继续未完成任务', { exact: true });
    await expect(recovery).toContainText('1 项未完成'); await expect(page.locator('.console-prompt-heading')).toContainText('PAUSED');
    expect(count).toBe(2); expect(received[1].tools.length).toBeGreaterThan(0);
    const current = await (await request.get('/api/ai/state')).json();
    expect((await request.post('/api/ai/resume', { data: {} })).ok()).toBe(false);
    expect((await request.post('/api/ai/resume', { data: { deviceId: current.deviceId, root, sessionId: 'stale-session' } })).ok()).toBe(false);
    expect(count).toBe(2);
    await page.screenshot({ path: 'artifacts/agent-budget-paused-desktop.png', fullPage: true });
    await page.setViewportSize({ width: 390, height: 844 });
    expect(await recovery.evaluate(element => element.scrollWidth <= element.clientWidth + 1)).toBe(true);
    await page.screenshot({ path: 'artifacts/agent-budget-paused-mobile.png', fullPage: true });
    await expect(page.getByLabel('继续任务步骤预算')).toHaveCount(0);
    await page.getByRole('button', { name: '继续任务', exact: true }).click();
    await expect(page.getByLabel('Agent 运行状态')).toContainText('本轮分析完成'); await expect(recovery).toHaveCount(0);
    expect(count).toBe(4); expect(JSON.stringify(received[2].messages)).toContain('sensorValue');
    expect(received[2].tools.some((tool: any) => tool.function.name.startsWith('propose_'))).toBe(false);
    await expect(page.locator('.agent-task-plan')).toContainText('2 / 2');
    invalid = true;
    await input.fill('继续检查'); await input.press('Control+Enter');
    await expect(page.locator('.agent-message.error').last()).toContainText('DSML');
    await expect(page.locator('.agent-message.error').last()).toContainText('未执行');
    await expect(page.locator('.console-prompt-heading')).toContainText('ERROR');
    await expect(page.getByRole('button', { name: '继续任务', exact: true })).toBeVisible();
    await page.screenshot({ path: 'artifacts/agent-dsml-recovery-mobile.png', fullPage: true });
    expect(await fs.readFile(path.join(root, 'main.c'), 'utf8')).toContain('sensorValue = 42');
  } finally {
    await request.post('/api/ai/cancel', { data: {} });
    await request.post('/api/ai/config', { data: { ...original, clearKey: true } }); await request.post('/api/ai/clear', { data: {} });
    server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())); await fs.rm(root, { recursive: true, force: true });
  }
});

test('older turns remain as attributed handoff excerpts, reload and clear with model context', async ({ page, request }) => {
  const original = (await (await request.get('/api/ai/state')).json()).config;
  const server = http.createServer((incoming, outgoing) => { incoming.resume(); incoming.on('end', () => { outgoing.setHeader('Content-Type', 'application/json'); outgoing.end(JSON.stringify({ choices: [{ message: { content: '历史建议，尚未修改。' }, finish_reason: 'stop' }] })); }); });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  try {
    await request.post('/api/ai/config', { data: { baseUrl: `http://127.0.0.1:${(server.address() as { port: number }).port}/v1`, apiStyle: 'chat', model: 'handoff-fixture' } });
    await request.post('/api/ai/clear', { data: {} });
    for (let i = 0; i < 10; i++) expect((await request.post('/api/ai/run', { data: { mode: 'ai', message: `保留任务 ${i}` } })).ok()).toBe(true);
    await page.goto('/?view=agent');
    await page.getByRole('button', { name: '展开会话与分析设置', exact: true }).click();
    await expect(page.getByLabel('模型上下文', { exact: true })).toContainText('8 轮');
    await page.locator('.agent-handoff > summary').click();
    await expect(page.locator('.agent-handoff')).toContainText('保留任务 0'); await expect(page.locator('.agent-handoff')).toContainText('未经重新验证');
    await page.reload(); await page.getByRole('button', { name: '展开会话与分析设置', exact: true }).click();
    await expect(page.locator('.agent-handoff')).toContainText('保留任务 0');
    await page.getByRole('button', { name: '重置模型上下文', exact: true }).click(); await expect(page.locator('.agent-handoff')).toHaveCount(0);
    await expect(page.locator('.agent-message.user').first()).toContainText('保留任务 0');
  } finally {
    await request.post('/api/ai/config', { data: { ...original, clearKey: true } }); await request.post('/api/ai/clear', { data: {} });
    server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve()));
  }
});
