import { useEffect, useRef, useState } from 'react';
import { Check, RefreshCw, Wrench, X } from 'lucide-react';
import { api } from './data';
import { Field, IconButton } from './ui';

type Config = Record<string, string>;
export function BuildSettings({ deviceId, root, saved, close, embedded = false }: { deviceId: string; root: string; saved: () => void; close: () => void; embedded?: boolean }) {
  const dialog = useRef<HTMLDialogElement>(null), [config, setConfig] = useState<Config | null>(null), [session, setSession] = useState(''), [error, setError] = useState(''), [busy, setBusy] = useState(false), [readOnly, setReadOnly] = useState(true);
  const [compilers, setCompilers] = useState<{ path: string; family: string }[]>([]), [files, setFiles] = useState<string[]>([]);
  const scan = () => api<typeof compilers>('/toolchains/gcc').then(setCompilers).catch(error => setError(error.message));
  useEffect(() => {
    let active = true; const previous = document.activeElement, element = dialog.current; element?.showModal();
    api<{ deviceId: string; sessionId: string; readOnly: boolean; config: Config }>('/ai/state').then(value => {
      if (!active) return; if (value.deviceId !== deviceId || value.config.root !== root) throw new Error('工程已变化，请重新打开设置'); setConfig(value.config); setSession(value.sessionId); setReadOnly(value.readOnly);
    }).catch(error => { if (active) setError(error.message); });
    api<{ path: string }[]>(`/ai/files?deviceId=${encodeURIComponent(deviceId)}`).then(value => { if (active) setFiles(value.filter(item => item.path.endsWith('.cmake')).map(item => item.path)); }).catch(() => {});
    void scan();
    return () => { active = false; element?.close(); if (previous instanceof HTMLElement && previous.isConnected) previous.focus(); };
  }, []);
  const update = (key: string, value: string) => setConfig(current => current ? { ...current, [key]: value } : null);
  const field = (label: string, key: string, placeholder = '', list?: string) => <Field label={label}><input aria-label={label} value={config?.[key] || ''} onChange={event => update(key, event.target.value)} placeholder={placeholder} list={list} spellCheck={false} /></Field>;
  const save = async () => { if (!config) return; setBusy(true); setError(''); try { await api('/validation/config', { ...config, deviceId, sessionId: session, root }); saved(); close(); } catch (error) { setError((error as Error).message); } finally { setBusy(false); } };
  const Container = embedded ? 'div' : 'dialog';
  return <Container ref={(element: HTMLDivElement | HTMLDialogElement | null) => { if (element instanceof HTMLDialogElement) dialog.current = element; }} className={embedded ? 'embedded-build-settings' : 'build-settings-dialog'} aria-label="工程构建设置" onCancel={event => { if (busy) event.preventDefault(); else close(); }}>
    <div className="panel-toolbar"><span className="panel-title"><Wrench size={16} />工程构建设置</span><IconButton title="关闭构建设置" disabled={busy} onClick={close}><X size={16} /></IconButton></div>
    <form onSubmit={event => { event.preventDefault(); void save(); }}><div className="build-settings-body"><code className="build-settings-root">{root}</code>{error && <p className="inline-error" role="alert">{error}</p>}
      <fieldset disabled={busy || !config || readOnly}><Field label="工程构建工具"><select aria-label="工程构建工具" value={config?.buildPreset || 'none'} onChange={event => update('buildPreset', event.target.value)}><option value="none">尚未配置</option><option value="gcc">GCC 交叉编译 · CMake / Ninja</option><option value="cmake">CMake · 本机编译</option><option value="platformio">PlatformIO</option><option value="esp-idf">ESP-IDF</option><option value="arduino">Arduino CLI</option><option value="keil">Keil µVision</option><option value="iar">IAR</option></select></Field>
        {config?.buildPreset === 'gcc' && <>{field('GCC 交叉编译器路径', 'gccCompiler', '自动匹配或填写 gcc.exe 的绝对路径', 'gcc-compilers')}<datalist id="gcc-compilers">{compilers.map(item => <option key={item.path} value={item.path}>{item.family}</option>)}</datalist><div className="gcc-discovery"><button type="button" className="quiet-button" onClick={() => void scan()}><RefreshCw size={13} />检测编译器</button><span>{compilers.length} 个可用位置</span></div>{field('CMake 工具链文件', 'gccToolchainFile', 'cmake/gcc-arm-none-eabi.cmake', 'gcc-toolchain-files')}<datalist id="gcc-toolchain-files">{files.map(file => <option key={file} value={file} />)}</datalist></>}
        {config?.buildPreset === 'arduino' && field('开发板 FQBN', 'fqbn', 'esp32:esp32:esp32s3')}
        {config?.buildPreset === 'platformio' && field('PlatformIO 环境', 'platformioEnvironment')}
        {config?.buildPreset === 'keil' && <>{field('Keil 工程相对路径', 'keilProject')}{field('Keil Target 名称', 'keilTarget')}{field('UV4.exe 路径', 'keilExecutable')}</>}
        {config?.buildPreset === 'iar' && <>{field('IAR 工程相对路径', 'iarProject')}{field('IAR 配置名称', 'iarConfig')}{field('IarBuild.exe 路径', 'iarExecutable')}</>}
      </fieldset></div><div className="settings-actions"><button type="submit" className="primary" disabled={!config || busy || readOnly}><Check size={14} />保存构建设置</button></div></form>
  </Container>;
}
