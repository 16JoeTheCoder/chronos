import { describe, expect, it } from 'vitest';
import { cushion, overrunMs } from '../../src/renderer/focus/cushion';
import { keyAction, type KeyInput } from '../../src/renderer/focus/keys';
import { createHold, type HoldSchedule } from '../../src/renderer/focus/hold';

const k = (o: Partial<KeyInput>): KeyInput => ({ type: 'down', key: ' ', repeat: false, modifier: false, target: 'body', dialogOpen: false, ...o });

describe('Focus window keys', () => {
  it('Space toggles from the bare window, once per press, and never finishes', () => {
    expect(keyAction(k({}))).toBe('toggle');
    expect(keyAction(k({ repeat: true }))).toBe('swallow');
    expect(keyAction(k({ type: 'up' }))).toBe('swallow');
    expect(keyAction(k({ target: 'hold' }))).toBe('toggle');
  });
  it('Enter presses and releases the hold, repeats keep pressing (the hold ignores them)', () => {
    expect(keyAction(k({ key: 'Enter' }))).toBe('press');
    expect(keyAction(k({ key: 'Enter', repeat: true }))).toBe('press');
    expect(keyAction(k({ key: 'Enter', type: 'up' }))).toBe('release');
  });
  it('leaves text inputs, other controls, dialogs and modified keys alone', () => {
    expect(keyAction(k({ target: 'text' }))).toBeNull();
    expect(keyAction(k({ key: 'Enter', target: 'control' }))).toBeNull();
    expect(keyAction(k({ dialogOpen: true }))).toBeNull();
    expect(keyAction(k({ key: 'Enter', modifier: true }))).toBeNull();
    expect(keyAction(k({ key: 'a' }))).toBeNull();
  });
});

describe('hold-Enter 2 s on the window path', () => {
  function clock() {
    let t = 0;
    const q: { at: number; fn: () => void }[] = [];
    const sch: HoldSchedule = { now: () => t, setTimeout: (fn, ms) => (q.push({ at: t + ms, fn }), q.length), clearTimeout: (h) => void (q[(h as number) - 1] = { at: Infinity, fn: () => undefined }) };
    const advance = (ms: number) => {
      const end = t + ms;
      for (;;) {
        const next = q.filter((x) => x.at <= end).sort((a, b) => a.at - b.at)[0];
        if (!next) break;
        q.splice(q.indexOf(next), 1);
        t = next.at;
        next.fn();
      }
      t = end;
    };
    return { sch, advance };
  }
  it('completes after 2 s, not before; an early release drains and completes nothing', () => {
    const c = clock();
    let done = 0;
    const h = createHold({ onComplete: () => done++, schedule: c.sch });
    h.press('enter');
    c.advance(1500);
    expect(done).toBe(0);
    h.release();
    c.advance(1000);
    expect(done).toBe(0);
    expect(h.progress).toBe(0);
    h.press('enter');
    h.press('enter'); // key auto-repeat
    c.advance(2100);
    expect(done).toBe(1);
  });
});

describe('buffer cushion', () => {
  it('is full on time, shrinks with overrun, then shows the overrun beyond it', () => {
    expect(cushion(30, 0)).toMatchObject({ frac: 1, state: 'full', overMs: 0 });
    const half = cushion(30, 15 * 60_000);
    expect(half).toMatchObject({ frac: 0.5, state: 'shrinking', overMs: 0 });
    expect(half.leftMs).toBe(15 * 60_000);
    expect(cushion(30, 42 * 60_000)).toMatchObject({ frac: 0, state: 'gone', overMs: 12 * 60_000 });
  });
  it('takes the larger of timer overtime and time past the block end', () => {
    expect(overrunMs(0, 1000, 400, true)).toBe(600);
    expect(overrunMs(900, 1000, 400, true)).toBe(900);
    expect(overrunMs(0, 1000, 400, false)).toBe(0);
    expect(overrunMs(0, 1000, null, true)).toBe(0);
  });
});
