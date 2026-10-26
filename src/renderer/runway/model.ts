// The day as the runway draws it: axis range, fixed instances, blocks, free
// stretches and the time-left numbers, all from core. Also the scheduling maths
// (free gaps in local minutes) shared by drag-and-drop and the keyboard path.

import { blocksOn, blockSpan, todayOf } from '../../core/tasks/tasks';
import { closuresOn, expandEvents, type Instance } from '../../core/time/schedule';
import { timeLeft, type TimeLeft } from '../../core/time/timeLeft';
import { localParts, zonedToUtc } from '../../core/time/zone';
import { settingsOf } from '../../core/repo/repo';
import type { Block, Closure, Data } from '../../core/model/types';

export const SNAP_MIN = 5;
export const DEFAULT_DUR = 25;

export interface DayModel {
  date: string;
  tz: string;
  /** Axis range, UTC ms. */
  from: number;
  to: number;
  instances: Instance[];
  blocks: Block[];
  tl: TimeLeft;
  holidays: Closure[];
}

export function dayModel(d: Data, now: number, range: 'full' | 'next6'): DayModel {
  const s = settingsOf(d);
  const date = todayOf(d, now);
  const dayStart = zonedToUtc(date, s.dayStartMin, s.timezone);
  const dayEnd = zonedToUtc(date, s.dayEndMin, s.timezone);
  const instances = expandEvents(d, date);
  const blocks = blocksOn(d, date);
  const tl = timeLeft({
    now,
    dayStart,
    dayEnd,
    bufferMin: s.bufferMin,
    fixed: instances.map((i) => [i.start, i.end]),
    blocks: blocks.map(blockSpan),
    variants: s.timeLeft,
  });
  const from = range === 'next6' ? Math.max(dayStart, now - 30 * 60_000) : dayStart;
  const to = range === 'next6' ? Math.min(Math.max(dayEnd, from + 60 * 60_000), from + 6.5 * 3_600_000) : dayEnd;
  return { date, tz: s.timezone, from, to, instances, blocks, tl, holidays: closuresOn(d, date).filter((c) => c.scopes.length > 0) };
}

/** Local minutes of an instant on the model's date. */
export const minuteOf = (m: DayModel, ts: number): number => {
  const p = localParts(ts, m.tz);
  return p.date === m.date ? p.minutes : p.date < m.date ? 0 : 1440;
};

export const snap = (min: number) => Math.round(min / SNAP_MIN) * SNAP_MIN;

/** Free gaps [startMin, endMin) today: inside the day, after now, not fixed, not planned (ignoring one block). */
export function freeGaps(d: Data, m: DayModel, now: number, ignoreBlockId?: string): [number, number][] {
  const s = settingsOf(d);
  const busy = [
    ...m.instances.map((i): [number, number] => [minuteOf(m, i.start), minuteOf(m, i.end)]),
    ...m.blocks.filter((b) => b.id !== ignoreBlockId).map((b): [number, number] => [b.startMin, b.endMin]),
  ].sort((a, b) => a[0] - b[0]);
  const out: [number, number][] = [];
  let cur = Math.max(s.dayStartMin, Math.ceil(minuteOf(m, now) / SNAP_MIN) * SNAP_MIN);
  for (const [a, b] of busy) {
    if (a > cur) out.push([cur, Math.min(a, s.dayEndMin)]);
    cur = Math.max(cur, b);
  }
  if (cur < s.dayEndMin) out.push([cur, s.dayEndMin]);
  return out.filter(([a, b]) => b - a >= SNAP_MIN);
}

/**
 * Place a block of `dur` minutes starting at `startMin`: valid only if the start
 * lies in a free gap; a gap shorter than the duration shortens the block to fit.
 */
export function place(gaps: [number, number][], startMin: number, dur: number): { startMin: number; endMin: number } | null {
  const g = gaps.find(([a, b]) => startMin >= a && startMin < b);
  if (!g) return null;
  const endMin = Math.min(startMin + dur, g[1]);
  return endMin - startMin >= SNAP_MIN ? { startMin, endMin } : null;
}

/** The first gap that fits the whole duration, else the longest gap. */
export function firstFit(gaps: [number, number][], dur: number): number | null {
  const fit = gaps.find(([a, b]) => b - a >= dur) ?? [...gaps].sort((x, y) => y[1] - y[0] - (x[1] - x[0]))[0];
  return fit ? fit[0] : null;
}

/** Minutes of this task already on the runway today or later. */
export function scheduledMin(d: Data, taskId: string, today: string): number {
  return Object.values(d.blocks)
    .filter((b) => b.deletedAt === null && b.taskId === taskId && b.date >= today)
    .reduce((s, b) => s + b.endMin - b.startMin, 0);
}
