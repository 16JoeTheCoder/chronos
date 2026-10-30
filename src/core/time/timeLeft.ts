// Time left today (§6.3a):
//   window     = [max(now, dayStart), dayEnd - buffer]
//   workable   = |window| - |fixed ∩ window|
//   committed  = |blocks ∩ window - fixed|,  unassigned = workable - committed
//   sprintable = free stretches (window - fixed - blocks) of >= 90 min
// Advanced variants (all 0 = off): transitionMin pads each fixed event's end,
// mealReserveMin reserves time at the middle of the day window, gapFilterMin
// ignores free stretches shorter than N minutes.

import type { TimeLeftVariants } from '../model/types';
import { clip, len, merge, subtract, total, type Interval } from './intervals';

export const SPRINTABLE_MIN = 90;
const MIN = 60_000;

export interface DayInput {
  now: number;
  /** UTC ms of the configured day start / end for today. */
  dayStart: number;
  dayEnd: number;
  bufferMin: number;
  fixed: Interval[];
  blocks: Interval[];
  variants: TimeLeftVariants;
}

export interface TimeLeft {
  window: Interval;
  dayLeftMs: number;
  bufferMs: number;
  fixedMs: number;
  workableMs: number;
  committedMs: number;
  unassignedMs: number;
  sprintableMs: number;
  /** Free stretches (not fixed, not planned) inside the window, in time order. */
  free: Interval[];
}

export function timeLeft(i: DayInput): TimeLeft {
  const from = Math.max(i.now, i.dayStart);
  const dayLeftMs = Math.max(0, i.dayEnd - from);
  const bufferMs = Math.min(dayLeftMs, i.bufferMin * MIN);
  const window: Interval = [from, Math.max(from, i.dayEnd - i.bufferMin * MIN)];
  const v = i.variants;
  const fixedRaw: Interval[] = i.fixed.map(([s, e]) => [s, e + v.transitionMin * MIN]);
  if (v.mealReserveMin > 0) {
    const mid = (i.dayStart + i.dayEnd) / 2;
    fixedRaw.push([mid - (v.mealReserveMin * MIN) / 2, mid + (v.mealReserveMin * MIN) / 2]);
  }
  const fixed = merge(clip(fixedRaw, window));
  const fixedMs = total(fixed);
  const open = subtract(window, fixed).filter((g) => len(g) >= v.gapFilterMin * MIN);
  const workableMs = total(open);
  const planned = merge(i.blocks.flatMap((b) => clip([b], window)).flatMap((b) => subtract(b, fixed)));
  const committedMs = total(planned);
  const free = open.flatMap((g) => subtract(g, planned));
  return {
    window,
    dayLeftMs,
    bufferMs,
    fixedMs,
    workableMs,
    committedMs,
    unassignedMs: Math.max(0, workableMs - committedMs),
    sprintableMs: total(free.filter((g) => len(g) >= SPRINTABLE_MIN * MIN)),
    free,
  };
}
