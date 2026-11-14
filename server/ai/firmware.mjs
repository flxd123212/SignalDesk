import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { createTwoFilesPatch, structuredPatch } from 'diff';

const allowed = new Set(['.c', '.h', '.cpp', '.hpp', '.cc', '.cxx', '.hxx', '.cmake', '.ino', '.rs', '.py', '.ini', '.toml', '.txt', '.json', '.yaml', '.yml', '.ioc', '.uvprojx', '.uvproj', '.uvoptx', '.uvopt', '.sct', '.s', '.ld', '.ewp', '.eww', '.ewd', '.icf']);
const excluded = new Set(['node_modules', '.git', '.pio', 'build', 'target', '.signaldesk-backups', '.references', '.venv']);
const hash = content => createHash('sha256').update(content).digest('hex');

export class FirmwareWorkspace {
  constructor(root, historyDirectory = '') { this.root = path.resolve(root); this.proposals = new Map(); this.historyDirectory = historyDirectory; }
  async persist(proposal) {
    if (!this.historyDirectory) return;
    await fs.mkdir(this.historyDirectory, { recursive: true });
    const target = path.join(this.historyDirectory, proposal.id + '.json');
    const temporary = target + '.tmp';
    await fs.writeFile(temporary, JSON.stringify(proposal)); await fs.rename(temporary, target);
  }
  async history() {
    if (!this.historyDirectory) return [];
    await fs.mkdir(this.historyDirectory, { recursive: true });
    const files = (await fs.readdir(this.historyDirectory)).filter(file => /^[\da-f-]{36}\.json$/.test(file));
    const records = [];
    for (const file of files) { const record = JSON.parse(await fs.readFile(path.join(this.historyDirectory, file), 'utf8')); if (record.root === this.root) { const { content, beforeContent, diff, hunks, ...summary } = record; records.push(summary); } }
    return records.sort((a, b) => b.createdAt.localeCompare(a.createdAt)).slice(0, 200);
  }
  async change(id) {
    if (typeof id !== 'string' || !/^[\da-f-]{36}$/.test(id)) throw new Error('修改记录 ID 无效');
    const record = this.proposals.get(id) || (this.historyDirectory && JSON.parse(await fs.readFile(path.join(this.historyDirectory, id + '.json'), 'utf8')));
    if (!record || record.root !== this.root) throw new Error('记录不属于当前工程');
    return record;
  }

  async setRoot(root) {
    if (typeof root !== 'string' || !path.isAbsolute(root)) throw new Error('固件目录必须为绝对路径');
    const resolved = await fs.realpath(root);
    if (!(await fs.stat(resolved)).isDirectory()) throw new Error('固件路径不是目录');
    this.root = resolved; this.proposals.clear();
  }

  async resolve(relative) {
    if (typeof relative !== 'string' || !relative || relative.length > 400 || path.isAbsolute(relative)) throw new Error('文件路径必须相对于固件目录');
    const segments = relative.split(/[\\/]/);
    if (segments.some(part => part === '..' || part.startsWith('.') || excluded.has(part))) throw new Error('不能访问固件目录之外或隐藏的文件');
    const root = await fs.realpath(this.root), filename = await fs.realpath(path.resolve(root, relative));
    const inside = path.relative(root, filename);
    if (!inside || inside.startsWith('..') || path.isAbsolute(inside) || !allowed.has(path.extname(filename).toLowerCase())) throw new Error('不受支持的固件文件路径');
    if (!(await fs.stat(filename)).isFile()) throw new Error('目标不是普通文件');
    return filename;
  }

  async list() {
    const files = [];
    const walk = async (directory, depth) => {
      if (depth > 6 || files.length >= 300) return;
      for (const entry of await fs.readdir(directory, { withFileTypes: true })) {
        if (entry.name.startsWith('.') || excluded.has(entry.name) || entry.isSymbolicLink()) continue;
        const filename = path.join(directory, entry.name);
        if (entry.isDirectory()) await walk(filename, depth + 1);
        else if (entry.isFile() && allowed.has(path.extname(entry.name).toLowerCase()) && files.length < 300) {
          const stat = await fs.stat(filename);
          files.push({ path: path.relative(this.root, filename).split(path.sep).join('/'), bytes: stat.size });
        }
      }
    };
    await walk(this.root, 0); return files.sort((a, b) => a.path.localeCompare(b.path));
  }

  async read(relative) {
    const filename = await this.resolve(relative);
    if ((await fs.stat(filename)).size > 96 * 1024) throw new Error('代码分析暂支持 96 KiB 以内的单文件');
    const bytes = await fs.readFile(filename);
    let content;
    try { content = new TextDecoder('utf-8', { fatal: true }).decode(bytes); }
    catch { throw new Error('固件文件必须使用 UTF-8 编码'); }
    return { path: relative, content, hash: hash(bytes), bytes: bytes.length };
  }

  async propose({ path: relative, expectedHash, content, reason }) {
    if (this.proposals.size >= 40) throw new Error('修改提案数量已达上限，请开启新会话');
    if (typeof content !== 'string' || Buffer.byteLength(content) > 96 * 1024 || typeof reason !== 'string') throw new Error('修改提案格式无效或文件过大');
    const before = await this.read(relative);
    if (expectedHash !== before.hash) throw new Error('文件已经变化，请重新读取后生成提案');
    const normalized = before.content.includes('\r\n') ? content.replace(/\r?\n/g, '\r\n') : content.replace(/\r\n/g, '\n');
    if (normalized === before.content) throw new Error('提案未包含任何修改');
    const proposal = { id: randomUUID(), type: 'file', status: 'pending', root: this.root, path: relative, expectedHash, content: normalized, reason: reason.slice(0, 2000), diff: createTwoFilesPatch(`a/${relative}`, `b/${relative}`, before.content, normalized), createdAt: new Date().toISOString() };
    proposal.beforeContent = before.content; proposal.afterHash = hash(normalized);
    proposal.hunks = structuredPatch(relative, relative, before.content, normalized, '', '', { context: 3 }).hunks;
    await this.persist(proposal);
    this.proposals.set(proposal.id, proposal); return proposal;
  }

  async apply(id) {
    const proposal = this.proposals.get(id);
    if (!proposal || proposal.status !== 'pending' || proposal.root !== this.root) throw new Error('修改提案已失效');
    proposal.status = 'applying';
    try {
    const filename = await this.resolve(proposal.path), before = await fs.readFile(filename);
    if (hash(before) !== proposal.expectedHash) throw new Error('文件在提案后已被修改，未覆盖新内容');
    const backupRoot = path.join(this.root, '.signaldesk-backups', proposal.id);
    const backupPath = path.join(backupRoot, proposal.path);
    let ancestor = path.dirname(backupPath);
    while (true) {
      try { const real = await fs.realpath(ancestor), inside = path.relative(await fs.realpath(this.root), real); if (inside.startsWith('..') || path.isAbsolute(inside)) throw new Error('备份目录不能通过链接指向工程之外'); break; }
      catch (error) { if (error.code !== 'ENOENT') throw error; ancestor = path.dirname(ancestor); }
    }
    await fs.mkdir(path.dirname(backupPath), { recursive: true });
    const resolvedBackup = await fs.realpath(path.dirname(backupPath)), resolvedRoot = await fs.realpath(this.root), insideBackup = path.relative(resolvedRoot, resolvedBackup);
    if (insideBackup.startsWith('..') || path.isAbsolute(insideBackup)) throw new Error('备份目录不能通过链接指向工程之外');
    await fs.writeFile(backupPath, before, { flag: 'wx' });
    const temporary = path.join(path.dirname(filename), `.signaldesk-${proposal.id}.tmp`);
    await fs.writeFile(temporary, proposal.content, { flag: 'wx' });
    await fs.rename(temporary, filename);
    proposal.status = 'applied'; proposal.backup = backupPath; proposal.appliedAt = new Date().toISOString(); await this.persist(proposal); return proposal;
    } catch (error) { if (proposal.status !== 'applied') proposal.status = 'failed'; await this.persist(proposal).catch(() => {}); throw error; }
  }
}
