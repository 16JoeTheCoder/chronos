// Touch gesture helpers (pure, unit-tested). Used by Sheet (swipe down), Tasks (swipe rows)
// and Board (column swipe indicator). Pointer events only; no library.

export type Swipe = 'left' | 'right' | 'up' | 'down' | null;

export interface SwipeOpts {
  /** Distance that counts as a swipe, px. */
  min?: number;
  /** How much longer the main axis must be than the other. */
  ratio?: number;
  /** A faster flick needs less distance. */
  flickMs?: number;
  flickMin?: number;
}

/** Which way did a finger travel? `dt` is milliseconds from press to release. */
export function classifySwipe(dx: number, dy: number, dt: number, o: SwipeOpts = {}): Swipe {
  const { min = 64, ratio = 1.6, flickMs = 220, flickMin = 36 } = o;
  const need = dt <= flickMs ? flickMin : min;
  const ax = Math.abs(dx);
  const ay = Math.abs(dy);
  if (ax >= need && ax >= ay * ratio) return dx > 0 ? 'right' : 'left';
  if (ay >= need && ay >= ax * ratio) return dy > 0 ? 'down' : 'up';
  return null;
}

/** Which axis is a drag locking to, once it has moved a few px? null = undecided. */
export function lockAxis(dx: number, dy: number, slop = 8): 'x' | 'y' | null {
  const ax = Math.abs(dx);
  const ay = Math.abs(dy);
  if (Math.max(ax, ay) < slop) return null;
  return ax > ay * 1.2 ? 'x' : 'y';
}

/** Press-and-hold time before a touch press becomes a drag (rows, cards). */
export const LONG_PRESS_MS = 420;
/** A finger that moves further than this before the hold ends is scrolling, not holding. */
export const LONG_PRESS_SLOP = 10;
