import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';

const directory = path.resolve('release');
const { version } = JSON.parse(await fs.readFile(path.resolve('package.json'), 'utf8'));
const files = (await fs.readdir(directory)).filter(file => [`SignalDesk-Setup-${version}-x64.exe`, `SignalDesk-Portable-${version}-x64.exe`].includes(file));
if (files.length !== 2) throw new Error('Build both the NSIS and Portable targets first.');
const manifest = [];
for (const file of files) {
  const bytes = await fs.readFile(path.join(directory, file));
  manifest.push({ file, bytes: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex') });
}
await fs.writeFile(path.join(directory, 'SHA256SUMS.txt'), manifest.map(item => `${item.sha256}  ${item.file}`).join('\n') + '\n');
await fs.writeFile(path.join(directory, 'release-manifest.json'), JSON.stringify({ generatedAt: new Date().toISOString(), platform: 'win32', arch: 'x64', signed: false, files: manifest }, null, 2));
console.log(JSON.stringify(manifest, null, 2));
