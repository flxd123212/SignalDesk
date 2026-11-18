import { useEffect, useRef, useState } from 'react';
import { cppLanguage } from '@codemirror/lang-cpp';
import { javascriptLanguage, typescriptLanguage } from '@codemirror/lang-javascript';
import { pythonLanguage } from '@codemirror/lang-python';
import { rustLanguage } from '@codemirror/lang-rust';
import { FileCode2, Search, X } from 'lucide-react';
import { api } from './data';
import { IconButton } from './ui';

export type OutlineItem = { name: string; line: number; kind: 'function' | 'type' };
type SearchReport = { matches: { path: string; line: number; text: string }[]; scannedFiles: number; skippedFiles: number; truncated: boolean };

export function ProjectSearch({ deviceId, root, open, close }: { deviceId: string; root: string; open: (file: string, line: number) => void; close: () => void }) {
  const dialog = useRef<HTMLDialogElement>(null), sequence = useRef(0);
  const [query, setQuery] = useState(''), [result, setResult] = useState<SearchReport | null>(null), [error, setError] = useState(''), [busy, setBusy] = useState(false);
  useEffect(() => {
    const element = dialog.current, previous = document.activeElement;
    element?.showModal();
    return () => { sequence.current++; element?.close(); if (previous instanceof HTMLElement && previous.isConnected) previous.focus(); };
  }, []);
  const search = async () => {
    if (!query.trim() || busy) return;
    const id = ++sequence.current;
    setBusy(true); setError(''); setResult(null);
    try {
      const report = await api<SearchReport>('/project/search', { deviceId, root, query });
      if (id === sequence.current) setResult(report);
    } catch (e) { if (id === sequence.current) setError((e as Error).message); }
    finally { if (id === sequence.current) setBusy(false); }
  };
  return <dialog className="command-palette" ref={dialog} aria-label="查找工程正文" onCancel={close}>
    <form className="palette-search" onSubmit={event => { event.preventDefault(); void search(); }}>
      <Search size={18}/><input autoFocus aria-label="工程正文关键词" placeholder="查找工程正文" maxLength={200} value={query} onChange={event => { sequence.current++; setQuery(event.target.value); setResult(null); setError(''); setBusy(false); }}/>
      <button className="quiet-button" disabled={busy || !query.trim()} type="submit">查找</button><IconButton title="关闭工程搜索" onClick={close}><X size={16}/></IconButton>
    </form>
    <div className="palette-results" aria-label="工程正文结果">
      {result?.matches.map(match => <button key={`${match.path}:${match.line}`} onClick={() => { open(match.path, match.line); close(); }}><FileCode2 size={16}/><span>{match.path}:{match.line}<small>{match.text}</small></span></button>)}
      <p className="palette-empty" role="status">{busy ? '正在搜索工程…' : error || (result ? `匹配 ${result.matches.length} 行，已搜索 ${result.scannedFiles} 个文件${result.truncated ? `（部分结果，跳过 ${result.skippedFiles} 个文件或已达到扫描上限）` : ''}` : '')}</p>
    </div>
  </dialog>;
}
export function sourceOutline(file: string, content: string): OutlineItem[] {
  const language = /\.(?:c|h|cc|cpp|cxx|hpp|ino)$/i.test(file) ? cppLanguage : /\.[cm]?jsx?$/i.test(file) ? javascriptLanguage : /\.tsx?$/i.test(file) ? typescriptLanguage : /\.pyi?$/i.test(file) ? pythonLanguage : /\.rs$/i.test(file) ? rustLanguage : null;
  if (!language || !content) return [];
  const symbols: OutlineItem[] = [], tree = language.parser.parse(content);
  let line = 1, scanned = 0;
  tree.iterate({ enter(node) {
    const type = ['StructSpecifier', 'ClassSpecifier', 'EnumSpecifier', 'ClassDeclaration', 'ClassDefinition', 'StructItem', 'EnumItem', 'TraitItem', 'InterfaceDeclaration', 'TypeAliasDeclaration'].includes(node.name);
    if (!type && !['FunctionDefinition', 'FunctionDeclaration', 'MethodDeclaration', 'FunctionItem'].includes(node.name)) return;
    const definition = node.node.getChild('FunctionDeclarator') || node.node;
    const name = definition.getChild('Identifier') || definition.getChild('QualifiedIdentifier') || definition.getChild('TypeIdentifier') || definition.getChild('VariableDefinition') || definition.getChild('PropertyDefinition') || definition.getChild('FieldIdentifier') || definition.getChild('VariableName');
    if (name && symbols.length < 300) {
      while (scanned < node.from) { if (content.charCodeAt(scanned) === 10) line++; scanned++; }
      symbols.push({ name: content.slice(name.from, name.to), line, kind: type ? 'type' : 'function' });
    }
  } });
  return symbols;
}

export function QuickOpenFile({ deviceId, open, close }: { deviceId: string; open: (file: string, line?: number) => void; close: () => void }) {
  const dialog = useRef<HTMLDialogElement>(null), input = useRef<HTMLInputElement>(null), [files, setFiles] = useState<{ path: string }[]>([]), [query, setQuery] = useState(''), [selected, setSelected] = useState(0), [error, setError] = useState(''), [loading, setLoading] = useState(true);
  useEffect(() => {
    let active = true; const previous = document.activeElement, element = dialog.current;
    element?.showModal(); input.current?.focus();
    api<{ path: string }[]>(`/ai/files?deviceId=${encodeURIComponent(deviceId)}`).then(value => { if (active) setFiles(value); }).catch(error => { if (active) setError(error.message); }).finally(() => { if (active) setLoading(false); });
    return () => { active = false; element?.close(); if (previous instanceof HTMLElement && previous.isConnected) previous.focus(); };
  }, [deviceId]);
  const suffix = query.match(/:(\d+)$/), line = suffix ? Math.min(10000000, Math.max(1, Number(suffix[1]))) : undefined;
  const tokens = query.replace(/:\d+$/, '').toLowerCase().split(/\s+/).filter(Boolean), matches = files.filter(file => tokens.every(token => file.path.toLowerCase().includes(token))).slice(0, 80), index = Math.min(selected, Math.max(0, matches.length - 1));
  const choose = (file: string) => { open(file, line); close(); };
  useEffect(() => { dialog.current?.querySelector('[aria-selected="true"]')?.scrollIntoView({ block: 'nearest' }); }, [index, query]);
  return <dialog ref={dialog} className="command-palette quick-open" aria-label="快速打开文件" onCancel={close} onClick={event => { if (event.target === dialog.current) close(); }}>
    <div className="palette-search"><Search size={18} /><input ref={input} role="combobox" aria-label="搜索项目文件" aria-expanded="true" aria-controls="file-search-results" aria-activedescendant={matches.length ? `file-result-${index}` : undefined} placeholder="文件名或路径" value={query} onChange={event => { setQuery(event.target.value); setSelected(0); }} onKeyDown={event => {
      if (event.nativeEvent.isComposing) return;
      if (event.key === 'ArrowUp' || event.key === 'ArrowDown') { event.preventDefault(); setSelected((index + (event.key === 'ArrowDown' ? 1 : -1) + matches.length) % (matches.length || 1)); }
      if (event.key === 'Enter' && matches[index]) { event.preventDefault(); choose(matches[index].path); }
    }} /><IconButton title="关闭文件搜索" onClick={close}><X size={16} /></IconButton></div>
    <div className="palette-results" id="file-search-results" role="listbox" aria-label="项目文件结果">{matches.map((file, i) => <button key={file.path} id={`file-result-${i}`} role="option" aria-selected={i === index} tabIndex={-1} onMouseMove={() => setSelected(i)} onClick={() => choose(file.path)}><FileCode2 size={17} /><span>{file.path.split('/').at(-1)}<small>{file.path}</small></span>{line && <code>:{line}</code>}</button>)}{!matches.length && <p className="palette-empty">{loading ? '正在读取项目文件' : error || '没有匹配文件'}</p>}</div>
  </dialog>;
}
