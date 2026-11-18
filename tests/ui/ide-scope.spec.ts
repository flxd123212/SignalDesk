import { expect, test } from '@playwright/test';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { startServer } from '../../server/index.mjs';

test('recover a conflicting pin draft and navigate from a project text match to its source line', async ({ page }) => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'signaldesk-ide-recovery-'));
  const root = path.join(directory, 'probe'); await fs.mkdir(root);
  await fs.writeFile(path.join(root, 'adc.c'), '// adc\nint adc_ready = 1;\n');
  const runtime = await startServer({ port: 0, autoDemo: false, directory: path.join(directory, 'sessions'), listPorts: async () => [] });
  const call = async (route: string, body?: object) => {
    const res = await page.request.fetch(`${runtime.address}/api${route}`, body ? { method: 'POST', data: body } : {});
    expect(res.ok()).toBeTruthy(); return res.json();
  };
  try {
    await call('/ai/config', { root });
    const deviceId = (await call('/state')).activeDevice;
    await page.goto(`${runtime.address}/?view=hardware`);
    await expect(page.locator('#signaldesk-startup')).toBeHidden();
    await page.getByRole('button', { name: '硬件工程属性' }).click();
    await page.getByLabel('硬件开发板名称').fill('local-board');
    const original = await call('/hardware');
    await call('/hardware/save', { deviceId, root, version: original.version, profile: { ...original, board: 'external-board' } });
    await page.getByRole('button', { name: '保存映射' }).click();
    const conflict = page.getByRole('region', { name: '硬件草稿恢复' });
    await expect(conflict).toBeVisible();
    await page.reload(); await expect(conflict).toBeVisible();
    const download = page.waitForEvent('download'); await conflict.getByRole('button', { name: '导出草稿' }).click();
    const draft = JSON.parse(await fs.readFile((await (await download).path())!, 'utf8'));
    expect(draft.profile.board).toBe('local-board');
    await conflict.getByRole('button', { name: '恢复草稿' }).click();
    expect((await call('/hardware')).board).toBe('external-board');
    await page.getByRole('button', { name: '保存映射' }).click();
    await expect.poll(async () => (await call('/hardware')).board).toBe('local-board');
    await page.keyboard.press('Control+Shift+f');
    const search = page.getByRole('dialog', { name: '查找工程正文' });
    await search.getByLabel('工程正文关键词').fill('ADC_READY');
    await search.getByLabel('工程正文关键词').press('Enter');
    await search.getByRole('button', { name: /adc\.c:2/ }).click();
    await expect(page).toHaveURL(/view=editor/);
    await expect(page.locator('.cm-activeLine')).toContainText('adc_ready');
  } finally { await page.close(); await runtime.close(); await fs.rm(directory, { recursive: true, force: true, maxRetries: 5 }); }
});
