// What each screen shows of the tasks (Phase 3.7 §1), built only from the selectors, so the
// cross-screen test can ask every screen the same question after a change made on any of them.

import type { Data, Task } from '../model/types';
import { taskPrefs } from '../model/defaults';
import { settingsOf } from '../repo/repo';
import { expandEvents, type Instance } from '../time/schedule';
import { active, paused, today } from './selectors';
import { blockSpan, blocksOn, deriveQueue, todayOf } from './tasks';

/** Home: the task in focus, and the shelf (paused first, then today's queue). */
export function homeModel(d: Data, now: number): { active: Task | undefined; shelf: Task[]; pausedIds: Set<string> } {
  const a = active(d);
  const p = paused(d).filter((t) => t.id !== a?.id);
  const pausedIds = new Set(p.map((t) => t.id));
  const rest = today(d, now).filter((t) => t.id !== a?.id && !pausedIds.has(t.id));
  return { active: a, shelf: [...p, ...rest], pausedIds };
}

/** The fixed event happening now (a class), or undefined. */
export function eventNow(d: Data, now: number): Instance | undefined {
  return expandEvents(d, todayOf(d, now)).find((i) => i.start <= now && now < i.end);
}

/**
 * "What am I doing now": the task in focus wins, then the task of the plan block running now,
 * then the fixed event (class) now. Plan blocks may overlap classes (Phase 3.7 §5).
 */
export function doingNow(d: Data, now: number): { task?: Task; event?: Instance } {
  const a = active(d);
  const event = eventNow(d, now);
  if (a) return { task: a, event };
  const b = blocksOn(d, todayOf(d, now)).find((x) => x.taskId && blockSpan(x)[0] <= now && now < blockSpan(x)[1]);
  const t = b?.taskId ? d.tasks[b.taskId] : undefined;
  return t && t.deletedAt === null && t.status !== 'done' && t.status !== 'dropped' ? { task: t, event } : { event };
}

/** The overlay pill: the task in focus, and the class on now when the setting is on. */
export function pillModel(d: Data, now: number): { task: Task | undefined; planned: Task | undefined; classNow: string | null } {
  const show = taskPrefs(settingsOf(d)).pillShowsClass;
  const ev = show ? eventNow(d, now) : undefined;
  const a = active(d);
  // Nothing in focus but a plan block running now: the planned task is what you are meant to be doing (it beats the class).
  return { task: a, planned: a ? undefined : doingNow(d, now).task, classNow: ev ? ev.event.title : null };
}

/** Focus shows the one task in focus. */
export const focusModel = (d: Data): Task | undefined => active(d);

/** Plan: the order the planner fills the day in. */
export const planQueue = (d: Data, now: number): Task[] => deriveQueue(d, now);
