import { expect, test } from '@playwright/test';
import http from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';

test('edit a natural-language prompt, reconnect during approval and inspect the generated screen', async ({ page,request }) => {
  const original = (await (await request.get('/api/ai/state')).json()).config;
  const root = await fs.mkdtemp(path.join(os.tmpdir(),'sd-delivery-ui-'));
  const brief = { goal:'显示温度', requirements:'按键切换', hardware:'SSD1306', constraints:'不改协议', acceptance:'按键触发切换', unknowns:'待确认接线' };
  const layout = JSON.stringify({pages:[{name:'首页',layers:[{kind:'button',label:'NEXT',x:5,y:10,w:70,h:55,to:1}]},{name:'详情',layers:[{kind:'text',label:'TEMP',x:5,y:20,w:90,h:40}]}]});
  let calls=0;
  const model=http.createServer((req,res)=>{let text=''; req.on('data',c=>text+=c);req.on('end',()=>{
    const body=JSON.parse(text), call=(name:string,args:object)=>({tool_calls:[{id:`c${calls}`,type:'function',function:{name,arguments:JSON.stringify(args)}}]});
    const message=!body.tools ? {content:JSON.stringify(brief)} : ++calls===1 ? call('review_project_brief',brief) : calls===2 ? call('propose_new_file',{path:'assets.txt',content:'asset-entry\n'.repeat(1200)+'asset-end-marker',reason:'创建资源目录'}) : calls===3 ? call('propose_screen_layout',{profile:'oled96',path:'ui/main.screen.json',expectedHash:'',layout,reason:'创建屏幕页面'}) : {content:'页面已生成，未验证实物。'};
    res.setHeader('Content-Type','application/json');res.end(JSON.stringify({choices:[{message,finish_reason:'tool_calls' in message?'tool_calls':'stop'}]}));});});
  await new Promise<void>(resolve=>model.listen(0,'127.0.0.1',resolve));
  try{
    await request.post('/api/ai/config',{data:{root,baseUrl:`http://127.0.0.1:${(model.address() as {port:number}).port}/v1`,model:'fixture',apiStyle:'chat'}});
    await page.goto('/?view=agent'); await expect(page.locator('#signaldesk-startup')).toBeHidden();
    await expect(page.locator('.app-shell')).toHaveAttribute('data-ready','true');
    await page.getByLabel('Agent 工作模式').selectOption('project'); const prompt=page.getByLabel('Agent 分析请求'); await prompt.fill('我想按键切换温度页');
    await page.getByRole('button',{name:'整理提示词'}).click();await expect(prompt).toHaveValue(/【验收与测量】/); expect(calls).toBe(0);
    await page.getByRole('button',{name:'还原原话'}).click();await expect(prompt).toHaveValue('我想按键切换温度页');
    await prompt.press('Control+Enter');
    await page.getByLabel('标准工程提示词').fill('显示温度。不改协议。');await page.getByRole('button',{name:'确认并开始'}).click();
    await expect(page.getByRole('button',{name:'同意执行'})).toBeVisible();await page.reload();
    const approval = page.getByRole('region', {name:'项目交互'});
    await approval.getByRole('button',{name:'预览已截断，查看完整差异'}).click();
    await expect(approval.locator('pre')).toContainText('asset-end-marker');
    await expect(fs.access(path.join(root,'assets.txt'))).rejects.toThrow();
    await approval.getByRole('button',{name:'同意执行'}).click();
    await expect(approval.locator('code')).toHaveText('ui/main.screen.json');
    await approval.getByRole('button',{name:'同意执行'}).click();
    await expect(page.getByRole('button',{name:'验收完成'})).toBeVisible();await expect(page.getByLabel('工程屏幕预览')).toBeVisible();
    const canvas=page.getByLabel('工程屏幕预览'); await expect.poll(()=>canvas.evaluate(el=>Array.from((el as HTMLCanvasElement).getContext('2d')!.getImageData(0,0,128,64).data).filter((v,i)=>i%4===0&&v>0).length)).toBeGreaterThan(5);
    await page.getByLabel('预览页面').selectOption('1'); await expect(page.getByLabel('预览页面')).toHaveValue('1');
    await page.getByRole('button',{name:'验收完成'}).click();await expect(page.getByLabel('Agent 运行状态')).toContainText('已验收');
    expect(JSON.parse(await fs.readFile(path.join(root,'ui/main.screen.json'),'utf8')).pages).toHaveLength(2);
  } finally {await request.post('/api/ai/cancel',{data:{}}); await request.post('/api/ai/config',{data:{...original,clearKey:true}});await request.post('/api/ai/clear',{data:{}});model.closeAllConnections();await new Promise<void>(resolve=>model.close(()=>resolve()));await fs.rm(root,{recursive:true,force:true});}
});
