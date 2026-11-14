import { expect, test } from '@playwright/test';
import http from 'node:http';
import { clickWorkbench } from './workbench-actions';

test('Agent read-only search, retry progress, manual recovery and cancellation work in the interface', async ({ page, request }) => {
  const original = (await (await request.get('/api/ai/state')).json()).config;
  let failedOnce = false, failAuth = false, waitForCancel = false;
  const received: Record<string, any>[] = [];
  const server = http.createServer((incoming, outgoing) => {
    let text = ''; incoming.on('data', chunk => { text += chunk; });
    incoming.on('end', () => {
      const body = JSON.parse(text); received.push(body); outgoing.setHeader('Content-Type', 'application/json');
      if (failAuth) { outgoing.statusCode = 401; outgoing.end(JSON.stringify({ error: { message: 'Invalid fixture credentials' } })); return; }
      if (!failedOnce || waitForCancel) { failedOnce = true; outgoing.statusCode = 429; outgoing.setHeader('Retry-After', waitForCancel ? '20' : '2'); outgoing.end(JSON.stringify({ error: { message: 'Fixture rate limit' } })); return; }
      const searched = body.messages.some((message: { role: string }) => message.role === 'tool');
      outgoing.end(JSON.stringify({ choices: [{ message: searched ? { content: '已定位 Serial 初始化，尚未修改任何源码。' } : { content: '', tool_calls: [{ id: 'search-1', type: 'function', function: { name: 'search_firmware', arguments: '{"query":"Serial"}' } }] }, finish_reason: searched ? 'stop' : 'tool_calls' }] }));
    });
  });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  try {
    await request.post('/api/ai/config', { data: { baseUrl: `http://127.0.0.1:${(server.address() as { port: number }).port}/v1`, model: 'fixture-agent', apiStyle: 'chat', apiKey: 'fixture-key' } });
    await request.post('/api/ai/clear', { data: {} });
    await page.goto('/'); await clickWorkbench(page, 'AI 与 Agent');
    await page.getByRole('button', { name: '展开会话与分析设置' }).click();
    await page.getByRole('button', { name: 'AI Agent', exact: true }).click();
    await page.getByLabel('Agent 工作模式').selectOption('review');
    await page.getByLabel('Agent 分析请求').fill('查找串口初始化，只读分析。');
    await page.getByRole('button', { name: '分析', exact: true }).click();
    await expect(page.getByLabel('Agent 运行状态')).toContainText('重试');
    await expect(page.locator('.agent-messages')).toContainText('已定位 Serial 初始化');
    await expect(page.getByLabel('Agent 运行状态')).toContainText('本轮分析完成');
    expect(received.every(body => !body.tools?.some((tool: any) => tool.function.name.startsWith('propose_')))).toBe(true);
    await page.screenshot({ path: 'artifacts/agent-runtime-desktop.png', fullPage: true });
    failAuth = true;
    await page.getByLabel('Agent 分析请求').fill('继续分析'); await page.getByRole('button', { name: '分析', exact: true }).click();
    await expect(page.locator('.agent-message.error')).toContainText('401');
    failAuth = false; await page.getByRole('button', { name: '重试上次请求', exact: true }).click();
    await expect(page.getByRole('button', { name: '重试上次请求', exact: true })).toHaveCount(0);
    await expect(page.getByLabel('Agent 运行状态')).toContainText('本轮分析完成');
    waitForCancel = true;
    await page.getByRole('button', { name: '分析', exact: true }).click(); await expect(page.getByLabel('Agent 运行状态')).toContainText('重试');
    const calls = received.length; await page.getByRole('button', { name: '停止', exact: true }).click();
    await expect(page.getByLabel('Agent 运行状态')).toContainText('分析已停止'); expect(received.length).toBe(calls);
    await page.setViewportSize({ width: 390, height: 844 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
    await page.screenshot({ path: 'artifacts/agent-runtime-mobile.png', fullPage: true });
  } finally {
    await request.post('/api/ai/cancel', { data: {} });
    await request.post('/api/ai/config', { data: { ...original, clearKey: true } });
    server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve()));
  }
});
