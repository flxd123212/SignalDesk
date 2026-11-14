import { clickWorkbench } from './workbench-actions';
import { expect, test } from '@playwright/test';
import fs from 'node:fs/promises';

test.beforeEach(async ({ request }) => {
  await request.post('/api/connect', { data: { path: 'demo' } });
  await request.post('/api/processing', { data: { mode: 'raw' } });
});

test('desktop renders moving multichannel waveforms and sends actual transport bytes', async ({ page, request }) => {
  const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
  await page.goto('/');
  await expect(page.getByRole('button', { name: '断开连接', exact: true })).toBeEnabled();
  await expect.poll(async () => (await (await request.get('/api/state')).json()).frames, { timeout: 15000 }).toBeGreaterThan(1100);
  await expect(page.locator('.uplot canvas')).toHaveCount(1);
  const pixels = await page.locator('.uplot canvas').evaluate((canvas: HTMLCanvasElement) => {
    const data = canvas.getContext('2d')!.getImageData(0, 0, canvas.width, canvas.height).data;
    let colored = 0;
    for (let index = 0; index < data.length; index += 4) if (data[index + 3] > 100 && Math.max(data[index], data[index + 1], data[index + 2]) - Math.min(data[index], data[index + 1], data[index + 2]) > 45) colored++;
    return colored;
  });
  expect(pixels).toBeGreaterThan(400);
  const initial = await page.locator('.uplot canvas').evaluate((canvas: HTMLCanvasElement) => canvas.toDataURL());
  await expect.poll(() => page.locator('.uplot canvas').evaluate((canvas: HTMLCanvasElement) => canvas.toDataURL())).not.toBe(initial);
  await fs.mkdir('artifacts', { recursive: true });
  await page.screenshot({ path: 'artifacts/workspace-desktop.png', fullPage: true });
  await page.getByLabel('发送内容', { exact: true }).fill('*IDN?');
  const before = (await (await request.get('/api/state')).json()).txBytes;
  await page.getByRole('button', { name: '发送', exact: true }).click();
  await expect.poll(async () => (await (await request.get('/api/state')).json()).txBytes).toBeGreaterThan(before);
  await clickWorkbench(page, '串口终端');
  await page.getByLabel('搜索串口数据').fill('SIMULATOR');
  await expect(page.locator('.terminal-log')).toContainText('SignalDesk,SIMULATOR');
  await clickWorkbench(page, '实时监测');
  await page.getByRole('button', { name: '频谱', exact: true }).click();
  await expect(page.locator('.chart-readout')).toContainText('HANN');
  await page.screenshot({ path: 'artifacts/spectrum-desktop.png', fullPage: true });
  expect(errors).toEqual([]);
});

test('node graph and formula change the live output channels', async ({ page, request }) => {
  await page.goto('/');
  await clickWorkbench(page, '节点编排');
  await expect(page.locator('.react-flow__node')).toHaveCount(5);
  await page.getByRole('button', { name: '应用到数据', exact: true }).click();
  await expect.poll(async () => (await (await request.get('/api/state')).json()).processingMode).toBe('graph');
  await expect.poll(async () => (await (await request.get('/api/state')).json()).names).toEqual(['放大信号', '平滑信号']);
  await page.screenshot({ path: 'artifacts/graph-desktop.png', fullPage: true });
  await clickWorkbench(page, '解析脚本');
  await page.getByRole('button', { name: '应用公式', exact: true }).click();
  await expect.poll(async () => (await (await request.get('/api/state')).json()).names).toEqual(['voltage', 'current', 'reference', 'power']);
  await expect.poll(async () => (await (await request.get('/api/state')).json()).latest.length).toBe(4);
  await page.screenshot({ path: 'artifacts/script-desktop.png', fullPage: true });
  await page.getByRole('button', { name: '原始通道', exact: true }).click();
  await expect.poll(async () => (await (await request.get('/api/state')).json()).processingMode).toBe('raw');
});

test('recording can be stopped, loaded and played without transmitting to a device', async ({ page, request }) => {
  await page.goto('/');
  await page.getByRole('button', { name: '开始录制', exact: true }).click();
  await expect.poll(async () => (await (await request.get('/api/state')).json()).recording?.bytes || 0).toBeGreaterThan(1000);
  const id = (await (await request.get('/api/state')).json()).recording.id;
  await page.getByRole('button', { name: '停止录制', exact: true }).click();
  await clickWorkbench(page, '录制与回放');
  const row = page.locator('tr').filter({ hasText: id.replace('.jsonl', '') });
  await row.getByRole('button', { name: '载入', exact: true }).click();
  await expect(page.getByRole('button', { name: '播放录制', exact: true })).toBeEnabled();
  await page.getByRole('button', { name: /^串口发送/ }).click();
  await expect(page.getByRole('button', { name: '发送', exact: true })).toBeDisabled();
  await page.getByRole('button', { name: '播放录制', exact: true }).click();
  await expect.poll(async () => (await (await request.get('/api/state')).json()).frames).toBeGreaterThan(10);
  await expect.poll(async () => (await (await request.get('/api/state')).json()).replay.playing).toBe(false);
});

test('desktop, compact desktop and mobile have no horizontal document overflow', async ({ page, request }) => {
  for (const viewport of [{ width: 1500, height: 950 }, { width: 1024, height: 768 }, { width: 390, height: 844 }]) {
    await page.setViewportSize(viewport);
    await page.goto('/');
    await expect.poll(async () => (await (await request.get('/api/state')).json()).frames).toBeGreaterThan(200);
    await expect(page.locator('.uplot canvas')).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
    if (viewport.width === 390) {
      await expect(page.locator('.measurement-row').first()).not.toContainText('--');
      await page.locator('.wave-panel').scrollIntoViewIfNeeded();
      await page.screenshot({ path: 'artifacts/workspace-mobile.png', fullPage: true });
      const panel = await page.locator('.wave-panel').boundingBox();
      expect(panel!.width).toBeLessThan(viewport.width);
    }
  }
});

test('Agent analyzes live data locally, reads the selected firmware and keeps API keys write-only', async ({ page, request }) => {
  await request.post('/api/ai/clear', { data: {} });
  await page.goto('/');
  await clickWorkbench(page, 'AI 与 Agent');
  await expect(page.getByLabel('固件源文件')).toHaveValue('SignalGenerator.ino');
  await expect.poll(async () => (await (await request.get('/api/state')).json()).frames).toBeGreaterThan(300);
  await page.getByRole('button', { name: '分析数据', exact: true }).click();
  await expect(page.locator('.agent-message.assistant')).toContainText('未调用模型');
  await expect(page.locator('.agent-message.assistant')).toContainText('模拟设备');
  await page.getByRole('button', { name: '项目与执行', exact: true }).click();
  await page.getByRole('button', { name: '查看源码', exact: true }).click();
  await expect(page.locator('.firmware-preview')).toContainText('Serial.begin(115200)');
  await page.screenshot({ path: 'artifacts/agent-desktop.png', fullPage: true });
  await page.getByRole('button', { name: '展开会话与分析设置', exact: true }).click();
  await page.getByRole('checkbox', { name: '持续分析', exact: true }).click();
  await expect(page.getByRole('checkbox', { name: '持续分析', exact: true })).toBeChecked();
  await expect.poll(async () => (await (await request.get('/api/ai/state')).json()).continuous?.count).toBe(1);
  await page.getByRole('checkbox', { name: '持续分析', exact: true }).click();
  await expect(page.getByRole('checkbox', { name: '持续分析', exact: true })).not.toBeChecked();
  await page.getByRole('button', { name: 'AI 接口设置', exact: true }).click();
  await page.getByLabel('AI 模型名称').fill('fixture-model');
  await page.getByLabel('AI API Key').fill('ui-fixture-secret');
  await page.getByRole('button', { name: '保存设置', exact: true }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  const state = await (await request.get('/api/ai/state')).json();
  expect(state.config.hasApiKey).toBe(true);
  expect(JSON.stringify(state)).not.toContain('ui-fixture-secret');
  await request.post('/api/ai/config', { data: { clearKey: true, model: '' } });
});
