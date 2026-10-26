// Time-left formula (§6.3a), table-driven. Times are minutes from an arbitrary 0.
import { describe, expect, it } from 'vitest';
import { timeLeft, type DayInput } from '../../src/core/time/timeLeft';

const M = 60_000;
const iv = (a: number, b: number): [number, number] => [a * M, b * M];
const off = { gapFilterMin: 0, transitionMin: 0, mealReserveMin: 0 };
const base: DayInput = { now: 360 * M, dayStart: 360 * M, dayEnd: 1320 * M, bufferMin: 30, fixed: [], blocks: [], variants: off };

const cases: [string, Partial<DayInput>, Partial<Record<'workable' | 'fixed' | 'committed' | 'unassigned' | 'sprintable' | 'dayLeft', number>>][] = [
  ['empty day', {}, { dayLeft: 960, fixed: 0, workable: 930, committed: 0, unassigned: 930, sprintable: 930 }],
  ['event spanning now is clipped', { now: 600 * M, fixed: [iv(540, 660)] }, { dayLeft: 720, fixed: 60, workable: 630 }],
  ['overlapping events merge', { fixed: [iv(600, 700), iv(650, 760), iv(760, 800)] }, { fixed: 200, workable: 730 }],
  ['now before day start', { now: 100 * M }, { dayLeft: 960, workable: 930 }],
  ['now after day end', { now: 1400 * M }, { dayLeft: 0, workable: 0, sprintable: 0 }],
  ['buffer larger than the window', { now: 1300 * M }, { dayLeft: 20, workable: 0 }],
  ['blocks commit time; blocks under fixed do not count', { fixed: [iv(600, 660)], blocks: [iv(400, 460), iv(630, 700)] }, { fixed: 60, workable: 870, committed: 100, unassigned: 770 }],
  ['sprintable needs 90 contiguous minutes', { now: 1000 * M, fixed: [iv(1080, 1100), iv(1180, 1210)] }, { workable: 240, sprintable: 0 }],
  ['transition pads fixed ends', { fixed: [iv(600, 660)], variants: { ...off, transitionMin: 15 } }, { fixed: 75, workable: 855 }],
  ['meal reserve at mid-day', { variants: { ...off, mealReserveMin: 60 } }, { fixed: 60, workable: 870 }],
  ['gap filter drops short free stretches', { fixed: [iv(400, 600), iv(620, 1290)], variants: { ...off, gapFilterMin: 30 } }, { workable: 40 }],
];

describe('timeLeft', () => {
  it.each(cases)('%s', (_name, input, want) => {
    const r = timeLeft({ ...base, ...input });
    const got = { workable: r.workableMs, fixed: r.fixedMs, committed: r.committedMs, unassigned: r.unassignedMs, sprintable: r.sprintableMs, dayLeft: r.dayLeftMs };
    for (const [k, v] of Object.entries(want)) expect(got[k as keyof typeof got] / M, k).toBe(v);
  });

  it('day left = workable + fixed + buffer when nothing is clipped', () => {
    const r = timeLeft({ ...base, fixed: [iv(600, 700)] });
    expect(r.dayLeftMs).toBe(r.workableMs + r.fixedMs + r.bufferMs);
  });
});
