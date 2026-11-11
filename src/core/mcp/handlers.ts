// MCP tool handlers (docs/MCP.md), transport-agnostic: handler(store, args) ->
// result. The StorePort is a narrow seam (read data, run a command), so the same
// code serves the local endpoint now and a Firestore-backed port later (Phase 4).
// No Node or Electron APIs here (the audit checks).
//
// Safety: writes go through core commands (validation, outbox, sync) exactly like
// UI edits; no hard deletes, no settings; at most 30 writes a minute; every write
// returns the changed record and an undoToken, and is logged as Claude activity.

import type { Command, Result, RevertOp } from '../commands';
import { blockFits } from '../commands';
import { clockOf, formatHM, parseHM } from '../format';
import { newId, reviewId } from '../model/ids';
import type { Block, Coll, Data, Rec, Task } from '../model/types';
import { get, live, settingsOf } from '../repo/repo';
import { SearchIndex, type SearchType } from '../search/index';
import { diffData } from '../sync/outbox';
import { PRIORITY_RANK, activeTask, blockSpan, blocksOn, isOpen, todayOf } from '../tasks/tasks';
import { overlaps, total } from '../time/intervals';
import { prepNudges } from '../time/prep';
import { expandEvents } from '../time/schedule';
import { timeLeft } from '../time/timeLeft';
import { addDays, daysBetween, mondayOf, weekdayOf, zonedToUtc } from '../time/zone';
import { WEEKDAYS } from '../format';
import { TOOLS, checkArgs, toolByName } from './tools';

export interface StorePort {
  data(): Data;
  now(): number;
  /** Apply a data command exactly like the app does (validation, outbox, sync). */
  run(cmd: Command): Result;
  /** A change Claude made, for the app's Undo toast. */
  notify?(n: { text: string; undoToken: string }): void;
}

export type ToolResult = { ok: true; result: unknown } | { ok: false; error: string };

export const WRITES_PER_MINUTE = 30;
const UNDO_KEEP = 100;

type Args = Record<string, unknown>;
const str = (v: unknown) => (typeof v === 'string' ? v : undefined);
const int = (v: unknown) => (typeof v === 'number' ? v : undefined);

export class Mcp {
  private undo = new Map<string, { ops: RevertOp[]; label: string; taskId: string }>();
  private writes: number[] = [];
  private index = new SearchIndex();

  constructor(private store: StorePort, private writesPerMinute = WRITES_PER_MINUTE) {}

  readonly tools = TOOLS;

  call(name: string, rawArgs: unknown): ToolResult {
    const tool = toolByName(name);
    if (!tool) return { ok: false, error: `Unknown tool ${name}.` };
    const args = (rawArgs ?? {}) as Args;
    const problem = checkArgs(tool.inputSchema, args);
    if (problem) return { ok: false, error: `Invalid input: ${problem}.` };
    try {
      if (tool.write && !this.allowWrite()) return { ok: false, error: `Too many changes in a minute (limit ${this.writesPerMinute}). Wait a moment and try again.` };
      return this.dispatch(name, args);
    } catch (e) {
      return { ok: false, error: `Chronos could not do that: ${e instanceof Error ? e.message : String(e)}` };
    }
  }

  /** Undo by token (also the app's Undo toast). */
  undoToken(token: string): ToolResult {
    const u = this.undo.get(token);
    if (!u) return { ok: false, error: 'Unknown or expired undo token.' };
    const r = this.store.run({ type: 'records.revert', ops: u.ops });
    if (!r.ok) return { ok: false, error: r.error };
    this.undo.delete(token);
    this.store.run({ type: 'activity.claude', taskId: u.taskId, reason: `undo: ${u.label}`.slice(0, 500) });
    return { ok: true, result: { undone: u.label } };
  }

  private allowWrite(): boolean {
    const now = this.store.now();
    this.writes = this.writes.filter((t) => now - t < 60_000);
    if (this.writes.length >= this.writesPerMinute) return false;
    this.writes.push(now);
    return true;
  }

  // ---- helpers ----
  private get d(): Data {
    return this.store.data();
  }
  private get tz(): string {
    return settingsOf(this.d).timezone;
  }
  private get today(): string {
    return todayOf(this.d, this.store.now());
  }
  private clock(ts: number): string {
    return clockOf(ts, this.tz);
  }

  private tagId(name: string | undefined): { id: string | null } | { error: string } {
    if (name === undefined) return { id: null };
    const tags = live(this.d, 'tags');
    const t = tags.find((x) => x.id === name) ?? tags.find((x) => x.name.toLowerCase() === name.trim().toLowerCase());
    return t ? { id: t.id } : { error: `Unknown tag "${name}". Known tags: ${tags.map((x) => x.name).join(', ') || 'none'}.` };
  }

  private task(t: Task) {
    const d = this.d;
    return {
      id: t.id,
      title: t.title,
      status: t.status,
      priority: t.priority,
      dueDate: t.dueDate,
      dueTime: t.dueTime === null ? null : formatHM(t.dueTime),
      estimateMin: t.estimateMin,
      tag: t.tagId ? (d.tags[t.tagId]?.name ?? null) : null,
      project: t.projectId ? (d.projects[t.projectId]?.name ?? null) : null,
      recurring: t.recurrence !== null,
      ...(t.deletedAt !== null ? { deleted: true } : {}),
    };
  }

  private block(b: Block) {
    return { id: b.id, taskId: b.taskId, title: b.title, date: b.date, start: formatHM(b.startMin), end: formatHM(b.endMin), kind: b.kind, auto: b.auto };
  }

  /** Why a block does not fit: the first fixed event or block it overlaps. */
  private overlapReason(date: string, startMin: number, endMin: number, ignoreId?: string): string {
    if (!(endMin > startMin && startMin >= 0 && endMin <= 1440)) return 'The end must be after the start, within the day.';
    const span: [number, number] = [zonedToUtc(date, startMin, this.tz), zonedToUtc(date, endMin, this.tz)];
    const ev = expandEvents(this.d, date).find((i) => overlaps(span, [i.start, i.end]));
    if (ev) return `It overlaps the fixed event "${ev.event.title}" ${formatHM(ev.startMin)}-${formatHM(ev.endMin)}.`;
    const b = blocksOn(this.d, date).find((x) => x.id !== ignoreId && overlaps(span, blockSpan(x)));
    if (b) return `It overlaps the planned block "${b.title}" ${formatHM(b.startMin)}-${formatHM(b.endMin)}.`;
    return 'That time does not fit.';
  }

  /** Run one write, remember how to undo it, log it, tell the app. */
  private write(tool: string, cmd: Command, label: string, describe: (d: Data, id: string | undefined) => unknown, taskId = ''): ToolResult {
    const before = this.d;
    const r = this.store.run(cmd);
    if (!r.ok) return { ok: false, error: r.fields && Object.keys(r.fields).length ? `${r.error} ${Object.values(r.fields).join(' ')}` : r.error };
    const after = this.d;
    const ops: RevertOp[] = diffData(before, after, this.store.now()).map((e) => {
      const prev = (before[e.coll] as Record<string, Rec>)[e.id];
      if (!prev) return { coll: e.coll as Coll, id: e.id, prev: null };
      const fields: Record<string, unknown> = {};
      for (const k of Object.keys(e.fields)) fields[k] = (prev as unknown as Record<string, unknown>)[k] ?? null;
      return { coll: e.coll as Coll, id: e.id, prev: fields };
    });
    const token = newId();
    this.undo.set(token, { ops, label, taskId });
    for (const k of [...this.undo.keys()].slice(0, Math.max(0, this.undo.size - UNDO_KEEP))) this.undo.delete(k);
    this.store.run({ type: 'activity.claude', taskId, reason: `${tool}: ${label}`.slice(0, 500) });
    this.store.notify?.({ text: `Claude: ${label}`, undoToken: token });
    return { ok: true, result: { changed: describe(this.d, r.id), undoToken: token } };
  }

  private dispatch(name: string, a: Args): ToolResult {
    const d = this.d;
    const now = this.store.now();
    const s = settingsOf(d);
    const ok = (result: unknown): ToolResult => ({ ok: true, result });
    const fail = (error: string): ToolResult => ({ ok: false, error });
    const taskOf = (id: unknown) => {
      const t = get(d, 'tasks', str(id));
      return t && t.deletedAt === null ? t : undefined;
    };
    switch (name) {
      case 'get_day': {
        const date = str(a.date) ?? this.today;
        const instances = expandEvents(d, date);
        const blocks = blocksOn(d, date);
        const dayStart = zonedToUtc(date, s.dayStartMin, s.timezone);
        const dayEnd = zonedToUtc(date, s.dayEndMin, s.timezone);
        const from = date === this.today ? now : date < this.today ? dayEnd : dayStart;
        const tl = timeLeft({ now: from, dayStart, dayEnd, bufferMin: s.bufferMin, fixed: instances.map((i) => [i.start, i.end]), blocks: blocks.map(blockSpan), variants: s.timeLeft });
        const m = (ms: number) => Math.round(ms / 60_000);
        return ok({
          date,
          weekday: WEEKDAYS[weekdayOf(date) - 1],
          timezone: s.timezone,
          now: date === this.today ? this.clock(now) : null,
          day: { start: formatHM(s.dayStartMin), end: formatHM(s.dayEndMin) },
          events: instances.map((i) => ({ id: i.event.id, title: i.event.title, start: formatHM(i.startMin), end: formatHM(i.endMin), recurring: i.event.recur !== null, ...(i.exceptionId ? { editedToday: true } : {}) })),
          blocks: blocks.map((b) => this.block(b)),
          free: tl.free.map(([x, y]) => ({ start: this.clock(x), end: this.clock(y), minutes: m(y - x) })),
          buffer: { start: formatHM(s.dayEndMin - s.bufferMin), end: formatHM(s.dayEndMin), minutes: s.bufferMin },
          timeLeft: { workableMin: m(tl.workableMs), fixedMin: m(tl.fixedMs), committedMin: m(tl.committedMs), openMin: m(tl.unassignedMs), bufferMin: m(tl.bufferMs), sprintableMin: m(tl.sprintableMs) },
          prep: date === this.today ? prepNudges(d, now).map((n) => ({ task: n.task.title, taskId: n.task.id, before: n.instance.event.title, at: this.clock(n.instance.start), needsMin: n.needsMin, freeBeforeMin: n.freeBeforeMin, tight: n.tight })) : [],
          focus: activeTask(d) ? this.task(activeTask(d) as Task) : null,
        });
      }
      case 'get_week': {
        const start = str(a.startDate) ?? mondayOf(this.today);
        const days = Array.from({ length: 7 }, (_, i) => {
          const date = addDays(start, i);
          const ev = expandEvents(d, date);
          const bl = blocksOn(d, date);
          const w: [number, number] = [zonedToUtc(date, s.dayStartMin, s.timezone), zonedToUtc(date, s.dayEndMin - s.bufferMin, s.timezone)];
          const busy = [...ev.map((x): [number, number] => [x.start, x.end]), ...bl.map(blockSpan)];
          const freeMs = Math.max(0, w[1] - w[0] - total(busy.map(([x, y]): [number, number] => [Math.max(x, w[0]), Math.min(y, w[1])]).filter(([x, y]) => y > x)));
          return {
            date,
            weekday: WEEKDAYS[weekdayOf(date) - 1],
            events: ev.map((x) => `${formatHM(x.startMin)}-${formatHM(x.endMin)} ${x.event.title}`),
            blocks: bl.map((b) => `${formatHM(b.startMin)}-${formatHM(b.endMin)} ${b.title}`),
            freeMin: Math.round(freeMs / 60_000),
          };
        });
        return ok({ timezone: s.timezone, days });
      }
      case 'list_tasks': {
        const tag = str(a.tag) !== undefined ? this.tagId(str(a.tag)) : null;
        if (tag && 'error' in tag) return fail(tag.error);
        const planned = new Set(live(d, 'blocks').filter((b) => b.taskId && b.date >= this.today).map((b) => b.taskId));
        const rank = { doing: 0, planned: 1, inbox: 2, done: 3, dropped: 4 } as const;
        const out = live(d, 'tasks')
          .filter((t) => a.status === undefined || t.status === a.status)
          .filter((t) => a.projectId === undefined || t.projectId === a.projectId)
          .filter((t) => !tag || t.tagId === tag.id)
          .filter((t) => a.dueBefore === undefined || (t.dueDate !== null && t.dueDate < (a.dueBefore as string)))
          .filter((t) => a.dueAfter === undefined || (t.dueDate !== null && t.dueDate > (a.dueAfter as string)))
          .filter((t) => a.overdue !== true || (isOpen(t) && t.dueDate !== null && t.dueDate < this.today))
          .filter((t) => a.unscheduled !== true || (isOpen(t) && !planned.has(t.id)))
          .sort((x, y) => rank[x.status] - rank[y.status] || (x.dueDate ?? '9999') .localeCompare(y.dueDate ?? '9999') || PRIORITY_RANK[x.priority] - PRIORITY_RANK[y.priority] || x.order - y.order);
        const limit = int(a.limit) ?? 50;
        return ok({ total: out.length, tasks: out.slice(0, limit).map((t) => this.task(t)) });
      }
      case 'get_task': {
        const t = taskOf(a.id);
        if (!t) return fail('No task with that id.');
        const tracked = live(d, 'sessions').filter((x) => x.taskId === t.id && x.phase === 'work').reduce((sum, x) => sum + (x.endedAt - x.startedAt), 0);
        return ok({
          ...this.task(t),
          kind: t.kind,
          finishCondition: t.finishCondition,
          notes: t.notes,
          recurrence: t.recurrence,
          recurrenceParentId: t.recurrenceParentId,
          source: t.source,
          trackedMin: Math.round(Math.max(tracked, t.workMs) / 60_000),
          completedAt: t.completedAt ? `${todayOf(d, t.completedAt)} ${this.clock(t.completedAt)}` : null,
          blocks: live(d, 'blocks').filter((b) => b.taskId === t.id).sort((x, y) => x.date.localeCompare(y.date) || x.startMin - y.startMin).map((b) => this.block(b)),
        });
      }
      case 'search': {
        this.index.update(d);
        return ok({ results: this.index.search(a.query as string, { types: a.types as SearchType[] | undefined, limit: int(a.limit) ?? 10 }) });
      }
      case 'list_projects':
        return ok({
          projects: live(d, 'projects')
            .filter((p) => !p.archived)
            .sort((x, y) => (x.sortKey < y.sortKey ? -1 : 1))
            .map((p) => ({ id: p.id, name: p.name, color: p.color, columns: p.columns.map((c) => ({ id: c.id, name: c.name, cards: live(d, 'tasks').filter((t) => t.projectId === p.id && (t.columnId ?? p.columns[0]?.id) === c.id).length })) })),
        });
      case 'get_project': {
        const p = get(d, 'projects', str(a.id));
        if (!p || p.deletedAt !== null) return fail('No project with that id.');
        const cards = live(d, 'tasks').filter((t) => t.projectId === p.id);
        return ok({
          id: p.id,
          name: p.name,
          archived: p.archived,
          columns: p.columns.map((c, i) => ({
            id: c.id,
            name: c.name,
            cards: cards
              .filter((t) => (p.columns.some((x) => x.id === t.columnId) ? t.columnId === c.id : i === 0))
              .sort((x, y) => (x.sortKey < y.sortKey ? -1 : x.sortKey > y.sortKey ? 1 : 0))
              .map((t) => this.task(t)),
          })),
        });
      }
      case 'list_events': {
        const from = str(a.from) ?? this.today;
        const to = str(a.to) ?? from;
        const n = daysBetween(from, to);
        if (n < 0 || n > 30) return fail('Use a range of 1 to 31 days, from <= to.');
        const events = [];
        for (let i = 0; i <= n; i++) {
          const date = addDays(from, i);
          for (const x of expandEvents(d, date)) events.push({ date, id: x.event.id, title: x.event.title, start: formatHM(x.startMin), end: formatHM(x.endMin), recurring: x.event.recur !== null, ...(x.exceptionId ? { editedThisDate: true } : {}) });
        }
        return ok({ timezone: s.timezone, events });
      }
      case 'get_stats': {
        const from = a.from as string;
        const to = a.to as string;
        if (to < from) return fail('to must be on or after from.');
        const w: [number, number] = [zonedToUtc(from, 0, s.timezone), zonedToUtc(addDays(to, 1), 0, s.timezone)];
        const byTag: Record<string, number> = {};
        const byProject: Record<string, number> = {};
        for (const x of live(d, 'sessions')) {
          if (x.phase !== 'work') continue;
          const ms = Math.max(0, Math.min(x.endedAt, w[1]) - Math.max(x.startedAt, w[0]));
          if (!ms) continue;
          const t = d.tasks[x.taskId];
          const tag = t?.tagId ? (d.tags[t.tagId]?.name ?? 'untagged') : 'untagged';
          const proj = t?.projectId ? (d.projects[t.projectId]?.name ?? 'no project') : 'no project';
          byTag[tag] = (byTag[tag] ?? 0) + ms;
          byProject[proj] = (byProject[proj] ?? 0) + ms;
        }
        const h = (o: Record<string, number>) => Object.fromEntries(Object.entries(o).map(([k, v]) => [k, Math.round((v / 3_600_000) * 100) / 100]));
        const finished = live(d, 'tasks').filter((t) => t.status === 'done' && t.completedAt !== null && t.completedAt >= w[0] && t.completedAt < w[1]);
        const est = finished.filter((t) => t.estimateMin !== null).map((t) => ({ title: t.title, estimateMin: t.estimateMin as number, actualMin: Math.round(t.workMs / 60_000) }));
        return ok({
          from,
          to,
          timezone: s.timezone,
          focusHoursByTag: h(byTag),
          focusHoursByProject: h(byProject),
          finished: finished.filter((t) => t.outcome !== 'killed').length,
          dropped: live(d, 'activity').filter((x) => x.type === 'dropped' && x.at >= w[0] && x.at < w[1]).length,
          estimateVsActual: { tasks: est, estimateMin: est.reduce((x, t) => x + t.estimateMin, 0), actualMin: est.reduce((x, t) => x + t.actualMin, 0) },
        });
      }
      case 'get_review': {
        const r = get(d, 'reviews', reviewId(a.date as string));
        if (!r || r.deletedAt !== null) return ok({ date: a.date, reviewed: false });
        return ok({ date: r.date, reviewed: true, outcomes: r.outcomes.map((o) => ({ ...o, title: d.tasks[o.taskId]?.title ?? null })) });
      }
      case 'list_notes': {
        const notes = live(d, 'ideas')
          .sort((x, y) => y.createdAt - x.createdAt)
          .slice(0, int(a.limit) ?? 20)
          .map((n) => ({ id: n.id, body: n.body.length > 2000 ? `${n.body.slice(0, 2000)}…` : n.body, created: `${todayOf(d, n.createdAt)} ${this.clock(n.createdAt)}`, taskId: n.taskId }));
        return ok({ notes });
      }

      // ---- writes ----
      case 'add_task': {
        const tag = this.tagId(str(a.tag));
        if ('error' in tag) return fail(tag.error);
        const dueTime = str(a.dueTime) !== undefined ? parseHM(a.dueTime as string) : null;
        if (a.dueTime !== undefined && dueTime === null) return fail('dueTime must be HH:MM.');
        const cmd: Command = {
          type: 'task.create',
          input: {
            title: a.title as string,
            kind: a.kind as 'task' | undefined,
            finishCondition: str(a.finishCondition),
            notes: str(a.notes),
            tagId: tag.id,
            projectId: str(a.projectId) ?? null,
            priority: a.priority as Task['priority'] | undefined,
            estimateMin: int(a.estimateMin) ?? null,
            dueDate: str(a.dueDate) ?? null,
            dueTime,
            recurrence: (a.recurrence as Task['recurrence']) ?? null,
            source: 'claude',
          },
        };
        if (a.projectId !== undefined && !get(d, 'projects', a.projectId as string)) return fail('No project with that id.');
        return this.write('add_task', cmd, `added "${a.title as string}"`, (x, id) => (id && x.tasks[id] ? this.task(x.tasks[id] as Task) : null), '');
      }
      case 'update_task': {
        const t = taskOf(a.id);
        if (!t) return fail('No task with that id.');
        const p = a.patch as Args;
        const input: Extract<Command, { type: 'task.update' }>['input'] = {};
        if (p.title !== undefined) input.title = p.title as string;
        if (p.finishCondition !== undefined) input.finishCondition = p.finishCondition as string;
        if (p.notes !== undefined) input.notes = p.notes as string;
        if (p.priority !== undefined) input.priority = p.priority as Task['priority'];
        if (p.estimateMin !== undefined) input.estimateMin = p.estimateMin as number;
        if (p.dueDate !== undefined) input.dueDate = p.dueDate as string;
        if (p.projectId !== undefined) input.projectId = p.projectId as string;
        if (p.recurrence !== undefined) input.recurrence = p.recurrence as Task['recurrence'];
        if (p.dueTime !== undefined) {
          const m = parseHM(p.dueTime as string);
          if (m === null) return fail('dueTime must be HH:MM.');
          input.dueTime = m;
        }
        if (p.tag !== undefined) {
          const tag = this.tagId(p.tag as string);
          if ('error' in tag) return fail(tag.error);
          input.tagId = tag.id;
        }
        return this.write('update_task', { type: 'task.update', id: t.id, input }, `updated "${t.title}"`, (x) => this.task(x.tasks[t.id] as Task), t.id);
      }
      case 'complete_task': {
        const t = taskOf(a.id);
        if (!t) return fail('No task with that id.');
        return this.write('complete_task', { type: 'task.finish', id: t.id }, `completed "${t.title}"`, (x) => {
          const next = live(x, 'tasks').find((n) => n.recurrenceParentId === (t.recurrenceParentId ?? t.id) && !d.tasks[n.id]);
          return { task: this.task(x.tasks[t.id] as Task), ...(next ? { next: this.task(next) } : {}) };
        }, t.id);
      }
      case 'drop_task': {
        const t = taskOf(a.id);
        if (!t) return fail('No task with that id.');
        return this.write('drop_task', { type: 'task.close', id: t.id, reason: a.reason as string }, `dropped "${t.title}"`, (x) => this.task(x.tasks[t.id] as Task), t.id);
      }
      case 'place_block': {
        const t = taskOf(a.taskId);
        if (!t || !isOpen(t)) return fail('No open task with that id.');
        const date = a.date as string;
        const [sm, em] = [a.startMin as number, a.endMin as number];
        if (!blockFits(d, date, sm, em)) return fail(`Not placed. ${this.overlapReason(date, sm, em)}`);
        return this.write('place_block', { type: 'block.create', taskId: t.id, date, startMin: sm, endMin: em }, `planned "${t.title}" ${date} ${formatHM(sm)}-${formatHM(em)}`, (x, id) => (id ? this.block(x.blocks[id] as Block) : null), t.id);
      }
      case 'move_block': {
        const b = get(d, 'blocks', str(a.id));
        if (!b || b.deletedAt !== null) return fail('No block with that id.');
        const date = str(a.date) ?? b.date;
        const sm = int(a.startMin) ?? b.startMin;
        const em = int(a.endMin) ?? (a.startMin !== undefined ? sm + (b.endMin - b.startMin) : b.endMin);
        if (!blockFits(d, date, sm, em, b.id)) return fail(`Not moved. ${this.overlapReason(date, sm, em, b.id)}`);
        return this.write('move_block', { type: 'block.move', id: b.id, date, startMin: sm, endMin: em }, `moved "${b.title}" to ${date} ${formatHM(sm)}-${formatHM(em)}`, (x) => this.block(x.blocks[b.id] as Block), b.taskId ?? '');
      }
      case 'remove_block': {
        const b = get(d, 'blocks', str(a.id));
        if (!b || b.deletedAt !== null) return fail('No block with that id.');
        return this.write('remove_block', { type: 'recycle', coll: 'blocks', id: b.id, confirmed: true }, `removed block "${b.title}"`, () => ({ id: b.id, removed: true }), b.taskId ?? '');
      }
      case 'skip_event_on': {
        const ev = get(d, 'events', str(a.eventId));
        if (!ev || ev.deletedAt !== null) return fail('No event with that id.');
        return this.write('skip_event_on', { type: 'event.skip', id: ev.id, date: a.date as string }, `skipped "${ev.title}" on ${a.date as string}`, () => ({ eventId: ev.id, date: a.date, skipped: true }));
      }
      case 'edit_event_on': {
        const ev = get(d, 'events', str(a.eventId));
        if (!ev || ev.deletedAt !== null) return fail('No event with that id.');
        const p = a.patch as Args;
        if (!Object.keys(p).length) return fail('Give a title, startMin or endMin to change.');
        return this.write(
          'edit_event_on',
          { type: 'event.editOn', id: ev.id, date: a.date as string, patch: { title: str(p.title), startMin: int(p.startMin), endMin: int(p.endMin) } },
          `changed "${ev.title}" on ${a.date as string}`,
          (x) => {
            const i = expandEvents(x, a.date as string).find((y) => y.event.id === ev.id);
            return i ? { eventId: ev.id, date: a.date, title: i.event.title, start: formatHM(i.startMin), end: formatHM(i.endMin) } : null;
          },
        );
      }
      case 'add_note':
        return this.write('add_note', { type: 'idea.add', text: a.body as string, taskId: null }, `saved a note`, (x, id) => (id ? { id, body: x.ideas[id]?.body } : null));
      case 'add_project':
        return this.write('add_project', { type: 'project.create', name: a.name as string, color: a.color as never, columns: a.columns as string[] | undefined }, `created project "${a.name as string}"`, (x, id) => (id ? { id, name: x.projects[id]?.name, columns: x.projects[id]?.columns } : null));
      case 'move_card': {
        const t = taskOf(a.taskId);
        if (!t) return fail('No task with that id.');
        return this.write('move_card', { type: 'task.moveCard', id: t.id, columnId: a.columnId as string, beforeId: str(a.beforeTaskId) ?? null }, `moved "${t.title}"`, (x) => ({ ...this.task(x.tasks[t.id] as Task), columnId: x.tasks[t.id]?.columnId }), t.id);
      }
      case 'undo':
        return this.undoToken(a.undoToken as string);
      default:
        return fail(`Unknown tool ${name}.`);
    }
  }
}
