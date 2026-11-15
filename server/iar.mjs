import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { XMLParser, XMLValidator } from 'fast-xml-parser';
import { toolDirectories, executableNames, isExecutable } from './platform.mjs';

const array = value => value === undefined ? [] : Array.isArray(value) ? value : [value];
export function iarPlan(config, root) {
  if (typeof config.iarProject !== 'string' || !/\.ewp$/i.test(config.iarProject) || path.isAbsolute(config.iarProject) || config.iarProject.split(/[\\/]/).includes('..')) throw new Error('请选择绑定目录内的 IAR .ewp 工程');
  if (typeof config.iarConfig !== 'string' || !config.iarConfig.trim() || config.iarConfig.length > 120 || /^-|[\x00\r\n]/.test(config.iarConfig)) throw new Error('IAR 配置名称无效');
  return { command: 'IarBuild', args: [path.resolve(root, config.iarProject), '-build', config.iarConfig, '-log', 'all'], cwd: root, iarConfig: { iarProject: config.iarProject, iarConfig: config.iarConfig } };
}

export async function readIarProject(root, relative) {
  if (typeof relative !== 'string' || path.isAbsolute(relative) || !/\.ewp$/i.test(relative)) throw new Error('IAR 工程文件无效');
  const realRoot = await fs.realpath(root), filename = await fs.realpath(path.resolve(realRoot, relative)), inside = path.relative(realRoot, filename);
  if (!inside || inside.startsWith('..') || path.isAbsolute(inside) || (await fs.stat(filename)).size > 2 * 1024 * 1024) throw new Error('IAR 工程不在绑定目录内或文件过大');
  const bytes = await fs.readFile(filename), text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  if (/<!DOCTYPE|<!ENTITY/i.test(text) || XMLValidator.validate(text) !== true) throw new Error('不支持的 IAR 工程 XML');
  const document = new XMLParser({ parseTagValue: false, processEntities: false }).parse(text).project;
  const configurations = array(document?.configuration).map(config => ({ name: config.name, toolchain: config.toolchain?.name || '', chip: array(config.settings).flatMap(group => array(group.data?.option)).find(option => /^(Device|OGChipSelectEditMenu)$/i.test(option.name || ''))?.state || '' }));
  if (!configurations.length || configurations.some(config => !config.name)) throw new Error('IAR 工程没有有效配置');
  const files = [];
  const walk = (group, depth = 0) => { if (depth > 20 || files.length > 2000) return; for (const file of array(group?.file)) files.push(String(file.name)); for (const next of array(group?.group)) walk(next, depth + 1); };
  walk(document);
  return { path: relative, configurations, files, sha256: createHash('sha256').update(bytes).digest('hex') };
}

export async function findIarExecutable(supplied = '', command = 'IarBuild') {
  const names = executableNames(command), basename = names[0];
  const candidates = supplied ? [supplied] : [...toolDirectories(), ...(process.env.IAR_PATH ? [process.env.IAR_PATH] : []), ...(process.platform === 'win32' ? ['D:\\IAR\\common\\bin'] : [])].flatMap(folder => names.map(name => path.join(folder, name)));
  for (const candidate of candidates) {
    if (!path.isAbsolute(candidate) || !names.some(name => name.toLowerCase() === path.basename(candidate).toLowerCase())) continue;
    if (await isExecutable(candidate)) return candidate;
  }
  throw new Error(`未找到 IAR ${basename}，请设置工具路径`);
}
