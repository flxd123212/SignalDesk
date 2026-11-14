import { useSyncExternalStore } from 'react';
import { pages } from './navigation';
import { normalizeColor } from './appearance';
import type { Page } from './types';

export type Preferences = {
  motion: boolean; startupAnimation: boolean; motionStyle: 'subtle' | 'expressive'; accent: string;
  backgroundMode: 'default' | 'color' | 'image'; backgroundColor: string; backgroundImage: string; backgroundDim: number; backgroundBlur: number; backgroundFit: 'cover' | 'contain';
  editorSize: number; editorWrap: boolean; favorites: Page[]; toolbar: boolean; workTabs: boolean; devicePopup: boolean; sendBar: 'auto' | 'always' | 'hidden'; startup: Page; layout: Record<string, boolean | number>;
};
export const accents = ['#73d8bb', '#87bfff', '#e8bd78', '#eea6bf'];
export const defaults: Preferences = { motion: true, startupAnimation: true, motionStyle: 'expressive', accent: accents[0], backgroundMode: 'default', backgroundColor: '#1a2325', backgroundImage: '', backgroundDim: 55, backgroundBlur: 0, backgroundFit: 'cover', editorSize: 14, editorWrap: true, favorites: ['workspace', 'terminal', 'editor', 'graph', 'commands', 'chips', 'agent', 'logs'], toolbar: false, workTabs: true, devicePopup: true, sendBar: 'auto', startup: 'workspace', layout: {} };
const storageKey = 'signaldesk.preferences.v1';
const isPage = (value: unknown): value is Page => pages.some(page => page.id === value);
export function normalizePreferences(input: unknown): Preferences {
  const value = input && typeof input === 'object' ? input as Partial<Preferences> : {};
  const layout = Object.fromEntries(Object.entries(value.layout && typeof value.layout === 'object' ? value.layout : {}).filter(([key, setting]) => ['simple', 'navigation', 'connection', 'agent-panel', 'bottom-panel', 'source-send', 'scope-details', 'terminal'].includes(key) ? typeof setting === 'boolean' : ['explorer-width', 'agent-width', 'dock-height'].includes(key) && typeof setting === 'number' && Number.isFinite(setting) && setting >= 100 && setting <= 1000));
  const bounded = (input: unknown, fallback: number, min: number, max: number) => typeof input === 'number' && Number.isFinite(input) ? Math.round(Math.min(max, Math.max(min, input))) : fallback;
  return { devicePopup: typeof value.devicePopup === 'boolean' ? value.devicePopup : defaults.devicePopup, accent: normalizeColor(value.accent, defaults.accent), editorSize: Number.isInteger(value.editorSize) && value.editorSize! >= 11 && value.editorSize! <= 22 ? value.editorSize! : defaults.editorSize,
    backgroundMode: value.backgroundMode === 'color' || value.backgroundMode === 'image' ? value.backgroundMode : 'default', backgroundColor: normalizeColor(value.backgroundColor, defaults.backgroundColor), backgroundImage: typeof value.backgroundImage === 'string' && /^[a-f0-9]{64}$/.test(value.backgroundImage) ? value.backgroundImage : '',
    backgroundDim: bounded(value.backgroundDim, defaults.backgroundDim, 20, 90), backgroundBlur: bounded(value.backgroundBlur, defaults.backgroundBlur, 0, 12), backgroundFit: value.backgroundFit === 'contain' ? 'contain' : 'cover',
    motion: typeof value.motion === 'boolean' ? value.motion : defaults.motion, startupAnimation: typeof value.startupAnimation === 'boolean' ? value.startupAnimation : defaults.startupAnimation, motionStyle: value.motionStyle === 'subtle' ? 'subtle' : defaults.motionStyle, editorWrap: typeof value.editorWrap === 'boolean' ? value.editorWrap : defaults.editorWrap,
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
