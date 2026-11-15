// Palette backdrop blur on low-power hardware (Phase 3.5 §3). Once per device, at startup, a
// full-window blurred layer (nearly invisible) is painted for ~0.5 s while a 16 ms timer runs;
// if the timer drifts (the main thread is busy compositing the blur) the palette uses dim only.
// Animation-frame loops are banned in this codebase (idle-CPU rule), so timer drift is the proxy.
import { api } from '../api';

const TICK_MS = 16;
const TICKS = 30;
/** Median tick interval above this means the blur costs frames. */
export const SLOW_MEDIAN_MS = 26;

/** Pure: given measured intervals (ms), keep the blur? */
export function keepBlur(intervals: number[]): boolean {
  if (!intervals.length) return true;
  const s = [...intervals].sort((a, b) => a - b);
  return (s[Math.floor(s.length / 2)] ?? 0) <= SLOW_MEDIAN_MS;
}

/** Measure once and store the answer on this device (device.paletteBlur). */
export function measureBlurOnce(): void {
  const probe = document.createElement('div');
  probe.setAttribute('aria-hidden', 'true');
  probe.style.cssText = 'position:fixed;inset:0;pointer-events:none;opacity:.01;backdrop-filter:blur(6px);z-index:-1';
  document.body.appendChild(probe);
  const intervals: number[] = [];
  let last = performance.now();
  const tick = () => {
    const t = performance.now();
    intervals.push(t - last);
    last = t;
    probe.style.transform = `translateX(${intervals.length % 2}px)`; // force a re-composite each tick
    if (intervals.length < TICKS) setTimeout(tick, TICK_MS);
    else {
      probe.remove();
      void api.command({ type: 'device.update', patch: { paletteBlur: keepBlur(intervals.slice(3)) } });
    }
  };
  setTimeout(tick, TICK_MS);
}
