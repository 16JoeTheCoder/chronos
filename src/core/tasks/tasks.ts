// Queue derivation and the single-focus rule (§6.4, Phase 3.7). Planning is free: tasks,
// blocks and order change at will. At most one task is 'doing', and only an explicit
// action makes it so (Start, a drop into the focus slot, the Doing column): every status
// change goes through core/tasks/transition. Other open tasks are 'planned' when they have
// a block today or later, else 'inbox' (normalize keeps this derived value right).

import { sessionId } from '../model/ids';
import type { Block, Data, Priority, Slice, Task, TaskStatus } from '../model/types';
import { create, get, live, settingsOf, timerOf, update, type Ctx } from '../repo/repo';
import { dateOf, zonedToUtc } from '../time/zone';
import { pauseAt, stop } from '../timer/timer';

export const PRIORITY_RANK: Record<Priority, number> = { must: 0, should: 1, nice: 2, none: 3 };

export const todayOf = (d: Data, now: number): string => dateOf(now, settingsOf(d).timezone);

export function blocksOn(d: Data, date: string): Block[] {
  const tasks = d.tasks;
  return live(d, 'blocks')
    .filter((b) => b.date === date && (b.taskId === null || tasks[b.taskId]?.deletedAt === null))
    .sort((a, b) => a.startMin - b.startMin || byId(a, b));
}

export const blockSpan = (b: Block): [number, number] => [zonedToUtc(b.date, b.startMin, b.tz), zonedToUtc(b.date, b.endMin, b.tz)];

export function activeTask(d: Data): Task | undefined {
  return live(d, 'tasks').find((t) => t.status === 'doing');
}

/** Not done and not dropped. */
export const isOpen = (t: Task): boolean => t.status !== 'done' && t.status !== 'dropped';

/** Its timer has run in the current run: the timer mode is fixed from then on. */
export const isLocked = (t: Task): boolean => t.startedAt !== null;

/** Unscheduled order: priority, then fractional order; dropped (parked) tasks go to the back. */
function byPriority(a: Task, b: Task): number {
  return (a.parkedAt ?? 0) - (b.parkedAt ?? 0) || PRIORITY_RANK[a.priority] - PRIORITY_RANK[b.priority] || a.order - b.order || byId(a, b);
}

/** Last tie-break: every device must derive the same queue from the same data (sync). */
const byId = (a: { id: string }, b: { id: string }) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);

/**
 * The execution queue: the locked active task (if any), then tasks with a block
 * today in block time order, then unscheduled tasks by priority and order.
 */
export function deriveQueue(d: Data, now: number): Task[] {
  const open = live(d, 'tasks').filter(isOpen);
  const locked = keeper(d, open);
  const seen = new Set<string>(locked ? [locked.id] : []);
  const out: Task[] = locked ? [locked] : [];
  for (const b of blocksOn(d, todayOf(d, now))) {
    const t = b.taskId ? d.tasks[b.taskId] : undefined;
    if (t && isOpen(t) && !seen.has(t.id)) {
      seen.add(t.id);
      out.push(t);
    }
  }
  return out.concat(open.filter((t) => !seen.has(t.id)).sort(byPriority));
}

/** Two doing tasks only happen after a merge: the timer's task wins, then a running one, then the lower id. */
function keeper(d: Data, open: Task[]): Task | undefined {
  const owned = timerOf(d).taskId;
  return open
    .filter((t) => t.status === 'doing')
    .sort((a, b) => Number(b.id === owned) - Number(a.id === owned) || Number(b.runtime.status === 'running') - Number(a.runtime.status === 'running') || byId(a, b))[0];
}

/**
 * Restore the invariants: at most one 'doing' task (nothing is promoted automatically);
 * every other open task is 'planned' (a block today or later) or 'inbox'.
 */
export function normalize(d: Data, ctx: Ctx): Data {
  const head = keeper(d, live(d, 'tasks').filter(isOpen));
  const today = todayOf(d, ctx.now);
  const planned = new Set(live(d, 'blocks').filter((b) => b.taskId && b.date >= today).map((b) => b.taskId as string));
  let out = d;
  for (const t of live(d, 'tasks')) {
    if (!isOpen(t)) continue;
    const want: TaskStatus = t.id === head?.id ? 'doing' : planned.has(t.id) ? 'planned' : 'inbox';
    if (t.status === want) continue;
    if (want !== 'doing' && t.runtime.status === 'running') {
      // Only reachable after a sync merge produced two actives: bank the slice first.
      const s = pauseAt(t, ctx.now);
      out = recordSlices(update(out, 'tasks', t.id, { ...s.task, status: want }, ctx), t.id, s.slices, ctx);
    } else {
      out = update(out, 'tasks', t.id, { status: want }, ctx);
    }
  }
  return out;
}

/** Turn closed timer slices into Session records (deterministic ids: re-recording is a no-op). */
export function recordSlices(d: Data, taskId: string, slices: Slice[], ctx: Ctx): Data {
  let out = d;
  for (const sl of slices) {
    const id = sessionId(taskId, sl.startedAt);
    if (get(out, 'sessions', id)) continue;
    const block = live(out, 'blocks').find((b) => {
      if (b.taskId !== taskId) return false;
      const [s, e] = blockSpan(b);
      return sl.startedAt >= s && sl.startedAt < e;
    });
    const blockEnd = block ? blockSpan(block)[1] : null;
    const overrunMs = blockEnd === null ? 0 : Math.max(0, sl.endedAt - Math.max(blockEnd, sl.startedAt));
    out = create(out, 'sessions', { taskId, blockId: block?.id ?? null, startedAt: sl.startedAt, endedAt: sl.endedAt, phase: sl.phase, overrunMs }, ctx, id).d;
  }
  return out;
}

/** Live tracked work including the running slice. */
export function liveWorkMs(t: Task, now: number): number {
  const rt = t.runtime;
  const running = rt.sliceStartedAt !== null && !(t.timer.mode === 'pomodoro' && rt.phase !== 'work');
  return t.workMs + (running ? Math.max(0, now - (rt.sliceStartedAt as number)) : 0);
}

export function trackedMs(t: Task, now: number): number {
  return t.workMs + t.breakMs + (t.runtime.sliceStartedAt !== null ? Math.max(0, now - t.runtime.sliceStartedAt) : 0);
}

/** Stop the task's timer (back to idle), banking the running slice as a session. */
export function stopTask(d: Data, t: Task, ctx: Ctx): { d: Data; task: Task } {
  const s = stop(t, ctx.now);
  return { d: recordSlices(d, t.id, s.slices, ctx), task: s.task };
}

export function maxOrder(d: Data): number {
  return live(d, 'tasks').reduce((m, t) => Math.max(m, t.order), 0);
}

export function minOrder(d: Data): number {
  return live(d, 'tasks').reduce((m, t) => Math.min(m, t.order), 1);
}

/** Is this device allowed to drive the timer? (§6.6: one owner at a time.) */
export function ownsTimer(d: Data, deviceId: string): boolean {
  const at = timerOf(d);
  const running = activeTask(d)?.runtime.status === 'running';
  return !running || !at.ownerDeviceId || at.ownerDeviceId === deviceId;
}
