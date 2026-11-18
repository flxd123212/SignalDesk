import { z } from 'zod';
import { blueprint } from '../shared/display-blueprint.mjs';
import { panels } from '../shared/display-scene.mjs';
import { callModel } from './ai/provider.mjs';

const description = z.object({ prompt: z.string().trim().min(1).max(900), profile: z.enum(panels.map(p => p.id)), capacity: z.number().int().min(1).max(4) });
export async function proposeDisplay(input, config, signal, provider = callModel) {
  const {prompt, profile, capacity} = description.parse(input);
  const screen = panels.find(p => p.id === profile);
  const response = await provider({ config, signal, messages: [
    { role: 'system', content: `You design embedded touchscreen UIs. Return only JSON {"pages":[{"name":"首页","layers":[{"kind":"button","label":"打开","x":5,"y":60,"w":40,"h":25,"to":0}]}]}. Coordinate units are percentages, bounds 0..100. Use 1 to ${capacity} pages, 1..20 layers/page. Kinds: text, button, bar, box, hotspot. to is zero-based within the generated pages. Optional fill and ink are 6-digit hex colors, value is a percent, event is an ASCII identifier emitted on tap. Design a navigable layout, size controls for native pixels, use contrasting luminance on monochrome. Reply in the user's language. No scripts or extra fields.` },
    { role: 'user', content: JSON.stringify({ display: screen, request: prompt }) },
  ] });
  try {
    const plan = blueprint.parse(JSON.parse(response.content.trim().replace(/^```(?:json)?\s*|\s*```$/gi,'')));
    if (plan.pages.length > capacity) throw new Error();
    return plan;
  } catch { throw new Error('模型返回的布局未通过页面、尺寸或事件校验，请缩小设计范围后重试'); }
}
