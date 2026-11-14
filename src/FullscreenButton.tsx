import { useEffect, useState } from 'react';
import { Maximize, Minimize } from 'lucide-react';
import { IconButton } from './ui';

export function FullscreenButton({ notify }: { notify: (message: string, error?: boolean) => void }) {
  const [active, setActive] = useState(false);
  useEffect(() => {
    const desktop = window.signaldeskDesktop;
    if (desktop) { void desktop.getFullscreen().then(setActive).catch(() => {}); return desktop.onFullscreen(setActive); }
    const changed = () => setActive(Boolean(document.fullscreenElement));
    document.addEventListener('fullscreenchange', changed);
    return () => document.removeEventListener('fullscreenchange', changed);
  }, []);
  const toggle = async () => {
    try {
      if (window.signaldeskDesktop) await window.signaldeskDesktop.toggleFullscreen();
      else if (document.fullscreenElement) await document.exitFullscreen();
      else await document.documentElement.requestFullscreen();
    } catch (error) { notify((error as Error).message, true); }
  };
  return <IconButton title={active ? '退出全屏 (Esc / F11)' : '全屏 (F11)'} onClick={toggle}>{active ? <Minimize size={18} /> : <Maximize size={18} />}</IconButton>;
}
