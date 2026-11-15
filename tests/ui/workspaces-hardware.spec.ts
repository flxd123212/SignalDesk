import { expect, test } from '@playwright/test';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('signaldesk.preferences.v1', JSON.stringify({ startupAnimation: false, layout: { connection: false } })));
});

test('four workspaces and menu actions support keyboard navigation and independent instruments', async ({ page }) => {
  const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
  await page.goto('/');
  for (const name of ['软件工作区', '硬件工作区', '联调工作区', '测试工作区']) await expect(page.getByRole('button', { name, exact: true })).toBeVisible();
  await page.keyboard.press('Control+Alt+2'); await expect(page).toHaveURL(/view=hardware/);
  await expect(page.getByRole('region', { name: '硬件工程工作台' })).toBeVisible();
  await page.keyboard.press('Control+Alt+4'); await expect(page).toHaveURL(/view=validation/);
  await page.getByRole('button', { name: '编辑', exact: true }).click();
  await page.getByRole('menuitem', { name: '键盘快捷操作…' }).click();
  await expect(page.getByRole('dialog', { name: '键盘快捷操作' })).toBeVisible(); await page.keyboard.press('Escape');
  await page.getByRole('button', { name: '窗口', exact: true }).click();
  const popupPromise = page.waitForEvent('popup'); await page.getByRole('menuitem', { name: '独立窗口：协议与仪器' }).click();
  const popup = await popupPromise; await expect(popup).toHaveURL(/view=instruments/); await popup.close();
  await page.keyboard.press('Control+Alt+3'); await expect(page).toHaveURL(/view=workspace/);
  await page.screenshot({ path: 'artifacts/four-workspaces-desktop.png' });
  await page.setViewportSize({ width: 390, height: 844 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
  expect(errors).toEqual([]);
});

test('node templates, connection form, undo, keyboard move and scoped drafts work without dragging', async ({ page, request }) => {
  await request.post('/api/connect', { data: { path: 'demo' } }); await request.post('/api/processing', { data: { mode: 'raw' } });
  const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
  await page.goto('/?view=graph'); await page.getByRole('button', { name: '一键配置', exact: true }).click();
  await page.getByLabel('测试拼图模板').selectOption('channels'); await page.getByLabel('模板通道数').fill('3');
  await page.getByRole('button', { name: '载入模板' }).click();
  await expect(page.locator('.react-flow__node')).toHaveCount(4);
  await page.getByLabel('新节点类型').selectOption('gain'); await page.getByRole('button', { name: '添加节点', exact: true }).click();
  await expect(page.getByLabel('节点名称', { exact: true })).toHaveValue('增益');
  await page.getByLabel('节点数值').fill('2');
  await page.getByRole('button', { name: '连接节点 (C)', exact: true }).click();
  await page.getByLabel('连线源节点').selectOption('source'); await page.getByLabel('连线目标节点').selectOption({ label: '增益' });
  await page.getByRole('button', { name: '建立连接', exact: true }).click();
  await page.locator('.graph-canvas').click({ position: { x: 30, y: 20 } });
  await page.keyboard.press('Control+d'); await expect(page.locator('.react-flow__node')).toHaveCount(6);
  await page.keyboard.press('Control+z'); await expect(page.locator('.react-flow__node')).toHaveCount(5);
  await page.getByRole('button', { name: '自动排列 (L)' }).click();
  const source = page.locator('.react-flow__node[data-id="source"]');
  await source.focus(); await page.keyboard.press('Enter');
  await expect(source).toHaveClass(/selected/); const position = await source.getAttribute('style'); await page.keyboard.press('ArrowRight');
  await expect(source).not.toHaveAttribute('style', position!);
  await page.getByRole('button', { name: '应用到数据', exact: true }).click();
  await expect(page.getByRole('button', { name: '已应用', exact: true })).toBeVisible();
  await page.screenshot({ path: 'artifacts/nodes-workbench-desktop.png' });
  await page.reload(); await expect(page.locator('.react-flow__node')).toHaveCount(5);
  await page.setViewportSize({ width: 390, height: 844 });
  await expect.poll(() => page.locator('.graph-canvas').evaluate(element => {
    const bounds = element.getBoundingClientRect();
    return [...element.querySelectorAll('.react-flow__node')].some(node => { const box = node.getBoundingClientRect(); return box.width > 20 && box.left >= bounds.left && box.right <= bounds.right && box.top >= bounds.top && box.bottom <= bounds.bottom; });
  })).toBe(true);
  await page.screenshot({ path: 'artifacts/nodes-workbench-mobile.png' });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
  expect(errors).toEqual([]);
});

test('netlist to pin mapping to code and feedback draft remains bound to its project', async ({ page, request }) => {
  const original = await (await request.get('/api/ai/state')).json();
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'signaldesk-hardware-ui-'));
  await fs.writeFile(path.join(directory, 'sensor.py'), 'import math\n\ndef sample_voltage(raw):\n    return raw * 3.3 / 4095\n');
  const xml = '<export><components><comp ref="U1"><value>STM32 fixture</value></comp><comp ref="J1"><value>Sensor</value></comp></components><nets><net code="1" name="ADC_IN"><node ref="U1" pin="12" pinfunction="PA0"/><node ref="J1" pin="1"/></net></nets></export>';
  try {
    await request.post('/api/ai/config', { data: { root: directory } });
    await page.goto('/?view=hardware');
    await page.getByLabel('KiCad 网表文件').setInputFiles({ name: 'board.xml', mimeType: 'application/xml', buffer: Buffer.from(xml) });
    await expect(page.locator('.hardware-summary')).toContainText('2 个器件');
    await page.getByRole('button', { name: '绑定 U1.12', exact: true }).click();
    await page.getByLabel('硬件信号名称').fill('传感器电压'); await page.getByLabel('GPIO 标号').fill('PA0');
    await page.getByLabel('硬件数据通道').selectOption('0'); await page.getByLabel('硬件信号单位').fill('V');
    await page.getByLabel('硬件信号下限').fill('0'); await page.getByLabel('硬件信号上限').fill('3.3');
    await page.getByLabel('硬件关联源码').fill('sensor.py'); await page.getByLabel('硬件源码行号').fill('3');
    await page.getByRole('button', { name: '保存映射', exact: true }).click();
    await expect(page.getByRole('button', { name: '保存映射', exact: true })).toBeDisabled();
    await page.getByRole('button', { name: '实时电路图', exact: true }).click();
    await expect(page.locator('.circuit-component')).toHaveCount(2);
    await page.screenshot({ path: 'artifacts/hardware-live-map.png' });
    await page.getByRole('button', { name: '引脚与源码', exact: true }).click();
    await page.locator('summary').filter({ hasText: '参数下发与反馈测试' }).click();
    await page.getByLabel('硬件测试命令').fill('SET RATE 10'); await page.getByLabel('硬件测试确认响应').fill('OK');
    await page.getByLabel('硬件测试反馈信号').selectOption({ label: '传感器电压' });
    const sent = (await (await request.get('/api/state')).json()).txBytes;
    await page.getByRole('button', { name: '生成测试草稿', exact: true }).click();
    await expect(page).toHaveURL(/view=automation/); await expect(page.locator('.cm-content')).toContainText('SET RATE 10');
    expect((await (await request.get('/api/state')).json()).txBytes).toBe(sent);
    await page.goto('/?view=hardware'); await expect(page.locator('.hardware-workbench')).toContainText('传感器电压');
    await page.getByRole('button', { name: 'sensor.py:3', exact: true }).click();
    await expect(page.getByLabel('源码语言')).toContainText('Python / MicroPython');
    await expect(page.locator('.cm-content')).toContainText('sample_voltage');
    expect(await page.locator('.cm-content span[style], .cm-content span[class]').count()).toBeGreaterThan(4);
    await page.screenshot({ path: 'artifacts/python-source-workspace.png' });
  } finally { await request.post('/api/ai/config', { data: original.config }); await fs.rm(directory, { recursive: true, force: true, maxRetries: 3 }); }
});
