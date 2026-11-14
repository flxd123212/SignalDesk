import { useEffect, useRef, useState } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { STLLoader } from 'three/addons/loaders/STLLoader.js';
import { GLTFExporter } from 'three/addons/exporters/GLTFExporter.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { Crosshair, RotateCcw, Upload, Download, Cpu, FileBox } from 'lucide-react';
import { Field } from './ui';
import { download, number } from './data';
import { orientation } from './pose-math.mjs';
import { inspectGlb } from './model-validation.mjs';
import { boardPresets, createBoard, disposeModel, suggestedBoard } from './board-models';
import type { AppState, Device } from './types';

type Component = { id: string; name: string; kind: string; evidence: string; pins: string; footprint?: string; pads?: { number: string; net: string }[] };
type Annotation = { name?: string; kind?: string; pins?: string; channel?: number; unit?: string };
type ImportedModel = { name: string; bytes: ArrayBuffer; format: string };
const modelSessions = new Map<string, { preset: string; imported: ImportedModel | null; upAxis: string; annotations: Record<string, Annotation> }>();
export function Attitude({ state }: { state: AppState }) {
  const scope = state as AppState & { activeDevice?: string; devices?: Device[] }, device = scope.devices?.find(item => item.id === scope.activeDevice), sessionKey = `${scope.activeDevice}:${device?.projectRoot || ''}`, restored = modelSessions.get(sessionKey);
  const mount = useRef<HTMLDivElement>(null), [mode, setMode] = useState('euler'), [unit, setUnit] = useState('deg'), [channels, setChannels] = useState([0, 1, 2, 3]), [source, setSource] = useState(new URLSearchParams(location.search).get('pose') === 'manual' ? 'manual' : 'live'), [manual, setManual] = useState([0, 0, 0]), [error, setError] = useState('');
  const [preset, setPreset] = useState(restored?.preset || (boardPresets.some(item => item.id === new URLSearchParams(location.search).get('board')) ? new URLSearchParams(location.search).get('board')! : suggestedBoard(device?.board || '', device?.chip || '') || 'esp32s3')), [imported, setImported] = useState<ImportedModel | null>(restored?.imported || null), [upAxis, setUpAxis] = useState(restored?.upAxis || 'Z'), [loading, setLoading] = useState(false), [components, setComponents] = useState<Component[]>([]), [selected, setSelected] = useState(''), [annotations, setAnnotations] = useState<Record<string, Annotation>>(restored?.annotations || {});
  const [showGrid, setShowGrid] = useState(true), [showAxes, setShowAxes] = useState(false), visibility = useRef({ showGrid, showAxes }), viewCamera = useRef((_view: string) => {});
  visibility.current = { showGrid, showAxes };
  const zero = useRef(new THREE.Quaternion()), resetCamera = useRef(() => {}), latest = useRef<THREE.Quaternion | null>(null), selectedRef = useRef(''), exportModel = useRef<THREE.Object3D | null>(null), alive = useRef(true), importGeneration = useRef(0);
  selectedRef.current = selected;
  const suggested = suggestedBoard(device?.board || '', device?.chip || '');
  const attitude = source === 'manual' ? orientation(manual, 'euler', [0, 1, 2], 'deg') : orientation(state.latest, mode, channels, unit);
  latest.current = attitude;
  useEffect(() => { alive.current = true; return () => { alive.current = false; importGeneration.current++; }; }, []);
  useEffect(() => { modelSessions.delete(sessionKey); modelSessions.set(sessionKey, { preset, imported, upAxis, annotations }); if (modelSessions.size > 8) modelSessions.delete(modelSessions.keys().next().value!); }, [sessionKey, preset, imported, upAxis, annotations]);
  useEffect(() => {
    if (!mount.current) return;
    const parent = mount.current; let renderer: THREE.WebGLRenderer;
    try { renderer = new THREE.WebGLRenderer({ antialias: true }); } catch { setError('WebGL 不可用，无法显示姿态模型'); return; }
    setError(''); setComponents([]); setSelected('');
    renderer.setPixelRatio(Math.min(devicePixelRatio, 2)); renderer.setClearColor(0x161a1c); renderer.toneMapping = THREE.ACESFilmicToneMapping; renderer.toneMappingExposure = 1.0; renderer.shadowMap.enabled = true; renderer.shadowMap.type = THREE.PCFSoftShadowMap; parent.appendChild(renderer.domElement); renderer.domElement.setAttribute('aria-label', '三维开发板姿态');
    const scene = new THREE.Scene(), camera = new THREE.PerspectiveCamera(38, 1, 0.1, 100); camera.up.set(0, 0, 1);
    const controls = new OrbitControls(camera, renderer.domElement); controls.enableDamping = true; controls.minDistance = 4; controls.maxDistance = 30;
    let aspectFactor = 1;
    viewCamera.current = view => { controls.enableDamping = false; controls.update(); const position: [number, number, number] = view === 'top' ? [0, -0.001, 7.4] : view === 'bottom' ? [0, -0.001, -7.4] : [3.8, -4.5, 4.5]; camera.position.set(...position).multiplyScalar(aspectFactor); controls.target.set(0, 0, 0); controls.update(); controls.enableDamping = true; };
    resetCamera.current = () => viewCamera.current('perspective'); resetCamera.current();
    const room = new RoomEnvironment(), pmrem = new THREE.PMREMGenerator(renderer), environment = pmrem.fromScene(room, 0.04); room.dispose(); pmrem.dispose(); scene.environment = environment.texture; scene.environmentIntensity = 0.55;
    scene.add(new THREE.HemisphereLight(0xe8f2ff, 0x4a555b, 0.65)); const light = new THREE.DirectionalLight(0xfff4df, 1.8); light.position.set(-3, -4, 7); light.castShadow = true; light.shadow.mapSize.set(1024, 1024); light.shadow.camera.left = -4; light.shadow.camera.right = 4; light.shadow.camera.top = 4; light.shadow.camera.bottom = -4; light.shadow.normalBias = 0.015; scene.add(light);
    const fill = new THREE.DirectionalLight(0xc5dfff, 0.7); fill.position.set(4, 2, 3); scene.add(fill);
    const grid = new THREE.GridHelper(12, 24, 0x414a50, 0x252e33); grid.rotateX(Math.PI / 2); grid.position.z = -1.5; scene.add(grid);
    const board = new THREE.Group(); scene.add(board); const axes = new THREE.AxesHelper(2.8); board.add(axes);
    const objects = new Map<string, THREE.Object3D>(), pointer = new THREE.Vector2(), raycaster = new THREE.Raycaster(), highlight = new THREE.BoxHelper(board, 0xf3c571); highlight.visible = false; scene.add(highlight);
    let disposed = false;
    const install = (model: THREE.Object3D) => {
      if (disposed) { disposeModel(model); return; }
      exportModel.current = model;
      const axis = new THREE.Group(); axis.add(model); if (upAxis === 'Y') axis.rotateX(Math.PI / 2);
      const box = new THREE.Box3().setFromObject(axis), size = box.getSize(new THREE.Vector3()), largest = Math.max(size.x, size.y, size.z);
      if (!Number.isFinite(largest) || largest < 1e-9) { disposeModel(model); exportModel.current = null; throw new Error('模型没有有效的三维几何体'); }
      const fit = new THREE.Group(), scale = 4.2 / largest; fit.scale.setScalar(scale); axis.position.sub(box.getCenter(new THREE.Vector3())); fit.add(axis); board.add(fit);
      const found: Component[] = []; let meshes = 0, declaredComponents = false;
      model.traverse(object => { if (object.userData.componentRoot === true) declaredComponents = true; });
      const walk = (object: THREE.Object3D, path: string) => {
        if (object instanceof THREE.Mesh) { meshes++; object.castShadow = true; object.receiveShadow = true; }
        const metadata = object.userData || {}, name = String(metadata.reference || metadata.ref || object.name || '').slice(0, 120); delete object.userData.signaldeskComponent;
        if (object !== model && name && !/^mesh_\d+$/.test(name) && (!declaredComponents || metadata.componentRoot === true)) {
          objects.set(path, object);
          const pads = Array.isArray(metadata.pcbPads) ? metadata.pcbPads.slice(0, 2000).filter((pad: unknown): pad is { number: string; net: string } => !!pad && typeof pad === 'object' && 'number' in pad && 'net' in pad && typeof pad.number === 'string' && typeof pad.net === 'string').map((pad: { number: string; net: string }) => ({ number: pad.number.slice(0, 80), net: pad.net.slice(0, 250) })) : undefined;
          found.push({ id: path, name, kind: String(metadata.value || metadata.kind || metadata.partNumber || '类型未标注').slice(0, 120), evidence: String(metadata.evidence || '模型节点名称 / 元数据，尚未核对实板').slice(0, 200), pins: typeof metadata.pins === 'string' ? metadata.pins.slice(0, 1000) : '', footprint: String(metadata.footprint || '').slice(0, 200), pads }); object.userData.signaldeskComponent = path;
        }
        object.children.forEach((child, i) => walk(child, `${path}/${i}`));
      }; walk(model, 'root');
      if (!found.length) { objects.set('root', model); model.userData.signaldeskComponent = 'root'; found.push({ id: 'root', name: imported?.name || '未标注模型', kind: '几何外形', evidence: '无可识别的独立元件名称，需要手动标注或带位号的模型', pins: '' }); }
      if (meshes > 5000) { board.remove(fit); disposeModel(model); exportModel.current = null; throw new Error('模型网格数量超过 5000'); }
      setComponents(found); setSelected(found[0].id); setLoading(false);
    };
    const load = async () => {
      try {
        if (!imported) install(createBoard(preset));
        else if (imported.format === 'glb') { const manager = new THREE.LoadingManager(); manager.setURLModifier(url => { if (!url.startsWith('blob:')) throw new Error('模型外部资源已阻止'); return url; }); const result = await new GLTFLoader(manager).parseAsync(imported.bytes, ''); install(result.scene); }
        else { const geometry = new STLLoader().parse(imported.bytes); if (geometry.getAttribute('position').count > 1500000) { geometry.dispose(); throw new Error('STL 超过 50 万三角形'); } geometry.computeVertexNormals(); install(new THREE.Mesh(geometry, new THREE.MeshStandardMaterial({ color: 0x7ba7b4, roughness: 0.6, side: THREE.DoubleSide }))); }
      } catch (failure) { if (!disposed) { setError((failure as Error).message); setLoading(false); } }
    }; void load();
    const resize = new ResizeObserver(() => { const width = Math.max(1, parent.clientWidth), height = Math.max(1, parent.clientHeight), nextFactor = Math.max(1, height / width); camera.position.sub(controls.target).multiplyScalar(nextFactor / aspectFactor).add(controls.target); aspectFactor = nextFactor; renderer.setSize(width, height); camera.aspect = width / height; camera.updateProjectionMatrix(); }); resize.observe(parent);
    let down = { x: 0, y: 0 };
    const press = (event: PointerEvent) => { down = { x: event.clientX, y: event.clientY }; };
    const pick = (event: PointerEvent) => { if (Math.hypot(event.clientX - down.x, event.clientY - down.y) > 5) return; const rect = renderer.domElement.getBoundingClientRect(); pointer.set((event.clientX - rect.left) / rect.width * 2 - 1, -(event.clientY - rect.top) / rect.height * 2 + 1); raycaster.setFromCamera(pointer, camera); for (const hit of raycaster.intersectObjects([...objects.values()], true)) { if (!(hit.object instanceof THREE.Mesh)) continue; let object: THREE.Object3D | null = hit.object; while (object && !object.userData.signaldeskComponent) object = object.parent; if (object) { setSelected(object.userData.signaldeskComponent); break; } } };
    renderer.domElement.addEventListener('pointerdown', press); renderer.domElement.addEventListener('pointerup', pick);
    let frame: number; const animate = () => { frame = requestAnimationFrame(animate); if (latest.current) board.quaternion.copy(zero.current).multiply(latest.current); const object = objects.get(selectedRef.current); highlight.visible = Boolean(object && object.name !== 'PCB'); if (object) highlight.setFromObject(object); grid.visible = visibility.current.showGrid; axes.visible = visibility.current.showAxes; controls.update(); renderer.render(scene, camera); }; animate();
    return () => { disposed = true; exportModel.current = null; cancelAnimationFrame(frame); resize.disconnect(); controls.dispose(); renderer.domElement.removeEventListener('pointerdown', press); renderer.domElement.removeEventListener('pointerup', pick); disposeModel(scene); environment.dispose(); light.shadow.dispose(); renderer.dispose(); renderer.domElement.remove(); };
  }, [preset, imported, upAxis]);
  const loadFile = async (file?: File) => {
    if (!file) return; const generation = ++importGeneration.current; setLoading(true); setError('');
    try { if (file.size > 20 * 1024 * 1024) throw new Error('3D 文件不能超过 20 MiB'); const format = file.name.split('.').at(-1)?.toLowerCase(); if (!['glb', 'stl'].includes(format || '')) throw new Error('支持 GLB / STL；STEP 请先通过 CAD 工具转换'); const bytes = await file.arrayBuffer(); if (format === 'glb') inspectGlb(bytes); if (!alive.current || generation !== importGeneration.current) return; setAnnotations({}); setImported({ name: file.name, bytes, format: format! }); setUpAxis(format === 'glb' ? 'Y' : 'Z'); }
    catch (failure) { if (alive.current && generation === importGeneration.current) { setError((failure as Error).message); setLoading(false); } }
  };
  const loadReference = async () => {
    const generation = ++importGeneration.current; setLoading(true); setError('');
    try {
      const response = await fetch('/models/royalblue54l/board.glb');
      if (!response.ok) throw new Error(`PCB 示例加载失败（HTTP ${response.status}）`);
      const bytes = await response.arrayBuffer(); inspectGlb(bytes);
      if (!alive.current || generation !== importGeneration.current) return;
      setImported({ name: 'RoyalBlue54L Feather · KiCad PCB', format: 'glb', bytes }); setAnnotations({}); setUpAxis('Y');
    } catch (failure) { if (alive.current && generation === importGeneration.current) { setError((failure as Error).message); setLoading(false); } }
  };
  useEffect(() => { if (!restored && new URLSearchParams(location.search).get('board') === 'royalblue54l') void loadReference(); }, []);
  const exportGlb = async () => { if (!exportModel.current) return; try { const data = await new GLTFExporter().parseAsync(exportModel.current, { binary: true }); const url = URL.createObjectURL(new Blob([data as ArrayBuffer], { type: 'model/gltf-binary' })), anchor = document.createElement('a'); anchor.href = url; anchor.download = 'signaldesk-board.glb'; anchor.click(); setTimeout(() => URL.revokeObjectURL(url), 1000); } catch (failure) { setError((failure as Error).message); } };
  const component = components.find(item => item.id === selected), annotation = annotations[selected] || {}, mapped = annotation.channel ?? -1;
  const annotate = (patch: Annotation) => setAnnotations(current => ({ ...current, [selected]: { ...current[selected], ...patch } }));
  return <section className="attitude-workspace">
    <div className="pcb-sample-toolbar"><button disabled={loading} onClick={() => void loadReference()}><FileBox size={15} />载入真实 PCB 示例</button>{imported?.name.startsWith('RoyalBlue54L') && <span>RoyalBlue54L Feather · KiCad 工程导出 · 50 个器件模型 · 位号 / 焊盘网络</span>}</div>
    <div className="model-view-toolbar"><div className="segmented" aria-label="模型视角"><button onClick={() => viewCamera.current('perspective')}>透视</button><button onClick={() => viewCamera.current('top')}>顶视</button><button onClick={() => viewCamera.current('bottom')}>底视</button></div><label className="checkbox"><input type="checkbox" checked={showGrid} onChange={event => setShowGrid(event.target.checked)} />网格</label><label className="checkbox"><input type="checkbox" checked={showAxes} onChange={event => setShowAxes(event.target.checked)} />坐标轴</label><span className="small-tag">{imported ? 'IMPORTED MODEL' : preset === 'esp32s3' ? 'DIMENSIONED REFERENCE' : 'ILLUSTRATIVE REFERENCE'}</span></div>
    {!imported && preset === 'esp32s3' && <div className="board-dimensions">ESP32-S3-DevKitC-1 v1.1 · PCB 25.40 x 62.74 mm · 2 x 22 pins / 2.54 mm · 板框尺寸参考，器件几何近似</div>}
    <div className="instrument-toolbar board-model-toolbar"><Field label="开发板模型"><select aria-label="开发板模型" value={imported ? 'imported' : preset} onChange={event => { importGeneration.current++; setLoading(false); setImported(null); setPreset(event.target.value); setAnnotations({}); setUpAxis('Z'); }}>{boardPresets.map(item => <option key={item.id} value={item.id}>{item.name} · {item.id === 'esp32s3' ? '尺寸参考' : '外观参考'}</option>)}{imported && <option value="imported">{imported.name}</option>}</select></Field><button disabled={!suggested} title={suggested ? '按当前设备的型号提示选择参考模型' : '当前设备暂无明确模型匹配'} onClick={() => { if (suggested) { importGeneration.current++; setLoading(false); setImported(null); setPreset(suggested); setAnnotations({}); setUpAxis('Z'); } }}><Cpu size={15} />匹配绑定开发板</button><label className="file-button"><Upload size={15} />导入 PCB 模型<input aria-label="导入 PCB 3D 模型" type="file" accept=".glb,.stl" onChange={event => { void loadFile(event.target.files?.[0]); event.target.value = ''; }} /></label><button disabled={loading || !components.length} onClick={() => void exportGlb()}><Download size={15} />导出 GLB</button><Field label="模型向上轴"><select aria-label="模型向上轴" value={upAxis} onChange={event => setUpAxis(event.target.value)}><option>Z</option><option>Y</option></select></Field></div>
    <div className="instrument-toolbar"><Field label="姿态来源"><select aria-label="姿态来源" value={source} onChange={event => { setSource(event.target.value); zero.current.identity(); }}><option value="live">设备通道</option><option value="manual">手动测试</option></select></Field>{source === 'live' && <><Field label="姿态格式"><select aria-label="姿态格式" value={mode} onChange={event => { setMode(event.target.value); zero.current.identity(); }}><option value="euler">Euler · ZYX</option><option value="quaternion">Quaternion · w x y z</option></select></Field>{mode === 'euler' && <Field label="角度单位"><select value={unit} onChange={event => { setUnit(event.target.value); zero.current.identity(); }}><option value="deg">deg</option><option value="rad">rad</option></select></Field>}{(mode === 'euler' ? ['Roll / X', 'Pitch / Y', 'Yaw / Z'] : ['w', 'x', 'y', 'z']).map((label, i) => <Field key={label} label={label}><select aria-label={`姿态 ${label}`} value={channels[i]} onChange={event => { setChannels(current => current.map((value, index) => index === i ? Number(event.target.value) : value)); zero.current.identity(); }}>{Array.from({ length: Math.max(4, state.names.length) }, (_, index) => <option key={index} value={index}>{state.names[index] || `CH${index + 1}`}</option>)}</select></Field>)}</>}<button disabled={!attitude} onClick={() => { if (attitude) zero.current.copy(attitude).invert(); }}><Crosshair size={15} />姿态归零</button><button onClick={() => { zero.current.identity(); resetCamera.current(); }}><RotateCcw size={15} />复位视图</button></div>
    {error && <p role="alert" className="instrument-error">{error}</p>}<div className="attitude-scene" ref={mount}><div className="attitude-status">{loading ? 'LOADING MODEL' : source === 'manual' ? 'MANUAL TEST' : attitude ? state.connected ? 'LIVE · Z-UP' : '离线 · 最后姿态' : '等待有效姿态数据'}<br />{component && (annotation.name || component.name)}{mapped >= 0 && ` · ${number(state.latest[mapped])} ${annotation.unit || ''}`}</div></div>
    {source === 'manual' && <div className="attitude-sliders">{['Roll', 'Pitch', 'Yaw'].map((label, i) => <Field key={label} label={`${label} · ${manual[i]}°`}><input aria-label={`${label} 测试角度`} type="range" min="-180" max="180" step="1" value={manual[i]} onChange={event => setManual(current => current.map((value, index) => index === i ? Number(event.target.value) : value))} /></Field>)}</div>}
    <div className="attitude-readout">{['w', 'x', 'y', 'z'].map(key => <span key={key}>{key.toUpperCase()} <b>{attitude ? attitude[key as 'w' | 'x' | 'y' | 'z'].toFixed(5) : '--'}</b></span>)}</div>
    <div className="model-inspector"><Field label={`模型元件 · ${components.length}`}><select aria-label="模型元件" value={selected} onChange={event => setSelected(event.target.value)}>{components.map(item => <option key={item.id} value={item.id}>{annotations[item.id]?.name || item.name}</option>)}</select></Field>{component && <><Field label="名称 / 位号"><input aria-label="元件名称位号" maxLength={120} value={annotation.name ?? component.name} onChange={event => annotate({ name: event.target.value })} /></Field><Field label="器件型号 / 类型"><input aria-label="元件型号" maxLength={120} value={annotation.kind ?? component.kind} onChange={event => annotate({ kind: event.target.value })} /></Field><Field label="引脚 / 网络标注"><input aria-label="元件引脚标注" maxLength={1000} value={annotation.pins ?? component.pins} onChange={event => annotate({ pins: event.target.value })} /></Field><Field label="数据通道"><select aria-label="元件数据通道" value={mapped} onChange={event => annotate({ channel: Number(event.target.value) })}><option value="-1">未绑定</option>{state.names.map((name, i) => <option key={i} value={i}>{name}</option>)}</select></Field><Field label="数据单位"><input maxLength={20} value={annotation.unit || ''} onChange={event => annotate({ unit: event.target.value })} /></Field><p className="instrument-notice">{component.evidence}</p><button onClick={() => download('board-component-map.json', JSON.stringify({ model: imported?.name || preset, device: scope.activeDevice, components: components.map(item => ({ ...item, ...annotations[item.id], annotationSource: annotations[item.id] ? 'user' : 'model' })) }, null, 2), 'application/json')}><Download size={15} />导出元件映射</button></>}</div>
    {!!component?.pads?.length && <section className="pcb-pad-table"><div className="panel-title">{component.name} · {component.footprint}</div><div className="table-scroll"><table><thead><tr><th>焊盘</th><th>PCB 网络</th></tr></thead><tbody>{component.pads.map((pad, index) => <tr key={index}><td>{pad.number || '未编号'}</td><td>{pad.net || '未分配'}</td></tr>)}</tbody></table></div></section>}
  </section>;
}
