import { expect, test } from '@playwright/test';
import http from 'node:http';
import fs from 'node:fs/promises';
import { clickWorkbench } from './workbench-actions';

test('terminal Agent supports slash tasks, highlighted code, clipboard, follow controls and conversation export', async ({ page, request, context }) => {
  const original = (await (await request.get('/api/ai/state')).json()).config;
  const output = '已检查串口初始化。建议先验证 `Serial.begin` 与上位机波特率一致。\n\n```cpp\n#include <Arduino.h>\nconst uint32_t baud = 115200;\nvoid setup() {\n  Serial.begin(baud); // 初始化串口\n}\n```\n\n**验证结果**：以上为审查建议，尚未写入或烧录。';
  const server = http.createServer((incoming, outgoing) => { incoming.resume(); incoming.on('end', () => { outgoing.setHeader('Content-Type', 'application/json'); outgoing.setHeader('x-request-id', 'console-trace-1'); outgoing.end(JSON.stringify({ model: 'console-resolved', id: 'console-response-1', choices: [{ message: { content: output }, finish_reason: 'stop' }], usage: { prompt_tokens: 123, completion_tokens: 45 } })); }); });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  try {
    await request.post('/api/ai/config', { data: { baseUrl: `http://127.0.0.1:${(server.address() as { port: number }).port}/v1`, model: 'console-fixture', apiStyle: 'chat', apiKey: 'console-test-secret' } });
    await request.post('/api/ai/clear', { data: {} });
    await context.grantPermissions(['clipboard-read', 'clipboard-write']);
    await page.goto('/'); await clickWorkbench(page, 'AI 与 Agent');
    await expect(page.getByLabel('Agent 会话', { exact: true })).toBeVisible();
    const input = page.getByLabel('Agent 分析请求');
    await input.fill('/'); await expect(page.getByRole('listbox', { name: 'Agent 斜杠指令' })).toBeVisible();
    await input.press('ArrowDown'); await input.press('Enter'); await expect(input).toHaveValue(/审查当前文件/);
    await expect(page.getByRole('listbox', { name: 'Agent 斜杠指令' })).toHaveCount(0);
    await input.press('Control+Enter');
    await expect(page.locator('.console-code')).toHaveCount(1);
    await expect(page.locator('.console-code .tok-keyword').first()).toBeVisible();
    expect(await page.locator('.console-code span[class*=tok-]').evaluateAll(elements => new Set(elements.map(element => getComputedStyle(element).color)).size)).toBeGreaterThan(2);
    await page.getByRole('button', { name: '复制代码', exact: true }).click();
    await expect(page.getByRole('button', { name: '代码已复制', exact: true })).toBeVisible();
    expect(await page.evaluate(() => navigator.clipboard.readText())).toContain('Serial.begin(baud)');
    const record = page.locator('.agent-call-details');
    await expect(record.locator('summary')).toContainText('请求 console-fixture'); await expect(record.locator('summary')).toContainText('返回 console-resolved');
    await record.locator('summary').click(); await expect(record).toContainText('console-trace-1'); await expect(record).toContainText('123 / 45');
    await record.getByRole('button', { name: '复制调用记录', exact: true }).click(); expect(await page.evaluate(() => navigator.clipboard.readText())).toContain('接口返回模型: console-resolved');
    await page.screenshot({ path: 'artifacts/agent-call-record-desktop.png', fullPage: true });
    await record.locator('summary').click();
    await page.getByRole('button', { name: '暂停跟随输出', exact: true }).click();
    await expect(page.getByRole('button', { name: '跟随最新输出', exact: true })).toHaveAttribute('aria-pressed', 'false');
    await page.getByRole('button', { name: '跟随最新输出', exact: true }).click();
    const download = page.waitForEvent('download'); await page.getByRole('button', { name: '导出 Agent 会话', exact: true }).click();
    const file = await download; const content = await fs.readFile((await file.path())!, 'utf8');
    expect(file.suggestedFilename()).toMatch(/^signaldesk-agent-.*\.md$/); expect(content).toContain('Serial.begin'); expect(content).toContain('请求模型: console-fixture'); expect(content).toContain('接口返回模型: console-resolved'); expect(content).not.toContain('console-test-secret');
    await page.screenshot({ path: 'artifacts/agent-console-desktop.png', fullPage: true });
    await clickWorkbench(page, '实时监测'); await clickWorkbench(page, '展开 Agent 分栏');
    const dock = page.getByRole('complementary', { name: '属性与 Agent 面板', exact: true });
    await expect(dock.locator('.console-code')).toBeVisible();
    expect(await dock.locator('.agent-console > .panel-toolbar').evaluate(element => {
      const bounds = element.getBoundingClientRect();
      return [...element.querySelectorAll('button')].filter(button => button.getBoundingClientRect().width > 0).every(button => { const box = button.getBoundingClientRect(); return box.left >= bounds.left && box.right <= bounds.right; });
    })).toBe(true);
    await page.screenshot({ path: 'artifacts/agent-console-dock.png', fullPage: true });
    await page.getByRole('button', { name: '关闭 Agent 面板', exact: true }).click(); await clickWorkbench(page, 'AI 与 Agent');
    await page.setViewportSize({ width: 1024, height: 768 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
    await page.screenshot({ path: 'artifacts/agent-console-compact.png', fullPage: true });
    await page.setViewportSize({ width: 390, height: 844 });
    await record.locator('summary').click();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
    await page.screenshot({ path: 'artifacts/agent-console-mobile.png', fullPage: true });
    await page.setViewportSize({ width: 1500, height: 950 });
    await page.getByRole('button', { name: '展开会话与分析设置' }).click();
    await expect(page.getByLabel('模型上下文', { exact: true })).toContainText('1 轮');
    await page.getByRole('button', { name: '重置模型上下文', exact: true }).click();
    await expect(page.getByLabel('模型上下文', { exact: true })).toContainText('0 轮'); await expect(record).toHaveCount(1);
    await request.post('/api/ai/config', { data: { model: 'new-request-model' } });
    await expect(record.locator('summary')).toContainText('请求 console-fixture');
  } finally {
    await request.post('/api/ai/config', { data: { ...original, clearKey: true } });
    await request.post('/api/ai/clear', { data: {} });
    server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve()));
  }
});
