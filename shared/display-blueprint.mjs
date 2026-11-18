import { z } from 'zod';
import { eventName, sceneSchema } from './display-scene.mjs';

const coord = z.number().min(0).max(100);
const shortText = z.string().max(48);
const item = z.object({ kind: z.enum(['text', 'button', 'bar', 'box', 'hotspot']), label: shortText,
  x: coord, y: coord, w: coord.positive(), h: coord.positive(), to: z.number().int().min(0).max(3).optional(),
  event: eventName.optional(), fill: z.string().regex(/^#[0-9a-f]{6}$/i).optional(), ink: z.string().regex(/^#[0-9a-f]{6}$/i).optional(), value: coord.optional(),
}).strict().refine(n => n.x + n.w <= 100.00001 && n.y + n.h <= 100.00001, '控件超出屏幕');
export const blueprint = z.object({ pages: z.array(z.object({ name: shortText.min(1), layers: z.array(item).min(1).max(20) }).strict()).min(1).max(4) }).strict()
  .refine(plan => plan.pages.every(page => page.layers.every(n => n.to === undefined || n.to < plan.pages.length)), '草案引用了不存在的页面');

const title = label => ({ kind: 'text', label, x: 6, y: 7, w: 88, h: 20 });
const value = label => ({ kind: 'text', label, x: 6, y: 30, w: 88, h: 30 });
const key = (label, to, x = 6, event = undefined) => ({ kind: 'button', label, x, y: 68, w: 40, h: 24, to, event });
export function designPreset(kind, name) {
  const caption = name.trim().slice(0, 40);
  if (kind === 'switch') return { pages: [
    {name: caption || '控制台', layers: [title(caption || '控制台'), value('待机'), key('启动', 1, 6, 'START')]},
    {name:'运行中', layers:[title(caption || '控制台'), value('运行中'), key('停止', 0, 6, 'STOP')]},
  ] };
  return { pages: [
    {name:caption || '菜单', layers:[title(caption || '设备菜单'), value('选择功能'), key('状态',1), key('设置',2,54)]},
    {name:'状态', layers:[title('设备状态'), { kind:'bar', label:'电量', value:72, x:6, y:36, w:88, h:14 }, key('返回',0)]},
    {name:'设置', layers:[title('设置'), value('默认模式'), key('返回',0)]},
  ] };
}

export function appendBlueprint(scene, proposal, makeId) {
  const plan = blueprint.parse(proposal), start = scene.pages.length;
  if (start + plan.pages.length > 8) throw new Error(`还可添加 ${8 - start} 页，此草案需要 ${plan.pages.length} 页`);
  const generated = plan.pages.map((page, i) => ({ name: page.name, bg: '#101b22', frames: [], layers: page.layers.map(n => ({
    id: makeId(), type: n.kind, text: n.label, x: n.x, y: n.y, w: n.w, h: n.h, target: start + (n.to ?? i),
    color: n.fill || '#8ae4ce', ink: n.ink || (n.kind === 'button' ? '#071410' : '#f5f9f8'), value: n.value ?? 50, event: n.event,
  })) }));
  return sceneSchema.parse({ ...scene, pages: [...scene.pages, ...generated] });
}
