import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';

const generated = /^(?:node_modules|build(?:-.+)?|cmake-build-.+|dist|out|obj|objects|listings|target|debug|release|x64|x86|\.git|\.svn|\.pio|\.venv|venv|\.signaldesk-build)$/i;
const sourceFile = /\.(?:c|cc|cpp|cxx|h|hh|hpp|hxx|ino|s|asm|inc|ld|lds|icf|sct|cmake|mk|py|pyi|js|mjs|cjs|jsx|ts|tsx|rs|toml|lock|go|mod|sum|lua|java|cs|v|sv|vh|svh|json|ini|ya?ml|uvprojx?|ewp|bat|cmd|sh)$|^(?:Makefile|CMakeLists\.txt|sdkconfig(?:\..+)?)$/i;

// Validation includes project-local drivers, headers, linker files and test scripts.
export async function sourceFingerprint(root) {
  const hash = createHash('sha256'); let files = 0, bytes = 0, entries = 0;
  const walk = async (directory, depth) => {
    if (depth > 20) throw new Error('源码目录超过 20 层，无法完整复核本地源码');
    for (const entry of (await fs.readdir(directory, { withFileTypes: true })).sort((a, b) => a.name.localeCompare(b.name))) {
      if (++entries > 30000) throw new Error('源码目录条目过多，无法完整复核本地源码');
      if (generated.test(entry.name)) continue;
      const filename = path.join(directory, entry.name);
      if (entry.isSymbolicLink()) throw new Error(`源码版本校验暂不支持符号链接：${path.relative(root, filename)}`);
      if (entry.isDirectory()) { await walk(filename, depth + 1); continue; }
      if (!entry.isFile() || !sourceFile.test(entry.name)) continue;
      const before = await fs.stat(filename); bytes += before.size;
      if (++files > 10000 || bytes > 64 * 1024 * 1024 || before.size > 8 * 1024 * 1024) throw new Error('源码版本校验超出上限（10,000 文件 / 64 MiB / 单文件 8 MiB）');
      const content = await fs.readFile(filename), after = await fs.stat(filename);
      if (before.mtimeMs !== after.mtimeMs || before.size !== after.size) throw new Error('源码在扫描期间发生变化，请重试');
      hash.update(JSON.stringify([path.relative(root, filename).split(path.sep).join('/'), createHash('sha256').update(content).digest('hex')]));
    }
  };
  await walk(root, 0);
  return { fingerprint: hash.digest('hex'), files, bytes };
}
