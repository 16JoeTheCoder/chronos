import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createHold } from '../../src/renderer/focus/hold';

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

function setup() {
  const done = vi.fn();
  const cancelled = vi.fn();
  const progress: number[] = [];
  const hold = createHold({ durationMs: 2000, onComplete: done, onCancel: cancelled, onProgress: (p) => progress.push(p) });
  return { hold, done, cancelled, progress };
}

describe('hold to complete', () => {
  it('completes exactly once after a full 2 s hold', () => {
    const { hold, done, progress } = setup();
    expect(hold.press('enter')).toBe(true);
    vi.advanceTimersByTime(1999);
    expect(done).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(done).toHaveBeenCalledTimes(1);
    expect(progress.at(-1)).toBe(1);
    vi.advanceTimersByTime(10_000);
    expect(done).toHaveBeenCalledTimes(1);
    // A press after completion (auto-repeat) does not complete again until released.
    expect(hold.press('enter')).toBe(false);
    hold.release();
    expect(hold.state).toBe('idle');
  });

  it('an early release cancels and drains back to zero', () => {
    const { hold, done, cancelled, progress } = setup();
    hold.press('pointer');
    vi.advanceTimersByTime(1000);
    expect(hold.progress).toBeCloseTo(0.5, 1);
    hold.release();
    expect(hold.state).toBe('draining');
    vi.advanceTimersByTime(1000);
    expect(done).not.toHaveBeenCalled();
    expect(cancelled).toHaveBeenCalledTimes(1);
    expect(progress.at(-1)).toBe(0);
    expect(hold.state).toBe('idle');
  });

  it('space never starts or completes a hold', () => {
    const { hold, done } = setup();
    expect(hold.press('space')).toBe(false);
    vi.advanceTimersByTime(5000);
    expect(done).not.toHaveBeenCalled();
    expect(hold.state).toBe('idle');
  });

  it('repeat presses while held do not restart the clock', () => {
    const { hold, done } = setup();
    hold.press('enter');
    vi.advanceTimersByTime(1500);
    expect(hold.press('enter')).toBe(false);
    expect(hold.press('pointer')).toBe(false);
    vi.advanceTimersByTime(500);
    expect(done).toHaveBeenCalledTimes(1);
  });

  it('can be held again after an early release', () => {
    const { hold, done } = setup();
    hold.press('enter');
    vi.advanceTimersByTime(500);
    hold.release();
    vi.advanceTimersByTime(500);
    hold.press('enter');
    vi.advanceTimersByTime(2000);
    expect(done).toHaveBeenCalledTimes(1);
  });

  it('cancel stops silently', () => {
    const { hold, done, cancelled } = setup();
    hold.press('enter');
    vi.advanceTimersByTime(800);
    hold.cancel();
    vi.advanceTimersByTime(5000);
    expect(done).not.toHaveBeenCalled();
    expect(cancelled).not.toHaveBeenCalled();
  });
});
