import { expect, test } from '@playwright/test';

test('all seven reference models render detailed parts and work at narrow viewports', async ({ page }) => {
  test.setTimeout(120000);
  const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
  await page.goto('/?view=attitude&pose=manual'); await expect(page.getByLabel('开发板模型')).toHaveValue('esp32s3');
  const canvas = page.getByLabel('三维开发板姿态');
  const visiblePixels = () => canvas.evaluate((element: HTMLCanvasElement) => new Promise<number>(resolve => requestAnimationFrame(() => {
    const gl = element.getContext('webgl2')!, bytes = new Uint8Array(gl.drawingBufferWidth * gl.drawingBufferHeight * 4);
    gl.readPixels(0, 0, gl.drawingBufferWidth, gl.drawingBufferHeight, gl.RGBA, gl.UNSIGNED_BYTE, bytes);
    let count = 0; for (let i = 0; i < bytes.length; i += 4) if (Math.max(bytes[i], bytes[i + 1], bytes[i + 2]) > 95) count++; resolve(count);
  })));
  for (const id of ['generic', 'esp32', 'esp32s3', 'bluepill', 'uno', 'pico', 'mpu6050']) {
    await page.setViewportSize({ width: 1500, height: 1000 }); await page.getByLabel('开发板模型').selectOption(id); await expect.poll(() => page.getByLabel('模型元件').locator('option').count()).toBeGreaterThan(15);
    await expect.poll(visiblePixels).toBeGreaterThan(1000); await canvas.scrollIntoViewIfNeeded(); await canvas.screenshot({ path: `artifacts/board-${id}-desktop.png` });
    await page.getByRole('button', { name: '顶视', exact: true }).click(); await expect.poll(visiblePixels).toBeGreaterThan(1000);
    await page.getByRole('button', { name: '底视', exact: true }).click(); await expect.poll(visiblePixels).toBeGreaterThan(1000);
    await page.getByRole('button', { name: '透视', exact: true }).click(); await page.setViewportSize({ width: 390, height: 844 }); await canvas.scrollIntoViewIfNeeded(); await expect.poll(visiblePixels).toBeGreaterThan(100);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true); await canvas.screenshot({ path: `artifacts/board-${id}-mobile.png` });
  }
  expect(errors).toEqual([]);
});
