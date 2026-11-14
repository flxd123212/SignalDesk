import { test, expect } from '@playwright/test';
import { clickWorkbench } from './workbench-actions';

test('startup draws before the application bundle, reports readiness and remains skippable', async ({ page }) => {
  let release!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  await page.route('**/assets/index-*.js', async route => { await gate; await route.continue(); });
  try {
    await page.goto('/', { waitUntil: 'commit' });
    const startup = page.getByRole('dialog', { name: 'SignalDesk 启动', exact: true });
    await expect(startup).toBeVisible();
    await expect(startup).toHaveAttribute('data-state', 'loading');
    await expect(startup.locator('li[data-done=true]')).toHaveCount(0);
    await expect(startup.locator('.boot-trace').first()).toHaveCSS('animation-name', 'boot-trace-in');
    await expect(startup.getByRole('status')).toHaveText('正在加载工作台界面');
    await page.screenshot({ path: 'artifacts/startup-desktop.png', animations: 'disabled' });
    await page.setViewportSize({ width: 390, height: 844 });
    expect(await startup.evaluate(element => element.scrollWidth <= element.clientWidth)).toBe(true);
    await page.screenshot({ path: 'artifacts/startup-mobile.png', animations: 'disabled' });
    release();
    await expect(startup).not.toBeVisible();
    await expect(page.locator('html')).toHaveAttribute('data-boot', 'complete');
    await expect(page.getByRole('heading', { name: '实时监测', exact: true })).toBeVisible();
    await expect(page.locator('#signaldesk-startup li[data-done=true]')).toHaveCount(3);
    expect(await page.locator('dialog[open]').count()).toBe(0);
  } finally { release(); }
});

test('stalled startup offers recovery and Escape never traps the workspace', async ({ page }) => {
  let release!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  await page.route('**/assets/index-*.js', async route => { await gate; await route.continue(); });
  try {
    await page.goto('/', { waitUntil: 'commit' });
    const startup = page.getByRole('dialog', { name: 'SignalDesk 启动', exact: true });
    await expect(startup).toHaveAttribute('data-state', 'stalled', { timeout: 16000 });
    await expect(startup.getByRole('button', { name: '重新加载' })).toBeVisible();
    await expect(startup.getByRole('button', { name: '进入工作区' })).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(startup).not.toBeVisible();
    release();
    await expect(page.locator('.app-shell')).toBeVisible();
    await expect(page.getByRole('button', { name: '打开设置', exact: true })).toBeEnabled();
  } finally { release(); }
});

test('motion settings persist, preview works and cached acquisition survives page transitions', async ({ page, request }) => {
  await request.post('/api/connect', { data: { path: 'demo' } });
  await page.goto('/');
  await expect(page.locator('#signaldesk-startup')).not.toBeVisible();
  const canvas = page.locator('.uplot canvas');
  await expect(canvas).toBeVisible();
  await page.locator('.cached-workspace').evaluate(element => { (element as HTMLElement).dataset.motionProbe = 'retained'; });
  await page.getByRole('button', { name: '暂停波形', exact: true }).click();
  await clickWorkbench(page, 'AI 与 Agent');
  await clickWorkbench(page, '实时监测');
  await expect(page.locator('.cached-workspace')).toHaveAttribute('data-motion-probe', 'retained');
  await page.getByRole('button', { name: '继续波形', exact: true }).click();
  await expect.poll(() => page.locator('.page-content').evaluate(element => element.getAnimations().length)).toBe(0);
  const initial = await canvas.evaluate(element => (element as HTMLCanvasElement).toDataURL());
  await expect.poll(() => canvas.evaluate(element => (element as HTMLCanvasElement).toDataURL())).not.toBe(initial);
  await page.keyboard.press('Control+b');
  await expect(page.locator('.ide-sidebar')).not.toBeVisible();
  await page.keyboard.press('Control+b');
  await expect(page.locator('.ide-sidebar')).toHaveCSS('animation-name', 'panel-enter-left');
  await page.keyboard.press('Control+j');
  await expect(page.locator('.bottom-dock')).toHaveCSS('animation-name', 'panel-enter-up');
  await page.keyboard.press('Control+j');
  await page.keyboard.press('Control+,');
  const settings = page.getByRole('dialog', { name: '设置', exact: true });
  await settings.getByLabel('动画风格', { exact: true }).selectOption('subtle');
  await expect(page.locator('.app-shell')).toHaveAttribute('data-motion-style', 'subtle');
  await settings.getByLabel('启动动画', { exact: true }).uncheck();
  await page.screenshot({ path: 'artifacts/motion-settings.png', animations: 'disabled' });
  await settings.getByRole('button', { name: '预览启动动画', exact: true }).click();
  const preview = page.getByRole('dialog', { name: 'SignalDesk 启动', exact: true });
  await expect(preview).toBeVisible();
  await expect(preview.getByRole('status')).toHaveText('启动动画预览');
  await preview.getByRole('button', { name: '关闭预览', exact: true }).click();
  await expect(preview).not.toBeVisible();
  await page.reload();
  await expect(page.locator('.app-shell')).toHaveAttribute('data-motion-style', 'subtle');
  await expect(page.locator('#signaldesk-startup')).not.toBeVisible();
  await page.keyboard.press('Control+,');
  await expect(settings.getByLabel('启动动画', { exact: true })).not.toBeChecked();
  await settings.getByLabel('界面动画', { exact: true }).uncheck();
  await expect(settings).toHaveCSS('animation-name', 'none');
  await expect(settings.getByRole('button', { name: '预览启动动画', exact: true })).toBeDisabled();
  await page.keyboard.press('Escape');
  await clickWorkbench(page, 'AI 与 Agent');
  expect(await page.locator('.page-content').evaluate(element => element.getAnimations().length)).toBe(0);
  await page.reload();
  await expect(page.locator('.app-shell')).toHaveAttribute('data-motion', 'off');
  await expect(page.locator('#signaldesk-startup')).not.toBeVisible();
});

test('system reduced motion and detached windows bypass the intro', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto('/');
  await expect(page.locator('.app-shell')).toBeVisible();
  await expect(page.locator('#signaldesk-startup')).not.toBeVisible();
  await clickWorkbench(page, 'AI 与 Agent');
  expect(await page.locator('.page-content').evaluate(element => element.getAnimations().length)).toBe(0);
  await page.keyboard.press('Control+,');
  const settings = page.getByRole('dialog', { name: '设置', exact: true });
  await expect(settings).toHaveCSS('animation-name', 'none');
  await page.keyboard.press('Escape');
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await page.goto('/?view=terminal&detached=1');
  await expect(page.locator('.app-shell')).toBeVisible();
  await expect(page.locator('#signaldesk-startup')).not.toBeVisible();
});

test('changing system motion preference cancels an active startup animation', async ({ page }) => {
  let release!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  await page.route('**/assets/index-*.js', async route => { await gate; await route.continue(); });
  try {
    await page.goto('/', { waitUntil: 'commit' });
    await expect(page.locator('#signaldesk-startup')).toBeVisible();
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await expect(page.locator('#signaldesk-startup')).not.toBeVisible();
    release();
    await expect(page.locator('.app-shell')).toBeVisible();
    await expect(page.locator('html')).toHaveAttribute('data-boot', 'complete');
  } finally { release(); }
});
