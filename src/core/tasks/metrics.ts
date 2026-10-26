// Focus metrics for the Done drawer (§6.8, ported from Monolith 0.2's weekly
// summary). The week starts Monday 00:00 local in settings.timezone.

import type { Data } from '../model/types';
import { live, settingsOf } from '../repo/repo';
import { addDays, mondayOf, zonedToUtc } from '../time/zone';
import { liveWorkMs, todayOf } from './tasks';

export interface Metrics {
  started: number;
  finished: number;
  dropped: number;
  focusTodayMs: number;
  focusWeekMs: number;
  finishedToday: number;
  sprints: { shipped: number; killed: number; active: number };
  /** Tracked work / estimate over finished tasks with estimates, or null. */
  overrun: number | null;
}

export function metrics(d: Data, now: number): Metrics {
  const tz = settingsOf(d).timezone;
  const today = todayOf(d, now);
  const dayStart = zonedToUtc(today, 0, tz);
  const weekStart = zonedToUtc(mondayOf(today), 0, tz);
  const weekEnd = zonedToUtc(addDays(mondayOf(today), 7), 0, tz);
  const inWeek = (t: number) => t >= weekStart && t < weekEnd;
  const acts = live(d, 'activity').filter((a) => inWeek(a.at));
  const count = (type: string) => acts.filter((a) => a.type === type).length;

  // Focus = closed work sessions + the live slice of the running task.
  const overlap = (s: number, e: number, from: number) => Math.max(0, Math.min(e, now) - Math.max(s, from));
  let focusTodayMs = 0;
  let focusWeekMs = 0;
  for (const s of live(d, 'sessions')) {
    if (s.phase !== 'work') continue;
    focusTodayMs += overlap(s.startedAt, s.endedAt, dayStart);
    focusWeekMs += overlap(s.startedAt, s.endedAt, weekStart);
  }
  const tasks = live(d, 'tasks');
  for (const t of tasks) {
    const sliceStart = t.runtime.sliceStartedAt;
    if (sliceStart === null || liveWorkMs(t, now) === t.workMs) continue;
    focusTodayMs += overlap(sliceStart, now, dayStart);
    focusWeekMs += overlap(sliceStart, now, weekStart);
  }

  const done = tasks.filter((t) => t.status === 'done');
  const estimated = done.filter((t) => t.outcome !== 'killed' && t.estimateMin && t.workMs > 0);
  const est = estimated.reduce((s, t) => s + (t.estimateMin ?? 0) * 60_000, 0);
  const sprints = tasks.filter((t) => t.kind === 'sprint');
  return {
    started: count('started'),
    finished: count('finished'),
    dropped: count('dropped') + count('killed'),
    focusTodayMs,
    focusWeekMs,
    finishedToday: done.filter((t) => t.outcome !== 'killed' && (t.completedAt ?? 0) >= dayStart).length,
    sprints: {
      shipped: sprints.filter((t) => t.outcome === 'shipped').length,
      killed: sprints.filter((t) => t.outcome === 'killed').length,
      active: sprints.filter((t) => t.status !== 'done').length,
    },
    overrun: estimated.length >= 3 && est > 0 ? estimated.reduce((s, t) => s + t.workMs, 0) / est : null,
  };
}
