import type { ButtonHTMLAttributes, ReactNode } from 'react';
import { useState } from 'react';
import { getPreferences, setPreferences, usePreferences } from './preferences';

export function useLayoutToggle(key: string, initial: boolean) {
  const preferences = usePreferences();
  const [fallback] = useState(() => { try { const saved = localStorage.getItem(`signaldesk.layout.${key}`); return saved === null ? initial : saved === 'true'; } catch { return initial; } });
  const value = typeof preferences.layout[key] === 'boolean' ? preferences.layout[key] as boolean : fallback;
  const update = (next: boolean) => { setPreferences({ layout: { ...getPreferences().layout, [key]: next } }); };
  return [value, update] as const;
}

export function IconButton({ title, children, ...props }: ButtonHTMLAttributes<HTMLButtonElement>) {
  return <button type="button" {...props} className={`icon-button ${props.className || ''}`} title={title} aria-label={title}>{children}</button>;
}

export function Field({ label, children, className = '' }: { label: string; children: ReactNode; className?: string }) {
  return <label className={`field ${className}`}><span>{label}</span>{children}</label>;
}

export function Empty({ icon, title }: { icon: ReactNode; title: string }) {
  return <div className="empty-state">{icon}<span>{title}</span></div>;
}
