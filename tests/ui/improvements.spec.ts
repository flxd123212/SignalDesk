import { clickWorkbench } from './workbench-actions';
import { expect, test } from '@playwright/test';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';

test('project dialog detects Keil targets and offers broad chip and board choices without expanding the sidebar', async ({ page, request }) => {
  const original = await (await request.get('/api/ai/state')).json(), state = await (await request.get('/api/state')).json();
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'signaldesk-project-picker-'));
  await fs.writeFile(path.join(directory, 'sensor.uvprojx'), '<Project><Targets><Target><TargetName>Sensor Debug</TargetName><TargetOption><TargetCommonOption><Device>STM32G431CB</Device></TargetCommonOption></TargetOption></Target></Targets></Project>');
  try {
    await page.goto('/'); await page.locator('.project-summary').click();
    const dialog = page.getByRole('dialog', { name: '设备与工程设置' });
    await expect(dialog.getByLabel('标记芯片系列').locator('option')).toHaveCount(19);
    await dialog.getByLabel('设备工程目录', { exact: true }).fill(directory);
    await dialog.getByRole('button', { name: '识别工程芯片', exact: true }).click();
    const candidate = dialog.locator('.identity-result').filter({ hasText: 'STM32G431CB' });
    await candidate.getByRole('button', { name: '采用', exact: true }).click(); await expect(dialog.getByLabel('设备芯片型号')).toHaveValue('STM32G431CB');
    await dialog.getByLabel('开发板型号').fill('G431 Sensor Bench');
    await dialog.screenshot({ path: 'artifacts/project-binding-desktop.png' });
    await page.setViewportSize({ width: 390, height: 844 });
    expect(await dialog.evaluate(element => element.getBoundingClientRect().width)).toBeLessThanOrEqual(390);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
    await dialog.getByRole('button', { name: '保存绑定', exact: true }).click(); await expect(dialog).toHaveCount(0);
    await expect(page.locator('.project-summary')).toContainText('STM32G431CB');
    const current = await (await request.get('/api/state')).json(); expect(current.devices[0].board).toBe('G431 Sensor Bench');
  } finally {
    await request.post('/api/devices/config', { data: { root: original.config.root, chip: state.devices[0].chip, board: state.devices[0].board || '' } });
    await fs.rm(directory, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  }
});

test('sensor graph templates generate real local waveforms and downloadable firmware test code without serial writes', async ({ page, request }) => {
  await request.post('/api/connect', { data: { path: 'demo' } }); await request.post('/api/processing', { data: { mode: 'raw' } });
  await page.goto('/'); await clickWorkbench(page, '节点编排');
  await expect(page.getByLabel('新节点类型').locator('option')).toHaveCount(24);
  await page.getByLabel('测试拼图模板').selectOption('sensor'); await page.getByRole('button', { name: '载入模板', exact: true }).click();
  await expect(page.locator('.react-flow__node')).toHaveCount(3);
  await page.getByRole('button', { name: '测试与代码', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: '节点测试与代码' });
  const before = (await (await request.get('/api/state')).json()).txBytes;
  await dialog.getByRole('button', { name: '生成并测试', exact: true }).click();
  await expect(dialog.getByLabel('生成的测试代码')).toContainText('Serial.begin(115200)');
  await expect(dialog.locator('.test-preview-legend')).toContainText('200 samples');
  expect(await dialog.locator('canvas').evaluate((canvas: HTMLCanvasElement) => { const { data } = canvas.getContext('2d')!.getImageData(0, 0, canvas.width, canvas.height); let colored = 0; for (let index = 0; index < data.length; index += 4) if (data[index + 1] > 100 && data[index] < data[index + 1]) colored++; return colored; })).toBeGreaterThan(100);
  const download = page.waitForEvent('download'); await dialog.getByRole('button', { name: '导出测试代码', exact: true }).click(); expect((await download).suggestedFilename()).toBe('signaldesk_test.ino');
  expect((await (await request.get('/api/state')).json()).txBytes).toBe(before);
  await dialog.screenshot({ path: 'artifacts/graph-test-desktop.png' });
  await page.setViewportSize({ width: 390, height: 844 }); expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
  await dialog.getByLabel('测试代码目标').selectOption('c'); await dialog.getByRole('button', { name: '生成并测试', exact: true }).click(); await expect(dialog.getByLabel('生成的测试代码')).toContainText('int signaldesk_next');
  await dialog.screenshot({ path: 'artifacts/graph-test-mobile.png' });
});

test('threshold alarms trigger from simulated acquisition, remain available across pages and export logs', async ({ page, request }) => {
  await request.post('/api/connect', { data: { path: 'demo' } }); await request.post('/api/processing', { data: { mode: 'raw' } });
  const state = await (await request.get('/api/state')).json(), original = await (await request.get('/api/alarms')).json();
  try {
    await page.goto('/'); await clickWorkbench(page, '报警监测');
    await page.getByRole('button', { name: '添加报警规则', exact: true }).click();
    await page.getByLabel('报警名称 1', { exact: true }).fill('UI threshold test');
    await page.getByLabel('报警上限 1', { exact: true }).fill('0.1'); await page.getByLabel('报警持续时间 1', { exact: true }).fill('0');
    await page.getByRole('button', { name: '保存报警规则', exact: true }).click();
    await expect(page.locator('.alarm-events')).toContainText('UI threshold test');
    const alarm = page.locator('.alarm-event').filter({ hasText: 'UI threshold test' }).first();
    await alarm.getByRole('button', { name: '确认报警', exact: true }).click(); await expect(alarm.getByRole('button', { name: '已确认', exact: true })).toBeDisabled();
    expect(await (await request.get('/api/logs/export?category=alarm')).text()).toContain('UI threshold test');
    await page.screenshot({ path: 'artifacts/alarms-desktop.png' });
    await page.getByRole('button', { name: '测试通知', exact: true }).click(); await expect(page.getByRole('status')).toContainText('非设备故障');
    await clickWorkbench(page, '实时监测'); await page.getByRole('button', { name: '查看报警', exact: true }).click(); await expect(page.getByRole('heading', { name: '报警监测', exact: true })).toBeVisible();
    await page.setViewportSize({ width: 390, height: 844 }); expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
    await page.screenshot({ path: 'artifacts/alarms-mobile.png', fullPage: true });
  } finally { await request.post('/api/alarms/config', { data: { deviceId: state.activeDevice, rules: original.rules } }); }
});
