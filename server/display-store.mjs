import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { sceneSchema } from '../shared/display-scene.mjs';

export function displayStore(directory, hub) {
  function filename({ deviceId, root }) {
    const entry = hub.devices.get(deviceId);
    if (!entry || hub.activeId !== deviceId || (entry.projectRoot || '') !== root) throw new Error('设备或工程已切换，请重新打开屏幕设计器');
    return path.join(directory, createHash('sha256').update(JSON.stringify([deviceId, root])).digest('hex') + '.json');
  }
  return {
    async createSketch(data) {
      filename(data);
      if (typeof data.code !== 'string' || !data.code.startsWith('// SignalDesk display sketch.') || data.code.length > 18 * 1024 * 1024) throw new Error('导出草图无效');
      const base = path.join(directory, 'exports'); await fs.mkdir(base, { recursive: true });
      const group = await fs.mkdtemp(path.join(base, 'design-'));
      const root = path.join(group, 'SignalDeskUI'); await fs.mkdir(root);
      await fs.writeFile(path.join(root, 'SignalDeskUI.ino'), data.code, { flag: 'wx' });
      return { root };
    },
    async load(scope) {
      const saved = filename(scope);
      try { return sceneSchema.parse(JSON.parse(await fs.readFile(saved, 'utf8'))); }
      catch (e) { if (e.code !== 'ENOENT') throw e; }
      if (!scope.root) return null;
      const candidate = path.join(scope.root, 'screen.signaldesk.json');
      try {
        const stat = await fs.lstat(candidate);
        if (!stat.isFile() || stat.size > 10 * 1024 * 1024) throw new Error('工程屏幕文件无效或过大');
        const scene = sceneSchema.parse(JSON.parse(await fs.readFile(candidate,'utf8')));
        filename(scope); return scene;
      } catch (e) { if(e.code==='ENOENT')return null;throw e; }
    },
    async save(data) {
      const dest = filename(data), checked = sceneSchema.parse(data.scene), tmp = `${dest}.${randomUUID()}.tmp`;
      await fs.mkdir(directory, { recursive: true });
      try { await fs.writeFile(tmp, JSON.stringify(checked)); await fs.rename(tmp, dest); } finally { await fs.rm(tmp, { force: true }); }
      return { ok: true };
    },
  };
}
