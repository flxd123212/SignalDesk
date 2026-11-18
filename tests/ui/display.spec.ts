import { expect, test } from '@playwright/test';
import fs from 'node:fs/promises';
import { encodeRaster, raster } from '../../shared/display-scene.mjs';

test('OLED and TFT preview pixels match exported firmware, pages react to touch and persist', async ({page}) => {
  await page.goto('/?view=display');
  const canvas=page.getByLabel('屏幕像素画布'), profile=page.getByLabel('屏幕型号');
  await expect(profile).toBeEnabled(); await expect(canvas).toHaveAttribute('width','128');
  for (const [id, mono] of [['oled96',true],['tft154',false]] as const) {
    await profile.selectOption(id);
    await expect(canvas).toHaveAttribute('width',mono?'128':'240');
    await expect.poll(()=>canvas.evaluate((el:HTMLCanvasElement)=>el.getContext('2d')!.getImageData(0,0,el.width,el.height).data.some((v,i)=>i%4!==3 && v>200))).toBe(true);
    const [file] = await Promise.all([page.waitForEvent('download'),page.getByRole('button',{name:'导出固件源码'}).click()]);
    const code=await fs.readFile((await file.path())!,'utf8');
    const bytes = Uint8Array.from(code.match(/img_0_0\[\] PROGMEM = \{([\s\d,]+)\}/)![1].trim().split(',').map(Number));
    const data=await canvas.evaluate((el:HTMLCanvasElement)=>({w:el.width,h:el.height,rgba:[...el.getContext('2d')!.getImageData(0,0,el.width,el.height).data]}));
    const expected=encodeRaster(raster(Uint8ClampedArray.from(data.rgba),data.w,data.h,mono,115),mono?1:2,'auto'); expect(Buffer.from(bytes).equals(Buffer.from(expected.bytes))).toBe(true);
  }
  await page.getByRole('button',{name:'交互预览'}).click(); const b=(await canvas.boundingBox())!; await canvas.click({position:{x:b.width*.78,y:b.height*.8}});
  await expect(page.locator('.studio-pages .current')).toHaveText('设置');
  await page.getByRole('button',{name:'返回设计'}).click(); await page.getByLabel('页面名称').fill('控制');
  await page.getByRole('button',{name:'保存',exact:true}).click(); await expect(page.locator('.display-studio output')).toContainText('已保存');
  await page.reload(); await expect(page.locator('.studio-pages')).toContainText('控制');
  await profile.click(); await profile.press('Escape');
  await page.screenshot({path:'artifacts/display-studio.png'});
  await page.setViewportSize({width:400,height:820}); await expect(canvas).toBeVisible();
  expect(await page.locator('.display-studio').evaluate(el=>el.scrollWidth <= el.clientWidth + 2)).toBe(true);
  await page.getByRole('button',{name:'生成并打开编译工程'}).click();
  await expect(page.getByRole('button',{name:'识别项目',exact:true})).toBeEnabled();
  await page.getByRole('button',{name:'识别项目',exact:true}).click();
  await expect(page.getByRole('dialog')).toContainText('SignalDeskUI');
});

test('animated GIF keeps its frames and delays in the exported sketch', async ({page}) => {
  await page.goto('/?view=display'); await expect(page.getByLabel('屏幕型号')).toBeEnabled();
  // A two-frame GIF with 100 and 200 ms delays and black/white palette indices.
  const gif=Buffer.from('47494638396101000100800000000000ffffff21f904000a0000002c000000000100010000020244010021f90400140000002c00000000010001000002024c01003b','hex');
  await page.locator('input[accept="image/png,image/jpeg,image/gif"]').setInputFiles({name:'two.gif',mimeType:'image/gif',buffer:gif});
  await expect(page.locator('.studio-status')).toContainText('2 帧');
  const [file]=await Promise.all([page.waitForEvent('download'),page.getByRole('button',{name:'导出固件源码'}).click()]);
  const code=await fs.readFile((await file.path())!,'utf8');
  expect(code).toContain('{img_0_0,100,'); expect(code).toContain('{img_0_1,200,');
});

test('a USB bootloader without a serial port opens discovery after insertion', async ({page}) => {
  let scans=0, plugged=false;
  await page.route('**/api/usb/boards',route=>{
    scans++;
    return route.fulfill({json:plugged ? [{key:'2e8a:0003/test',name:'RP2040 BOOTSEL',kind:'UF2 启动盘',vid:'2e8a',pid:'0003',descriptor:'RP2 Boot'}] : []});
  });
  await page.goto('/?view=tooling'); await expect.poll(()=>scans).toBeGreaterThan(0);
  await expect(page.getByRole('dialog',{name:'发现设备'})).toHaveCount(0); plugged=true;
  const dialog=page.getByRole('dialog',{name:'发现设备'}); await expect(dialog).toContainText('RP2040 BOOTSEL',{timeout:15000});
  await expect(dialog.getByRole('button',{name:'绑定并连接'})).toBeDisabled(); await expect(dialog).toContainText('0 个串口');
});

test('interactive design proposal can become the boot page, emit its event and be undone', async ({page})=>{
  await page.goto('/?view=display'); await page.getByRole('button',{name:'设计助手',exact:true}).click();
  const dialog=page.getByRole('dialog',{name:'界面设计助手'}); await dialog.getByRole('button',{name:'状态切换'}).click();
  await dialog.getByLabel('界面标题').fill('温控台'); await dialog.getByRole('button',{name:'生成草案'}).click();
  await expect(dialog.getByLabel('设计草案预览')).toBeVisible(); await dialog.getByLabel('将草案首页设为开机页').check();
  await dialog.getByRole('button',{name:'应用到设计'}).click(); await expect(page.locator('.studio-pages .current')).toHaveText('温控台');
  await page.getByRole('button',{name:'交互预览',exact:true}).click(); const canvas=page.getByLabel('屏幕像素画布');const box=(await canvas.boundingBox())!;
  await canvas.click({position:{x:box.width*.25,y:box.height*.8}}); await expect(page.locator('.studio-pages .current')).toHaveText('运行中'); await expect(page.locator('.display-studio output')).toContainText('UI:START');
  await page.getByRole('button',{name:'返回设计',exact:true}).click();
  const [file]=await Promise.all([page.waitForEvent('download'),page.getByRole('button',{name:'导出固件源码'}).click()]);
  const code=await fs.readFile((await file.path())!,'utf8'); expect(code).toContain('Serial.println(F("UI:START"))');
  await page.getByTitle('撤销设计修改').click(); await expect(page.locator('.studio-pages')).not.toContainText('温控台');
  await page.getByTitle('重做设计修改').click(); await expect(page.locator('.studio-pages')).toContainText('温控台');
});

test('image skill converts a local button graphic into a round-trip touch journey', async ({page})=>{
  await page.goto('/?view=display'); await expect(page.getByLabel('屏幕型号')).toBeEnabled();
  const png=await page.evaluate(()=>{
    const c=document.createElement('canvas');c.width=128;c.height=64;const g=c.getContext('2d')!;
    g.fillStyle='black';g.fillRect(0,0,128,64);g.fillStyle='white';g.fillRect(24,18,32,14);return c.toDataURL().split(',')[1];
  });
  await page.locator('input[accept="image/png,image/jpeg,image/gif"]').setInputFiles({name:'panel.png',mimeType:'image/png',buffer:Buffer.from(png,'base64')});
  await page.getByRole('button',{name:'设计助手',exact:true}).click();const dialog=page.getByRole('dialog',{name:'界面设计助手'});
  await dialog.getByRole('button',{name:'图像热区'}).click();await dialog.getByRole('button',{name:'生成草案'}).click();
  await dialog.getByRole('button',{name:'应用到设计'}).click();const origin=await page.locator('.studio-pages .current').innerText();
  await page.getByRole('button',{name:'交互预览',exact:true}).click();const c=page.getByLabel('屏幕像素画布'),box=(await c.boundingBox())!;
  await c.click({position:{x:box.width*40/128,y:box.height*25/64}});await expect(page.locator('.studio-pages .current')).toContainText('热区');
  await c.click({position:{x:box.width*.25,y:box.height*.76}});await expect(page.locator('.studio-pages .current')).toHaveText(origin);
});
