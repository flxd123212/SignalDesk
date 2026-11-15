import { test, expect } from '@playwright/test';
import { clickWorkbench } from './workbench-actions';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { SerialPortMock } from 'serialport';
import { startServer } from '../../server/index.mjs';

test('hot plug opens a dialog across pages, updates removals, binds actual mock port and preserves projects', async ({ page }) => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'signaldesk-discovery-ui-'));
  const usb = { path: 'COM93', vendorId: '303a', productId: '1001', serialNumber: 'ui-discovery', friendlyName: 'ESP32-S3' };
  let ports: typeof usb[] = [];
  SerialPortMock.binding.createPort(usb.path, { record: true });
  const runtime = await startServer({ port: 0, directory: path.join(directory, 'sessions'), Port: SerialPortMock, listPorts: async () => ports });
  try {
    await page.goto(runtime.address); await expect(page.locator('.status-bar')).toContainText('未匹配串口');
    await clickWorkbench(page, 'AI 与 Agent');
    await page.locator('.header-right').getByRole('button', { name: '发现设备', exact: true }).click();
    const dialog = page.getByRole('dialog', { name: '发现设备', exact: true });
    await expect(dialog).toContainText('系统尚未提供可用串口');
    await dialog.getByRole('button', { name: '关闭设备发现', exact: true }).click();
    ports = [usb];
    await expect(dialog).toBeVisible(); await expect(dialog).toContainText('发现新设备'); await expect(dialog).toContainText('ESP32-S3');
    await expect(dialog.getByRole('listbox', { name: '发现的串口' }).getByRole('option')).toHaveCount(1);
    expect(runtime.engine.connected).toBe(false);
    await page.screenshot({ path: 'artifacts/discovered-device.png' });
    ports = []; await expect(dialog.getByRole('button', { name: '绑定并连接', exact: true })).toBeDisabled();
    await expect(dialog).toContainText('所选串口已移除');
    ports = [usb]; await expect(dialog.getByRole('button', { name: '绑定并连接', exact: true })).toBeEnabled();
    await dialog.getByLabel('发现设备绑定目标').selectOption('new');
    await dialog.getByRole('button', { name: '绑定并连接', exact: true }).click(); await expect(dialog).toHaveCount(0);
    await expect.poll(() => runtime.engine.config.path).toBe('COM93'); expect(runtime.engine.txBytes).toBe(0);
    expect(runtime.engine.connected).toBe(true); expect(runtime.engine.devices.size).toBe(2);
    await runtime.engine.disconnect();
    ports = []; await expect.poll(() => runtime.discovery.snapshot.ports.length).toBe(0);
    ports = [usb]; await expect(dialog).toBeVisible();
    await dialog.getByLabel('插入新串口时弹窗').uncheck();
    await dialog.getByRole('button', { name: '关闭设备发现', exact: true }).click();
    ports = []; await expect.poll(() => runtime.discovery.snapshot.ports.length).toBe(0);
    ports = [usb]; await expect.poll(() => runtime.discovery.snapshot.ports.length).toBe(1);
    await expect(dialog).toHaveCount(0);
    await page.setViewportSize({ width: 390, height: 844 });
    await page.locator('.header-right').getByRole('button', { name: '发现设备', exact: true }).click(); await expect(dialog).toBeVisible();
    expect(await dialog.evaluate(element => element.scrollWidth <= element.clientWidth + 1)).toBe(true);
    await page.screenshot({ path: 'artifacts/discovered-device-mobile.png' });
  } finally { await page.close(); await runtime.close(); await fs.rm(directory, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }); }
});

test('hot plug defers behind settings and disconnected duplicate windows do not auto-prompt', async ({ page }) => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'signaldesk-discovery-defer-'));
  let ports: { path: string }[] = [];
  const runtime = await startServer({ port: 0, directory: path.join(directory, 'sessions'), listPorts: async () => ports });
  try {
    await page.goto(runtime.address); await page.getByRole('button', { name: '打开设置', exact: true }).click();
    ports = [{ path: 'COM94' }]; await expect.poll(() => runtime.discovery.snapshot.ports.length).toBe(1);
    const dialog = page.getByRole('dialog', { name: '发现设备', exact: true }); await expect(dialog).toHaveCount(0);
    await page.getByRole('button', { name: '关闭设置', exact: true }).click(); await expect(dialog).toBeVisible();
    await expect(dialog).toContainText('未确认'); await dialog.getByRole('button', { name: '关闭设备发现', exact: true }).click();
    await page.goto(runtime.address + '/?detached=1&view=terminal');
    ports = []; await expect.poll(() => runtime.discovery.snapshot.ports.length).toBe(0);
    ports = [{ path: 'COM95' }]; await expect.poll(() => runtime.discovery.snapshot.ports.length).toBe(1);
    await expect(dialog).toHaveCount(0);
  } finally { await page.close(); await runtime.close(); await fs.rm(directory, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }); }
});
