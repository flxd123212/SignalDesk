import { test, expect } from '@playwright/test';

test('keyboard workflow respects dialogs, held keys and IME, and opens exactly one verification view', async ({ page }) => {
  await page.goto('/?view=editor');
  await expect(page.locator('.app-shell')).toHaveAttribute('data-ready', 'true');
  await expect(page.locator('#signaldesk-startup')).toBeHidden();
  let executions = 0;
  page.on('request', req => { if (req.url().endsWith('/validation/execute')) executions++; });
  await page.keyboard.press('Shift+F1');
  const help = page.getByRole('dialog', { name: '键盘快捷操作' });
  await help.getByRole('searchbox').fill('容量');
  await expect(help.getByRole('row')).toHaveCount(1);
  await expect(help.getByRole('row')).toContainText('Shift+F8');
  await page.keyboard.press('F7'); await expect(help).toBeVisible();
  await page.keyboard.press('Escape');
  await page.evaluate(() => {
    for (const init of [{ repeat: true }, { isComposing: true }]) window.dispatchEvent(new KeyboardEvent('keydown', { key: 'F7', bubbles: true, ...init }));
  });
  await page.keyboard.press('F6'); await expect(page.getByRole('dialog', { name: '发现设备' })).toBeVisible(); await page.keyboard.press('Escape');
  await page.keyboard.press('Control+Backquote'); await expect(page).toHaveURL(/view=terminal/);
  await page.keyboard.press('Shift+F8');
  const panel = page.getByRole('region', {name:'源码编译与测试'});
  await expect(panel.getByRole('button', {name:'容量', exact:true})).toHaveAttribute('aria-pressed','true');
  await page.keyboard.press('Control+Alt+4'); await expect(panel).toHaveCount(1);
  await page.keyboard.press('F8'); await expect(panel.getByRole('button', {name:/^问题 /})).toHaveAttribute('aria-pressed','true');
  await page.keyboard.press('Shift+F7'); await expect(panel.getByRole('button', {name:'输出', exact:true})).toHaveAttribute('aria-pressed','true');
  await page.keyboard.press('Control+Shift+p'); await expect(page.getByRole('combobox', {name:'查找功能或设备'})).toBeVisible();
  expect(executions).toBe(0);
});
