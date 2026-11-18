import { createHash } from 'node:crypto';
import downloads from '../shared/tool-downloads.cjs';

// Arduino's published 1.2.2-checksums.txt, keyed by the target archive suffix.
const checksums = {
  'Windows_64bit.zip': 'bdd3ed88a361af8539e51a1cc0bf831b269be155ddfdd90cb96a900ce78723b7',
  'Linux_64bit.tar.gz': 'a5ad085d1b02fd4010df18b1bbf20453276efe6c6e2ac323baa0cac4e96a85b4',
  'Linux_ARM64.tar.gz': '4aa3b383db5184f61ecb93b7f0448d91d706effc8ea6f26290fb9b1a37ab8096',
  'macOS_64bit.tar.gz': 'fb3c019eb01fcaba46e12c0dfd00386f9bdb44a83f83a3d810a3bc303cc3e5dd',
  'macOS_ARM64.tar.gz': 'bf7a6ee89b63ee95f708c20bcb60fdb81037da1319269187ee100528f5ad1bd1',
};
let pending;
export async function verifiedArchive() {
  if (pending) return pending;
  async function download() {
    const url = downloads.sources()['arduino-cli'], name = new URL(url).pathname.split('/').at(-1);
    const digest = checksums[name.replace('arduino-cli_1.2.2_', '')];
    if (!digest) throw new Error('此架构请从官方安装入口下载');
    const response = await fetch(url, { signal: AbortSignal.timeout(120000) });
    if (!response.ok || !response.body) throw new Error(`工具下载失败 HTTP ${response.status}`);
    const chunks = [], hash = createHash('sha256'); let size = 0;
    for await (const part of response.body) {
      size += part.byteLength;
      if (size > 64 * 1024 * 1024) throw new Error('安装包超过大小上限');
      hash.update(part); chunks.push(part);
    }
    if (hash.digest('hex') !== digest) throw new Error('Arduino 安装包 SHA256 校验失败');
    return { name, bytes: Buffer.concat(chunks, size) };
  }
  pending = download().finally(() => { pending = null; }); return pending;
}
