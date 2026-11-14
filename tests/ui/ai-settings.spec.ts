import { clickWorkbench } from './workbench-actions';
import { expect, test } from '@playwright/test';
import http from 'node:http';

test('AI provider presets validate DeepSeek and model discovery and test errors stay visible', async ({ page, request }) => {
  const original = (await (await request.get('/api/ai/state')).json()).config;
  let fail = false;
  const server = http.createServer((incoming, outgoing) => {
    incoming.resume(); incoming.on('end', () => { outgoing.setHeader('Content-Type', 'application/json');
      if (incoming.url === '/v1/models') outgoing.end(JSON.stringify({ data: [{ id: 'fixture-chat' }, { id: 'fixture-tool' }] }));
      else if (fail) { outgoing.statusCode = 401; outgoing.end(JSON.stringify({ error: { message: 'bad fixture-key' } })); }
      else outgoing.end(JSON.stringify({ choices: [{ message: { content: 'OK fixture' }, finish_reason: 'stop' }] }));
    });
  });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  try {
    await page.goto('/'); await clickWorkbench(page, 'AI 与 Agent'); await page.getByRole('button', { name: 'AI 接口设置', exact: true }).click();
    const dialog = page.getByRole('dialog', { name: 'AI 接口设置' });
    await expect(page.getByLabel('AI 服务商').locator('option')).toHaveCount(13);
    await page.getByLabel('AI 服务商').selectOption('deepseek'); await expect(page.getByLabel('AI API 格式')).toHaveValue('chat'); await expect(page.getByLabel('AI 模型名称')).toHaveValue('deepseek-flash');
    await expect(page.getByLabel('AI 回答模式')).toHaveValue('auto'); await expect(page.getByLabel('AI 输出上限')).toHaveValue('8192');
    await page.getByLabel('AI 回答模式').selectOption('enabled'); await expect(page.getByLabel('AI 思考强度')).toHaveValue('low'); await expect(page.getByLabel('AI 输出上限')).toHaveValue('16384');
    await page.getByLabel('AI 回答模式').selectOption('disabled'); await expect(page.getByLabel('AI 思考强度')).toHaveCount(0);
    await page.getByLabel('AI API 格式').selectOption('responses'); await expect(dialog.getByRole('alert')).toContainText('Chat Completions'); await expect(page.getByRole('button', { name: '保存并测试接口' })).toBeDisabled();
    await page.getByLabel('AI API 格式').selectOption('chat'); await page.getByLabel('AI Base URL').fill(`http://127.0.0.1:${(server.address() as { port: number }).port}/v1/chat/completions`); await page.getByLabel('AI API Key').fill('fixture-key');
    await page.getByRole('button', { name: '读取模型列表' }).click(); await expect(page.getByLabel('可用 AI 模型')).toBeVisible(); await page.getByLabel('可用 AI 模型').selectOption('fixture-chat');
    await page.getByRole('button', { name: '保存并测试接口' }).click(); await expect(dialog.getByRole('status')).toContainText('连接成功'); await expect(dialog.getByRole('status')).toContainText('OK fixture');
    await page.screenshot({ path: 'artifacts/ai-provider-settings-desktop.png', fullPage: true });
    fail = true; await page.getByRole('button', { name: '保存并测试接口' }).click(); await expect(dialog.getByRole('alert')).toContainText('401'); await expect(dialog.getByRole('alert')).not.toContainText('fixture-key');
    await page.setViewportSize({ width: 390, height: 844 }); expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true); await page.screenshot({ path: 'artifacts/ai-provider-settings-mobile.png', fullPage: true });
  } finally {
    await request.post('/api/ai/config', { data: { ...original, clearKey: true } });
    server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve()));
  }
});
