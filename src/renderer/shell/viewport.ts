// The one place that knows the breakpoints (Phase 4, mobile shell). responsive.css repeats
// the same numbers in its media queries; tests/renderer/shell/viewport.test.ts keeps them honest.
// phone < 640, tablet 640-1023, desktop >= 1024. Phone first: the narrowest class is the default.
import { useEffect, useState } from 'react';

export type Viewport = 'phone' | 'tablet' | 'desktop';

export const BREAKPOINTS = { tablet: 640, desktop: 1024 } as const;

export const classifyViewport = (width: number): Viewport => (width < BREAKPOINTS.tablet ? 'phone' : width < BREAKPOINTS.desktop ? 'tablet' : 'desktop');

const PHONE_Q = `(max-width: ${BREAKPOINTS.tablet - 0.02}px)`;
const DESKTOP_Q = `(min-width: ${BREAKPOINTS.desktop}px)`;

/** The class right now. Guarded: no matchMedia (tests, odd embeds) means desktop, today's layout. */
export function currentViewport(): Viewport {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return 'desktop';
  if (window.matchMedia(PHONE_Q).matches) return 'phone';
  return window.matchMedia(DESKTOP_Q).matches ? 'desktop' : 'tablet';
}

export function useViewport(): Viewport {
  const [vp, setVp] = useState<Viewport>(currentViewport);
  useEffect(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return;
    const lists = [window.matchMedia(PHONE_Q), window.matchMedia(DESKTOP_Q)];
    const on = () => setVp(currentViewport());
    lists.forEach((l) => l.addEventListener('change', on));
    on();
    return () => lists.forEach((l) => l.removeEventListener('change', on));
  }, []);
  return vp;
}
