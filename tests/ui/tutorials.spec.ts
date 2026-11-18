import { test, expect } from '@playwright/test';
import { tutorials } from '../../shared/tutorials.mjs';

async function ready(page: import('@playwright/test').Page, view = 'workspace') {
  await page.goto(`/?view=${view}`);
  await expect(page.locator('.app-shell')).toHaveAttribute('data-ready', 'true');
  await expect(page.locator('#signaldesk-startup')).not.toBeVisible();
}

test('first-run invitation is nonblocking, dismissible and tutorial progress survives reload', async ({ page }) => {
  const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
  const writes: string[] = []; page.on('request', request => { if (request.method() === 'POST') writes.push(request.url()); });
  await ready(page);
  await expect(page.getByRole('region', { name: '新手入门提示' })).toBeVisible();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await page.getByRole('button', { name: '开始入门', exact: true }).click();
  let help = page.getByRole('dialog', { name: '帮助与教程', exact: true });
  await expect(help).toBeVisible(); await expect(help.getByLabel('搜索教程')).toBeFocused();
  await help.getByRole('button', { name: '第 3 步：检查第一条报文', exact: true }).click();
  await expect(help.getByRole('article')).toContainText('乱码时先核对波特率');
  await page.screenshot({ path: 'artifacts/tutorials-desktop.png', fullPage: true });
  await page.keyboard.press('Escape'); await expect(help).toHaveCount(0);
  await page.reload(); await expect(page.locator('#signaldesk-startup')).not.toBeVisible();
  await expect(page.getByRole('region', { name: '新手入门提示' })).toHaveCount(0);
  await page.getByRole('button', { name: '打开功能搜索', exact: true }).focus();
  await page.keyboard.press('Control+k');
  await page.getByRole('combobox', { name: '查找功能或设备' }).fill('教程');
  await page.getByRole('combobox', { name: '查找功能或设备' }).press('Enter');
  help = page.getByRole('dialog', { name: '帮助与教程', exact: true });
  await expect(help.getByRole('button', { name: '第 3 步：检查第一条报文', exact: true })).toHaveAttribute('aria-current', 'step');
  await help.getByRole('button', { name: '下一步', exact: true }).click();
  await help.getByRole('button', { name: '完成教程', exact: true }).click();
  await expect(help.locator('.help-library-status')).toContainText(`已完成 1 / ${tutorials.length}`);
  await page.keyboard.press('Escape');
  await expect(page.getByRole('button', { name: '打开功能搜索', exact: true })).toBeFocused();
  await page.reload();
  const progress = await page.evaluate(() => JSON.parse(localStorage.getItem('signaldesk.preferences.v1') || '{}').tutorial);
  expect(progress.completed).toEqual(['first-device']); expect(progress.positions['first-device']).toBe(3);
  expect(writes).toEqual([]); expect(errors).toEqual([]);
});

test('tutorial actions open real settings and resume the same step without executing tools', async ({ page }) => {
  const writes: string[] = []; page.on('request', request => { if (request.method() === 'POST') writes.push(request.url()); });
  await ready(page, 'agent'); await page.keyboard.press('F1');
  let help = page.getByRole('dialog', { name: '帮助与教程', exact: true });
  await expect(help.getByRole('heading', { name: '安全使用 Agent', exact: true })).toBeVisible();
  await help.getByRole('button', { name: '打开 AI 接口设置', exact: true }).click();
  await expect(help).toHaveCount(0);
  const settings = page.getByRole('dialog', { name: '设置', exact: true });
  await expect(settings.getByRole('heading', { name: 'AI 接口', exact: true })).toBeVisible();
  await page.getByRole('button', { name: '关闭设置', exact: true }).click();
  await expect(page.getByRole('region', { name: '当前教程' })).toContainText('配置并测试接口');
  await page.getByRole('button', { name: '继续教程', exact: true }).click();
  help = page.getByRole('dialog', { name: '帮助与教程', exact: true });
  await help.getByRole('button', { name: '下一步', exact: true }).click();
  await help.getByRole('button', { name: '打开 Agent', exact: true }).click();
  await expect(page.getByRole('region', { name: '当前教程' })).toContainText('先进行只读审查');
  await expect(page.locator('.agent-console')).toBeVisible();
  await page.getByRole('button', { name: '结束本次引导', exact: true }).click();
  await expect(page.getByRole('region', { name: '当前教程' })).toHaveCount(0);
  expect(writes).toEqual([]);
});

test('context help, advanced search and narrow screens remain keyboard accessible with reduced motion', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await ready(page, 'can'); await page.keyboard.press('F1');
  const help = page.getByRole('dialog', { name: '帮助与教程', exact: true });
  await expect(help.getByRole('heading', { name: '仪器与 CAN 分析', exact: true })).toBeVisible();
  await help.getByLabel('搜索教程').fill('ASCII');
  await help.getByRole('navigation', { name: '选择教程' }).getByRole('button', { name: /^指令与协议测试/ }).click();
  await help.getByRole('button', { name: '第 2 步：混发文本与二进制', exact: true }).click();
  await expect(help.getByRole('article')).toContainText('AT[HEX:00 FF]END');
  await expect(help.locator('.help-step')).toHaveCSS('animation-name', 'none');
  for (const viewport of [{ width: 1024, height: 768 }, { width: 390, height: 844 }]) {
    await page.setViewportSize(viewport);
    expect(await help.evaluate(element => element.scrollWidth <= element.clientWidth + 1)).toBe(true);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
    await expect(help.getByRole('button', { name: '下一步', exact: true })).toBeInViewport();
  }
  await page.screenshot({ path: 'artifacts/tutorials-mobile.png', fullPage: true });
  await help.getByRole('button', { name: '关闭教程', exact: true }).click();
  await page.getByRole('button', { name: '打开设置', exact: true }).click();
  const settings = page.getByRole('dialog', { name: '设置', exact: true });
  await settings.getByRole('button', { name: '学习与帮助', exact: true }).click();
  await expect(settings.getByRole('checkbox', { name: '启动时显示入门提示' })).not.toBeChecked();
  await settings.getByRole('button', { name: '打开使用教程', exact: true }).click();
  await expect(help.getByRole('heading', { name: '指令与协议测试', exact: true })).toBeVisible();
});

test('the beginner path opens project import and switches to simple mode only on explicit action', async ({ page }) => {
  await ready(page); await page.getByRole('button', { name: '开始入门', exact: true }).click();
  let help = page.getByRole('dialog', { name: '帮助与教程', exact: true });
  await help.getByRole('button', { name: '添加项目', exact: true }).click();
  const setup = page.getByRole('dialog', { name: '添加项目', exact: true });
  await expect(setup.getByLabel('导入工程路径')).toBeVisible();
  await page.keyboard.press('Escape'); await expect(setup).toHaveCount(0);
  await page.getByRole('button', { name: '继续教程', exact: true }).click();
  help = page.getByRole('dialog', { name: '帮助与教程', exact: true });
  await help.getByRole('button', { name: '第 4 步：保持工作区清爽', exact: true }).click();
  await expect(page.locator('.app-shell')).not.toHaveClass(/simple-mode/);
  await help.getByRole('button', { name: '切换精简模式', exact: true }).click();
  await expect(page.locator('.app-shell')).toHaveClass(/simple-mode/);
  await page.getByRole('button', { name: '继续教程', exact: true }).click();
  await help.getByRole('button', { name: '完成教程', exact: true }).click();
  await help.getByRole('button', { name: '关闭教程', exact: true }).click();
  await expect(page.getByRole('region', { name: '当前教程' })).toHaveCount(0);
  await page.reload(); await expect(page.locator('.app-shell')).toHaveClass(/simple-mode/);
  await expect(page.getByRole('region', { name: '新手入门提示' })).toHaveCount(0);
});

test('legacy appearance imports and resetting the layout preserve learning progress', async ({ page }) => {
  await ready(page, 'editor'); await page.keyboard.press('F1');
  const help = page.getByRole('dialog', { name: '帮助与教程', exact: true });
  await help.getByRole('button', { name: '第 2 步：打开源码', exact: true }).click();
  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: '打开设置', exact: true }).click();
  const settings = page.getByRole('dialog', { name: '设置', exact: true });
  await settings.getByLabel('导入偏好文件').setInputFiles({ name: 'legacy-preferences.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify({ version: 1, preferences: { accent: '#87bfff', editorSize: 16 } })) });
  await expect(settings.getByRole('button', { name: '晴空蓝', exact: true })).toHaveAttribute('aria-pressed', 'true');
  const progress = () => page.evaluate(() => JSON.parse(localStorage.getItem('signaldesk.preferences.v1') || '{}').tutorial);
  expect((await progress()).positions['project-build']).toBe(1);
  await settings.getByRole('button', { name: '恢复默认布局', exact: true }).click();
  expect((await progress()).positions['project-build']).toBe(1);
  expect((await progress()).dismissed).toBe(true);
  await settings.getByRole('button', { name: '关闭设置', exact: true }).click();
  await page.keyboard.press('F1');
  await expect(help.getByRole('button', { name: '第 2 步：打开源码', exact: true })).toHaveAttribute('aria-current', 'step');
});
