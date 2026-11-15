// End-of-day review (PHASE23 §4): at dayEndMin - bufferMin (or on demand) every
// unfinished task planned for the day is asked ONCE: tomorrow / unscheduled / drop /
// done. The answer is stored as reviews/review-<date>; the id is deterministic, so
// the review's existence on any device means the day is reviewed and nobody is
// asked twice. Overdue items fold in here too (no banners elsewhere). The effects
// of the answers live in commands.ts ('review.submit'); this file only decides who
// is asked and when. Pure.

import { reviewId } from '../model/ids';
import type { Data, Task } from '../model/types';
import { get, live, settingsOf } from '../repo/repo';
import { isOpen, todayOf } from '../tasks/tasks';
import { byPlanOrder } from './plan';
import { zonedToUtc } from '../time/zone';

export const isReviewed = (d: Data, date: string): boolean => {
  const r = get(d, 'reviews', reviewId(date));
  return !!r && r.deletedAt === null;
};

/** UTC ms from which the day's review is due: the end of the working day minus the buffer. */
export function reviewDueAt(d: Data, date: string): number {
  const s = settingsOf(d);
  return zonedToUtc(date, s.dayEndMin - s.bufferMin, s.timezone);
}

/**
 * Open tasks to ask about for `date`: planned that day (a block on it), or due on or
 * before it. A task already answered "unscheduled" in an earlier review is not asked
 * again just for being overdue. The task being timed right now is left alone.
 */
export function reviewCandidates(d: Data, date: string): Task[] {
  const planned = new Set(live(d, 'blocks').filter((b) => b.taskId && b.date === date).map((b) => b.taskId));
  const parked = new Set<string>();
  for (const r of live(d, 'reviews')) if (r.date < date) for (const o of r.outcomes) if (o.action === 'unscheduled') parked.add(o.taskId);
  const due = (t: Task) => t.dueDate !== null && t.dueDate <= date && !parked.has(t.id);
  return live(d, 'tasks')
    .filter((t) => isOpen(t) && t.runtime.status !== 'running' && (planned.has(t.id) || due(t)))
    .sort(byPlanOrder);
}

export interface PendingReview {
  date: string;
  tasks: Task[];
}

/**
 * The review to show now, or null: today's, once its time has come (or on demand
 * with `force`), not yet reviewed on any device, with at least one task to ask about.
 */
export function pendingReview(d: Data, now: number, force = false): PendingReview | null {
  const date = todayOf(d, now);
  if (isReviewed(d, date) || (!force && now < reviewDueAt(d, date))) return null;
  const tasks = reviewCandidates(d, date);
  return tasks.length ? { date, tasks } : null;
}
