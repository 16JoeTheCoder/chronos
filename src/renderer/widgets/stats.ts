// Numbers behind the home widgets, pure and unit-tested: the last seven days of focus
// time, the focus streak, estimate drift, and the day dial's segments.

import type { Data } from '../../core/model/types';
import { live, settingsOf } from '../../core/repo/repo';
import { blocksOn, liveWorkMs, todayOf } from '../../core/tasks/tasks';
import { addDays, dayBounds, localParts } from '../../core/time/zone';

const HOUR = 3_600_000;
const MIN = 60_000;

export interface DayFocus {
  date: string;
  /** Weekday label, "Mon". */
  label: string;
  hours: number;
}

const WEEKDAY = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

/** Focus milliseconds per local date: closed work sessions plus the slice running now. */
export function focusMsByDate(d: Data, now: number): Map<string, number> {
  const tz = settingsOf(d).timezone;
  const out = new Map<string, number>();
  const add = (start: number, end: number) => {
    let date = localParts(start, tz).date;
    let cursor = start;
    for (let i = 0; i < 40 && cursor < end; i++) {
      const [, dayEnd] = dayBounds(date, tz);
      const to = Math.min(end, dayEnd);
      out.set(date, (out.get(date) ?? 0) + (to - cursor));
      cursor = to;
      date = addDays(date, 1);
    }
  };
  for (const s of live(d, 'sessions')) if (s.phase === 'work' && s.endedAt > s.startedAt) add(s.startedAt, Math.min(s.endedAt, now));
  for (const t of live(d, 'tasks')) {
    const start = t.runtime.sliceStartedAt;
    if (start !== null && liveWorkMs(t, now) !== t.workMs && now > start) add(start, now);
  }
  return out;
}

/** The trailing seven days ending today, oldest first. */
export function weekFocus(d: Data, now: number): DayFocus[] {
  const today = todayOf(d, now);
  const ms = focusMsByDate(d, now);
  return Array.from({ length: 7 }, (_, i) => {
    const date = addDays(today, i - 6);
    const dow = new Date(`${date}T12:00:00Z`).getUTCDay();
    return { date, label: WEEKDAY[dow] as string, hours: (ms.get(date) ?? 0) / HOUR };
  });
}

/**
 * Consecutive days with at least `minMin` of focus, ending today. A today that has not
 * reached it yet does not break the streak: it counts from yesterday.
 */
export function focusStreak(d: Data, now: number, minMin = 25): number {
  const today = todayOf(d, now);
  const ms = focusMsByDate(d, now);
  const ok = (date: string) => (ms.get(date) ?? 0) >= minMin * MIN;
  let date = ok(today) ? today : addDays(today, -1);
  let n = 0;
  while (ok(date) && n < 400) {
    n++;
    date = addDays(date, -1);
  }
  return n;
}

/** Tracked / estimated over finished tasks (>= 3 with estimates), as a whole percent: +12 means 12 % long. Null when unknown. */
export function estimateDriftPct(d: Data): number | null {
  const done = live(d, 'tasks').filter((t) => t.status === 'done' && t.outcome !== 'killed' && t.estimateMin && t.workMs > 0);
  if (done.length < 3) return null;
  const est = done.reduce((s, t) => s + (t.estimateMin ?? 0) * MIN, 0);
  const act = done.reduce((s, t) => s + t.workMs, 0);
  return est > 0 ? Math.round((act / est - 1) * 100) : null;
}

export interface DialSeg {
  kind: 'fixed' | 'block' | 'done';
  /** Minutes from midnight. */
  from: number;
  to: number;
}

/** Segments for the 24 h dial: fixed events, planned blocks, and blocks whose task is done. */
export function daySegments(fixed: [number, number][], d: Data, date: string): { segs: DialSeg[]; blocksTotal: number; blocksDone: number } {
  const blocks = blocksOn(d, date).filter((b) => b.kind !== 'break');
  const segs: DialSeg[] = fixed.map(([from, to]) => ({ kind: 'fixed', from, to }));
  let doneN = 0;
  for (const b of blocks) {
    const isDone = b.taskId ? d.tasks[b.taskId]?.status === 'done' : false;
    if (isDone) doneN++;
    segs.push({ kind: isDone ? 'done' : 'block', from: b.startMin, to: b.endMin });
  }
  return { segs, blocksTotal: blocks.length, blocksDone: doneN };
}

/** Arc length for [from,to) minutes on a circle of circumference c: `dash gap` and rotation in degrees from the top. */
export function arc(from: number, to: number, c: number): { dash: string; rot: number } {
  const len = Math.max(0, ((to - from) / 1440) * c);
  return { dash: `${len.toFixed(2)} ${(c - len).toFixed(2)}`, rot: (from / 1440) * 360 - 90 };
}
