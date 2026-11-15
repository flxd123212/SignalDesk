import { clickWorkbench } from './workbench-actions';
import { expect, test } from '@playwright/test';
import fs from 'node:fs/promises';

test.beforeEach(async ({ request }) => { await request.post('/api/connect', { data: { path: 'demo' } }); await request.post('/api/processing', { data: { mode: 'raw' } }); });

test('oscilloscope exposes independent scales, cursors, dominant frequency and fullscreen escape', async ({ page, request }) => {
  await page.goto('/'); await expect(page.locator('.app-shell')).toHaveAttribute('data-ready', 'true'); await expect(page.locator('#signaldesk-startup')).not.toBeVisible(); await expect.poll(async () => (await (await request.get('/api/state')).json()).frames).toBeGreaterThan(700);
  await page.getByRole('button', { name: '自动设置量程与时基', exact: true }).click(); await expect(page.getByLabel('独立通道量程')).toBeChecked();
  await page.getByLabel('双游标测量').check(); await expect(page.locator('.chart-readout')).toContainText('ΔT');
  await page.getByLabel('通道耦合').selectOption('AC'); await page.getByLabel('通道反相').check();
  await page.screenshot({ path: 'artifacts/scope-desktop.png', fullPage: true });
  await page.getByRole('button', { name: '找主频', exact: true }).click(); await expect(page.locator('.scope-frequency')).toContainText('Hz'); await expect(page.locator('.chart-readout')).toContainText('HANN');
  await page.getByRole('button', { name: '全屏波形', exact: true }).click(); await expect.poll(() => page.evaluate(() => Boolean(document.fullscreenElement))).toBe(true); await page.keyboard.press('Escape'); await expect.poll(() => page.evaluate(() => Boolean(document.fullscreenElement))).toBe(false);
  await page.setViewportSize({ width: 390, height: 844 }); expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true); await page.screenshot({ path: 'artifacts/scope-mobile.png', fullPage: true });
});

test('CAN records calculate and export estimated load with explicit limits', async ({ page }) => {
  await page.goto('/'); await expect(page.locator('.app-shell')).toHaveAttribute('data-ready', 'true'); await expect(page.locator('#signaldesk-startup')).not.toBeVisible(); await clickWorkbench(page, 'CAN 分析'); await page.getByRole('button', { name: '示例记录', exact: true }).click(); await page.getByRole('button', { name: '分析', exact: true }).click();
  await expect(page.locator('.instrument-metrics')).toContainText('1001'); await expect(page.locator('.instrument-table tbody tr')).toHaveCount(2);
  const downloaded = page.waitForEvent('download'); await page.getByRole('button', { name: '导出分析', exact: true }).click(); const result = JSON.parse(await fs.readFile(await (await downloaded).path() as string, 'utf8')); expect(result.count).toBe(1001); expect(result.load.upper).toBeGreaterThan(result.load.lower);
  await page.screenshot({ path: 'artifacts/can-desktop.png', fullPage: true }); await page.setViewportSize({ width: 390, height: 844 }); expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true); await page.screenshot({ path: 'artifacts/can-mobile.png', fullPage: true });
});

test('custom JS templates preview real evaluated values and output requires manual enable', async ({ page, request }) => {
  await page.goto('/'); await expect(page.locator('.app-shell')).toHaveAttribute('data-ready', 'true'); await expect(page.locator('#signaldesk-startup')).not.toBeVisible(); await clickWorkbench(page, '自定义控件'); await page.getByLabel('控件输入源').selectOption('test'); await page.getByLabel('控件测试值').fill('42'); await page.getByRole('button', { name: '运行一次', exact: true }).click(); await expect(page.locator('.widget-render')).toContainText('42.000');
  await expect(page.getByRole('button', { name: '发送当前值', exact: true })).toBeDisabled(); await page.getByLabel('控件模板').selectOption('bar'); await page.getByRole('button', { name: '运行一次', exact: true }).click(); await expect(page.locator('.widget-render progress')).toHaveAttribute('value', '0.42');
  const before = (await (await request.get('/api/state')).json()).txBytes; await page.getByRole('checkbox', { name: '启用手动发送到当前设备' }).check(); await page.getByRole('button', { name: '发送当前值', exact: true }).click(); await expect.poll(async () => (await (await request.get('/api/state')).json()).txBytes).toBeGreaterThan(before);
  await page.screenshot({ path: 'artifacts/widgets-desktop.png', fullPage: true }); await page.setViewportSize({ width: 390, height: 844 }); expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true); await page.screenshot({ path: 'artifacts/widgets-mobile.png', fullPage: true });
});

test('3D attitude is nonblank, changes orientation and responds to orbit across desktop and mobile', async ({ page }) => {
  const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
  await page.goto('/'); await expect(page.locator('.app-shell')).toHaveAttribute('data-ready', 'true'); await expect(page.locator('#signaldesk-startup')).not.toBeVisible(); await clickWorkbench(page, '姿态调试'); const canvas = page.getByLabel('三维开发板姿态'); await expect(canvas).toBeVisible(); await page.getByLabel('姿态来源').selectOption('manual');
  const pixels = () => canvas.evaluate((element: HTMLCanvasElement) => new Promise<{ colored: number; hash: number }>(resolve => requestAnimationFrame(() => { const gl = element.getContext('webgl2')!; const pixels = new Uint8Array(gl.drawingBufferWidth * gl.drawingBufferHeight * 4); gl.readPixels(0, 0, gl.drawingBufferWidth, gl.drawingBufferHeight, gl.RGBA, gl.UNSIGNED_BYTE, pixels); let colored = 0, hash = 0; for (let i = 0; i < pixels.length; i += 4) { if (Math.max(pixels[i], pixels[i + 1], pixels[i + 2]) > 85 && Math.max(pixels[i], pixels[i + 1], pixels[i + 2]) - Math.min(pixels[i], pixels[i + 1], pixels[i + 2]) > 20) colored++; hash = (hash + pixels[i] * (i % 7919) + pixels[i + 1]) % 1000000007; } resolve({ colored, hash }); })));
  await expect.poll(async () => (await pixels()).colored).toBeGreaterThan(500); const initial = (await pixels()).hash;
  await page.getByLabel('Roll 测试角度').fill('65'); await expect.poll(async () => (await pixels()).hash).not.toBe(initial);
  const beforeOrbit = (await pixels()).hash, box = (await canvas.boundingBox())!; await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2); await page.mouse.down(); await page.mouse.move(box.x + box.width / 2 + 110, box.y + box.height / 2 + 40, { steps: 10 }); await page.mouse.up(); await expect.poll(async () => (await pixels()).hash).not.toBe(beforeOrbit);
  await page.screenshot({ path: 'artifacts/attitude-desktop.png', fullPage: true }); await page.setViewportSize({ width: 390, height: 844 }); await canvas.scrollIntoViewIfNeeded(); await expect.poll(async () => (await pixels()).colored).toBeGreaterThan(100); expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true); await page.screenshot({ path: 'artifacts/attitude-mobile.png', fullPage: true }); expect(errors).toEqual([]);
});

test('mixed sending preserves bytes, receive search highlights and raw reports export', async ({ page, request }) => {
  await page.goto('/'); await expect(page.locator('.app-shell')).toHaveAttribute('data-ready', 'true'); await expect(page.locator('#signaldesk-startup')).not.toBeVisible(); await page.getByLabel('发送格式').selectOption('mixed'); await page.getByLabel('发送内容', { exact: true }).fill('HELLO[HEX:00 FF]END'); await page.getByLabel('发送结束符').selectOption('none'); await expect(page.locator('.mixed-preview')).toContainText('48 45 4C 4C 4F 00 FF 45 4E 44'); await page.getByRole('button', { name: '发送', exact: true }).click();
  await clickWorkbench(page, '串口终端'); await page.getByLabel('收发方向').selectOption('TX'); await page.getByLabel('搜索串口数据').fill('HELLO'); await expect(page.locator('.terminal-log mark')).toHaveText('HELLO'); await page.getByLabel('报文导出格式').selectOption('txbin');
  const downloaded = page.waitForEvent('download'); await page.getByRole('button', { name: '导出终端缓存', exact: true }).click(); expect((await fs.readFile(await (await downloaded).path() as string)).toString('hex')).toBe('48454c4c4f00ff454e44');
  await page.getByRole('button', { name: '暂停终端刷新', exact: true }).click(); await page.screenshot({ path: 'artifacts/terminal-search.png', fullPage: true });
  await page.getByLabel('发送内容', { exact: true }).fill('A[HEX:F]'); await expect(page.getByRole('button', { name: '发送', exact: true })).toBeDisabled();
  await request.post('/api/disconnect', { data: {} }); await clickWorkbench(page, '展开连接设置'); await expect(page.getByRole('button', { name: '连接设备', exact: true })).toBeEnabled(); await page.getByLabel('连接方式').selectOption('bluetooth'); await expect(page.getByLabel('蓝牙串口')).toBeVisible(); await expect(page.getByText('BLE GATT 未适配', { exact: true })).toBeVisible();
});

test('command groups queue selected commands and persist mixed format', async ({ page, request }) => {
  await page.goto('/'); await expect(page.locator('.app-shell')).toHaveAttribute('data-ready', 'true'); await expect(page.locator('#signaldesk-startup')).not.toBeVisible(); await clickWorkbench(page, '指令库'); await page.getByLabel('选择分组 AT 指令', { exact: true }).check(); await page.getByLabel('分组发送间隔').fill('20'); await page.getByRole('button', { name: '依次发送', exact: true }).click();
  await expect.poll(async () => (await (await request.get('/api/commands/queue')).json())?.status).toBe('succeeded'); expect((await (await request.get('/api/commands/queue')).json()).sent).toBe(2);
  await page.getByLabel('指令 1 格式', { exact: true }).selectOption('mixed'); await page.getByLabel('指令 1 内容', { exact: true }).fill('AT[HEX:00]'); await page.reload(); await clickWorkbench(page, '指令库'); await expect(page.getByLabel('指令 1 格式', { exact: true })).toHaveValue('mixed');
  await page.screenshot({ path: 'artifacts/commands-desktop.png', fullPage: true }); await page.setViewportSize({ width: 390, height: 844 }); expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true); await page.screenshot({ path: 'artifacts/commands-mobile.png', fullPage: true });
});

test('two rotary controls adjust scope and spectrum using keyboard, drag and focused wheel', async ({ page }) => {
  await page.goto('/'); await expect(page.locator('.app-shell')).toHaveAttribute('data-ready', 'true'); await expect(page.locator('#signaldesk-startup')).not.toBeVisible(); const time = page.getByRole('slider', { name: '时基旋钮', exact: true }), range = page.getByRole('slider', { name: '通道量程旋钮', exact: true });
  await time.press('ArrowUp'); await expect(page.getByLabel('示波器时基')).toHaveValue('1'); await range.press('ArrowDown'); await expect(page.getByLabel('通道每格量程')).toHaveValue('0.5'); await expect(page.getByLabel('独立通道量程')).toBeChecked();
  const box = (await time.boundingBox())!; await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2); await page.mouse.down(); await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2 - 18); await page.mouse.up(); await expect(page.getByLabel('示波器时基')).toHaveValue('5');
  await page.mouse.wheel(0, 100); await expect(page.getByLabel('示波器时基')).toHaveValue('2'); await page.screenshot({ path: 'artifacts/scope-knobs-desktop.png', fullPage: true });
  await page.getByRole('button', { name: '频谱', exact: true }).click(); await page.getByRole('slider', { name: '频率范围旋钮' }).press('ArrowDown'); await expect(page.getByLabel('频谱频率范围')).toHaveValue('50'); await page.getByRole('slider', { name: '频谱幅度旋钮' }).press('ArrowDown'); await expect(page.getByLabel('频谱每格幅度')).toHaveValue('0.5');
  await page.setViewportSize({ width: 390, height: 844 }); await page.getByRole('slider', { name: '频率范围旋钮' }).scrollIntoViewIfNeeded(); expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true); await page.screenshot({ path: 'artifacts/spectrum-knobs-mobile.png', fullPage: true });
});

test('board models export GLB, import named PCB parts and show manually bound sensor data', async ({ page }) => {
  await page.goto('/'); await expect(page.locator('.app-shell')).toHaveAttribute('data-ready', 'true'); await expect(page.locator('#signaldesk-startup')).not.toBeVisible(); await clickWorkbench(page, '姿态调试'); await page.getByLabel('开发板模型').selectOption('esp32'); await expect(page.getByLabel('模型元件')).toContainText('ESP32-WROOM');
  const exporting = page.waitForEvent('download'); await page.getByRole('button', { name: '导出 GLB', exact: true }).click(); const exported = await fs.readFile(await (await exporting).path() as string); expect(exported.readUInt32LE(0)).toBe(0x46546c67);
  const binary = Buffer.alloc(36); [0, 0, 0, 2, 0, 0, 0, 1, 0].forEach((value, index) => binary.writeFloatLE(value, index * 4));
  const json = Buffer.from(JSON.stringify({ asset: { version: '2.0' }, scene: 0, scenes: [{ nodes: [0] }], nodes: [{ mesh: 0, name: 'U1', extras: { reference: 'U1', value: 'TEST_SENSOR', pins: 'PIN_A=test' } }], meshes: [{ primitives: [{ attributes: { POSITION: 0 } }] }], buffers: [{ byteLength: 36 }], bufferViews: [{ buffer: 0, byteOffset: 0, byteLength: 36 }], accessors: [{ bufferView: 0, componentType: 5126, count: 3, type: 'VEC3', min: [0, 0, 0], max: [2, 1, 0] }] }));
  const padded = Buffer.alloc(Math.ceil(json.length / 4) * 4, 32); json.copy(padded); const header = Buffer.alloc(20); header.writeUInt32LE(0x46546c67, 0); header.writeUInt32LE(2, 4); header.writeUInt32LE(20 + padded.length + 8 + binary.length, 8); header.writeUInt32LE(padded.length, 12); header.writeUInt32LE(0x4e4f534a, 16); const binHeader = Buffer.alloc(8); binHeader.writeUInt32LE(binary.length, 0); binHeader.writeUInt32LE(0x004e4942, 4);
  await page.getByLabel('导入 PCB 3D 模型').setInputFiles({ name: 'sensor-board.glb', mimeType: 'model/gltf-binary', buffer: Buffer.concat([header, padded, binHeader, binary]) }); await expect(page.getByLabel('元件名称位号')).toHaveValue('U1'); await expect(page.getByLabel('元件型号')).toHaveValue('TEST_SENSOR'); await expect(page.getByLabel('元件引脚标注')).toHaveValue('PIN_A=test');
  await page.getByLabel('元件数据通道').selectOption('0'); await expect(page.locator('.attitude-status')).toContainText(/U1 · [\d.]+/); await page.getByLabel('元件名称位号').fill('U1 temperature');
  const mapping = page.waitForEvent('download'); await page.getByRole('button', { name: '导出元件映射', exact: true }).click(); const metadata = JSON.parse(await fs.readFile(await (await mapping).path() as string, 'utf8')); expect(metadata.components[0].channel).toBe(0); expect(metadata.components[0].annotationSource).toBe('user');
  await page.screenshot({ path: 'artifacts/pcb-model-import.png', fullPage: true });
});

test('ESP32-S3 v1.1 reference has 44 named pins and source-backed component metadata', async ({ page }) => {
  await page.setViewportSize({ width: 1700, height: 1100 }); await page.goto('/?view=attitude&board=esp32s3&pose=manual'); await expect(page.getByLabel('开发板模型')).toHaveValue('esp32s3'); await expect(page.locator('.board-dimensions')).toContainText('25.40 x 62.74');
  const parts = page.getByLabel('模型元件'); await expect(parts.locator('option')).toHaveCount(68); const entries = await parts.locator('option').allTextContents(); expect(entries.filter(name => /^J[13]\.\d+$/.test(name))).toHaveLength(44);
  await parts.selectOption({ label: 'U3' }); await expect(page.getByLabel('元件型号')).toHaveValue('CP2102N-A02-GQFN28 / USB-UART'); await parts.selectOption({ label: 'D6' }); await expect(page.getByLabel('元件引脚标注')).toHaveValue('DIN: GPIO38 (v1.1)'); await parts.selectOption({ label: 'U4' });
  await page.locator('.page-attitude').evaluate(element => { element.scrollTop = 0; }); const canvas = page.getByLabel('三维开发板姿态'); await canvas.scrollIntoViewIfNeeded(); await page.screenshot({ path: 'artifacts/esp32-s3-reference-desktop.png', fullPage: true }); await canvas.screenshot({ path: 'artifacts/esp32-s3-model-detail.png' });
  const exporting = page.waitForEvent('download'); await page.getByRole('button', { name: '导出 GLB', exact: true }).click(); const model = await exporting; await model.saveAs('artifacts/esp32-s3-devkitc-1-v1.1-reference.glb'); const bytes = await fs.readFile(await model.path() as string); const json = JSON.parse(bytes.subarray(20, 20 + bytes.readUInt32LE(12)).toString()); expect(json.nodes.some((node: { extras?: { dimensions?: { pitchMm?: number } } }) => node.extras?.dimensions?.pitchMm === 2.54)).toBe(true);
  await page.setViewportSize({ width: 390, height: 844 }); await canvas.scrollIntoViewIfNeeded(); expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true); await canvas.screenshot({ path: 'artifacts/esp32-s3-model-mobile.png' });
});

test('math node exposes both input values and live result and opens the data panel', async ({ page, request }) => {
  await page.goto('/'); await expect(page.locator('.app-shell')).toHaveAttribute('data-ready', 'true'); await expect(page.locator('#signaldesk-startup')).not.toBeVisible(); await clickWorkbench(page, '节点编排'); await page.getByRole('button', { name: '一键配置', exact: true }).click(); await page.getByLabel('测试拼图模板').selectOption('ratio'); await page.getByRole('button', { name: '载入模板', exact: true }).click(); await page.getByRole('button', { name: '应用到数据', exact: true }).click();
  await expect.poll(async () => (await (await request.get('/api/state')).json()).graphInputs?.['math']?.length).toBe(2); await expect(page.locator('.node-input-readouts')).not.toContainText('--'); await expect(page.locator('.signal-node.divide .node-value')).not.toContainText('a / b'); await page.screenshot({ path: 'artifacts/math-node-inputs.png', fullPage: true });
  await page.getByRole('button', { name: '查看数据', exact: true }).click(); await expect(page.getByRole('heading', { name: '实时监测', exact: true })).toBeVisible(); await request.post('/api/processing', { data: { mode: 'raw' } });
});
