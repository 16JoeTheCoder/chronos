// The buffer cushion on Focus: the end-of-day buffer is a visible reserve. It stays full while
// the task is on time, shrinks minute by minute as the task overruns, and once it is gone the
// remainder is shown as overrun. Pure.

const MIN = 60_000;

export interface Cushion {
  /** 0..1 of the buffer still left. */
  frac: number;
  leftMs: number;
  /** Milliseconds past the end of the buffer (the real overrun), 0 while the cushion holds. */
  overMs: number;
  state: 'full' | 'shrinking' | 'gone';
}

export function cushion(bufferMin: number, overrunMs: number): Cushion {
  const total = Math.max(0, bufferMin) * MIN;
  const over = Math.max(0, overrunMs);
  if (total === 0) return { frac: 0, leftMs: 0, overMs: over, state: over > 0 ? 'gone' : 'full' };
  const left = Math.max(0, total - over);
  return { frac: left / total, leftMs: left, overMs: Math.max(0, over - total), state: over <= 0 ? 'full' : left > 0 ? 'shrinking' : 'gone' };
}

/** Overrun of the running task: the larger of its timer overtime and the time past its block's end. */
export function overrunMs(timerOvertimeMs: number, now: number, blockEnd: number | null, running: boolean): number {
  const pastBlock = running && blockEnd !== null ? Math.max(0, now - blockEnd) : 0;
  return Math.max(timerOvertimeMs, pastBlock);
}
