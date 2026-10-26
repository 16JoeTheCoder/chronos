// Queue derivation and the single-focus rules (§6.4). Planning is free: tasks,
// blocks and order change at will. Execution is strict: exactly one active task,
// the head of the derived queue that has a finish condition; once its timer has
// run it is locked, and only Finish (typed phrase) or Drop (typed reason) end it.

import { sessionId } from '../model/ids';
import type { Block, Data, Priority, Slice, Task } from '../model/types';
import { create, get, live, settingsOf, timerOf, update, type Ctx } from '../repo/repo';
import { hasFinishCondition } from '../validation';
import { dateOf, zonedToUtc } from '../time/zone';
import { pauseAt, stop } from '../timer/timer';

export const PRIORITY_RANK: Record<Priority, number> = { must: 0, should: 1, nice: 2 };

export const todayOf = (d: Data, now: number): string => dateOf(now, settingsOf(d).timezone);

export function blocksOn(d: Data, date: string): Block[] {
  const tasks = d.tasks;
  return live(d, 'blocks')
    .filter((b) => b.date === date && (b.taskId === null || tasks[b.taskId]?.deletedAt === null))
    .sort((a, b) => a.startMin - b.startMin);
}

export const blockSpan = (b: Block): [number, number] => [zonedToUtc(b.date, b.startMin, b.tz), zonedToUtc(b.date, b.endMin, b.tz)];

export function activeTask(d: Data): Task | undefined {
  return live(d, 'tasks').find((t) => t.status === 'active');
}

/** Locked once its timer has run in the current run (Drop and Reopen start a new run). */
export const isLocked = (t: Task): boolean => t.startedAt !== null;

/** Unscheduled order: priority, then fractional order; dropped (parked) tasks go to the back. */
function byPriority(a: Task, b: Task): number {
  return (a.parkedAt ?? 0) - (b.parkedAt ?? 0) || PRIORITY_RANK[a.priority] - PRIORITY_RANK[b.priority] || a.order - b.order;
}

/**
 * The execution queue: the locked active task (if any), then tasks with a block
 * today in block time order, then unscheduled tasks by priority and order.
 */
export function deriveQueue(d: Data, now: number): Task[] {
  const open = live(d, 'tasks').filter((t) => t.status !== 'done');
  const locked = open.find((t) => t.status === 'active' && isLocked(t));
  const seen = new Set<string>(locked ? [locked.id] : []);
  const out: Task[] = locked ? [locked] : [];
  for (const b of blocksOn(d, todayOf(d, now))) {
    const t = b.taskId ? d.tasks[b.taskId] : undefined;
    if (t && t.status !== 'done' && !seen.has(t.id)) {
      seen.add(t.id);
      out.push(t);
    }
  }
  return out.concat(open.filter((t) => !seen.has(t.id)).sort(byPriority));
}

/** Restore the invariant: exactly one active task (the locked one, else the first startable head). */
export function normalize(d: Data, ctx: Ctx): Data {
  const queue = deriveQueue(d, ctx.now);
  const head = queue.find((t) => isLocked(t) && t.status === 'active') ?? queue.find((t) => hasFinishCondition(t.finishCondition));
  let out = d;
  for (const t of live(d, 'tasks')) {
    if (t.status === 'done') continue;
    const want = t.id === head?.id ? 'active' : 'queued';
    if (t.status === want) continue;
    if (want === 'queued' && t.runtime.status === 'running') {
      // Only reachable after a sync merge produced two actives: bank the slice first.
      const s = pauseAt(t, ctx.now);
      out = recordSlices(update(out, 'tasks', t.id, { ...s.task, status: 'queued' }, ctx), t.id, s.slices, ctx);
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
