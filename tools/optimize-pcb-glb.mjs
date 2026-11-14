import fs from 'node:fs/promises';
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { GLTFExporter } from 'three/addons/exporters/GLTFExporter.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { inspectGlb } from '../src/model-validation.mjs';

const [input, output, reportPath] = process.argv.slice(2);
if (!reportPath) throw new Error('Usage: node tools/optimize-pcb-glb.mjs input.glb output.glb report.json');
const bytes = await fs.readFile(input), raw = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
inspectGlb(raw);
const loaded = await new GLTFLoader().parseAsync(raw, '');
if (loaded.animations.length) throw new Error('This offline optimizer only accepts static CAD exports');
const root = loaded.scene;
const stats = () => {
  let meshes = 0, triangles = 0; const components = [];
  root.traverse(object => { if (object.isMesh) { meshes++; triangles += (object.geometry.index?.count || object.geometry.attributes.position.count) / 3; } if (object.userData.reference) components.push(object.userData.reference); });
  const bounds = new THREE.Box3().setFromObject(root);
  return { meshes, triangles, components: components.sort(), min: bounds.min.toArray(), max: bounds.max.toArray() };
};
const before = stats(), parents = [];
root.traverse(object => { if (object.isGroup) parents.push(object); });
for (const parent of parents) {
  const groups = new Map();
  for (const mesh of [...parent.children]) {
    if (!mesh.isMesh || mesh.isSkinnedMesh || mesh.children.length || Array.isArray(mesh.material) || mesh.userData.reference || mesh.geometry.groups.length || Object.keys(mesh.geometry.morphAttributes).length) continue;
    const signature = Object.entries(mesh.geometry.attributes).map(([name, value]) => `${name}:${value.itemSize}:${value.normalized}:${value.array.constructor.name}`).sort().join('|');
    const key = `${mesh.material.uuid}:${!!mesh.geometry.index}:${signature}`;
    if (!groups.has(key)) groups.set(key, []); groups.get(key).push(mesh);
  }
  for (const meshes of groups.values()) {
    if (meshes.length < 2) continue;
    const copies = meshes.map(mesh => { mesh.updateMatrix(); return mesh.geometry.clone().applyMatrix4(mesh.matrix); });
    const merged = mergeGeometries(copies); copies.forEach(copy => copy.dispose());
    if (!merged) throw new Error('CAD face batching failed');
    const combined = new THREE.Mesh(merged, meshes[0].material); combined.name = '';
    for (const mesh of meshes) parent.remove(mesh);
    parent.add(combined);
  }
}
const after = stats();
if (before.triangles !== after.triangles || JSON.stringify(before.components) !== JSON.stringify(after.components) || [...before.min, ...before.max].some((value, i) => Math.abs(value - [...after.min, ...after.max][i]) > 1e-6)) throw new Error('CAD geometry changed unexpectedly during batching');
// Three's binary exporter uses browser FileReader for Blob serialization only.
globalThis.FileReader = class {
  readAsArrayBuffer(blob) { blob.arrayBuffer().then(result => { this.result = result; this.onloadend?.(); }).catch(error => this.onerror?.(error)); }
};
const data = await new GLTFExporter().parseAsync(root, { binary: true }); inspectGlb(data);
await fs.writeFile(output, Buffer.from(data));
const report = { before, after, bytes: data.byteLength, source: input, output, note: 'Merged coplanar-independent CAD face draw calls by material within each existing node. No triangle decimation, component transform or vertex position changes.' };
await fs.writeFile(reportPath, JSON.stringify(report, null, 2));
console.log(JSON.stringify({ meshesBefore: before.meshes, meshesAfter: after.meshes, triangles: after.triangles, components: after.components.length, bytes: data.byteLength }, null, 2));
