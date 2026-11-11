// Every state change the UI can ask for, as one discriminated union, and the
// pure reducer that applies the data commands. main/controller.ts owns the few
// that touch the machine (gap answer, device settings, takeover, import/export)
// and routes everything else through apply(), then persists and broadcasts.

import type { Block, CalEvent, Closure, Coll, Data, Priority, ProjectColumn, Rec, Scope, Settings, Tag, TagColor, Task, TaskRecurrence, TaskSource, TimerConfig, TimerEvent } from './model/types';
import { TAG_COLORS } from './model/types';
import { defaultColumns } from './model/defaults';
import { exceptionId, newId } from './model/ids';
import { keyBetween } from './model/sortKey';
import { create, get, live, putRaw, recycle, restore, settingsOf, timerOf, update, updateSettings, type Ctx, type Fields } from './repo/repo';
import { spawnNext } from './tasks/recurrence';
import { checkpointDue, nextCheckpoint } from './tasks/sprints';
import { activeTask, blockSpan, blocksOn, deriveQueue, isLocked, isOpen, maxOrder, minOrder, normalize, ownsTimer, recordSlices, stopTask, todayOf, trackedMs } from './tasks/tasks';
import { expandEvents } from './time/schedule';
import { overlaps } from './time/intervals';
import { zonedToUtc } from './time/zone';
import { advance, pauseAt, skipPhase, start, reset } from './timer/timer';
import {
  isDate, isDropReason, isMinute, validateEventFields, validateSettings, validateTag, validateTaskFields, type Errors,
} from './validation';
import type { DeviceSettings } from './model/types';

export interface TaskInput {
  kind?: 'task' | 'sprint';
  title: string;
  finishCondition?: string;
  notes?: string;
  tagId?: string | null;
  priority?: Priority;
  estimateMin?: number | null;
  dueDate?: string | null;
  dueTime?: number | null;
  dueEventId?: string | null;
  projectId?: string | null;
  columnId?: string | null;
  recurrence?: TaskRecurrence | null;
  source?: TaskSource;
  checkpointEveryMin?: number | null;
  timer?: TimerConfig;
}

/** Per-date override of a repeating event (null / absent = unchanged). */
export interface OccurrencePatch {
  title?: string | null;
  startMin?: number | null;
  endMin?: number | null;
  tagId?: string | null;
}

/** One record put back the way it was (undo). `prev` null = the record did not exist: recycle it. */
export interface RevertOp {
  coll: Coll;
  id: string;
  prev: Record<string, unknown> | null;
}

export type EventInput = Pick<CalEvent, 'title' | 'tagId' | 'scope' | 'tz' | 'startMin' | 'endMin' | 'date' | 'recur' | 'notes'>;
export type ClosureInput = Pick<Closure, 'name' | 'startDate' | 'endDate' | 'scopes' | 'confirmed'>;
export type TagInput = Pick<Tag, 'name' | 'color' | 'kind'>;
export type SettingsPatch = Partial<Omit<Settings, 'id' | 'createdAt' | 'updatedAt' | 'deviceId' | 'deletedAt' | 'v'>>;
export const RECYCLABLE: Coll[] = ['tasks', 'events', 'eventExceptions', 'blocks', 'tags', 'ideas', 'closures', 'projects'];

export type Command =
  | { type: 'task.create'; input: TaskInput }
  | { type: 'task.update'; id: string; input: Partial<TaskInput> }
  | { type: 'task.reorder'; id: string; direction: 'up' | 'down' }
  /** Complete a task (held 2 s in the app). The focused task stops its timer; recurring tasks spawn the next one. */
  | { type: 'task.finish'; id: string }
  /** Park the focused task at the back of the queue (v1 Drop). */
  | { type: 'task.drop'; id: string; reason: string }
  /** Close any open task as dropped (not finished). */
  | { type: 'task.close'; id: string; reason: string }
  | { type: 'task.reopen'; id: string }
  | { type: 'task.moveCard'; id: string; columnId: string; beforeId: string | null }
  | { type: 'timer'; action: 'start' | 'pause' | 'resume' | 'reset' | 'skipPhase' }
  | { type: 'sprint.checkpoint'; id: string; choice: 'continue' | 'kill'; reason?: string }
  | { type: 'block.create'; taskId: string | null; date: string; startMin: number; endMin: number; title?: string; kind?: Block['kind'] }
  | { type: 'block.move'; id: string; date: string; startMin: number; endMin: number }
  | { type: 'event.create'; input: EventInput }
  | { type: 'event.update'; id: string; input: EventInput }
  | { type: 'event.skip'; id: string; date: string }
  | { type: 'event.editOn'; id: string; date: string; patch: OccurrencePatch }
  | { type: 'project.create'; name: string; color?: TagColor; columns?: string[] }
  | { type: 'closure.create'; input: ClosureInput }
  | { type: 'closure.update'; id: string; input: ClosureInput }
  | { type: 'tag.create'; input: TagInput }
  | { type: 'tag.update'; id: string; input: TagInput }
  | { type: 'idea.add'; text: string; taskId: string | null }
  /** Internal (MCP undo, snapshot restore): never parsed from IPC. */
  | { type: 'records.revert'; ops: RevertOp[] }
  | { type: 'idea.review'; id: string; reviewed: boolean }
  | { type: 'idea.toTask'; id: string }
  | { type: 'recycle'; coll: Coll; id: string; confirmed: boolean }
  | { type: 'restore'; coll: Coll; id: string }
  | { type: 'settings.update'; patch: SettingsPatch }
  // Handled by main/controller.ts (they touch the machine, not just data):
  | { type: 'device.update'; patch: Partial<Omit<DeviceSettings, 'deviceId' | 'sync'>> }
  | { type: 'gap.answer'; count: boolean }
  | { type: 'timer.takeover' }
  | { type: 'data.import'; source: 'monolith' }
  | { type: 'data.export' }
  | { type: 'data.openFolder' };

export type Result = { ok: true; id?: string } | { ok: false; error: string; fields?: Errors };
export type Mutation = { ok: true; d: Data; events: TimerEvent[]; id?: string } | { ok: false; error: string; fields?: Errors };

const ok = (d: Data, events: TimerEvent[] = [], id?: string): Mutation => ({ ok: true, d, events, id });
const fail = (error: string, fields?: Errors): Mutation => ({ ok: false, error, fields });
const checked = (fields: Errors, then: () => Mutation): Mutation => (Object.keys(fields).length ? fail('Please fix the highlighted fields.', fields) : then());
const MIN = 60_000;

/** Does [startMin, endMin) on date fit around fixed events and other blocks? */
export function blockFits(d: Data, date: string, startMin: number, endMin: number, ignoreId?: string): boolean {
  if (!(Number.isInteger(startMin) && Number.isInteger(endMin) && startMin >= 0 && endMin <= 1440 && endMin > startMin)) return false;
  const tz = settingsOf(d).timezone;
  const span: [number, number] = [zonedToUtc(date, startMin, tz), zonedToUtc(date, endMin, tz)];
  const fixed = expandEvents(d, date).map((i): [number, number] => [i.start, i.end]);
  const blocks = blocksOn(d, date).filter((b) => b.id !== ignoreId).map(blockSpan);
  return ![...fixed, ...blocks].some((x) => overlaps(span, x));
}

const lastSortKey = (d: Data): string | null => live(d, 'tasks').reduce<string | null>((m, t) => (m === null || t.sortKey > m ? t.sortKey : m), null);
const cleanRecurrence = (r: TaskRecurrence): TaskRecurrence =>
  r.freq === 'weekly' ? { freq: 'weekly', interval: r.interval, weekdays: [...new Set(r.weekdays ?? [])].sort() } : { freq: 'daily', interval: r.interval };

function liveProject(d: Data, id: string | null | undefined) {
  const p = get(d, 'projects', id);
  return p && p.deletedAt === null ? p : undefined;
}

function newTask(d: Data, input: TaskInput): Fields<'tasks'> {
  const s = settingsOf(d);
  const project = liveProject(d, input.projectId);
  const sprint = input.kind === 'sprint';
  const timer = structuredClone(input.timer ?? (sprint ? { ...s.timerDefaults, mode: 'stopwatch' as const } : s.timerDefaults));
  const every = sprint ? (input.checkpointEveryMin ?? s.checkpointEveryMin) : null;
  return {
    kind: sprint ? 'sprint' : 'task',
    title: input.title.trim(),
    finishCondition: (input.finishCondition ?? '').trim(),
    notes: input.notes ?? '',
    tagId: input.tagId && get(d, 'tags', input.tagId) ? input.tagId : null,
    priority: input.priority ?? 'should',
    estimateMin: input.estimateMin ?? null,
    dueDate: input.dueDate ?? null,
    dueTime: input.dueTime ?? null,
    dueEventId: input.dueEventId ?? null,
    projectId: project ? project.id : null,
    columnId: project ? (project.columns.find((c) => c.id === input.columnId) ?? project.columns[0])?.id ?? null : null,
    recurrence: input.recurrence ? cleanRecurrence(input.recurrence) : null,
    recurrenceParentId: null,
    source: input.source ?? 'typed',
    order: maxOrder(d) + 1,
    sortKey: keyBetween(lastSortKey(d), null),
    status: 'inbox',
    outcome: null,
    dropCount: 0,
    parkedAt: null,
    workMs: 0,
    breakMs: 0,
    pomodorosCompleted: 0,
    startedAt: null,
    completedAt: null,
    timer,
    runtime: { status: 'idle', phase: 'work', phaseElapsedMs: 0, sliceStartedAt: null, cycleSessions: 0, expiredNotified: false },
    checkpointEveryMin: every,
    nextCheckpointMs: every ? every * MIN : null,
  };
}

/** Apply a data command. Pure: (data, command, clock+device) -> new data. */
export function apply(d: Data, cmd: Command, ctx: Ctx & { deviceName?: string }): Mutation {
  const res = applyRaw(d, cmd, ctx);
  return res.ok ? { ...res, d: normalize(res.d, ctx) } : res;
}

function applyRaw(d: Data, cmd: Command, ctx: Ctx & { deviceName?: string }): Mutation {
  switch (cmd.type) {
    case 'task.create': {
      const e = validateTaskFields({ ...cmd.input, title: cmd.input.title ?? '' });
      return checked(e, () => {
        const r = create(d, 'tasks', newTask(d, cmd.input), ctx);
        return ok(r.d, [], r.rec.id);
      });
    }

    case 'task.update': {
      const t = get(d, 'tasks', cmd.id);
      if (!t || t.deletedAt !== null) return fail('Task not found.');
      const i = cmd.input;
      const e = validateTaskFields(i);
      if (i.finishCondition !== undefined && isLocked(t) && i.finishCondition.trim() !== t.finishCondition) e.finishCondition = 'The finish condition is locked once the timer has started.';
      if (i.timer !== undefined && isLocked(t) && JSON.stringify(i.timer) !== JSON.stringify(t.timer)) e.timer = 'The timer mode is fixed once it has started.';
      if (i.tagId && !get(d, 'tags', i.tagId)) e.tagId = 'Unknown tag.';
      if (i.projectId && !liveProject(d, i.projectId)) e.projectId = 'Unknown project.';
      return checked(e, () => {
        const patch: Partial<Task> = {};
        if (i.title !== undefined) patch.title = i.title.trim();
        if (i.finishCondition !== undefined) patch.finishCondition = i.finishCondition.trim();
        if (i.notes !== undefined) patch.notes = i.notes;
        if (i.tagId !== undefined) patch.tagId = i.tagId;
        if (i.priority !== undefined) patch.priority = i.priority;
        if (i.estimateMin !== undefined) patch.estimateMin = i.estimateMin;
        if (i.dueDate !== undefined) patch.dueDate = i.dueDate;
        if (i.dueTime !== undefined) patch.dueTime = i.dueTime;
        if (i.recurrence !== undefined) patch.recurrence = i.recurrence ? cleanRecurrence(i.recurrence) : null;
        if (i.projectId !== undefined) {
          const p = liveProject(d, i.projectId);
          patch.projectId = p?.id ?? null;
          patch.columnId = p ? (p.columns.find((c) => c.id === (i.columnId ?? t.columnId)) ?? p.columns[0])?.id ?? null : null;
        } else if (i.columnId !== undefined) {
          const p = liveProject(d, t.projectId);
          if (p && p.columns.some((c) => c.id === i.columnId)) patch.columnId = i.columnId;
        }
        if (i.dueEventId !== undefined) patch.dueEventId = i.dueEventId;
        if (i.timer !== undefined) patch.timer = structuredClone(i.timer);
        if (i.checkpointEveryMin !== undefined && t.kind === 'sprint') patch.checkpointEveryMin = i.checkpointEveryMin;
        return ok(update(d, 'tasks', t.id, patch, ctx));
      });
    }

    case 'task.reorder': {
      // Moves within the derived queue; crossing into another priority band adopts it.
      const q = deriveQueue(d, ctx.now).filter((t) => !(t.status === 'doing' && isLocked(t)));
      const i = q.findIndex((t) => t.id === cmd.id);
      const j = cmd.direction === 'up' ? i - 1 : i + 1;
      const a = q[i];
      const b = q[j];
      if (!a || !b) return ok(d);
      const beyond = q[cmd.direction === 'up' ? j - 1 : j + 1];
      const order = beyond ? (b.order + beyond.order) / 2 : b.order + (cmd.direction === 'up' ? -1 : 1);
      return ok(update(d, 'tasks', a.id, { order, priority: b.priority, parkedAt: b.parkedAt }, ctx));
    }

    case 'timer': {
      const t = activeTask(d);
      if (!t) return fail('No task in focus. Give a task a finish condition to start.');
      if (!ownsTimer(d, ctx.deviceId)) return fail(`Running on ${timerOf(d).ownerName || 'another device'}. Take over to control it here.`);
      if (cmd.action === 'start' || cmd.action === 'resume') {
        if (t.runtime.status === 'running') return ok(d);
        let next: Task = { ...t, parkedAt: null };
        // Inside one of its blocks, a fresh countdown runs to the block's end (§6.6).
        const block = blocksOn(d, todayOf(d, ctx.now)).find((b) => b.taskId === t.id && blockSpan(b)[0] <= ctx.now && ctx.now < blockSpan(b)[1]);
        if (block && t.runtime.status === 'idle' && t.timer.mode === 'countdown') {
          next.timer = { ...t.timer, countdown: { durationMs: Math.max(60_000, blockSpan(block)[1] - ctx.now), onExpire: settingsOf(d).blockEnd } };
        }
        next = start(advance(next, ctx.now).task, ctx.now);
        let out = d;
        if (t.startedAt === null) {
          next.startedAt = ctx.now;
          out = create(out, 'activity', { type: 'started', taskId: t.id, at: ctx.now, reason: '' }, ctx).d;
        }
        out = update(out, 'tasks', t.id, next, ctx);
        out = update(out, 'timer', 'current', { taskId: t.id, ownerDeviceId: ctx.deviceId, ownerName: ctx.deviceName ?? '', takeoverAt: null }, ctx);
        return ok(out);
      }
      if (cmd.action === 'skipPhase' && t.timer.mode !== 'pomodoro') return fail('Skip is only available in Pomodoro mode.');
      const s = cmd.action === 'pause' ? pauseAt(t, ctx.now) : cmd.action === 'reset' ? reset(t, ctx.now) : skipPhase(t, ctx.now);
      return ok(recordSlices(update(d, 'tasks', t.id, s.task, ctx), t.id, s.slices, ctx), s.events);
    }

    case 'task.finish': {
      const t = get(d, 'tasks', cmd.id);
      if (!t || t.deletedAt !== null || !isOpen(t)) return fail('Only an open task can be finished.');
      const focused = activeTask(d)?.id === t.id;
      if (focused && !ownsTimer(d, ctx.deviceId)) return fail('Take over the timer on this device first.');
      const s = stopTask(d, t, ctx);
      let out = update(s.d, 'tasks', t.id, { ...s.task, status: 'done', outcome: t.kind === 'sprint' ? 'shipped' : 'finished', completedAt: ctx.now, nextCheckpointMs: null }, ctx);
      out = create(out, 'activity', { type: 'finished', taskId: t.id, at: ctx.now, reason: '' }, ctx).d;
      out = spawnNext(out, t, ctx);
      return ok(focused || timerOf(out).taskId === t.id ? update(out, 'timer', 'current', { taskId: null }, ctx) : out);
    }

    case 'task.close': {
      const t = get(d, 'tasks', cmd.id);
      if (!t || t.deletedAt !== null || !isOpen(t)) return fail('Only an open task can be dropped.');
      if (!isDropReason(cmd.reason)) return fail('Give a reason (at least 3 characters).');
      const focused = activeTask(d)?.id === t.id;
      if (focused && !ownsTimer(d, ctx.deviceId)) return fail('Take over the timer on this device first.');
      const s = stopTask(d, t, ctx);
      const today = todayOf(d, ctx.now);
      let out = s.d;
      for (const b of live(d, 'blocks')) if (b.taskId === t.id && b.date >= today) out = recycle(out, 'blocks', b.id, ctx);
      out = update(out, 'tasks', t.id, { ...s.task, status: 'dropped', outcome: null, completedAt: ctx.now, nextCheckpointMs: null }, ctx);
      out = create(out, 'activity', { type: 'dropped', taskId: t.id, at: ctx.now, reason: cmd.reason.trim() }, ctx).d;
      return ok(focused || timerOf(out).taskId === t.id ? update(out, 'timer', 'current', { taskId: null }, ctx) : out);
    }

    case 'task.moveCard': {
      const t = get(d, 'tasks', cmd.id);
      if (!t || t.deletedAt !== null) return fail('Task not found.');
      const p = liveProject(d, t.projectId);
      if (!p) return fail('That task is not in a project.');
      if (!p.columns.some((c) => c.id === cmd.columnId)) return fail('Unknown column.');
      const cards = live(d, 'tasks')
        .filter((x) => x.projectId === p.id && x.columnId === cmd.columnId && x.id !== t.id)
        .sort((a, b) => (a.sortKey < b.sortKey ? -1 : a.sortKey > b.sortKey ? 1 : 0));
      const i = cmd.beforeId ? cards.findIndex((x) => x.id === cmd.beforeId) : -1;
      if (cmd.beforeId && i < 0) return fail('That card is not in this column.');
      const before = i >= 0 ? cards[i] : undefined;
      const after = i > 0 ? cards[i - 1] : i < 0 ? cards.at(-1) : undefined;
      let key: string;
      try {
        key = keyBetween(after?.sortKey ?? null, before?.sortKey ?? null);
      } catch {
        return fail('Could not order that card.');
      }
      return ok(update(d, 'tasks', t.id, { columnId: cmd.columnId, sortKey: key }, ctx));
    }

    case 'task.drop':
    case 'sprint.checkpoint': {
      const t = activeTask(d);
      if (!t || t.id !== cmd.id) return fail('Only the task in focus can be changed here.');
      if (cmd.type === 'sprint.checkpoint' && cmd.choice === 'continue') {
        return checkpointDue(t, ctx.now) ? ok(update(d, 'tasks', t.id, { nextCheckpointMs: nextCheckpoint(t, ctx.now) }, ctx)) : ok(d);
      }
      const reason = cmd.reason ?? '';
      if (!isDropReason(reason)) return fail('Give a reason (at least 3 characters).');
      if (!ownsTimer(d, ctx.deviceId)) return fail('Take over the timer on this device first.');
      const kill = cmd.type === 'sprint.checkpoint';
      if (kill && t.kind !== 'sprint') return fail('Only sprints have checkpoints.');
      const s = stopTask(d, t, ctx);
      let out = s.d;
      const today = todayOf(d, ctx.now);
      // Drop clears the task's blocks from today on, so the runway frees that time.
      for (const b of live(d, 'blocks')) if (b.taskId === t.id && b.date >= today) out = recycle(out, 'blocks', b.id, ctx);
      out = update(
        out,
        'tasks',
        t.id,
        kill
          ? { ...s.task, status: 'done', outcome: 'killed', completedAt: ctx.now, nextCheckpointMs: null }
          : // startedAt cleared: the lock (§6.4) applies to the current run, so a dropped task is free again.
            { ...s.task, status: 'inbox', startedAt: null, dropCount: t.dropCount + 1, parkedAt: ctx.now, order: maxOrder(d) + 1 },
        ctx,
      );
      out = create(out, 'activity', { type: kill ? 'killed' : 'dropped', taskId: t.id, at: ctx.now, reason: reason.trim() }, ctx).d;
      return ok(update(out, 'timer', 'current', { taskId: null }, ctx));
    }

    case 'task.reopen': {
      const t = get(d, 'tasks', cmd.id);
      if (!t || isOpen(t)) return fail('Only finished or dropped tasks can be reopened.');
      const every = t.checkpointEveryMin ?? settingsOf(d).checkpointEveryMin;
      return ok(update(d, 'tasks', t.id, { status: 'inbox', outcome: null, completedAt: null, startedAt: null, parkedAt: null, order: minOrder(d) - 1, nextCheckpointMs: t.kind === 'sprint' ? t.workMs + every * MIN : null }, ctx));
    }

    case 'block.create': {
      if (!isDate(cmd.date)) return fail('Invalid date.');
      const t = cmd.taskId ? get(d, 'tasks', cmd.taskId) : undefined;
      if (cmd.taskId && (!t || t.deletedAt !== null)) return fail('Task not found.');
      if (!blockFits(d, cmd.date, cmd.startMin, cmd.endMin)) return fail('That time overlaps a fixed event or another block.');
      const kind = cmd.kind ?? (t?.kind === 'sprint' ? 'sprint' : 'work');
      const r = create(d, 'blocks', { taskId: cmd.taskId, tagId: t?.tagId ?? null, title: (cmd.title ?? t?.title ?? 'Block').slice(0, 120), date: cmd.date, startMin: cmd.startMin, endMin: cmd.endMin, tz: settingsOf(d).timezone, kind, auto: false }, ctx);
      return ok(r.d, [], r.rec.id);
    }

    case 'block.move': {
      const b = get(d, 'blocks', cmd.id);
      if (!b || b.deletedAt !== null) return fail('Block not found.');
      if (!isDate(cmd.date) || !blockFits(d, cmd.date, cmd.startMin, cmd.endMin, b.id)) return fail('That time overlaps a fixed event or another block.');
      return ok(update(d, 'blocks', b.id, { date: cmd.date, startMin: cmd.startMin, endMin: cmd.endMin }, ctx));
    }

    case 'event.create':
    case 'event.update': {
      const e = validateEventFields(cmd.input as unknown as Record<string, unknown>);
      return checked(e, () => {
        const i = cmd.input;
        const fields = { title: i.title.trim(), tagId: i.tagId && get(d, 'tags', i.tagId) ? i.tagId : null, scope: i.scope, tz: i.tz, startMin: i.startMin, endMin: i.endMin, date: i.date, recur: i.recur ? { ...i.recur, weekdays: [...new Set(i.recur.weekdays)].sort() } : null, notes: i.notes };
        if (cmd.type === 'event.update') return get(d, 'events', cmd.id) ? ok(update(d, 'events', cmd.id, fields, ctx)) : fail('Event not found.');
        const r = create(d, 'events', fields, ctx);
        return ok(r.d, [], r.rec.id);
      });
    }

    case 'event.skip': {
      const ev = get(d, 'events', cmd.id);
      if (!ev || ev.deletedAt !== null || !ev.recur || !isDate(cmd.date)) return fail('Only a repeating event can skip one occurrence.');
      const r = create(d, 'eventExceptions', { eventId: ev.id, date: cmd.date, kind: 'skip', title: null, startMin: null, endMin: null, tagId: null }, ctx, exceptionId(ev.id, cmd.date));
      return ok(r.d, [], r.rec.id);
    }

    case 'event.editOn': {
      const ev = get(d, 'events', cmd.id);
      if (!ev || ev.deletedAt !== null || !ev.recur || !isDate(cmd.date)) return fail('Only a repeating event can change one occurrence.');
      const id = exceptionId(ev.id, cmd.date);
      const prev = get(d, 'eventExceptions', id);
      const base = prev && prev.deletedAt === null && prev.kind === 'edit' ? prev : null;
      const p = cmd.patch;
      const pick = <K extends keyof OccurrencePatch>(k: K) => (p[k] !== undefined ? p[k] : (base?.[k] ?? null));
      const next = { title: pick('title'), startMin: pick('startMin'), endMin: pick('endMin'), tagId: pick('tagId') };
      const e: Errors = {};
      if (next.title !== null && (typeof next.title !== 'string' || !next.title.trim() || next.title.length > 120)) e.title = 'Title must be 1-120 characters.';
      if ((next.startMin !== null && !isMinute(next.startMin)) || (next.endMin !== null && !isMinute(next.endMin)) || (next.endMin ?? ev.endMin) <= (next.startMin ?? ev.startMin)) e.time = 'End must be after start.';
      if (next.tagId !== null && !get(d, 'tags', next.tagId)) e.tagId = 'Unknown tag.';
      return checked(e, () => {
        const fields = { eventId: ev.id, date: cmd.date, kind: 'edit' as const, title: typeof next.title === 'string' ? next.title.trim() : null, startMin: next.startMin as number | null, endMin: next.endMin as number | null, tagId: next.tagId as string | null };
        const r = prev ? { d: update(restore(d, 'eventExceptions', id, ctx), 'eventExceptions', id, fields, ctx), rec: prev } : create(d, 'eventExceptions', fields, ctx, id);
        return ok(r.d, [], id);
      });
    }

    case 'project.create': {
      const name = (cmd.name ?? '').trim();
      if (!name || name.length > 80) return fail('Name the project (1-80 characters).', { name: 'Name must be 1-80 characters.' });
      if (cmd.color !== undefined && !TAG_COLORS.includes(cmd.color)) return fail('Pick a colour.', { color: 'Pick a colour.' });
      const names = cmd.columns?.map((c) => c.trim()).filter(Boolean) ?? [];
      if (names.length > 12 || names.some((c) => c.length > 40)) return fail('Up to 12 columns of 1-40 characters.', { columns: 'Up to 12 columns of 1-40 characters.' });
      const columns: ProjectColumn[] = names.length ? names.map((n) => ({ id: newId().slice(0, 8), name: n })) : defaultColumns();
      const last = live(d, 'projects').reduce<string | null>((m, x) => (m === null || x.sortKey > m ? x.sortKey : m), null);
      const r = create(d, 'projects', { name, color: cmd.color ?? 'tag1', columns, archived: false, sortKey: keyBetween(last, null) }, ctx);
      return ok(r.d, [], r.rec.id);
    }

    case 'records.revert': {
      let out = d;
      for (const op of cmd.ops) {
        const cur = get(out, op.coll, op.id);
        if (op.prev === null) {
          if (cur && cur.deletedAt === null) out = recycle(out, op.coll, op.id, ctx);
          continue;
        }
        const { id: _id, fv: _fv, fw: _fw, updatedAt: _u, deviceId: _dv, v: _v, ...fields } = op.prev;
        out = cur ? update(out, op.coll, op.id, fields as never, ctx) : putRaw(out, op.coll, { ...(op.prev as unknown as Rec), fv: {}, fw: {} } as never);
      }
      return ok(out);
    }

    case 'closure.create':
    case 'closure.update': {
      const i = cmd.input;
      const SC: Scope[] = ['school', 'work', 'uni', 'other'];
      if (!i.name?.trim() || i.name.length > 80) return fail('Name the closure.', { name: 'Name must be 1-80 characters.' });
      if (!isDate(i.startDate) || !isDate(i.endDate) || i.endDate < i.startDate) return fail('Check the dates.', { dates: 'End must be on or after start.' });
      if (!Array.isArray(i.scopes) || !i.scopes.every((s) => SC.includes(s))) return fail('Invalid scopes.');
      const fields = { name: i.name.trim(), startDate: i.startDate, endDate: i.endDate, scopes: [...new Set(i.scopes)], confirmed: i.confirmed === true };
      if (cmd.type === 'closure.update') return get(d, 'closures', cmd.id) ? ok(update(d, 'closures', cmd.id, fields, ctx)) : fail('Closure not found.');
      const r = create(d, 'closures', { ...fields, source: 'custom' }, ctx);
      return ok(r.d, [], r.rec.id);
    }

    case 'tag.create':
    case 'tag.update':
      return checked(validateTag(cmd.input), () => {
        const fields = { name: cmd.input.name.trim(), color: cmd.input.color, kind: cmd.input.kind };
        if (cmd.type === 'tag.update') return get(d, 'tags', cmd.id) ? ok(update(d, 'tags', cmd.id, fields, ctx)) : fail('Tag not found.');
        const r = create(d, 'tags', fields, ctx);
        return ok(r.d, [], r.rec.id);
      });

    case 'idea.add': {
      const text = cmd.text.trim();
      if (!text || text.length > 20_000) return fail('Type a thought first (up to 20,000 characters).');
      const r = create(d, 'ideas', { text: text.slice(0, 1000), body: text, taskId: cmd.taskId && get(d, 'tasks', cmd.taskId) ? cmd.taskId : null, reviewed: false, parsedTaskIds: [] }, ctx);
      return ok(r.d, [], r.rec.id);
    }
    case 'idea.review':
      return ok(update(d, 'ideas', cmd.id, { reviewed: cmd.reviewed }, ctx));
    case 'idea.toTask': {
      const idea = get(d, 'ideas', cmd.id);
      if (!idea) return fail('Idea not found.');
      const r = create(d, 'tasks', newTask(d, { title: idea.text.slice(0, 120) }), ctx);
      return ok(update(r.d, 'ideas', idea.id, { reviewed: true }, ctx), [], r.rec.id);
    }

    case 'recycle': {
      if (!RECYCLABLE.includes(cmd.coll)) return fail('That cannot be deleted.');
      const rec = get(d, cmd.coll, cmd.id);
      if (!rec) return fail('Not found.');
      if (cmd.coll === 'tasks') {
        const t = rec as Task;
        if (trackedMs(t, ctx.now) > 0 && !cmd.confirmed) return fail('confirm-required');
        if (t.runtime.status === 'running') {
          const s = stopTask(d, t, ctx);
          return ok(recycle(update(update(s.d, 'tasks', t.id, s.task, ctx), 'timer', 'current', { taskId: null }, ctx), 'tasks', t.id, ctx));
        }
      }
      return ok(recycle(d, cmd.coll, cmd.id, ctx));
    }
    case 'restore':
      return RECYCLABLE.includes(cmd.coll) ? ok(restore(d, cmd.coll, cmd.id, ctx)) : fail('That cannot be restored.');

    case 'settings.update': {
      const next = { ...settingsOf(d), ...cmd.patch } as Settings;
      return checked(validateSettings(next), () => ok(updateSettings(d, cmd.patch, ctx)));
    }

    default:
      return fail('Unsupported command.');
  }
}
