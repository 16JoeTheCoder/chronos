// Hold-to-confirm timing, with no DOM and no React: the caller feeds it presses
// and releases and it reports progress and one completion. Timers and the clock
// are injected so tests can run it on fake time.
//
// Rules: only Enter and the pointer can hold; Space never does. A press while
// already held (key auto-repeat) is ignored. Releasing early drains the progress
// back to 0 and completes nothing. A full hold completes exactly once, and not
// again until it has been released.

export type HoldSource = 'enter' | 'pointer' | 'space';
export type HoldState = 'idle' | 'holding' | 'draining' | 'done';

export interface HoldSchedule {
  setTimeout(fn: () => void, ms: number): unknown;
  clearTimeout(handle: unknown): void;
  now(): number;
}

export interface HoldOptions {
  /** How long the hold must last. */
  durationMs?: number;
  /** Longest gap between progress reports. */
  tickMs?: number;
  /** How long a part-filled ring takes to drain back after an early release. */
  drainMs?: number;
  /** 0..1, on every tick; 0 once cancelled or released after completion. */
  onProgress?: (p: number) => void;
  onComplete: () => void;
  /** An early release finished draining. */
  onCancel?: () => void;
  schedule?: HoldSchedule;
}

export interface Hold {
  /** Returns true if this press started (or resumed) a hold. */
  press(source: HoldSource): boolean;
  release(): void;
  /** Stop everything without a callback (unmount). */
  cancel(): void;
  readonly state: HoldState;
  readonly progress: number;
}

export const HOLD_MS = 2000;

const realSchedule: HoldSchedule = {
  setTimeout: (fn, ms) => setTimeout(fn, ms),
  clearTimeout: (h) => clearTimeout(h as ReturnType<typeof setTimeout>),
  now: () => Date.now(),
};

export function createHold(opts: HoldOptions): Hold {
  const durationMs = opts.durationMs ?? HOLD_MS;
  const tickMs = opts.tickMs ?? 50;
  const drainMs = opts.drainMs ?? 250;
  const sch = opts.schedule ?? realSchedule;
  let state: HoldState = 'idle';
  let progress = 0;
  let timer: unknown = null;
  let startedAt = 0;
  let drainFrom = 0;
  let drainStart = 0;

  const stop = () => {
    if (timer !== null) sch.clearTimeout(timer);
    timer = null;
  };
  const report = (p: number) => {
    progress = p;
    opts.onProgress?.(p);
  };

  function tickHold() {
    timer = null;
    const elapsed = sch.now() - startedAt;
    if (elapsed >= durationMs) {
      state = 'done';
      report(1);
      opts.onComplete();
      return;
    }
    report(elapsed / durationMs);
    timer = sch.setTimeout(tickHold, Math.min(tickMs, durationMs - elapsed));
  }

  function tickDrain() {
    timer = null;
    const elapsed = sch.now() - drainStart;
    if (elapsed >= drainMs) {
      state = 'idle';
      report(0);
      opts.onCancel?.();
      return;
    }
    report(drainFrom * (1 - elapsed / drainMs));
    timer = sch.setTimeout(tickDrain, Math.min(tickMs, drainMs - elapsed));
  }

  return {
    press(source) {
      if (source === 'space') return false;
      if (state === 'holding' || state === 'done') return false;
      stop();
      state = 'holding';
      startedAt = sch.now() - progress * durationMs; // resume from a half-drained ring
      tickHold();
      return true;
    },
    release() {
      if (state === 'holding') {
        stop();
        state = 'draining';
        drainFrom = progress;
        drainStart = sch.now();
        tickDrain();
      } else if (state === 'done') {
        state = 'idle';
        report(0);
      }
    },
    cancel() {
      stop();
      state = 'idle';
      progress = 0;
    },
    get state() {
      return state;
    },
    get progress() {
      return progress;
    },
  };
}
