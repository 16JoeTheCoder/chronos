// Holographic depth (Stark's second energy layer): panels tilt up to 9 degrees with the pointer
// and assemble from a scan line when Home opens. CSS carries the look; this only feeds --tx/--ty.
// No rAF: the tilt follows pointermove directly and is off with data-motion="off" or the switch.
import { useEffect, type RefObject } from 'react';

export const MAX_TILT_DEG = 9;

/** Pointer position to -0.5..0.5 within a box. */
export function tiltOf(x: number, y: number, r: { left: number; top: number; width: number; height: number }): { tx: number; ty: number } {
  const c = (n: number) => Math.min(0.5, Math.max(-0.5, n));
  return { tx: c((x - r.left) / r.width - 0.5), ty: c((y - r.top) / r.height - 0.5) };
}

export function useHolo(root: RefObject<HTMLElement>): void {
  useEffect(() => {
    const el = root.current;
    const html = document.documentElement;
    if (!el) return;
    const on = (e: PointerEvent) => {
      if (html.dataset.holographicDepth !== 'on' || html.dataset.motion === 'off') return;
      const { tx, ty } = tiltOf(e.clientX, e.clientY, el.getBoundingClientRect());
      el.style.setProperty('--tx', tx.toFixed(3));
      el.style.setProperty('--ty', ty.toFixed(3));
    };
    const off = () => {
      el.style.setProperty('--tx', '0');
      el.style.setProperty('--ty', '0');
    };
    window.addEventListener('pointermove', on);
    document.addEventListener('pointerleave', off);
    return () => {
      window.removeEventListener('pointermove', on);
      document.removeEventListener('pointerleave', off);
    };
  }, [root]);
}
