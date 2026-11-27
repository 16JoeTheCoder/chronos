// Pull to refresh, the pure part. The hook (usePullToRefresh) feeds finger travel in and
// renders what comes out. No animation frames: the indicator moves with a CSS transition.
/** Finger travel (px) that arms a refresh. */
export const PULL_THRESHOLD = 96;
export const PULL_DAMPING = 0.5;
/** Tallest the indicator grows (px). */
export const PULL_MAX = 64;
/** Height the line holds while the sync runs. */
export const PULL_HOLD = 40;
/** "Up to date" stays this long, so a fast sync is still seen. */
export const PULL_DONE_MS = 900;

export type PullPhase = 'idle' | 'pulling' | 'ready' | 'refreshing' | 'done';

/** Finger travel to the indicator's height: damped, capped. */
export const pullOffset = (dy: number): number => Math.min(PULL_MAX, Math.max(0, dy) * PULL_DAMPING);

/** The phase while the finger is down. */
export const phaseFor = (dy: number): PullPhase => (dy <= 0 ? 'idle' : dy >= PULL_THRESHOLD ? 'ready' : 'pulling');

/** A gesture starts only at the very top of the page, with one finger. */
export const canStartPull = (scrollTop: number, touches: number): boolean => scrollTop <= 0 && touches === 1;

/** On release: refresh when the pull passed the threshold. */
export const shouldRefresh = (dy: number): boolean => dy >= PULL_THRESHOLD;

export const PULL_TEXT: Record<PullPhase, string> = {
  idle: '',
  pulling: 'Pull to refresh',
  ready: 'Release to refresh',
  refreshing: 'Syncing',
  done: 'Up to date',
};
