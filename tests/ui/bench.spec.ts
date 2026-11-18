import { test, expect } from '@playwright/test';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { startServer } from '../../server/index.mjs';
import { clickWorkbench } from './workbench-actions';

test('edit firmware, reject a stale save, open the probe and instrument panels', async ({ page }) => {
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'signaldesk-bench-ui-'));
  const root = path.join(tmp, 'ProbeTest');
  await fs.mkdir(root);
  const source = path.join(root, 'ProbeTest.ino');
  await fs.writeFile(source, 'void setup() {}\nvoid loop() {}\n');
  const server = await startServer({
    port: 0,
    directory: path.join(tmp, 'data', 'sessions'),
    listPorts: async () => [],
  });
  try {
    const post = async (url: string, data: object) => {
      const res = await page.request.post(server.address + '/api' + url, { data });
      expect(res.ok()).toBeTruthy();
      return res.json();
    };
    const plan = await post('/projects/prepare', { root });
    await post('/projects/apply', { id: plan.id, targetId: plan.targets[0].id, reuseAI: false });
    await page.goto(server.address);
    await clickWorkbench(page, '项目源码');
    await page.getByRole('button', { name: '编辑源码', exact: true }).click();
    const editor = page.getByRole('dialog', { name: '编辑项目文件' });
    await editor.getByLabel('代码编辑器').fill('int reading = 5;');
    await editor.getByRole('button', { name: '查看增删' }).click();
    await expect(editor.locator('.added')).toContainText('reading');
    await editor.getByRole('button', { name: '保存', exact: true }).click();
    await expect(editor).not.toBeVisible();
    expect(await fs.readFile(source, 'utf8')).toContain('reading = 5');
    await page.getByRole('button', { name: '编辑源码', exact: true }).click();
    await editor.getByLabel('代码编辑器').fill('int reading = 7;');
    await fs.writeFile(source, 'int reading = 9;');
    await editor.getByRole('button', { name: '保存', exact: true }).click();
    await expect(editor.getByRole('alert')).toContainText('变化');
    expect(await fs.readFile(source, 'utf8')).toContain('reading = 9');
    await editor.getByRole('button', { name: '关闭源码工具' }).click();
    await page.getByRole('button', { name: '调试当前源码行' }).click();
    const lab = page.getByRole('dialog', { name: '工程实验工具' });
    await expect(lab.getByLabel('断点源码')).toHaveValue('ProbeTest.ino');
    for (const [value, action] of [
      ['can', '监听总线'],
      ['power', '发现 Joulescope'],
      ['ble', '扫描'],
      ['bench', '发现仪器'],
    ]) {
      await lab.getByLabel('实验工具', { exact: true }).selectOption(value);
      await expect(lab.getByRole('button', { name: action, exact: true })).toBeVisible();
    }
  } finally {
    await page.close();
    await server.close();
    await fs.rm(tmp, { recursive: true, force: true, maxRetries: 5 });
  }
});
