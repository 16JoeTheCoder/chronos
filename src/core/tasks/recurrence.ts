// Recurring tasks: completing one creates the next instance with the
// deterministic id `<parentId>:<nextDate>`, so two devices completing the same
// task (even offline) converge on one record. The next date steps from the
// task's due date (or the completion date when it has none), never from a clock
// that could differ between devices.

import { defaultTimer, idleRuntime } from '../model/defaults';
import { recurrenceId } from '../model/ids';
import { keyBetween } from '../model/sortKey';
import type { Data, Task, TaskRecurrence } from '../model/types';
import { create, get, live, type Ctx } from '../repo/repo';
import { addDays, daysBetween, mondayOf, weekdayOf } from '../time/zone';
import { maxOrder, todayOf } from './tasks';

/** The first date after `from` on which the recurrence falls. */
export function nextDate(r: TaskRecurrence, from: string): string {
  if (r.freq === 'daily') return addDays(from, Math.max(1, r.interval));
  const days = r.weekdays?.length ? r.weekdays : [weekdayOf(from)];
  const week0 = mondayOf(from);
  for (let i = 1; i <= 7 * 53 * Math.max(1, r.interval); i++) {
    const date = addDays(from, i);
    const weeks = Math.floor(daysBetween(week0, mondayOf(date)) / 7);
    if (days.includes(weekdayOf(date)) && weeks % Math.max(1, r.interval) === 0) return date;
  }
  return addDays(from, 7 * r.interval);
}

/** After `t` was completed: create its next instance (once). */
export function spawnNext(d: Data, t: Task, ctx: Ctx): Data {
  if (!t.recurrence) return d;
  const parentId = t.recurrenceParentId ?? t.id;
  const date = nextDate(t.recurrence, t.dueDate ?? todayOf(d, ctx.now));
  const id = recurrenceId(parentId, date);
  if (get(d, 'tasks', id) || d.tombs.tasks?.[id]) return d;
  const lastKey = live(d, 'tasks').reduce<string | null>((m, x) => (m === null || x.sortKey > m ? x.sortKey : m), null);
  return create(
    d,
    'tasks',
    {
      kind: t.kind,
      title: t.title,
      finishCondition: t.finishCondition,
      notes: t.notes,
      tagId: t.tagId,
      priority: t.priority,
      estimateMin: t.estimateMin,
      dueDate: date,
      dueTime: t.dueTime,
      dueEventId: null,
      projectId: t.projectId,
      columnId: t.projectId ? t.columnId : null,
      recurrence: t.recurrence,
      recurrenceParentId: parentId,
      source: t.source,
      order: maxOrder(d) + 1,
      sortKey: keyBetween(lastKey, null),
      status: 'inbox',
      outcome: null,
      dropCount: 0,
      parkedAt: null,
      workMs: 0,
      breakMs: 0,
      pomodorosCompleted: 0,
      startedAt: null,
      completedAt: null,
      timer: t.timer ?? defaultTimer(),
      runtime: idleRuntime(),
      checkpointEveryMin: t.checkpointEveryMin,
      nextCheckpointMs: t.checkpointEveryMin ? t.checkpointEveryMin * 60_000 : null,
    },
    ctx,
    id,
  ).d;
}
