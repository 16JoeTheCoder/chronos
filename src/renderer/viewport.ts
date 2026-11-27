// Viewport classes for the renderer (pure helpers + one hook). phone < 640, tablet 640-1023, desktop >= 1024.
// Browser APIs are guarded: an Android WebView may lack matchMedia or ResizeObserver.
import { useSyncExternalStore } from 'react';

export type ViewportClass = 'phone' | 'tablet' | 'desktop';

export const DESKTOP_MIN = 1024;

export const viewportClass = (width: number): ViewportClass => (width < 640 ? 'phone' : width < DESKTOP_MIN ? 'tablet' : 'desktop');

export const isMobileUA = (ua: string): boolean => /Android|iPhone|iPad|iPod|Mobile|CriOS|FxiOS/i.test(ua);

/** "Desktop-class": a wide window with a mouse, not a phone or tablet UA. Gates "Get the desktop app". */
export function isDesktopClass(v: { width: number; finePointer: boolean; ua: string }): boolean {
  return v.width >= DESKTOP_MIN && v.finePointer && !isMobileUA(v.ua);
}

export const matches = (q: string): boolean => {
  try { return typeof window.matchMedia === 'function' && window.matchMedia(q).matches; } catch { return false; }
};

const snapshot = (): string => {
  const w = typeof window === 'undefined' ? 1280 : window.innerWidth;
  const ua = typeof navigator === 'undefined' ? '' : navigator.userAgent;
  return `${viewportClass(w)}|${isDesktopClass({ width: w, finePointer: matches('(pointer: fine)'), ua }) ? 1 : 0}|${matches('(pointer: coarse)') ? 1 : 0}`;
};

const subscribe = (cb: () => void) => {
  window.addEventListener('resize', cb);
  window.addEventListener('orientationchange', cb);
  return () => { window.removeEventListener('resize', cb); window.removeEventListener('orientationchange', cb); };
};

/** The current class, whether it is desktop-class, and whether the primary pointer is touch. */
export function useViewport(): { cls: ViewportClass; desktopClass: boolean; touch: boolean } {
  const s = useSyncExternalStore(subscribe, snapshot, () => 'desktop|0|0');
  const [cls, d, t] = s.split('|') as [ViewportClass, string, string];
  return { cls, desktopClass: d === '1', touch: t === '1' };
}
