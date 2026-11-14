export function inspectGlb(buffer) {
  if (!(buffer instanceof ArrayBuffer) || buffer.byteLength < 20 || buffer.byteLength > 20 * 1024 * 1024) throw new Error('GLB 模型大小应为 20 B..20 MiB');
  const view = new DataView(buffer);
  if (view.getUint32(0, true) !== 0x46546c67 || view.getUint32(4, true) !== 2 || view.getUint32(8, true) !== buffer.byteLength || view.getUint32(16, true) !== 0x4e4f534a) throw new Error('需要有效的 glTF 2.0 GLB 文件');
  const length = view.getUint32(12, true); if (length > buffer.byteLength - 20) throw new Error('GLB JSON 区越界');
  const data = JSON.parse(new TextDecoder().decode(new Uint8Array(buffer, 20, length)));
  if ((data.accessors || []).some(item => !Number.isInteger(item.count) || item.count < 0)) throw new Error('GLB 访问器数量无效');
  if ((data.buffers || []).some(item => item.uri) || (data.images || []).some(item => item.uri)) throw new Error('仅接受所有资源内嵌的 GLB，禁止外部文件或网络资源');
  if ((data.extensionsRequired || []).some(name => !['KHR_materials_unlit', 'KHR_materials_clearcoat', 'KHR_materials_ior', 'KHR_materials_specular', 'KHR_texture_transform', 'KHR_mesh_quantization'].includes(name))) throw new Error('模型需要未配置的扩展或压缩解码器，请导出未压缩 GLB');
  if ((data.nodes || []).length > 5000 || (data.accessors || []).reduce((sum, item) => sum + Number(item.count || 0), 0) > 3000000) throw new Error('模型超过 5000 节点或 300 万访问器元素');
  const nodes = data.nodes || [], parents = new Set(), colors = new Uint8Array(nodes.length);
  for (const node of nodes) for (const child of node.children || []) { if (!Number.isInteger(child) || child < 0 || child >= nodes.length || parents.has(child)) throw new Error('GLB 节点引用无效或有多个父节点'); parents.add(child); }
  for (let root = 0; root < nodes.length; root++) {
    if (colors[root] === 2) continue;
    const stack = [[root, false]];
    while (stack.length) { const [index, exit] = stack.pop(); if (exit) { colors[index] = 2; continue; } if (colors[index] === 1) throw new Error('GLB 节点存在循环引用'); if (colors[index] === 2) continue; colors[index] = 1; stack.push([index, true]); for (const child of nodes[index].children || []) stack.push([child, false]); }
  }
  return data;
}
