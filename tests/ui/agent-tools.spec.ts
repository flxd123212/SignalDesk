import { test, expect } from '@playwright/test';
import http from 'node:http';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

test('Agent displays tool results, plans, source links, history search and capability permissions', async ({ page, request }) => {
  const original = (await (await request.get('/api/ai/state')).json()).config;
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'signaldesk-tool-ui-'));
  await fs.writeFile(path.join(directory, 'main.c'), 'int value = 1;\nint main(void) { return value; }\n');
  let count = 0;
  const tool = (name: string, args: object) => ({ id: `${name}-${count}`, type: 'function', function: { name, arguments: JSON.stringify(args) } });
  const server = http.createServer((incoming, outgoing) => {
    let body = ''; incoming.on('data', chunk => body += chunk);
    incoming.on('end', () => {
      count++;
      const input = JSON.parse(body);
      const range = input.messages.filter((message: { role: string; content: string }) => message.role === 'tool').map((message: { content: string }) => JSON.parse(message.content)).find((result: { hash?: string }) => result.hash);
      const calls = count === 1 ? [tool('update_task_plan', { steps: [{ title: '定位并读取源码', status: 'in_progress' }, { title: '等待确认代码补丁', status: 'pending' }] }), tool('find_firmware_files', { query: 'main.c' })]
        : count === 2 ? [tool('read_firmware_lines', { path: 'main.c', startLine: 1, endLine: 2 })]
          : count === 3 ? [tool('propose_source_patch', { path: 'main.c', expectedHash: range.hash, oldText: 'int value = 1;', newText: 'int value = 2;', reason: '测试局部修改提案' }), tool('update_task_plan', { steps: [{ title: '定位并读取源码', status: 'completed' }, { title: '等待确认代码补丁', status: 'pending' }] })] : [];
      outgoing.setHeader('Content-Type', 'application/json'); outgoing.end(JSON.stringify({ choices: [{ message: calls.length ? { tool_calls: calls } : { content: '源码已读取，局部补丁已生成，等待确认。尚未修改文件或执行编译。' }, finish_reason: calls.length ? 'tool_calls' : 'stop' }] }));
    });
  });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  try {
    const configured = await request.post('/api/ai/config', { data: { root: directory, baseUrl: `http://127.0.0.1:${(server.address() as { port: number }).port}/v1`, model: 'tools-fixture', apiStyle: 'chat', apiKey: 'tools-test-secret' } }); expect(configured.ok()).toBe(true);
    await request.post('/api/ai/clear', { data: {} });
    await page.goto('/?view=agent');
    await page.getByRole('button', { name: 'Agent 工具箱', exact: true }).click();
    const toolbox = page.getByRole('dialog', { name: 'Agent 工具箱', exact: true });
    await expect(toolbox).toContainText('18 个工具'); await expect(toolbox).toContainText('需附带原始日志');
    await page.screenshot({ path: 'artifacts/agent-toolbox-desktop.png', animations: 'disabled' });
    await page.keyboard.press('Escape'); await expect(toolbox).toHaveCount(0);
    const input = page.getByLabel('Agent 分析请求'); await input.fill('检查 main.c 并提供局部修改计划'); await input.press('Control+Enter');
    await expect(page.locator('.agent-task-plan')).toContainText('1 / 2');
    await expect(page.locator('.agent-message.assistant').last()).toContainText('尚未修改文件');
    await expect(page.locator('.agent-tool-event')).toHaveCount(5);
    const read = page.locator('.agent-tool-event').filter({ has: page.locator('summary', { hasText: '按行读取源码' }) });
    await read.locator('summary').click(); await expect(read).toContainText('int value = 1;'); await expect(read).toContainText('参数');
    await page.screenshot({ path: 'artifacts/agent-tools-results.png', fullPage: true, animations: 'disabled' });
    await read.getByRole('button', { name: '打开 main.c:1', exact: true }).click();
    await expect(page.locator('.editor-page')).toBeVisible(); await expect(page.locator('.cm-editor')).toContainText('int value = 1;');
    await page.getByRole('button', { name: 'AI 与 Agent', exact: true }).click();
    await page.getByRole('button', { name: '展开会话与分析设置', exact: true }).click();
    await page.getByLabel('搜索 Agent 会话记录').fill('尚未修改文件'); await expect(page.locator('.agent-message')).toHaveCount(1);
    await page.getByRole('button', { name: '清除会话搜索', exact: true }).click();
    await page.getByLabel('Agent 工作模式').selectOption('review');
    await page.getByRole('button', { name: 'Agent 工具箱', exact: true }).click(); await expect(toolbox).toContainText('只读模式不可用');
    await page.setViewportSize({ width: 390, height: 844 });
    expect(await toolbox.evaluate(element => element.scrollWidth <= element.clientWidth + 1)).toBe(true);
    await page.screenshot({ path: 'artifacts/agent-toolbox-mobile.png', fullPage: true, animations: 'disabled' });
    await page.getByRole('button', { name: '关闭工具箱', exact: true }).click();
    await page.getByRole('button', { name: '清除任务计划', exact: true }).click(); await expect(page.locator('.agent-task-plan')).toHaveCount(0);
    expect(await fs.readFile(path.join(directory, 'main.c'), 'utf8')).toContain('int value = 1;');
  } finally {
    await fetch('http://127.0.0.1:4788/api/ai/config', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ...original, clearKey: true }) });
    await fetch('http://127.0.0.1:4788/api/ai/clear', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
    server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())); await fs.rm(directory, { recursive: true, force: true });
  }
});
