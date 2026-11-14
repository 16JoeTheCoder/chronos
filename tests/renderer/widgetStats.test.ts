import { describe, expect, it } from 'vitest';
import { arc, daySegments, estimateDriftPct, focusStreak, weekFocus } from '../../src/renderer/widgets/stats';
import { emptyData } from '../../src/core/model/defaults';
import type { Data } from '../../src/core/model/types';
import { TZ, at } from '../helpers';

const NOW = at(15 * 60, '2026-11-14'); // Sat 14 Nov 2026 15:00 WIB

function dataWith(sessions: [number, number][], tasks: object[] = [], blocks: object[] = []): Data {
  const d = emptyData();
  const base = { createdAt: 0, updatedAt: 0, deviceId: 'x', deletedAt: null, v: 3, fv: {}, fw: {} };
  sessions.forEach(([a, b], i) => ((d.sessions as Record<string, unknown>)[`s${i}`] = { ...base, id: `s${i}`, taskId: 't', blockId: null, startedAt: a, endedAt: b, phase: 'work' }));
  tasks.forEach((t, i) => ((d.tasks as Record<string, unknown>)[`t${i}`] = { ...base, id: `t${i}`, runtime: { sliceStartedAt: null }, workMs: 0, ...t }));
  blocks.forEach((b, i) => ((d.blocks as Record<string, unknown>)[`b${i}`] = { ...base, id: `b${i}`, ...b }));
  return d;
}

describe('weekFocus and streak', () => {
  const day = (offset: number, h = 10) => at(h * 60 + offset * 1440, '2026-11-14');
  it('buckets sessions by local date over the trailing week', () => {
    const d = dataWith([[day(0, 9), day(0, 11)], [day(-1, 9), day(-1, 10)], [day(-8, 9), day(-8, 12)]]);
    const w = weekFocus(d, NOW);
    expect(w).toHaveLength(7);
    expect(w[6]).toMatchObject({ date: '2026-11-14', label: 'Sat' });
    expect(w[6]!.hours).toBeCloseTo(2);
    expect(w[5]!.hours).toBeCloseTo(1);
    expect(w.reduce((s, x) => s + x.hours, 0)).toBeCloseTo(3);
  });
  it('splits a session across midnight', () => {
    const d = dataWith([[at(23 * 60, '2026-11-13'), at(60, '2026-11-14')]]);
    const w = weekFocus(d, NOW);
    expect(w[5]!.hours).toBeCloseTo(1);
    expect(w[6]!.hours).toBeCloseTo(1);
  });
  it('counts a streak of days with >= 25 min, and today not yet reached does not break it', () => {
    const run = (n: number, skipToday = false) => dataWith(Array.from({ length: n }, (_, i) => [at(540 - (i + (skipToday ? 1 : 0)) * 1440, '2026-11-14'), at(600 - (i + (skipToday ? 1 : 0)) * 1440, '2026-11-14')]));
    expect(focusStreak(run(5), NOW)).toBe(5);
    expect(focusStreak(run(4, true), NOW)).toBe(4);
    expect(focusStreak(dataWith([[day(0, 9), day(0, 9) + 10 * 60_000]]), NOW)).toBe(0);
    expect(focusStreak(dataWith([]), NOW)).toBe(0);
  });
});

describe('estimate drift', () => {
  it('needs three finished estimated tasks, then reports percent long', () => {
    const mk = (n: number) => Array.from({ length: n }, () => ({ status: 'done', outcome: 'done', estimateMin: 50, workMs: 56 * 60_000 }));
    expect(estimateDriftPct(dataWith([], mk(2)))).toBeNull();
    expect(estimateDriftPct(dataWith([], mk(3)))).toBe(12);
  });
});

describe('day dial', () => {
  it('lists fixed, planned and done segments', () => {
    const d = dataWith([], [{ status: 'done' }, { status: 'doing' }], [
      { taskId: 't0', date: '2026-11-14', startMin: 540, endMin: 600, kind: 'work', title: 'a', tz: TZ },
      { taskId: 't1', date: '2026-11-14', startMin: 660, endMin: 720, kind: 'work', title: 'b', tz: TZ },
    ]);
    const r = daySegments([[780, 840]], d, '2026-11-14');
    expect(r.blocksTotal).toBe(2);
    expect(r.blocksDone).toBe(1);
    expect(r.segs.map((s) => s.kind)).toEqual(['fixed', 'done', 'block']);
  });
  it('arcs are proportional and start at the top at midnight', () => {
    const a = arc(0, 720, 100);
    expect(a.dash).toBe('50.00 50.00');
    expect(a.rot).toBe(-90);
    expect(arc(360, 720, 100).rot).toBe(0);
  });
});
