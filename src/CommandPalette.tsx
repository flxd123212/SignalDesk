import { useEffect, useRef, useState } from 'react';
import { ArrowRight, Cable, Search, X } from 'lucide-react';
import { pages } from './navigation';
import { IconButton } from './ui';
import type { Device, Page } from './types';

export function CommandPalette({ devices, navigate, selectDevice, close }: { devices: Device[]; navigate: (page: Page) => void; selectDevice: (id: string) => Promise<void>; close: () => void }) {
  const dialog = useRef<HTMLDialogElement>(null), input = useRef<HTMLInputElement>(null);
  const [query, setQuery] = useState(''), [selected, setSelected] = useState(0), [busy, setBusy] = useState(false);
  useEffect(() => {
    const previous = document.activeElement, element = dialog.current;
    element?.showModal(); input.current?.focus();
    return () => { element?.close(); if (previous instanceof HTMLElement && previous.isConnected) previous.focus(); };
  }, []);
  const entries = [...pages.map(page => ({ id: page.id, name: page.label, group: page.group, terms: page.keywords, icon: page.icon, run: () => navigate(page.id) })), ...devices.map(device => ({ id: device.id, name: device.name, group: '切换设备', terms: `${device.path} ${device.chip || ''} ${device.board || ''}`, icon: Cable, run: () => selectDevice(device.id) }))];
  const tokens = query.trim().toLocaleLowerCase().split(/\s+/).filter(Boolean);
  const matches = entries.filter(entry => tokens.every(token => `${entry.name} ${entry.group} ${entry.terms}`.toLocaleLowerCase().includes(token)));
  const index = Math.min(selected, Math.max(0, matches.length - 1));
  useEffect(() => { dialog.current?.querySelector('[aria-selected="true"]')?.scrollIntoView({ block: 'nearest' }); }, [index, query]);
  const run = async (entry: typeof entries[number]) => { if (busy) return; setBusy(true); try { await entry.run(); close(); } finally { setBusy(false); } };
  return <dialog ref={dialog} className="command-palette" aria-label="查找功能或设备" onCancel={close} onClick={event => { if (event.target === dialog.current) close(); }}>
    <div className="palette-search"><Search size={19} /><input ref={input} aria-label="查找功能或设备" placeholder="搜索功能、设备、型号…" value={query} role="combobox" aria-expanded="true" aria-controls="palette-results" aria-activedescendant={matches.length ? `palette-${matches[index].id}` : undefined} onChange={event => { setQuery(event.target.value); setSelected(0); }} onKeyDown={event => {
      if (event.nativeEvent.isComposing || event.keyCode === 229) return;
      if (event.key === 'ArrowDown' || event.key === 'ArrowUp') { event.preventDefault(); setSelected((index + (event.key === 'ArrowDown' ? 1 : -1) + matches.length) % (matches.length || 1)); }
      if (event.key === 'Enter' && matches[index]) { event.preventDefault(); void run(matches[index]); }
    }} /><IconButton title="关闭功能搜索" onClick={close}><X size={16} /></IconButton></div>
    <div className="palette-results" id="palette-results" role="listbox" aria-label="搜索结果">{matches.map((entry, i) => <button type="button" id={`palette-${entry.id}`} role="option" aria-selected={i === index} tabIndex={-1} disabled={busy} key={entry.id} onMouseMove={() => setSelected(i)} onClick={() => void run(entry)}><entry.icon size={18} /><span>{entry.name}<small>{entry.group === '切换设备' ? entry.terms : entry.group}</small></span><ArrowRight size={14} /></button>)}{!matches.length && <p className="palette-empty">没有匹配的功能或设备</p>}</div>
  </dialog>;
}
