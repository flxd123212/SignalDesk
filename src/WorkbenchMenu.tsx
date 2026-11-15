import { Fragment, useEffect, useRef, useState } from 'react';
import { Menu } from 'lucide-react';
import { shortcutLabel } from './platform';

export type MenuAction = { label: string; action: () => void; checked?: boolean; disabled?: boolean; shortcut?: string; group?: string };
export function WorkbenchMenu({ label, items, icon = false }: { label: string; items: MenuAction[]; icon?: boolean }) {
  const [open, setOpen] = useState(false), root = useRef<HTMLDivElement>(null), trigger = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (!open) return;
    root.current?.querySelector<HTMLButtonElement>('[role=menuitem]:not(:disabled)')?.focus();
    const outside = (event: PointerEvent) => { if (!root.current?.contains(event.target as Node)) setOpen(false); };
    document.addEventListener('pointerdown', outside); return () => document.removeEventListener('pointerdown', outside);
  }, [open]);
  return <div className="workbench-menu" ref={root}><button ref={trigger} className="menu-trigger" aria-label={label} aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen(!open)} onKeyDown={event => { if (event.key === 'ArrowDown') { event.preventDefault(); setOpen(true); } }}>{icon ? <Menu size={17} /> : label}</button>{open && <div className="menu-popup" role="menu" aria-label={`${label}菜单`} onKeyDown={event => {
    const buttons = [...(root.current?.querySelectorAll<HTMLButtonElement>('[role=menuitem]:not(:disabled)') || [])], index = buttons.indexOf(document.activeElement as HTMLButtonElement);
    if (event.key === 'Escape') { event.preventDefault(); setOpen(false); trigger.current?.focus(); }
    else if (event.key === 'Tab') setOpen(false);
    else if (['ArrowUp', 'ArrowDown', 'Home', 'End'].includes(event.key)) { event.preventDefault(); const next = event.key === 'Home' ? 0 : event.key === 'End' ? buttons.length - 1 : (index + (event.key === 'ArrowDown' ? 1 : -1) + buttons.length) % buttons.length; buttons[next]?.focus(); }
  }}>{items.map((item, index) => <Fragment key={`${index}:${item.label}`}>{item.group && item.group !== items[index - 1]?.group && <div className="menu-section" role="presentation">{item.group}</div>}<button role="menuitem" aria-label={item.label} disabled={item.disabled} onClick={() => { setOpen(false); trigger.current?.focus(); item.action(); }}><span className="menu-check">{item.checked ? '✓' : ''}</span>{item.label}{item.shortcut && <kbd>{shortcutLabel(item.shortcut)}</kbd>}</button></Fragment>)}</div>}</div>;
}
