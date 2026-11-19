// The one status transition (Phase 3.7 §1). Every command that changes a task's status
// goes through transition(): Home, Tasks, Board, Focus, Plan, the overlay pill, the palette
// and MCP all end up here, so a status means the same thing on every screen.
//
//   leaving done/dropped  clears completedAt and outcome (the done styling goes with them)
//   leaving doing         pauses the timer and closes the running session (time is kept)
//   becoming doing        pauses any other doing task first (one active task)
//   becoming done         stops the timer, records the outcome, spawns the next recurrence
// A task in a project also moves to the matching board column (doing / done / back to the first).

import { doingColumnId, doneColumnId } from '../board';
import type { Data, Outcome, Task } from '../model/types';
import { create, get, live, recycle, settingsOf, timerOf, update, type Ctx } from '../repo/repo';
import { advance, pauseAt, start } from '../timer/timer';
import { spawnNext } from './recurrence';
import { blockSpan, blocksOn, minOrder, ownsTimer, recordSlices, stopTask, todayOf } from './tasks';

/** 'open' = back in the list (inbox or planned; normalize derives which). */
export type Target = 'open' | 'doing' | 'done' | 'dropped';

export interface TransitionOpts {
  /** Becoming doing: also start (or resume) its timer. */
  start?: boolean;
  /** Becoming done: the outcome (default finished, shipped for a sprint). */
  outcome?: Outcome;
  /** Becoming dropped: the reason for the activity log. */
  reason?: string;
  /** Board move: the column the caller already chose (skips the automatic column). */
  columnId?: string;
  /** Leaving doing to open by Drop: park it at the back. */
  park?: boolean;
  deviceName?: string;
}

export type TransitionResult = { ok: true; d: Data } | { ok: false; error: string };

const MIN = 60_000;

export const targetOf = (t: Task): Target => (t.status === 'doing' ? 'doing' : t.status === 'done' ? 'done' : t.status === 'dropped' ? 'dropped' : 'open');

/** The column a status belongs in, or null to leave the task's column as it is. */
function columnFor(d: Data, t: Task, to: Target): string | null | undefined {
  const p = t.projectId ? get(d, 'projects', t.projectId) : undefined;
  if (!p || p.deletedAt !== null) return undefined;
  const doing = doingColumnId(p.columns);
  const done = doneColumnId(p.columns);
  if (to === 'doing') return doing ?? undefined;
  if (to === 'done') return done ?? undefined;
  // Open (or dropped): leave a normal column alone; out of doing/done goes back to the first other column.
  if (t.columnId && t.columnId !== doing && t.columnId !== done && p.columns.some((c) => c.id === t.columnId)) return undefined;
  return p.columns.find((c) => c.id !== doing && c.id !== done)?.id ?? p.columns[0]?.id;
}

/** Pause the running slice (if any) and bank it as a session. Runtime stays 'paused' so a later Start resumes it. */
function release(d: Data, t: Task, ctx: Ctx): { d: Data; task: Task } {
  if (t.runtime.status !== 'running') return { d, task: t };
  const s = pauseAt(t, ctx.now);
  return { d: recordSlices(d, t.id, s.slices, ctx), task: s.task };
}

/** Start (or resume) the timer of `t`, which must already be the doing task. */
export function startTimer(d: Data, t: Task, ctx: Ctx & { deviceName?: string }): Data {
  if (t.runtime.status === 'running') return d;
  let next: Task = { ...t, parkedAt: null };
  // Inside one of its blocks, a fresh countdown runs to the block's end (§6.6).
  const block = blocksOn(d, todayOf(d, ctx.now)).find((b) => b.taskId === t.id && blockSpan(b)[0] <= ctx.now && ctx.now < blockSpan(b)[1]);
  if (block && t.runtime.status === 'idle' && t.timer.mode === 'countdown') {
    next.timer = { ...t.timer, countdown: { durationMs: Math.max(MIN, blockSpan(block)[1] - ctx.now), onExpire: settingsOf(d).blockEnd } };
  }
  next = start(advance(next, ctx.now).task, ctx.now);
  let out = d;
  if (t.startedAt === null) {
    next.startedAt = ctx.now;
    out = create(out, 'activity', { type: 'started', taskId: t.id, at: ctx.now, reason: '' }, ctx).d;
  }
  out = update(out, 'tasks', t.id, next, ctx);
  return update(out, 'timer', 'current', { taskId: t.id, ownerDeviceId: ctx.deviceId, ownerName: ctx.deviceName ?? '', takeoverAt: null }, ctx);
}

export function transition(d: Data, id: string, to: Target, ctx: Ctx & { deviceName?: string }, opts: TransitionOpts = {}): TransitionResult {
  const t0 = get(d, 'tasks', id);
  if (!t0 || t0.deletedAt !== null) return { ok: false, error: 'Task not found.' };
  const from = targetOf(t0);
  const running = t0.runtime.status === 'running';
  if (from === 'doing' && to !== 'doing' && running && !ownsTimer(d, ctx.deviceId)) return { ok: false, error: `Running on ${timerOf(d).ownerName || 'another device'}. Take over to control it here.` };

  let out = d;
  let t = t0;
  const col = opts.columnId ?? columnFor(d, t0, to);
  const colPatch = col === undefined || col === null ? {} : { columnId: col };

  // Leaving doing: pause and close the session; the slot is free.
  if (from === 'doing' && to !== 'doing') {
    const r = to === 'done' || to === 'dropped' ? stopTask(out, t, ctx) : release(out, t, ctx);
    out = r.d;
    t = r.task;
    if (timerOf(out).taskId === t.id) out = update(out, 'timer', 'current', { taskId: null }, ctx);
  }

  if (to === 'doing') {
    // One active task: anything else in doing goes back to the list, paused.
    for (const other of live(out, 'tasks')) {
      if (other.id === t.id || other.status !== 'doing') continue;
      const r = transition(out, other.id, 'open', ctx);
      if (!r.ok) return r;
      out = r.d;
    }
    t = get(out, 'tasks', t.id) as Task;
    const reopened = from === 'done' || from === 'dropped' ? { outcome: null, completedAt: null, startedAt: null } : {};
    out = update(out, 'tasks', t.id, { status: 'doing', parkedAt: null, ...reopened, ...colPatch }, ctx);
    t = get(out, 'tasks', t.id) as Task;
    if (timerOf(out).taskId !== t.id) out = update(out, 'timer', 'current', { taskId: t.id, ownerDeviceId: ctx.deviceId, ownerName: ctx.deviceName ?? opts.deviceName ?? '', takeoverAt: null }, ctx);
    if (opts.start) out = startTimer(out, t, ctx);
    return { ok: true, d: out };
  }

  if (to === 'open') {
    if (from === 'done' || from === 'dropped') {
      const every = t.checkpointEveryMin ?? settingsOf(out).checkpointEveryMin;
      out = update(out, 'tasks', t.id, { ...t, status: 'inbox', outcome: null, completedAt: null, startedAt: null, parkedAt: null, order: minOrder(out) - 1, nextCheckpointMs: t.kind === 'sprint' ? t.workMs + every * MIN : null, ...colPatch }, ctx);
    } else {
      out = update(out, 'tasks', t.id, { ...t, status: 'inbox', ...(opts.park ? { parkedAt: ctx.now, dropCount: t.dropCount + 1 } : {}), ...colPatch }, ctx);
    }
    return { ok: true, d: out };
  }

  if (from === to) return { ok: true, d: out };
  if (from !== 'doing') {
    const r = stopTask(out, t, ctx);
    out = r.d;
    t = r.task;
  }
  const today = todayOf(out, ctx.now);
  if (to === 'done') {
    const outcome = opts.outcome ?? (t.kind === 'sprint' ? 'shipped' : 'finished');
    out = update(out, 'tasks', t.id, { ...t, status: 'done', outcome, completedAt: ctx.now, nextCheckpointMs: null, ...colPatch }, ctx);
    out = create(out, 'activity', { type: outcome === 'killed' ? 'killed' : 'finished', taskId: t.id, at: ctx.now, reason: opts.reason ?? '' }, ctx).d;
    if (outcome !== 'killed') out = spawnNext(out, t, ctx);
  } else {
    for (const b of live(out, 'blocks')) if (b.taskId === t.id && b.date >= today) out = recycle(out, 'blocks', b.id, ctx);
    out = update(out, 'tasks', t.id, { ...t, status: 'dropped', outcome: null, completedAt: ctx.now, nextCheckpointMs: null, ...colPatch }, ctx);
    out = create(out, 'activity', { type: 'dropped', taskId: t.id, at: ctx.now, reason: (opts.reason ?? '').trim() }, ctx).d;
  }
  if (timerOf(out).taskId === t.id) out = update(out, 'timer', 'current', { taskId: null }, ctx);
  return { ok: true, d: out };
}

/** The status a board column implies for a card dropped into it. */
export function targetForColumn(d: Data, t: Task, columnId: string): Target {
  const p = t.projectId ? get(d, 'projects', t.projectId) : undefined;
  if (!p) return targetOf(t);
  if (doingColumnId(p.columns) === columnId) return 'doing';
  if (doneColumnId(p.columns) === columnId) return 'done';
  return t.status === 'dropped' ? 'dropped' : 'open';
}
