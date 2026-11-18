import { changedTile, defaultCalibration, encodeRaster, panelFor, pixels, sceneSchema } from '../../shared/display-scene.mjs';
import { paint, type Scene } from './scene';

export async function firmware(input: Scene) {
  const s = sceneSchema.parse(input), p = panelFor(s.profile), frames: string[] = [], arrays: string[] = [], pages: string[] = [], actions: string[] = [];
  let total = 0;
  const calibration = s.calibration || defaultCalibration;
  const eventIds = new Map<string, number>();
  for (const [pi, page] of s.pages.entries()) {
    const first = frames.length, count = Math.max(1, page.frames.length);
    let previous: Uint8Array | undefined;
    for (let i = 0; i < count; i++) {
      const {bytes} = await paint(s, pi, i);
      const tile = !p.mono && previous ? changedTile(previous,bytes,p.w,p.h) : {x:0,y:0,w:p.w,h:p.h,bytes};
      previous = bytes;
      const packed = encodeRaster(tile.bytes, p.mono ? 1 : 2, s.codec), name = `img_${pi}_${i}`;
      total += packed.bytes.length;
      if (total > 4 * 1024 * 1024) throw new Error('素材超过 4 MiB 导出预算，请减少帧数或选择自动压缩');
      const lines = [];
      for (let j = 0; j < packed.bytes.length; j += 64) lines.push(packed.bytes.subarray(j, j + 64).join(','));
      arrays.push(`static const uint8_t ${name}[] PROGMEM = {\n${lines.join(',\n') || '0'}\n};`);
      frames.push(`{${name},${page.frames[i]?.ms || 1000},${packed.rle}${p.mono ? '' : `,${tile.x},${tile.y},${tile.w},${tile.h}`}}`);
    }
    pages.push(`{${first},${count}}`);
    for (const n of [...page.layers].reverse()) if (n.type === 'button' || n.type === 'hotspot') {
      if (n.event && !eventIds.has(n.event)) eventIds.set(n.event, eventIds.size + 1);
      const b = pixels(n, p); actions.push(`{${pi},${n.target},${b.x},${b.y},${b.w},${b.h},${eventIds.get(n.event || '') || 0}}`);
    }
  }
  const driver = p.driver === 'SH1106G' ? 'SH110X' : p.driver;
  const display = p.mono ? `Adafruit_${p.driver} display(${p.w}, ${p.h}, &Wire, -1);` : `Adafruit_${driver} display(${s.cs}, ${s.dc}, ${s.rst});`;
  const init = p.driver === 'SSD1306' ? `if (!display.begin(SSD1306_SWITCHCAPVCC, ${s.address})) return;` : p.driver === 'SH1106G' ? `if (!display.begin(${s.address}, true)) return;` : p.driver === 'ST7789' ? `display.init(W, H);` : 'display.begin();';
  const code = `// SignalDesk display sketch. Save as SignalDeskUI/SignalDeskUI.ino.
// Arduino Library Manager: Adafruit GFX Library, ${driver === 'ST7789' ? 'Adafruit ST7735 and ST7789 Library' : 'Adafruit ' + driver}${s.touch === 'xpt2046' ? ', XPT2046_Touchscreen' : ''}.
// ${p.driver}, ${p.w}x${p.h}, ${total} bytes of pixel assets. Hardware ${p.mono ? 'I2C (default SDA/SCL)' : 'SPI (default MOSI/SCK)'}.
#include <Arduino.h>
#include <Wire.h>
#include <SPI.h>
#include <Adafruit_GFX.h>
#include <Adafruit_${driver}.h>
${s.touch === 'xpt2046' ? `#include <XPT2046_Touchscreen.h>\nXPT2046_Touchscreen touch(${s.touchCs});\nconst int X_MIN=${calibration.x0}, X_MAX=${calibration.x1}, Y_MIN=${calibration.y0}, Y_MAX=${calibration.y1};` : ''}
${display}
static const uint16_t W=${p.w}, H=${p.h};
#if defined(__AVR__) && ${total}UL > 60000UL
#error This display design exceeds the near-flash asset budget on AVR. Reduce frames or use a 32-bit target.
#endif
${arrays.join('\n')}
struct Frame { const uint8_t *data; uint16_t ms; bool rle; ${p.mono ? '' : 'uint16_t x,y,w,h;'} };
struct Page { uint16_t first, count; };
struct Action { uint8_t page, target; uint16_t x, y, w, h, eventId; };
static const Frame frames[] = {${frames.join(',')}};
static const Page pages[] = {${pages.join(',')}};
static const Action actions[] = {${[...actions, '{255,0,0,0,0,0,0}'].join(',')}};
static uint8_t pageIndex=0;
static uint16_t frameIndex=0;
static uint32_t frameTime=0;
static bool dirty=true, ready=false;
void uiShow(uint8_t target) {
  if (target >= sizeof(pages)/sizeof(pages[0])) return;
  pageIndex=target; frameIndex=0; dirty=true;
}
void uiTap(int x, int y) {
  for (const Action &a : actions) if (a.page==pageIndex && x>=a.x && y>=a.y && x<a.x+a.w && y<a.y+a.h) {
    switch (a.eventId) { ${Array.from(eventIds, ([name, id]) => `case ${id}: Serial.println(F("UI:${name}")); break;`).join('\n')} }
    uiShow(a.target); return;
  }
}
void renderFrame() {
  const Frame &f=frames[pages[pageIndex].first+frameIndex];
  const uint8_t *cursor=f.data;
  uint8_t remaining=0; uint16_t value=0;
  ${p.mono ? 'display.clearDisplay();' : 'if (!f.w || !f.h) return; static uint16_t line[W]; display.startWrite(); display.setAddrWindow(f.x,f.y,f.w,f.h);'}
  for (uint16_t y=0;y<${p.mono ? 'H' : 'f.h'};y++) {
    for (uint16_t x=0;x<${p.mono ? '(W+7)/8' : 'f.w'};x++) {
      if (!remaining) {
        remaining=f.rle ? pgm_read_byte(cursor++) : 1;
        value=pgm_read_byte(cursor++);
        ${p.mono ? '' : 'value=(value<<8)|pgm_read_byte(cursor++);'}
      }
      remaining--;
      ${p.mono ? 'for (uint8_t b=0;b<8 && x*8+b<W;b++) if (value & (128>>b)) display.drawPixel(x*8+b,y,1);' : 'line[x]=value;'}
    }
    ${p.mono ? '' : 'display.writePixels(line,f.w);'}
  }
  ${p.mono ? 'display.display();' : 'display.endWrite();'}
}
void setup() {
  Serial.begin(115200);
  ${init}
  ${s.touch === 'xpt2046' ? `touch.begin(); touch.setRotation(${calibration.rotation});` : ''}
  ready=true;
}
void loop() {
  if (!ready) return;
  if (Serial.available()) { int c=Serial.read(); if (c>=\x270\x27 && c<=\x277\x27) uiShow(c-\x270\x27); }
  ${s.touch === 'xpt2046' ? `static bool down=false; bool pressed=touch.touched();\n  if (pressed && !down) { TS_Point pt=touch.getPoint(); uiTap(map(pt.x,X_MIN,X_MAX,0,W-1),map(pt.y,Y_MIN,Y_MAX,0,H-1)); }\n  down=pressed;` : ''}
  const Page &p=pages[pageIndex]; const uint32_t now=millis();
  if (!dirty && p.count>1 && uint32_t(now-frameTime)>=frames[p.first+frameIndex].ms) { frameIndex=(frameIndex+1)%p.count; dirty=true; }
  if (dirty) { renderFrame(); frameTime=now; dirty=false; }
}
`;
  return { code, total };
}
