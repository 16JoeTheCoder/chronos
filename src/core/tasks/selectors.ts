// The one place screens read task lists from (Phase 3.7 §1). Home, Tasks, Board, Focus,
// Plan, the overlay pill, the palette and MCP all ask these selectors, so a change made on
// one screen shows on every other. Pure; order is the manual list order (sortKey) unless
// a selector says otherwise.

import type { Data, Task } from '../model/types';
import { live, settingsOf } from '../repo/repo';
import { addDays, dateOf } from '../time/zone';
import { todayOf } from './tasks';

export const isOpenTask = (t: Task): boolean => t.deletedAt === null && t.status !== 'done' && t.status !== 'dropped';
export const bySortKey = (a: Task, b: Task): number => (a.sortKey < b.sortKey ? -1 : a.sortKey > b.sortKey ? 1 : a.createdAt - b.createdAt || (a.id < b.id ? -1 : 1));
export const labelsOf = (t: Task): string[] => t.labels ?? [];

const openTasks = (d: Data): Task[] => live(d, 'tasks').filter(isOpenTask).sort(bySortKey);
const plannedOn = (d: Data, date: string): Set<string> => new Set(live(d, 'blocks').filter((b) => b.date === date && b.taskId).map((b) => b.taskId as string));

/** No date, no project, nothing planned for it. */
export function inbox(d: Data, now: number): Task[] {
  const today = todayOf(d, now);
  const planned = new Set(live(d, 'blocks').filter((b) => b.taskId && b.date >= today).map((b) => b.taskId as string));
  return openTasks(d).filter((t) => !t.dueDate && !t.projectId && !planned.has(t.id));
}

/** Due today or overdue, planned today, added today with no date, or the task in focus. */
export function today(d: Data, now: number): Task[] {
  const day = todayOf(d, now);
  const tz = settingsOf(d).timezone;
  const planned = plannedOn(d, day);
  return openTasks(d).filter((t) => t.status === 'doing' || (t.dueDate !== null && t.dueDate <= day) || planned.has(t.id) || (t.dueDate === null && dateOf(t.createdAt, tz) === day));
}

/** Overdue (before today), then each of the next `days` days with the tasks due that day. */
export function upcoming(d: Data, now: number, days = 14): { date: string; overdue: boolean; tasks: Task[] }[] {
  const day = todayOf(d, now);
  const open = openTasks(d).filter((t) => t.dueDate !== null);
  const out: { date: string; overdue: boolean; tasks: Task[] }[] = [];
  const overdue = open.filter((t) => (t.dueDate as string) < day);
  if (overdue.length) out.push({ date: overdue.reduce((m, t) => ((t.dueDate as string) < m ? (t.dueDate as string) : m), day), overdue: true, tasks: overdue });
  for (let i = 0; i < days; i++) {
    const date = addDays(day, i);
    out.push({ date, overdue: false, tasks: open.filter((t) => t.dueDate === date).sort(byDueTime) });
  }
  return out;
}

const byDueTime = (a: Task, b: Task) => (a.dueTime ?? 1e9) - (b.dueTime ?? 1e9) || bySortKey(a, b);

/** Every open task. */
export const all = (d: Data): Task[] => openTasks(d);

/** A project's open tasks plus its done ones (still inside the retention window). */
export const byProject = (d: Data, projectId: string): Task[] => live(d, 'tasks').filter((t) => t.projectId === projectId && t.status !== 'dropped').sort(bySortKey);

/** The one task in focus. */
export const active = (d: Data): Task | undefined => live(d, 'tasks').find((t) => t.status === 'doing');

/** Started, not finished, not in focus: the shelf's "paused" cards. */
export const paused = (d: Data): Task[] => openTasks(d).filter((t) => t.status !== 'doing' && (t.runtime.status === 'paused' || t.workMs > 0));

/** Finished tasks still kept (newest first). */
export const done = (d: Data): Task[] => live(d, 'tasks').filter((t) => t.status === 'done').sort((a, b) => (b.completedAt ?? 0) - (a.completedAt ?? 0));

/** Open tasks due on `date` or planned on it. */
export function forDay(d: Data, date: string): Task[] {
  const planned = plannedOn(d, date);
  return openTasks(d).filter((t) => t.dueDate === date || planned.has(t.id));
}

/** Labels in use, most used first (for @ suggestions). */
export function labelsInUse(d: Data): string[] {
  const n = new Map<string, number>();
  for (const t of live(d, 'tasks')) for (const l of labelsOf(t)) n.set(l, (n.get(l) ?? 0) + 1);
  return [...n.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).map(([l]) => l);
}

/** Done tasks whose retention window is over (hours; 0 = keep forever). */
export function expiredDone(d: Data, now: number, hours: number): Task[] {
  if (!hours) return [];
  const cut = now - hours * 3_600_000;
  return live(d, 'tasks').filter((t) => t.status === 'done' && t.completedAt !== null && t.completedAt <= cut);
}
