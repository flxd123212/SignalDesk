import { test, expect } from '@playwright/test';

test('display click baseline records, replays and detects an actual visual change', async ({ page }) => {
  await page.goto('/?view=display');
  const panel = page.locator('.screen-regression');
  await panel.locator('summary').click();
  await panel.getByRole('button', { name: '录制点击' }).click();
  const canvas = page.getByLabel('屏幕像素画布');
  const bounds = await canvas.boundingBox();
  expect(bounds).toBeTruthy();
  await canvas.click({ position: { x: bounds!.width * 0.78, y: bounds!.height * 0.8 } });
  await panel.getByRole('button', { name: '保存录制' }).click();
  await expect(panel).toContainText('已保存 1 步基准');
  await panel.getByRole('button', { name: '重放', exact: true }).click();
  await expect(panel).toContainText('设计器回放通过');
  await page.getByRole('button', { name: '返回设计' }).click();
  await page.getByLabel('画布底色').fill('#ffffff');
  await panel.getByRole('button', { name: '重放', exact: true }).click();
  await expect(panel).toContainText('个像素变化');
  await expect(panel.getByRole('img', { name: '变化像素' })).toBeVisible();
});
