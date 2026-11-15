import { test, expect } from '@playwright/test';

test('macOS uses Command labels and physical digit keys with Option', async ({ page }) => {
  await page.addInitScript(() => {
    Object.defineProperty(navigator, 'platform', { value: 'MacIntel' });
    localStorage.setItem('signaldesk.preferences.v1', JSON.stringify({ startupAnimation: false }));
  });
  await page.goto('/'); await expect(page.locator('.app-shell')).toHaveAttribute('data-ready', 'true');
  await page.getByRole('button', { name: '视图', exact: true }).click();
  await expect(page.getByRole('menuitem', { name: '硬件工作区', exact: true })).toContainText('Cmd+Option+2');
  await page.keyboard.press('Escape');
  await page.evaluate(() => window.dispatchEvent(new KeyboardEvent('keydown', { key: '@', code: 'Digit2', metaKey: true, altKey: true, bubbles: true })));
  await expect(page).toHaveURL(/view=hardware/);
  await page.keyboard.press('Meta+,'); await expect(page.getByRole('dialog', { name: '设置', exact: true })).toBeVisible();
  await page.keyboard.press('Escape'); await page.keyboard.press('Meta+k');
  await expect(page.getByRole('combobox', { name: '查找功能或设备' })).toBeVisible();
});
