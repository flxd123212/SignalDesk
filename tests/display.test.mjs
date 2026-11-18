import test from 'node:test';
import assert from 'node:assert/strict';
import { raster, encodeRaster, hit, panelFor } from '../shared/display-scene.mjs';
import { windowsUsb, macUsb, classifyUsb } from '../server/usb-inventory.mjs';

test('native monochrome rows start at MSB and RGB565 bytes are high-first', () => {
  const data = Uint8ClampedArray.from([255,0,0,255,0,255,0,255,0,0,255,255]);
  assert.deepEqual([...raster(data.slice(), 3, 1, false, 128)], [248,0,7,224,0,31]);
  assert.deepEqual([...raster(data.slice(), 3, 1, true, 128)], [64]);
  const repeated = new Uint8Array(650).fill(43);
  for (const unit of [1,2]) {
    const packed = encodeRaster(repeated, unit, 'auto'); assert.equal(packed.rle,true);
    const restored = []; for(let i=0;i<packed.bytes.length;i+=unit+1) for(let n=0;n<packed.bytes[i];n++) restored.push(...packed.bytes.slice(i+1,i+1+unit));
    assert.deepEqual(Uint8Array.from(restored),repeated);
  }
  const button = { type:'button', x:0, y:0, w:50, h:50 }, overlay={ ...button, type:'text' };
  assert.equal(hit([button,overlay],panelFor('oled96'),63,31),button); assert.equal(hit([button],panelFor('oled96'),64,31),undefined);
});
test('native USB evidence distinguishes probes, bootloaders and generic bridges', () => {
  const rows = windowsUsb([{InstanceId:'USB\\VID_0483&PID_DF11\\1',FriendlyName:'DFU'}, {InstanceId:'USB\\VID_0483&PID_DF11&MI_01\\1',FriendlyName:'duplicate'}]);
  assert.equal(rows.length,1); assert.equal(classifyUsb(rows[0]).kind,'USB DFU');
  const mac = macUsb({SPUSBDataType:[{_items:[{_name:'RP2 Boot',vendor_id:'0x2e8a',product_id:'0x0003',location_id:'1'}]}]});
  assert.equal(classifyUsb(mac[0]).name,'RP2040 BOOTSEL');
  assert.equal(classifyUsb({vid:'1a86',pid:'7523',name:'CH340'}),null);
  assert.equal(classifyUsb({vid:'0483',pid:'3748'}).name,'ST-LINK');
});
