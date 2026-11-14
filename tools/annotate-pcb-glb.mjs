import fs from 'node:fs/promises';
import { inspectGlb } from '../src/model-validation.mjs';

const [input, metadataPath, output, reportPath] = process.argv.slice(2);
if (!reportPath) throw new Error('Usage: node tools/annotate-pcb-glb.mjs input.glb metadata.json output.glb report.json');
const buffer = await fs.readFile(input), metadata = JSON.parse(await fs.readFile(metadataPath, 'utf8'));
if (buffer.readUInt32LE(0) !== 0x46546c67 || buffer.readUInt32LE(4) !== 2) throw new Error('Expected GLB 2');
const oldLength = buffer.readUInt32LE(12), document = JSON.parse(buffer.subarray(20, 20 + oldLength).toString('utf8'));
const entries = new Map(metadata.footprints.map(item => [item.reference, item])), represented = new Set();
for (const node of document.nodes || []) {
  const part = entries.get(node.name);
  if (!part) continue;
  represented.add(part.reference);
  node.extras = { ...node.extras, reference: part.reference, value: part.value, footprint: part.footprint, pins: part.pads.map(pad => `${pad.number}:${pad.net || '(no net)'}`).join(', '), pcbPads: part.pads, componentRoot: true, evidence: 'KiCad PCB 位号、封装与焊盘网络；模型来自工程 3D 资源，未做实板核对' };
}
// Keep imported glTF geometry/transforms unchanged; add only source and component metadata.
document.asset.extras = { ...document.asset.extras, board: metadata.name, sourceSha256: metadata.sourceSha256, sourceLicense: metadata.sourceLicense, provenance: metadata.provenance };
const json = Buffer.from(JSON.stringify(document)), padded = Buffer.alloc(Math.ceil(json.length / 4) * 4, 32); json.copy(padded);
const rest = buffer.subarray(20 + oldLength), header = Buffer.from(buffer.subarray(0, 20)); header.writeUInt32LE(20 + padded.length + rest.length, 8); header.writeUInt32LE(padded.length, 12);
const result = Buffer.concat([header, padded, rest]); inspectGlb(result.buffer.slice(result.byteOffset, result.byteOffset + result.byteLength));
await fs.writeFile(output, result);
const report = { name: metadata.name, bytes: result.length, footprints: entries.size, represented: [...represented].sort(), withoutModelGeometry: [...entries.values()].filter(item => !represented.has(item.reference)).map(item => ({ reference: item.reference, value: item.value, models: item.models })), missingResources: metadata.missingModels, meshCount: document.meshes.length, nodeCount: document.nodes.length, sourceSha256: metadata.sourceSha256 };
await fs.writeFile(reportPath, JSON.stringify(report, null, 2));
console.log(JSON.stringify({ bytes: report.bytes, footprints: report.footprints, represented: represented.size, missingResources: report.missingResources, withoutModelGeometry: report.withoutModelGeometry.map(item => item.reference) }, null, 2));
