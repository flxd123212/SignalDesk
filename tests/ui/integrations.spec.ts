import { clickWorkbench } from './workbench-actions';
import { expect, test } from '@playwright/test';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

test('external Agent permission switches control actual API access and can revoke a token', async ({ page, request }) => {
  const original = await (await request.get('/api/ai/state')).json();
  let connection = '', session = '';
  try {
    await page.goto('/'); await clickWorkbench(page, '外部 Agent');
    await expect(page.getByLabel('创建权限：直接写入源码', { exact: true })).not.toBeChecked();
    await expect(page.getByLabel('创建权限：直接发送设备指令', { exact: true })).not.toBeChecked();
    await page.getByLabel('外部 Agent 名称').fill('UI scoped client');
    const response = page.waitForResponse(response => response.url().endsWith('/api/external/create'));
    await page.getByRole('button', { name: '创建连接令牌', exact: true }).click();
    const result = await (await response).json(); connection = result.connection.id; session = result.connection.session;
    expect(result.connection.expiresAt).toBeUndefined(); await expect(page.getByLabel('外部令牌有效期')).toHaveCount(0);
    const headers = { Authorization: `Bearer ${result.token}` };
    const tools = await (await request.get('/api/external/tools', { headers })).json();
    expect(tools.some((tool: { name: string }) => tool.name === 'run_toolchain')).toBe(false);
    expect((await request.post('/api/external/call', { headers, data: { tool: 'run_toolchain', arguments: { commandLine: 'cmake --version' } } })).status()).toBe(403);
    await page.getByLabel('UI scoped client 权限：执行工具链命令', { exact: true }).click();
    await expect(page.getByLabel('UI scoped client 权限：执行工具链命令', { exact: true })).toBeChecked();
    await expect.poll(async () => (await (await request.get('/api/external/tools', { headers })).json()).some((tool: { name: string }) => tool.name === 'run_toolchain')).toBe(true);
    await page.getByLabel('外部连接配置格式').selectOption('json');
    await expect(page.locator('.connection-config')).toContainText('mcpServers');
    await page.locator('.external-connection').getByRole('button', { name: '断开', exact: true }).click();
    await expect(page.locator('.external-connection')).toContainText('已断开');
    expect((await request.get('/api/external/tools', { headers })).status()).toBe(401);
    await page.locator('.external-connection').getByRole('button', { name: '连接', exact: true }).click();
    await expect(page.locator('.external-connection').getByRole('button', { name: '断开', exact: true })).toBeVisible();
    expect((await request.get('/api/external/tools', { headers })).status()).toBe(200);
    await page.getByRole('button', { name: '撤销 UI scoped client', exact: true }).click();
    await expect(page.locator('.external-connection')).toHaveCount(0);
    expect((await request.get('/api/external/tools', { headers })).status()).toBe(401);
    await page.screenshot({ path: 'artifacts/external-agents-desktop.png', fullPage: true });
    await page.setViewportSize({ width: 390, height: 844 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
  } finally {
    if (connection) await request.post('/api/external/update', { data: { id: connection, revoke: true } });
    await request.post('/api/ai/sessions/select', { data: { id: original.sessionId } });
    if (session) await request.post('/api/ai/sessions/close', { data: { id: session } });
  }
});

test('installed Keil and IAR paths populate; Keil project metadata and flash preview are inspectable without flashing', async ({ page, request }) => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'signaldesk-keil-ui-'));
  const original = await (await request.get('/api/ai/state')).json();
  const tools = await (await request.get('/api/toolchains')).json();
  const xml = '<Project><Targets><Target><TargetName>Test Target</TargetName><TargetOption><TargetCommonOption><Device>STM32F407VG</Device><Vendor>STMicroelectronics</Vendor><OutputDirectory>Objects</OutputDirectory><OutputName>test</OutputName><CreateHexFile>1</CreateHexFile></TargetCommonOption></TargetOption><Groups><Group><Files><File><FileName>main.c</FileName><FilePath>main.c</FilePath></File></Files></Group></Groups></Target></Targets></Project>';
  await fs.writeFile(path.join(directory, 'test.uvprojx'), xml);
  await fs.mkdir(path.join(directory, 'Objects')); await fs.writeFile(path.join(directory, 'Objects', 'test.axf'), 'UI TEST ONLY. NOT FIRMWARE.');
  await fs.writeFile(path.join(directory, 'test.ewp'), '<project><configuration><name>Debug</name><toolchain><name>8051</name></toolchain></configuration></project>');
  try {
    await request.post('/api/ai/config', { data: { root: directory } });
    await page.goto('/'); await clickWorkbench(page, '芯片与固件');
    await expect(page.getByLabel('Keil 工程文件', { exact: true })).toHaveValue('test.uvprojx');
    await expect(page.getByLabel('Keil Target', { exact: true })).toHaveValue('Test Target');
    await expect(page.locator('.keil-section')).toContainText('STM32F407VG');
    if (tools.keilExecutable) {
      await expect(page.getByLabel('Keil 工具路径')).toHaveValue(tools.keilExecutable);
      await page.getByRole('button', { name: '预览 Keil 烧录', exact: true }).click();
      await expect(page.locator('.keil-section .flash-confirm')).toContainText('"-f"');
      await expect(page.getByRole('button', { name: '确认 Keil 写入', exact: true })).toBeDisabled();
    }
    await expect(page.getByLabel('IAR 工程文件')).toHaveValue('test.ewp');
    await expect(page.getByLabel('IAR 配置', { exact: true })).toHaveValue('Debug');
    if (tools.iarExecutable) await expect(page.getByLabel('IAR 工具路径')).toHaveValue(tools.iarExecutable);
    await page.locator('.keil-section').scrollIntoViewIfNeeded();
    await page.screenshot({ path: 'artifacts/keil-desktop.png', fullPage: true });
    await page.setViewportSize({ width: 390, height: 844 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
  } finally {
    await request.post('/api/ai/config', { data: original.config });
    await fs.rm(directory, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 });
  }
});
