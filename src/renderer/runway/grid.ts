// The Plan view's time grid (Phase 3.7 §5), pure. A fixed number of pixels per minute, so a
// minute is the same width everywhere: hour and half-hour lines sit on real instants, and the
// now-line sits on the current minute (seconds dropped), so at 21:39 it is exactly one minute
// left of where 21:40 will be.
import { clockOf } from '../../core/format';
import { localParts } from '../../core/time/zone';

export const PX_PER_MIN = 2;
const MIN = 60_000;

export interface GridLine { ts: number; x: number; label: string | null; major: boolean }

export interface Grid {
  /** Total width in px. */
  width: number;
  /** Position of an instant, px from the grid's left edge (clamped to the grid). */
  x(ts: number): number;
  lines: GridLine[];
  /** The now-line (minute-aligned), or null when now is outside the grid. */
  now: { x: number; label: string } | null;
}

export function timeGrid(from: number, to: number, now: number, tz: string, ppm = PX_PER_MIN): Grid {
  const spanMin = Math.max(1, Math.round((to - from) / MIN));
  const width = spanMin * ppm;
  const x = (ts: number) => Math.min(width, Math.max(0, ((ts - from) / MIN) * ppm));
  const lines: GridLine[] = [];
  const off = (30 - (localParts(from, tz).minutes % 30)) % 30;
  for (let ts = from + off * MIN; ts <= to; ts += 30 * MIN) {
    const major = localParts(ts, tz).minutes % 60 === 0;
    lines.push({ ts, x: x(ts), label: major ? clockOf(ts, tz) : null, major });
  }
  const minute = Math.floor(now / MIN) * MIN;
  return { width, x, lines, now: minute >= from && minute <= to ? { x: x(minute), label: clockOf(minute, tz) } : null };
}
