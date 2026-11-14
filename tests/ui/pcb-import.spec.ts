import { expect, test } from '@playwright/test';
import fs from 'node:fs/promises';

test('real KiCad PCB export preserves 50 parts, pin nets, telemetry, movement and GLB round trip', async ({ page, request }) => {
  const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
  await request.post('/api/connect', { data: { path: 'demo' } });
  await page.setViewportSize({ width: 1600, height: 1100 }); await page.goto('/?view=attitude&pose=manual');
  await page.getByRole('button', { name: '载入真实 PCB 示例', exact: true }).click();
  const parts = page.getByLabel('模型元件'), canvas = page.getByLabel('三维开发板姿态');
  await expect(parts.locator('option')).toHaveCount(50); await expect(page.getByLabel('模型向上轴')).toHaveValue('Y');
  await parts.selectOption({ label: 'U1' }); await expect(page.getByLabel('元件型号')).toHaveValue('BM15x');
  await expect(page.locator('.pcb-pad-table tbody tr')).toHaveCount(55); await expect(page.locator('.pcb-pad-table')).toContainText('/Connectors/UART.RX');
  await page.getByLabel('元件数据通道').selectOption('0'); await expect(page.locator('.attitude-status')).toContainText(/U1 · [\d.]+/);
  const pixels = () => canvas.evaluate((element: HTMLCanvasElement) => new Promise<{ count: number; hash: number }>(resolve => requestAnimationFrame(() => {
    const gl = element.getContext('webgl2')!, bytes = new Uint8Array(gl.drawingBufferWidth * gl.drawingBufferHeight * 4); gl.readPixels(0, 0, gl.drawingBufferWidth, gl.drawingBufferHeight, gl.RGBA, gl.UNSIGNED_BYTE, bytes);
    let count = 0, hash = 0; for (let i = 0; i < bytes.length; i += 4) { if (Math.max(bytes[i], bytes[i + 1], bytes[i + 2]) > 95) count++; hash = (hash + bytes[i] * (i % 7919) + bytes[i + 1]) % 1000000007; } resolve({ count, hash });
  })));
  await canvas.scrollIntoViewIfNeeded(); await expect.poll(async () => (await pixels()).count).toBeGreaterThan(1500);
  await canvas.screenshot({ path: 'artifacts/pcb-real-model-desktop.png' }); await page.screenshot({ path: 'artifacts/pcb-real-workspace.png', fullPage: true });
  const initial = (await pixels()).hash; await page.getByLabel('Roll 测试角度').fill('45'); await expect.poll(async () => (await pixels()).hash).not.toBe(initial); await page.getByLabel('Roll 测试角度').fill('0');
  const beforeOrbit = (await pixels()).hash, box = (await canvas.boundingBox())!; await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2); await page.mouse.down(); await page.mouse.move(box.x + box.width / 2 + 100, box.y + box.height / 2 + 40, { steps: 8 }); await page.mouse.up(); await expect.poll(async () => (await pixels()).hash).not.toBe(beforeOrbit);
  await page.getByRole('button', { name: '顶视', exact: true }).click(); await canvas.screenshot({ path: 'artifacts/pcb-real-model-top.png' }); await page.getByRole('button', { name: '底视', exact: true }).click(); await expect.poll(async () => (await pixels()).count).toBeGreaterThan(1500); await canvas.screenshot({ path: 'artifacts/pcb-real-model-bottom.png' });
  await page.getByRole('button', { name: '透视', exact: true }).click(); await page.setViewportSize({ width: 390, height: 844 }); await canvas.scrollIntoViewIfNeeded(); await expect.poll(async () => (await pixels()).count).toBeGreaterThan(100); expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true); await canvas.screenshot({ path: 'artifacts/pcb-real-model-mobile.png' });
  const exporting = page.waitForEvent('download'); await page.getByRole('button', { name: '导出 GLB', exact: true }).click(); const exported = await fs.readFile(await (await exporting).path() as string);
  const json = JSON.parse(exported.subarray(20, 20 + exported.readUInt32LE(12)).toString()); expect(json.nodes.filter((node: { extras?: { componentRoot?: boolean } }) => node.extras?.componentRoot).length).toBe(50);
  await page.getByLabel('导入 PCB 3D 模型').setInputFiles({ name: 'roundtrip-pcb.glb', mimeType: 'model/gltf-binary', buffer: exported }); await expect(parts.locator('option')).toHaveCount(50); await parts.selectOption({ label: 'U5' }); await expect(page.getByLabel('元件型号')).toHaveValue('nRF52833-QDXX'); expect(errors).toEqual([]);
});
