import { clickWorkbench } from './workbench-actions';
import { expect, test } from '@playwright/test';
import fs from 'node:fs/promises';

test.beforeEach(async ({ request }) => {
  await request.post('/api/connect', { data: { path: 'demo' } });
  await request.post('/api/processing', { data: { mode: 'raw' } });
});

test('function search supports keyboard navigation, device search and browser history', async ({ page, request }) => {
  await page.goto('/');
  await expect(page.locator('#signaldesk-startup')).not.toBeVisible();
  await page.keyboard.press('Control+k');
  const search = page.getByRole('combobox', { name: '查找功能或设备' });
  await expect(search).toBeFocused();
  await search.fill('fft');
  await expect(page.getByRole('listbox', { name: '搜索结果' }).getByRole('option')).toHaveCount(1);
  await search.fill('keil');
  await search.dispatchEvent('keydown', { key: 'Enter', code: 'Enter', isComposing: true });
  await expect(page.getByRole('dialog', { name: '查找功能或设备' })).toBeVisible();
  await page.screenshot({ path: 'artifacts/studio-search.png' });
  await search.press('Enter');
  await expect(page.getByRole('heading', { name: '芯片与固件', exact: true })).toBeVisible();
  await expect(page).toHaveURL(/view=chips/);
  await page.goBack();
  await expect(page.getByRole('heading', { name: '实时监测', exact: true })).toBeVisible();
  const device = (await (await request.get('/api/state')).json()).devices[0];
  await page.getByRole('button', { name: '打开功能搜索' }).click();
  await search.fill(device.name);
  await expect(page.getByRole('listbox', { name: '搜索结果' }).getByRole('option')).toContainText(device.name);
  await search.press('Escape');
  await expect(page.getByRole('dialog', { name: '查找功能或设备' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: '打开功能搜索' })).toBeFocused();
});

test('workspace layout toggles persist and return space to the live chart', async ({ page }) => {
  await page.goto('/');
  await expect.poll(async () => Number((await page.locator('.plot-footer').innerText()).match(/([\d,]+) frames/)?.[1].replaceAll(',', '') || 0), { timeout: 20000 }).toBeGreaterThan(1050);
  await expect(page.locator('.uplot canvas')).toBeVisible();
  const before = await page.locator('.uplot canvas').boundingBox();
  await page.getByRole('button', { name: '收起侧栏', exact: true }).click();
  await page.getByRole('button', { name: '收起终端', exact: true }).click();
  await expect(page.locator('.connection-sidebar')).not.toBeVisible();
  await expect(page.locator('.terminal-log')).not.toBeVisible();
  await expect.poll(async () => (await page.locator('.uplot canvas').boundingBox())?.width || 0).toBeGreaterThan(before!.width);
  await expect.poll(async () => (await page.locator('.uplot canvas').boundingBox())?.height || 0).toBeGreaterThan(before!.height);
  await page.screenshot({ path: 'artifacts/studio-focused.png', fullPage: true });
  await page.reload();
  await expect(page.locator('.connection-sidebar')).not.toBeVisible();
  await expect(page.getByRole('button', { name: '展开终端', exact: true })).toBeVisible();
  await page.getByRole('button', { name: '展开终端', exact: true }).click();
  await expect(page.locator('.terminal-log')).toBeVisible();
  await clickWorkbench(page, '展开连接设置');
  await expect(page.getByRole('button', { name: '断开连接', exact: true })).toBeVisible();
});

test('device drafts and successful history stay isolated and IME enter never sends', async ({ page, request }) => {
  const original = (await (await request.get('/api/state')).json()).activeDevice;
  let added = '';
  try {
    await page.goto('/');
    await expect(page.locator('.app-shell')).toHaveAttribute('data-ready', 'true');
    await expect(page.locator('#signaldesk-startup')).not.toBeVisible();
    const input = page.getByLabel('发送内容', { exact: true });
    await input.fill('*IDN?');
    const before = (await (await request.get('/api/state')).json()).txBytes;
    await input.dispatchEvent('keydown', { key: 'Enter', code: 'Enter', isComposing: true });
    await expect(input).toHaveValue('*IDN?');
    expect((await (await request.get('/api/state')).json()).txBytes).toBe(before);
    await page.getByRole('button', { name: '发送', exact: true }).click();
    await expect(page.getByLabel('最近发送记录')).toBeEnabled();
    await input.fill('FIRST DEVICE DRAFT');
    await page.getByRole('button', { name: '添加设备', exact: true }).click();
    await expect(page.getByRole('tab')).toHaveCount(2);
    added = (await (await request.get('/api/state')).json()).activeDevice;
    await expect(input).toHaveValue('AT');
    await expect(page.getByLabel('最近发送记录')).toBeDisabled();
    await input.fill('02 FF');
    await page.getByLabel('发送格式', { exact: true }).selectOption('hex');
    await page.getByRole('tab').first().click();
    await expect(input).toHaveValue('FIRST DEVICE DRAFT');
    await expect(page.getByLabel('发送格式', { exact: true })).toHaveValue('text');
    const sent = (await (await request.get('/api/state')).json()).txBytes;
    await page.getByLabel('最近发送记录').selectOption('0');
    await expect(input).toHaveValue('*IDN?');
    expect((await (await request.get('/api/state')).json()).txBytes).toBe(sent);
    await page.getByRole('tab').nth(1).click();
    await expect(input).toHaveValue('02 FF');
    await expect(page.getByLabel('发送格式', { exact: true })).toHaveValue('hex');
    await expect(page.getByLabel('最近发送记录')).toBeDisabled();
  } finally {
    if (added) await request.post('/api/devices/remove', { data: { id: added } });
    await request.post('/api/devices/select', { data: { id: original } });
  }
});

test('paused CSV and channel readouts stay frozen while live sampling continues', async ({ page, request }) => {
  await page.goto('/');
  await expect.poll(async () => (await (await request.get('/api/state')).json()).frames).toBeGreaterThan(300);
  await page.getByRole('button', { name: '暂停波形', exact: true }).click();
  await expect(page.locator('.live-chip')).toContainText('HOLD');
  const metric = (await page.locator('.metric-value').first().textContent())!;
  const exported = async () => {
    const download = page.waitForEvent('download');
    await page.getByRole('button', { name: '导出波形 CSV', exact: true }).click();
    const file = await download;
    return fs.readFile((await file.path())!, 'utf8');
  };
  const first = await exported();
  const frames = (await (await request.get('/api/state')).json()).frames;
  await expect.poll(async () => (await (await request.get('/api/state')).json()).frames).toBeGreaterThan(frames + 100);
  expect(await exported()).toBe(first);
  await expect(page.locator('.metric-value').first()).toHaveText(metric);
  expect(first.split('\n').length).toBeGreaterThan(100);
  await page.getByRole('button', { name: '继续波形', exact: true }).click();
  await expect(page.locator('.metric-value').first()).not.toHaveText(metric);
});

test('an in-flight file send cannot move to another selected device', async ({ page, request }) => {
  const initial = await (await request.get('/api/state')).json();
  const added = await (await request.post('/api/devices/add', { data: {} })).json();
  let release = () => {}, target = '';
  const gate = new Promise<void>(resolve => { release = resolve; });
  try {
    await request.post('/api/devices/select', { data: { id: initial.activeDevice } });
    await page.goto('/');
    await page.route('**/api/send', async route => { target = route.request().postDataJSON().deviceId; await gate; await route.continue(); });
    await expect(page.getByRole('button', { name: '发送', exact: true })).toBeEnabled();
    await page.locator('.send-bar input[type=file]').setInputFiles({ name: 'target-test.bin', mimeType: 'application/octet-stream', buffer: Buffer.from([0x12, 0x34]) });
    await expect.poll(() => target).toBe(initial.activeDevice);
    await page.getByRole('tab').nth(1).click();
    await expect.poll(async () => (await (await request.get('/api/state')).json()).activeDevice).toBe(added.activeDevice);
    release();
    await expect(page.locator('.toast[role=status]')).toContainText('当前设备已切换');
    const current = await (await request.get('/api/state')).json();
    expect(current.txBytes).toBe(0);
    expect(current.devices.find((device: { id: string }) => device.id === initial.activeDevice).txBytes).toBe(initial.txBytes);
  } finally {
    release(); await page.unrouteAll({ behavior: 'wait' });
    await request.post('/api/devices/remove', { data: { id: added.activeDevice } });
    await request.post('/api/devices/select', { data: { id: initial.activeDevice } });
  }
});
