import { useSyncExternalStore } from 'react';
import { pages } from './navigation';
import type { Page } from './types';

export type Preferences = { accent: string; editorSize: number; editorWrap: boolean; favorites: Page[]; toolbar: boolean; workTabs: boolean; devicePopup: boolean; sendBar: 'auto' | 'always' | 'hidden'; startup: Page; layout: Record<string, boolean | number> };
export const accents = ['#73d8bb', '#87bfff', '#e8bd78', '#eea6bf'];
export const defaults: Preferences = { accent: accents[0], editorSize: 14, editorWrap: true, favorites: ['workspace', 'terminal', 'editor', 'graph', 'commands', 'chips', 'agent', 'logs'], toolbar: false, workTabs: true, devicePopup: true, sendBar: 'auto', startup: 'workspace', layout: {} };
const storageKey = 'signaldesk.preferences.v1';
const isPage = (value: unknown): value is Page => pages.some(page => page.id === value);
export function normalizePreferences(input: unknown): Preferences {
  const value = input && typeof input === 'object' ? input as Partial<Preferences> : {};
  const layout = Object.fromEntries(Object.entries(value.layout && typeof value.layout === 'object' ? value.layout : {}).filter(([key, setting]) => ['simple', 'navigation', 'connection', 'agent-panel', 'bottom-panel', 'source-send', 'scope-details', 'terminal'].includes(key) ? typeof setting === 'boolean' : ['explorer-width', 'agent-width', 'dock-height'].includes(key) && typeof setting === 'number' && Number.isFinite(setting) && setting >= 100 && setting <= 1000));
  return { devicePopup: typeof value.devicePopup === 'boolean' ? value.devicePopup : defaults.devicePopup, accent: accents.includes(value.accent || '') ? value.accent! : defaults.accent, editorSize: Number.isInteger(value.editorSize) && value.editorSize! >= 11 && value.editorSize! <= 22 ? value.editorSize! : defaults.editorSize,
    editorWrap: typeof value.editorWrap === 'boolean' ? value.editorWrap : defaults.editorWrap,
    favorites: Array.isArray(value.favorites) ? [...new Set(value.favorites.filter(isPage))] : [...defaults.favorites], toolbar: typeof value.toolbar === 'boolean' ? value.toolbar : defaults.toolbar, workTabs: typeof value.workTabs === 'boolean' ? value.workTabs : defaults.workTabs,
    sendBar: ['auto', 'always', 'hidden'].includes(value.sendBar || '') ? value.sendBar! : defaults.sendBar, startup: isPage(value.startup) ? value.startup : defaults.startup, layout };
}
function load() { try { return normalizePreferences(JSON.parse(localStorage.getItem(storageKey) || '{}')); } catch { return normalizePreferences({}); } }
let current = window.signaldeskDesktop?.savedPreferences ? normalizePreferences(window.signaldeskDesktop.savedPreferences) : load();
const listeners = new Set<() => void>();
export const getPreferences = () => current;
export function setPreferences(patch: Partial<Preferences>, replace = false) {
  current = normalizePreferences(replace ? patch : { ...current, ...patch });
  let persisted = true;
  try { localStorage.setItem(storageKey, JSON.stringify(current)); } catch { persisted = false; }
  void window.signaldeskDesktop?.savePreferences(current).catch(() => { window.dispatchEvent(new CustomEvent('signaldesk-preference-error')); });
  listeners.forEach(listener => listener()); return persisted;
}
window.addEventListener('storage', event => { if (event.key === storageKey || event.key === null) { current = load(); listeners.forEach(listener => listener()); } });
window.signaldeskDesktop?.onPreferences(value => { current = normalizePreferences(value); listeners.forEach(listener => listener()); });
const subscribe = (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener); }; };
export function usePreferences() { return useSyncExternalStore(subscribe, getPreferences); }
