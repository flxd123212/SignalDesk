import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { XMLParser, XMLValidator } from 'fast-xml-parser';

const array = value => value === undefined ? [] : Array.isArray(value) ? value : [value];
const hash = data => createHash('sha256').update(data).digest('hex');
export function keilPlan(config, root, flash = false) {
  const relative = config.keilProject;
  if (typeof relative !== 'string' || !relative || relative.length > 400 || path.isAbsolute(relative) || relative.split(/[\\/]/).some(part => part === '..') || !/\.uvprojx?$/i.test(relative)) throw new Error('请选择工程目录内的 .uvprojx 或 .uvproj 文件');
  if (typeof config.keilTarget !== 'string' || !config.keilTarget.trim() || config.keilTarget.length > 120 || /^[\s-]|[\r\n\x00]/.test(config.keilTarget)) throw new Error('请输入 Keil Target 名称');
  const project = path.resolve(root, relative), logFile = path.join(root, '.signaldesk-build', `keil-${flash ? 'flash' : 'build'}-${randomUUID()}.log`);
  return { command: 'UV4', args: [flash ? '-f' : '-b', project, '-t', config.keilTarget, '-o', logFile, '-j0'], cwd: root, project, logFile, target: `KEIL:${config.keilTarget}`, confirmation: `WRITE KEIL:${config.keilTarget}`, keilConfig: { keilProject: relative, keilTarget: config.keilTarget }, root };
}

export async function readKeilProject(root, relative) {
  if (typeof relative !== 'string' || path.isAbsolute(relative) || !/\.uvprojx?$/i.test(relative)) throw new Error('Keil 工程文件无效');
  const realRoot = await fs.realpath(root), filename = await fs.realpath(path.resolve(root, relative)), inside = path.relative(realRoot, filename);
  if (!inside || inside.startsWith('..') || path.isAbsolute(inside)) throw new Error('Keil 工程必须位于绑定目录内');
  if ((await fs.stat(filename)).size > 2 * 1024 * 1024) throw new Error('Keil 工程文件超过 2 MiB');
  const bytes = await fs.readFile(filename), text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  if (/<!DOCTYPE|<!ENTITY/i.test(text) || XMLValidator.validate(text) !== true) throw new Error('不支持的工程 XML');
  const parsed = new XMLParser({ ignoreAttributes: false, parseTagValue: false, processEntities: false }).parse(text);
  const targets = array(parsed.Project?.Targets?.Target).map(target => {
    const common = target.TargetOption?.TargetCommonOption || {};
    return { name: String(target.TargetName || ''), chip: String(common.Device || ''), vendor: String(common.Vendor || ''), outputDirectory: String(common.OutputDirectory || ''), outputName: String(common.OutputName || ''), hexEnabled: common.CreateHexFile === '1', files: array(target.Groups?.Group).flatMap(group => array(group.Files?.File).map(file => ({ name: file.FileName, path: file.FilePath }))) };
  });
  if (!targets.length || targets.some(target => !target.name)) throw new Error('工程没有有效 Target');
  const options = filename.replace(/\.uvproj(x?)$/i, '.uvopt$1');
  let optionsHash = null;
  try { optionsHash = hash(await fs.readFile(options)); } catch (error) { if (error.code !== 'ENOENT') throw error; }
  return { path: relative, filename, sha256: hash(bytes), optionsHash, targets };
}

export async function findKeilExecutable(supplied = '') {
  const basename = process.platform === 'win32' ? 'UV4.exe' : 'UV4';
  const candidates = supplied ? [supplied] : [...(process.env.PATH || '').split(path.delimiter).map(folder => path.join(folder.replace(/^"|"$/g, ''), basename)), 'D:\\Keil5 C51\\UV4\\UV4.exe', 'C:\\Keil_v5\\UV4\\UV4.exe', 'C:\\Keil\\UV4\\UV4.exe', 'D:\\Keil_v5\\UV4\\UV4.exe'];
  for (const candidate of candidates) {
    if (!path.isAbsolute(candidate) || path.basename(candidate).toLowerCase() !== basename.toLowerCase()) continue;
    try { if ((await fs.stat(candidate)).isFile()) return candidate; } catch { /* Try installed locations. */ }
  }
  throw new Error('未找到 Keil UV4.exe，请安装 µVision 并指定路径');
}

export async function keilArtifact(root, project, targetName) {
  const target = project.targets.find(item => item.name === targetName);
  if (!target?.outputName) throw new Error('Keil 工程未配置输出文件名');
  const directory = path.resolve(path.dirname(project.filename), target.outputDirectory.replaceAll('\\', path.sep));
  const names = [target.outputName, target.outputName + '.axf', target.outputName + '.hex', target.outputName + '.abs', target.outputName + '.elf'];
  const realRoot = await fs.realpath(root);
  for (const name of names) {
    try {
      const filename = await fs.realpath(path.join(directory, name)), relative = path.relative(realRoot, filename), stat = await fs.stat(filename);
      if (!stat.isFile()) continue;
      if (relative.startsWith('..') || path.isAbsolute(relative) || stat.size > 32 * 1024 * 1024) throw new Error('Keil 输出文件不在绑定工程内或超过 32 MiB');
      const bytes = await fs.readFile(filename); return { path: filename, sha256: hash(bytes), bytes: bytes.length };
    } catch (error) { if (error.code !== 'ENOENT') throw error; }
  }
  throw new Error('未找到 Keil 构建输出，请先成功编译所选 Target');
}
