// Prep nudges (§6.5): for each tagged event in the next 24 h, the unfinished
// tasks that belong before it (explicitly via dueEventId, or implicitly by tag
// and deadline), how much they still need and how much free time is left.

import type { Data, Task } from '../model/types';
import { live, settingsOf } from '../repo/repo';
import { blockSpan, blocksOn, liveWorkMs, todayOf } from '../tasks/tasks';
import { addDays, zonedToUtc } from './zone';
import { upcoming, expandEvents, type Instance } from './schedule';
import { subtract, total, type Interval } from './intervals';

export interface Nudge {
  key: string;
  instance: Instance;
  task: Task;
  needsMin: number;
  freeBeforeMin: number;
  tight: boolean;
}

const MIN = 60_000;

/** Free time (inside each day's window, not fixed, not planned) between now and `until`. */
export function freeBetween(d: Data, now: number, until: number): number {
  const s = settingsOf(d);
  let free = 0;
  for (let date = todayOf(d, now), i = 0; i < 3; i++, date = addDays(date, 1)) {
    const w: Interval = [Math.max(now, zonedToUtc(date, s.dayStartMin, s.timezone)), Math.min(until, zonedToUtc(date, s.dayEndMin, s.timezone))];
    if (w[1] <= w[0]) continue;
    const busy: Interval[] = [...expandEvents(d, date).map((x): Interval => [x.start, x.end]), ...blocksOn(d, date).map(blockSpan)];
    free += total(subtract(w, busy));
  }
  return free;
}

export function prepNudges(d: Data, now: number): Nudge[] {
  const tasks = live(d, 'tasks').filter((t) => t.status !== 'done');
  const out: Nudge[] = [];
  for (const inst of upcoming(d, now, todayOf(d, now), 24)) {
    const tag = inst.event.tagId;
    if (!tag) continue;
    for (const t of tasks) {
      const explicit = t.dueEventId === inst.event.id;
      const implicit = !t.dueEventId && t.tagId === tag && t.deadline !== null && t.deadline <= inst.date;
      if (!explicit && !implicit) continue;
      const needsMin = Math.max(0, Math.ceil(((t.estimateMin ?? 0) * MIN - liveWorkMs(t, now)) / MIN));
      const freeBeforeMin = Math.floor(freeBetween(d, now, inst.start) / MIN);
      out.push({ key: `${inst.event.id}@${inst.date}:${t.id}`, instance: inst, task: t, needsMin, freeBeforeMin, tight: freeBeforeMin < needsMin });
    }
  }
  return out;
}
