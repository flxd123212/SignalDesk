import { useLayoutEffect, useRef } from 'react';
import { usePreferences } from './preferences';

// Animate the existing surface so cached graphs and editors keep their state.
export function useSurfaceMotion(identity: string) {
  const ref = useRef<HTMLDivElement>(null);
  const { motion, motionStyle } = usePreferences();
  useLayoutEffect(() => {
    const element = ref.current, media = matchMedia('(prefers-reduced-motion: reduce)');
    if (!element || !motion || media.matches) return;
    const expressive = motionStyle === 'expressive';
    const animation = element.animate([
      { opacity: .55, transform: `translateY(${expressive ? 8 : 3}px)` },
      { opacity: 1, transform: 'translateY(0)' },
    ], { duration: expressive ? 260 : 140, easing: 'cubic-bezier(.2,.7,.2,1)' });
    const stop = () => { if (media.matches) animation.cancel(); };
    media.addEventListener('change', stop);
    return () => { animation.cancel(); media.removeEventListener('change', stop); };
  }, [identity, motion, motionStyle]);
  return ref;
}
