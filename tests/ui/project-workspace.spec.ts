import { clickWorkbench } from './workbench-actions';
import { test as base, expect } from '@playwright/test';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { SerialPortMock } from 'serialport';
import { startServer } from '../../server/index.mjs';

const test = base.extend<{ project: { root: string; url: string; runtime: Awaited<ReturnType<typeof startServer>>; call: (route: string, data?: object) => Promise<any> } }>({
  project: async ({}, use) => {
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'signaldesk-onboarding-ui-')), root = path.join(directory, 'S3-Telemetry');
    await fs.mkdir(path.join(root, 'src'), { recursive: true });
    await fs.writeFile(path.join(root, 'platformio.ini'), '[platformio]\ndefault_envs = telemetry\n[env:telemetry]\nboard = esp32-s3-devkitc-1\nmonitor_speed = 230400\n');
    await fs.writeFile(path.join(root, 'src', 'main.cpp'), `#include <Arduino.h>

constexpr uint32_t kSamplePeriodUs = 5000;
uint32_t previousSampleUs = 0;
uint32_t sampleCount = 0;

void setup() {
  Serial.begin(230400);
  previousSampleUs = micros();
}

void loop() {
  const uint32_t now = micros();
  if (uint32_t(now - previousSampleUs) < kSamplePeriodUs) return;
  previousSampleUs = now;

  const float seconds = sampleCount++ * (kSamplePeriodUs / 1000000.0f);
  const float voltage = 1.65f + 0.8f * sinf(2.0f * PI * seconds);
  const float current = 0.4f + 0.1f * cosf(2.0f * PI * seconds);

  Serial.print(voltage, 4);
  Serial.print(",");
  Serial.println(current, 4);
}
`);
    SerialPortMock.binding.createPort('COM88', { echo: false, record: true });
    const runtime = await startServer({ port: 0, directory: path.join(directory, 'data', 'sessions'), autoDemo: false, Port: SerialPortMock, listPorts: async () => [{ path: 'COM88', vendorId: '303a', productId: '1001', serialNumber: 'ui-s3-001', friendlyName: 'ESP32-S3' }] });
    const call = async (route: string, data?: object) => { const response = await fetch(`${runtime.address}/api${route}`, data ? { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data) } : {}); const json = await response.json(); if (!response.ok) throw new Error(JSON.stringify(json)); return json; };
    try { await use({ root, url: runtime.address, runtime, call }); }
    finally { await runtime.close(); await fs.rm(directory, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }); }
  },
});

test('project import configures serial, source, toolchain and Agent with no secret exposure', async ({ page, project }) => {
  const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
  await project.call('/ai/config', { model: 'fixture-model', apiStyle: 'chat', apiKey: 'ui-project-secret' });
  await page.goto(project.url); await expect(page.locator('.app-shell')).toHaveAttribute('data-ready', 'true'); await expect(page.locator('#signaldesk-startup')).not.toBeVisible();
  await page.getByRole('button', { name: '添加项目', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: '添加项目' });
  await dialog.getByLabel('导入工程路径').fill(project.root);
  await dialog.getByRole('button', { name: '识别项目', exact: true }).click();
  await expect(dialog.getByLabel('项目匹配串口')).toHaveValue('COM88');
  await expect(dialog).toContainText('ESP32-S3-DevKitC-1');
  await expect(dialog).toContainText('src/main.cpp');
  await page.screenshot({ path: 'artifacts/ide-project-setup.png', fullPage: true });
  await dialog.getByRole('button', { name: '添加并连接 COM88', exact: true }).click();
  await expect(dialog).toHaveCount(0);
  await expect(page.getByRole('tab')).toHaveCount(2);
  await expect(page.locator('.project-quickbar')).toContainText('230400');
  const state = await project.call('/state');
  expect(state.connected).toBe(true); expect(state.config.path).toBe('COM88'); expect(state.config.protocol).toBe('firewater');
  expect(state.devices.find((item: any) => item.id === state.activeDevice).projectRoot).toBe(project.root);
  project.runtime.engine.receive(Buffer.from(Array.from({ length: 1200 }, (_, i) => `${1.5 + Math.sin(i / 22)},${2 + Math.cos(i / 25)},1.8\n`).join('')));
  await page.getByLabel('筛选项目文件').fill('main.cpp');
  await page.getByRole('button', { name: '打开文件 src/main.cpp', exact: true }).click();
  await expect(page.locator('.cm-content')).toContainText('Serial.begin(230400)');
  await expect(page.locator('.cm-content')).toHaveAttribute('contenteditable', 'false');
  await expect(page.locator('.project-quickbar')).not.toBeVisible();
  await expect(page.locator('.send-bar')).not.toBeVisible();
  await page.getByRole('button', { name: '搜索与跳转源码', exact: true }).click();
  await page.getByLabel('搜索源码').fill('loop'); await page.getByLabel('搜索源码').press('Enter');
  await expect(page.getByLabel('跳转源码行')).toHaveValue('12');
  await page.getByRole('button', { name: '交给 Agent 审查', exact: true }).click();
  const agent = page.getByRole('complementary', { name: '属性与 Agent 面板' });
  await expect(agent.getByLabel('Agent 分析请求')).toContainText('src/main.cpp');
  await expect(agent.getByLabel('附带当前文件')).toBeChecked();
  await agent.getByRole('button', { name: '项目体检', exact: true }).click();
  await expect(agent.locator('.agent-message.assistant')).toContainText('项目体检');
  await expect(agent.locator('.agent-message.assistant')).toContainText('未调用模型或验证接口');
  await expect(agent.locator('.agent-session-bar')).toBeVisible();
  await expect(agent.getByRole('button', { name: '启动子代理', exact: true })).not.toBeVisible();
  await agent.getByRole('button', { name: '展开会话与分析设置', exact: true }).click();
  await expect(agent.getByLabel('Agent 会话', { exact: true })).toBeVisible();
  await expect(agent.getByRole('button', { name: '启动子代理', exact: true })).toBeVisible();
  await agent.getByRole('button', { name: '收起会话与分析设置', exact: true }).click();
  await page.getByRole('button', { name: '搜索与跳转源码', exact: true }).click();
  await expect(page.locator('.source-workspace')).toHaveCSS('min-height', '0px');
  expect((await page.locator('.source-workspace').boundingBox())!.height).toBeGreaterThan(650);
  if (await page.getByRole('button', { name: '关闭消息', exact: true }).isVisible()) await page.getByRole('button', { name: '关闭消息', exact: true }).click();
  await page.screenshot({ path: 'artifacts/ide-source-agent.png', fullPage: true });
  await clickWorkbench(page, '打开底部工具面板');
  await page.locator('.dock-tabs').getByRole('button', { name: '工具链', exact: true }).click();
  await expect(page.locator('.bottom-dock').getByLabel('工具链命令', { exact: true })).toHaveValue('platformio run -e "telemetry"');
  await page.screenshot({ path: 'artifacts/ide-source-output.png', fullPage: true });
  await page.getByRole('button', { name: '收起底部面板', exact: true }).click();
  await page.getByRole('separator', { name: '调整属性与 Agent 面板宽度' }).press('ArrowLeft');
  await expect(page.getByRole('separator', { name: '调整属性与 Agent 面板宽度' })).toHaveAttribute('aria-valuenow', '376');
  await expect(page.locator('body')).not.toContainText('ui-project-secret');
  await page.getByRole('button', { name: '视图', exact: true }).click();
  await expect(page.getByRole('menu', { name: '视图菜单' })).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('button', { name: '视图', exact: true })).toBeFocused();
  expect(JSON.stringify(await project.call('/ai/state'))).not.toContain('ui-project-secret');
  expect((await project.call('/ai/state')).config.model).toBe('fixture-model');
  expect(errors).toEqual([]);
});

test('IDE source navigation highlights C++, folds functions and opens files by keyboard', async ({ page, project }) => {
  await fs.appendFile(path.join(project.root, 'src/main.cpp'), '\n// Sampling remains non-blocking.\n');
  const plan = await project.call('/projects/prepare', { root: project.root });
  await project.call('/projects/apply', { id: plan.id, targetId: plan.targets[0].id, reuseAI: false });
  await page.goto(project.url); await expect(page.locator('.app-shell')).toHaveAttribute('data-ready', 'true'); await expect(page.locator('#signaldesk-startup')).not.toBeVisible();
  await page.keyboard.press('Control+p');
  await expect(page.getByRole('dialog', { name: '快速打开文件' })).toBeVisible();
  await page.getByRole('combobox', { name: '搜索项目文件' }).fill('main.cpp:12');
  await expect(page.getByRole('dialog', { name: '快速打开文件' }).getByRole('option')).toHaveCount(1);
  await expect(page.getByRole('dialog', { name: '快速打开文件' }).getByRole('option')).toContainText('src/main.cpp');
  await page.getByRole('combobox', { name: '搜索项目文件' }).press('Enter');
  await expect(page.getByLabel('跳转源码行')).toHaveValue('12');
  await expect(page.locator('.cm-activeLine')).toContainText('void loop');
  await expect(page.locator('.explorer-opened')).toContainText('main.cpp');
  await expect(page.locator('.explorer-outline')).toContainText('setup');
  await expect(page.locator('.explorer-outline')).toContainText('loop');
  const palette = await page.locator('.source-workspace .cm-line span').evaluateAll(elements => [...new Set(elements.map(element => getComputedStyle(element).color))]);
  expect(palette).toContain('rgb(134, 189, 245)');
  expect(palette).toContain('rgb(185, 217, 155)');
  expect(palette.length).toBeGreaterThanOrEqual(5);
  await page.locator('.cm-foldGutter [title="Fold line"]').first().click();
  await expect(page.locator('.cm-foldPlaceholder')).toBeVisible();
  await page.locator('.cm-foldPlaceholder').click({ timeout: 5000 });
  await expect(page.locator('.cm-foldPlaceholder')).toHaveCount(0);
  await page.getByRole('button', { name: '跳转到 setup，第 7 行', exact: true }).click();
  await expect(page.getByLabel('跳转源码行')).toHaveValue('7');
  await page.keyboard.press('Control+b'); await expect(page.locator('.ide-sidebar')).not.toBeVisible();
  await page.keyboard.press('Control+b'); await expect(page.locator('.ide-sidebar')).toBeVisible();
  await page.keyboard.press('Control+j'); await expect(page.locator('.bottom-dock')).toBeVisible();
  await page.keyboard.press('Control+j'); await expect(page.locator('.bottom-dock')).toHaveCount(0);
  await page.getByRole('button', { name: '交给 Agent 审查', exact: true }).click();
  await page.getByRole('button', { name: '搜索与跳转源码', exact: true }).click();
  await page.screenshot({ path: 'artifacts/ide-source-highlighted.png', fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
  await page.getByRole('button', { name: '关闭 Agent 面板', exact: true }).click();
  await page.keyboard.press('Control+p'); await page.getByRole('combobox', { name: '搜索项目文件' }).fill('main.cpp');
  await page.screenshot({ path: 'artifacts/ide-quick-file-mobile.png', fullPage: true });
  await page.keyboard.press('Escape');
});

test('simple mode preserves full layout, exposes instruments on demand and fits mobile', async ({ page, project }) => {
  await project.call('/connect', { path: 'demo' });
  await page.goto(project.url); await expect(page.locator('.app-shell')).toHaveAttribute('data-ready', 'true'); await expect(page.locator('#signaldesk-startup')).not.toBeVisible();
  await clickWorkbench(page, '精简模式');
  await expect(page.locator('.connection-sidebar')).not.toBeVisible();
  await expect(page.locator('.measure-panel')).not.toBeVisible();
  await expect(page.getByRole('navigation').getByRole('button', { name: '节点编排', exact: true })).toHaveCount(0);
  await page.getByRole('button', { name: '展开示波器设置', exact: true }).click();
  await expect(page.locator('.measure-panel')).toBeVisible();
  await page.getByRole('button', { name: '收起示波器设置', exact: true }).click();
  await expect(page.locator('.uplot canvas')).toBeVisible();
  await expect.poll(async () => (await project.call('/state')).frames).toBeGreaterThan(500);
  await page.screenshot({ path: 'artifacts/ide-simple-desktop.png', fullPage: true });
  await page.reload(); await expect(page.locator('.app-shell')).toHaveClass(/simple-mode/);
  await clickWorkbench(page, '完整模式');
  await expect(page.locator('.ide-sidebar')).toBeVisible();
  await expect(page.locator('.measure-panel')).toBeVisible();
  await clickWorkbench(page, '展开 Agent 分栏');
  await clickWorkbench(page, '打开底部工具面板');
  await clickWorkbench(page, '精简模式');
  await expect(page.locator('.agent-dock')).toHaveCount(0);
  await expect(page.locator('.bottom-dock')).toHaveCount(0);
  await page.getByRole('button', { name: '打开功能搜索', exact: true }).click();
  await page.getByRole('combobox', { name: '查找功能或设备' }).fill('keil');
  await page.getByRole('combobox', { name: '查找功能或设备' }).press('Enter');
  await expect(page.getByRole('heading', { name: '芯片与固件', exact: true })).toBeVisible();
  await clickWorkbench(page, '实时监测');
  await page.getByRole('button', { name: '暂停波形', exact: true }).click();
  await clickWorkbench(page, '项目源码');
  await clickWorkbench(page, '实时监测');
  await expect(page.locator('.live-chip')).toContainText('HOLD');
  await page.getByRole('button', { name: '继续波形', exact: true }).click();
  for (const viewport of [{ width: 1024, height: 768 }, { width: 390, height: 844 }]) {
    await page.setViewportSize(viewport);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
    await expect(page.locator('.uplot canvas')).toBeVisible();
  }
  await page.screenshot({ path: 'artifacts/ide-simple-mobile.png', fullPage: true });
  await page.getByRole('button', { name: '添加项目', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: '添加项目' });
  await dialog.getByLabel('导入工程路径').fill(project.root); await dialog.getByRole('button', { name: '识别项目', exact: true }).click();
  await expect(dialog.getByLabel('项目匹配串口')).toHaveValue('COM88');
  await page.screenshot({ path: 'artifacts/ide-project-mobile.png', fullPage: true });
  expect(await dialog.evaluate(element => element.scrollWidth <= element.clientWidth + 1)).toBe(true);
});

test('offline project stays offline and source tabs and Agent tasks follow the device', async ({ page, project }) => {
  await page.goto(project.url); await expect(page.locator('.app-shell')).toHaveAttribute('data-ready', 'true'); await expect(page.locator('#signaldesk-startup')).not.toBeVisible(); const original = (await project.call('/state')).activeDevice;
  await page.getByRole('button', { name: '添加项目', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: '添加项目' });
  await dialog.getByLabel('导入工程路径').fill(project.root); await dialog.getByRole('button', { name: '识别项目', exact: true }).click();
  await dialog.getByLabel('项目匹配串口').selectOption('');
  await dialog.getByRole('button', { name: '添加项目', exact: true }).click();
  await expect(dialog).toHaveCount(0);
  expect((await project.call('/state')).config.path).toBe('unassigned');
  expect((await project.call('/state')).connected).toBe(false);
  await clickWorkbench(page, 'AI 与 Agent');
  await expect(page.getByLabel('固件源文件')).toHaveValue('src/main.cpp');
  await page.getByLabel('Agent 快捷任务').selectOption({ label: '通信排查' });
  await expect(page.getByLabel('Agent 分析请求')).toContainText('串口配置');
  expect((await project.call('/ai/state')).messages).toHaveLength(0);
  await clickWorkbench(page, '芯片与固件');
  await expect(page.getByLabel('烧录芯片型号')).toHaveValue('esp32s3');
  await expect(page.getByLabel('下载串口')).toHaveValue('');
  await page.getByRole('tab').first().click();
  await expect.poll(async () => (await project.call('/state')).activeDevice).toBe(original);
  await clickWorkbench(page, 'AI 与 Agent');
  await expect(page.getByLabel('固件源文件')).toHaveValue('SignalGenerator.ino');
  await expect(page.getByLabel('Agent 分析请求')).toHaveValue('');
});
