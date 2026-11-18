import test from 'node:test';
import assert from 'node:assert/strict';
import { proposeDisplay } from '../server/display-assistant.mjs';
import { blueprint, designPreset } from '../shared/display-blueprint.mjs';
import { changedTile, raster } from '../shared/display-scene.mjs';

test('model design proposal limits page links, events and request content', async () => {
  const request = { prompt:'控制面板', profile:'oled96', capacity:2, unrelated:'secret' };
  const plan=designPreset('switch','控制面板');
  const result=await proposeDisplay(request,{model:'test'},undefined,async ({messages})=>{
    assert.ok(!messages[1].content.includes('secret')); return {content:JSON.stringify(plan)};
  });
  assert.equal(result.pages[0].layers.at(-1).event,'START');
  plan.pages[0].layers.at(-1).to=3; assert.equal(blueprint.safeParse(plan).success,false);
  await assert.rejects(proposeDisplay(request,{},undefined,async()=>({content:'{}'})),/校验/);
});
test('partial RGB565 transfers restore exact multi-row pixels and skip unchanged frames',()=>{
  const prev=new Uint8Array(50), next=prev.slice(); next[12]=85;next[35]=99;
  const tile=changedTile(prev,next,5,5); assert.deepEqual([tile.x,tile.y,tile.w,tile.h],[1,1,2,3]);
  const restored=prev.slice(); for(let y=0;y<tile.h;y++) restored.set(tile.bytes.subarray(y*tile.w*2,(y+1)*tile.w*2),((tile.y+y)*5+tile.x)*2);
  assert.deepEqual(restored,next); assert.equal(changedTile(next,next,5,5).bytes.length,0);
  const grey=new Uint8ClampedArray(4*4*4).fill(128); const bits=raster(grey,4,4,true,128,true);assert.ok(new Set(bits).size>1);
});
