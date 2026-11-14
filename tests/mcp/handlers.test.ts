// The MCP handlers against an in-memory StorePort: every tool, input checking, rate limit, undo.
import { describe, expect, it } from 'vitest';
import { apply, type Command } from '../../src/core/commands';
import { Mcp, WRITES_PER_MINUTE, type StorePort, type ToolResult } from '../../src/core/mcp/handlers';
import { TOOLS } from '../../src/core/mcp/tools';
import { reviewId } from '../../src/core/model/ids';
import type { Data } from '../../src/core/model/types';
import { create, live } from '../../src/core/repo/repo';
import { at, ctx, fresh, MIN, run, T0, TODAY } from '../helpers';

type Any = Record<string, any>;
const MON2 = '2026-11-02';

interface Rig {
  st: { d: Data; now: number };
  mcp: Mcp;
  port: StorePort;
  notes: { text: string; undoToken: string }[];
  called: Set<string>;
  call: (name: string, args?: unknown) => ToolResult;
  ok: (name: string, args?: unknown) => Any;
  err: (name: string, args?: unknown) => string;
  ids: Record<string, string>;
}

/** A small world: Math tag, a weekly Monday class 13:00-14:00, a one-off dentist, three tasks, one block today. */
function seed(): { d: Data; ids: Record<string, string> } {
  let d = fresh();
  const ids: Record<string, string> = {};
  const step = <T extends { d: Data; id: string }>(key: string, r: T) => {
    d = r.d;
    ids[key] = r.id;
  };
  step('math', run(d, { type: 'tag.create', input: { name: 'Math', color: 'tag1', kind: 'class' } }));
  step('home', run(d, { type: 'tag.create', input: { name: 'Home', color: 'tag3', kind: 'general' } }));
  step('class', run(d, { type: 'event.create', input: { title: 'Physics class', tagId: null, scope: 'school', tz: 'Asia/Jakarta', startMin: 780, endMin: 840, date: null, recur: { weekdays: [1], everyNWeeks: 1, anchorDate: TODAY, from: null, until: null }, notes: '' } }));
  step('dentist', run(d, { type: 'event.create', input: { title: 'Dentist', tagId: null, scope: 'other', tz: 'Asia/Jakarta', startMin: 900, endMin: 960, date: '2026-10-27', recur: null, notes: '' } }));
  step('report', run(d, { type: 'task.create', input: { title: 'Write report', finishCondition: 'Report is sent', tagId: ids.math, dueDate: '2026-10-24', estimateMin: 60, priority: 'must' } }));
  step('paper', run(d, { type: 'task.create', input: { title: 'Read paper', finishCondition: 'Notes on the paper', dueDate: '2026-10-30' } }));
  step('trip', run(d, { type: 'task.create', input: { title: 'Plan trip', tagId: ids.home } }));
  step('blockPaper', run(d, { type: 'block.create', taskId: ids.paper!, date: TODAY, startMin: 600, endMin: 660 }));
  return { d, ids };
}

function rig(initial?: Data, limit?: number): Rig {
  const s = initial ? { d: initial, ids: {} } : seed();
  const st = { d: s.d, now: T0 };
  const notes: Rig['notes'] = [];
  const called = new Set<string>();
  const port: StorePort = {
    data: () => st.d,
    now: () => st.now,
    run: (cmd: Command) => {
      const r = apply(st.d, cmd, ctx(st.now, 'mcp'));
      if (!r.ok) return { ok: false, error: r.error, fields: r.fields };
      st.d = r.d;
      return { ok: true, id: r.id };
    },
    notify: (n) => notes.push(n),
  };
  const mcp = new Mcp(port, limit);
  const call = (name: string, args: unknown = {}) => {
    called.add(name);
    return mcp.call(name, args);
  };
  const ok = (name: string, args?: unknown): Any => {
    const r = call(name, args);
    if (!r.ok) throw new Error(`${name} failed: ${r.error}`);
    return r.result as Any;
  };
  const err = (name: string, args?: unknown): string => {
    const r = call(name, args);
    if (r.ok) throw new Error(`${name} unexpectedly succeeded: ${JSON.stringify(r.result)}`);
    return r.error;
  };
  return { st, mcp, port, notes, called, call, ok, err, ids: s.ids };
}

const claudeLog = (d: Data) => live(d, 'activity').filter((a) => a.type === 'claude');
const task = (r: Rig, key: string) => r.st.d.tasks[r.ids[key]!]!;

describe('tool catalogue', () => {
  it('lists 28 tools with strict schemas', () => {
    expect(TOOLS).toHaveLength(28);
    expect(new Set(TOOLS.map((t) => t.name)).size).toBe(28);
    for (const t of TOOLS) {
      expect(t.inputSchema.additionalProperties, t.name).toBe(false);
      expect(t.description.length, t.name).toBeGreaterThan(10);
    }
    expect(TOOLS.filter((t) => t.write).map((t) => t.name).sort()).toEqual(['add_note', 'add_project', 'add_task', 'complete_task', 'drop_task', 'edit_event_on', 'move_block', 'move_card', 'place_block', 'place_event', 'post_log', 'remove_block', 'skip_event_on', 'undo', 'update_task']);
  });
});

describe('read tools', () => {
  it('get_day: events, blocks, free gaps, buffer, time left, timezone', () => {
    const r = rig();
    const day = r.ok('get_day', {});
    expect(day).toMatchObject({ date: TODAY, weekday: 'Mon', timezone: 'Asia/Jakarta', now: '09:00', day: { start: '06:00', end: '22:00' } });
    expect(day.events).toEqual([expect.objectContaining({ id: r.ids.class, title: 'Physics class', start: '13:00', end: '14:00', recurring: true })]);
    expect(day.blocks).toEqual([expect.objectContaining({ id: r.ids.blockPaper, taskId: r.ids.paper, start: '10:00', end: '11:00', kind: 'work', auto: false })]);
    // free time from now, around the block and the class, up to the buffer
    expect(day.free).toEqual([
      { start: '09:00', end: '10:00', minutes: 60 },
      { start: '11:00', end: '13:00', minutes: 120 },
      { start: '14:00', end: '21:30', minutes: 450 },
    ]);
    expect(day.buffer).toEqual({ start: '21:30', end: '22:00', minutes: 30 });
    // 09:00 -> 21:30 is 750 min; minus the 60 min class = 690; the block commits 60 of it
    expect(day.timeLeft).toMatchObject({ workableMin: 690, fixedMin: 60, committedMin: 60, openMin: 630, bufferMin: 30 });
    // the task with today's first block is the one in focus
    expect(day.focus).toMatchObject({ title: 'Read paper', status: 'doing' });
    expect(day.prep).toEqual([]);
  });

  it('get_day for another date uses that date, with no "now"', () => {
    const r = rig();
    const day = r.ok('get_day', { date: '2026-10-27' });
    expect(day).toMatchObject({ date: '2026-10-27', weekday: 'Tue', now: null });
    expect(day.events.map((e: Any) => e.title)).toEqual(['Dentist']);
    expect(day.free).toEqual([
      { start: '06:00', end: '15:00', minutes: 540 },
      { start: '16:00', end: '21:30', minutes: 330 },
    ]);
    expect(day.timeLeft.workableMin).toBe(15 * 60 + 30 - 60);
  });

  it('get_day moves with the clock', () => {
    const r = rig();
    r.st.now = at(12 * 60 + 30);
    const day = r.ok('get_day', {});
    expect(day.now).toBe('12:30');
    expect(day.free[0]).toEqual({ start: '12:30', end: '13:00', minutes: 30 });
  });

  it('get_week: 7 days from this Monday, or from startDate', () => {
    const r = rig();
    const w = r.ok('get_week', {});
    expect(w.timezone).toBe('Asia/Jakarta');
    expect(w.days).toHaveLength(7);
    expect(w.days.map((d: Any) => d.date)).toEqual(['2026-10-26', '2026-10-27', '2026-10-28', '2026-10-29', '2026-10-30', '2026-10-31', '2026-11-01']);
    expect(w.days[0]).toMatchObject({ weekday: 'Mon', events: ['13:00-14:00 Physics class'], blocks: ['10:00-11:00 Read paper'], freeMin: 930 - 60 - 60 });
    expect(w.days[1]).toMatchObject({ events: ['15:00-16:00 Dentist'], freeMin: 930 - 60 });
    expect(w.days[2]).toMatchObject({ events: [], blocks: [], freeMin: 930 });
    const next = r.ok('get_week', { startDate: MON2 });
    expect(next.days[0]).toMatchObject({ date: MON2, events: ['13:00-14:00 Physics class'] });
  });

  it('list_tasks: no filter returns everything, doing first', () => {
    const r = rig();
    const all = r.ok('list_tasks', {});
    expect(all.total).toBe(3);
    expect(all.tasks[0]).toMatchObject({ title: 'Read paper', status: 'doing', dueDate: '2026-10-30' });
    expect(all.tasks[1]).toMatchObject({ title: 'Write report', status: 'inbox', tag: 'Math', dueDate: '2026-10-24', estimateMin: 60 });
    expect(all.tasks.map((t: Any) => t.title)).toEqual(['Read paper', 'Write report', 'Plan trip']);
  });

  it('list_tasks: status, tag (name, case-insensitive), overdue, unscheduled, dueBefore, limit', () => {
    const r = rig();
    const titles = (args: Any) => r.ok('list_tasks', args).tasks.map((t: Any) => t.title);
    r.port.run({ type: 'block.create', taskId: r.ids.report!, date: '2026-10-28', startMin: 600, endMin: 660 });
    expect(titles({ status: 'doing' })).toEqual(['Read paper']);
    expect(titles({ status: 'planned' })).toEqual(['Write report']);
    expect(titles({ status: 'inbox' })).toEqual(['Plan trip']);
    expect(titles({ status: 'done' })).toEqual([]);
    expect(titles({ tag: 'Math' })).toEqual(['Write report']);
    expect(titles({ tag: 'math' })).toEqual(['Write report']);
    expect(titles({ tag: r.ids.home })).toEqual(['Plan trip']);
    expect(titles({ overdue: true })).toEqual(['Write report']);
    expect(titles({ unscheduled: true })).toEqual(['Plan trip']);
    expect(titles({ dueBefore: '2026-10-31' })).toEqual(['Read paper', 'Write report']);
    expect(titles({ dueBefore: '2026-10-25' })).toEqual(['Write report']);
    expect(titles({ dueAfter: '2026-10-25' })).toEqual(['Read paper']);
    expect(titles({ tag: 'Math', overdue: true })).toEqual(['Write report']);
    expect(titles({ tag: 'Home', overdue: true })).toEqual([]);
    const limited = r.ok('list_tasks', { limit: 2 });
    expect(limited.total).toBe(3);
    expect(limited.tasks).toHaveLength(2);
    expect(r.err('list_tasks', { tag: 'Nope' })).toMatch(/Unknown tag "Nope".*Math, Home/);
  });

  it('list_tasks: overdue ignores finished tasks', () => {
    const r = rig();
    r.ok('complete_task', { id: r.ids.report });
    expect(r.ok('list_tasks', { overdue: true }).tasks).toEqual([]);
    expect(r.ok('list_tasks', { status: 'done' }).tasks.map((t: Any) => t.title)).toEqual(['Write report']);
  });

  it('get_task: full task with blocks, tracked time and recurrence', () => {
    const r = rig();
    const t = r.ok('get_task', { id: r.ids.paper });
    expect(t).toMatchObject({ id: r.ids.paper, title: 'Read paper', status: 'doing', finishCondition: 'Notes on the paper', kind: 'task', recurrence: null, source: 'typed', trackedMin: 0, completedAt: null });
    expect(t.blocks).toEqual([expect.objectContaining({ id: r.ids.blockPaper, date: TODAY, start: '10:00', end: '11:00' })]);
    expect(r.err('get_task', { id: 'nope' })).toMatch(/No task/);
  });

  it('search: finds tasks, notes, projects, events; honours types and limit', () => {
    const r = rig();
    r.ok('add_note', { body: 'Paper ideas: compare two approaches' });
    r.ok('add_project', { name: 'Paper club' });
    const res = r.ok('search', { query: 'paper' }).results as Any[];
    expect(res.map((h) => h.type).sort()).toEqual(['note', 'project', 'task']);
    expect(r.ok('search', { query: 'paper', types: ['task'] }).results.map((h: Any) => h.id)).toEqual([r.ids.paper]);
    expect(r.ok('search', { query: 'dentist' }).results[0]).toMatchObject({ type: 'event', id: r.ids.dentist });
    expect(r.ok('search', { query: 'paper', limit: 1 }).results).toHaveLength(1);
    expect(r.ok('search', { query: 'zzzzqx' }).results).toEqual([]);
  });

  it('search sees later changes and never returns deleted tasks', () => {
    const r = rig();
    expect(r.ok('search', { query: 'trip' }).results).toHaveLength(1);
    r.ok('update_task', { id: r.ids.trip, patch: { title: 'Plan holiday' } });
    expect(r.ok('search', { query: 'trip' }).results).toHaveLength(0);
    expect(r.ok('search', { query: 'holiday' }).results).toHaveLength(1);
    r.port.run({ type: 'recycle', coll: 'tasks', id: r.ids.trip!, confirmed: true });
    expect(r.ok('search', { query: 'holiday' }).results).toHaveLength(0);
  });

  it('list_projects / get_project show ordered cards after move_card', () => {
    const r = rig();
    const proj = r.ok('add_project', { name: 'Thesis', columns: ['Todo', 'Doing', 'Done'] }).changed;
    const add = (title: string) => r.ok('add_task', { title, projectId: proj.id }).changed.id as string;
    const [a, b, c] = [add('Card A'), add('Card B'), add('Card C')] as [string, string, string];
    const cols = proj.columns as { id: string; name: string }[];
    const names = (res: Any, i: number) => res.columns[i].cards.map((x: Any) => x.title);

    let p = r.ok('get_project', { id: proj.id });
    expect(p.columns.map((x: Any) => x.name)).toEqual(['Todo', 'Doing', 'Done']);
    expect(names(p, 0)).toEqual(['Card A', 'Card B', 'Card C']);

    r.ok('move_card', { taskId: c, columnId: cols[0]!.id, beforeTaskId: a });
    p = r.ok('get_project', { id: proj.id });
    expect(names(p, 0)).toEqual(['Card C', 'Card A', 'Card B']);

    const moved = r.ok('move_card', { taskId: b, columnId: cols[1]!.id });
    expect(moved.changed).toMatchObject({ title: 'Card B', columnId: cols[1]!.id });
    r.ok('move_card', { taskId: a, columnId: cols[1]!.id, beforeTaskId: b });
    p = r.ok('get_project', { id: proj.id });
    expect(names(p, 0)).toEqual(['Card C']);
    expect(names(p, 1)).toEqual(['Card A', 'Card B']);
    expect(names(p, 2)).toEqual([]);

    const list = r.ok('list_projects', {}).projects as Any[];
    const entry = list.find((x) => x.id === proj.id)!;
    expect(entry.columns.map((x: Any) => x.cards)).toEqual([1, 2, 0]);

    expect(r.err('move_card', { taskId: a, columnId: 'nope' })).toMatch(/Unknown column/);
    expect(r.err('move_card', { taskId: r.ids.trip, columnId: cols[0]!.id })).toMatch(/not in a project/);
    expect(r.err('move_card', { taskId: a, columnId: cols[0]!.id, beforeTaskId: b })).toMatch(/not in this column/);
    expect(r.err('get_project', { id: 'nope' })).toMatch(/No project/);
  });

  it('list_events: a range with skips and edits applied; more than 31 days is rejected', () => {
    const r = rig();
    const range = r.ok('list_events', { from: TODAY, to: '2026-11-03' });
    expect(range.timezone).toBe('Asia/Jakarta');
    expect(range.events.map((e: Any) => `${e.date} ${e.title}`)).toEqual([`${TODAY} Physics class`, '2026-10-27 Dentist', `${MON2} Physics class`]);
    r.ok('skip_event_on', { eventId: r.ids.class, date: MON2 });
    r.ok('edit_event_on', { eventId: r.ids.class, date: '2026-11-09', patch: { title: 'Physics exam', startMin: 600, endMin: 720 } });
    const after = r.ok('list_events', { from: TODAY, to: '2026-11-10' }).events as Any[];
    expect(after.filter((e) => e.title === 'Physics class').map((e) => e.date)).toEqual([TODAY]);
    expect(after.find((e) => e.date === '2026-11-09')).toMatchObject({ title: 'Physics exam', start: '10:00', end: '12:00', editedThisDate: true });
    // default: today only
    expect(r.ok('list_events', {}).events.map((e: Any) => e.title)).toEqual(['Physics class']);
    // 31 days inclusive is fine, 32 is not, reversed is not
    expect(r.ok('list_events', { from: TODAY, to: '2026-11-25' }).events.length).toBeGreaterThan(0);
    expect(r.err('list_events', { from: TODAY, to: '2026-11-26' })).toMatch(/1 to 31 days/);
    expect(r.err('list_events', { from: '2026-10-01', to: '2026-12-01' })).toMatch(/1 to 31 days/);
    expect(r.err('list_events', { from: '2026-11-05', to: TODAY })).toMatch(/1 to 31 days/);
  });

  it('get_stats: focus hours per tag, finished count and estimate vs actual', () => {
    const r = rig();
    // 30 minutes on the head ("Read paper", tagged Home here), finish it; then 15 minutes on the next head ("Write report", Math)
    r.port.run({ type: 'task.update', id: r.ids.paper!, input: { tagId: r.ids.home, estimateMin: 60 } });
    r.port.run({ type: 'timer', action: 'start' });
    r.st.now = T0 + 30 * MIN;
    r.port.run({ type: 'timer', action: 'pause' });
    r.ok('complete_task', { id: r.ids.paper });
    expect(task(r, 'paper').status).toBe('done');
    r.st.now = T0 + 40 * MIN;
    r.port.run({ type: 'timer', action: 'start' });
    r.st.now = T0 + 55 * MIN;
    r.port.run({ type: 'timer', action: 'pause' });
    const s = r.ok('get_stats', { from: TODAY, to: TODAY });
    expect(s).toMatchObject({ from: TODAY, to: TODAY, timezone: 'Asia/Jakarta', finished: 1, dropped: 0 });
    expect(s.focusHoursByTag).toEqual({ Home: 0.5, Math: 0.25 });
    expect(s.focusHoursByProject).toEqual({ 'no project': 0.75 });
    expect(s.estimateVsActual).toEqual({ tasks: [{ title: 'Read paper', estimateMin: 60, actualMin: 30 }], estimateMin: 60, actualMin: 30 });
    // outside the window nothing counts
    expect(r.ok('get_stats', { from: '2026-10-27', to: '2026-10-28' }).focusHoursByTag).toEqual({});
    expect(r.err('get_stats', { from: '2026-10-28', to: '2026-10-27' })).toMatch(/on or after/);
  });

  it('get_stats counts drops', () => {
    const r = rig();
    r.ok('drop_task', { id: r.ids.trip, reason: 'no longer needed' });
    expect(r.ok('get_stats', { from: TODAY, to: TODAY }).dropped).toBe(1);
  });

  it('get_review: absent -> reviewed false; present -> outcomes with titles', () => {
    const r = rig();
    expect(r.ok('get_review', { date: TODAY })).toEqual({ date: TODAY, reviewed: false });
    const date = '2026-10-25';
    r.st.d = create(r.st.d, 'reviews', { date, outcomes: [{ taskId: r.ids.trip!, action: 'tomorrow' }, { taskId: 'gone', action: 'dropped' }] }, ctx(T0), reviewId(date)).d;
    expect(r.ok('get_review', { date })).toEqual({
      date,
      reviewed: true,
      outcomes: [
        { taskId: r.ids.trip, action: 'tomorrow', title: 'Plan trip' },
        { taskId: 'gone', action: 'dropped', title: null },
      ],
    });
  });

  it('list_notes: newest first, with a limit', () => {
    const r = rig();
    expect(r.ok('list_notes', {}).notes).toEqual([]);
    r.ok('add_note', { body: 'first note' });
    r.st.now += 5 * MIN;
    r.ok('add_note', { body: 'second note' });
    r.st.now += 5 * MIN;
    r.ok('add_note', { body: 'third note' });
    const all = r.ok('list_notes', {}).notes as Any[];
    expect(all.map((n) => n.body)).toEqual(['third note', 'second note', 'first note']);
    expect(all[0]!.created).toBe(`${TODAY} 09:10`);
    expect(r.ok('list_notes', { limit: 2 }).notes).toHaveLength(2);
  });
});

describe('write tools', () => {
  it('add_task: source claude, inbox, tag by name; unknown tag lists the known ones', () => {
    const r = rig();
    const res = r.ok('add_task', { title: 'Email the teacher', finishCondition: 'Email sent to Ms Rina', tag: 'math', priority: 'must', dueDate: '2026-10-29', dueTime: '14:30', estimateMin: 10 });
    const t = r.st.d.tasks[res.changed.id]!;
    expect(t).toMatchObject({ source: 'claude', title: 'Email the teacher', tagId: r.ids.math, priority: 'must', dueDate: '2026-10-29', dueTime: 870, estimateMin: 10 });
    expect(res.changed).toMatchObject({ tag: 'Math', dueTime: '14:30', status: expect.stringMatching(/inbox|planned|doing/) });
    expect(res.undoToken).toBeTruthy();
    const msg = r.err('add_task', { title: 'x', tag: 'Chemistry' });
    expect(msg).toMatch(/Unknown tag "Chemistry"/);
    expect(msg).toContain('Math');
    expect(msg).toContain('Home');
    expect(r.err('add_task', { title: 'x', dueTime: '99:99' })).toMatch(/dueTime/);
    expect(r.err('add_task', { title: 'x', projectId: 'nope' })).toMatch(/No project/);
    expect(r.err('add_task', { title: 'short fc', finishCondition: 'abc' })).toMatch(/finish/i);
  });

  it('add_task accepts a recurrence and a sprint kind', () => {
    const r = rig();
    const res = r.ok('add_task', { title: 'Stretch', recurrence: { freq: 'weekly', interval: 1, weekdays: [3, 1] } });
    expect(r.st.d.tasks[res.changed.id]!.recurrence).toEqual({ freq: 'weekly', interval: 1, weekdays: [1, 3] });
    expect(res.changed.recurring).toBe(true);
    const sprint = r.ok('add_task', { title: 'Big thing', kind: 'sprint' });
    expect(r.st.d.tasks[sprint.changed.id]!.kind).toBe('sprint');
  });

  it('update_task: only the given fields change; tag by name; dueTime HH:MM', () => {
    const r = rig();
    const before = task(r, 'trip');
    const res = r.ok('update_task', { id: r.ids.trip, patch: { title: 'Plan the trip', tag: 'Math', dueDate: '2026-11-05', dueTime: '08:15', priority: 'nice', notes: 'ask Dad' } });
    expect(res.changed).toMatchObject({ title: 'Plan the trip', tag: 'Math', dueDate: '2026-11-05', dueTime: '08:15', priority: 'nice' });
    const after = task(r, 'trip');
    expect(after).toMatchObject({ title: 'Plan the trip', tagId: r.ids.math, dueTime: 495, notes: 'ask Dad' });
    expect(after.estimateMin).toBe(before.estimateMin);
    expect(after.finishCondition).toBe(before.finishCondition);
    expect(r.err('update_task', { id: r.ids.trip, patch: { dueTime: '25:00' } })).toMatch(/HH:MM/);
    expect(r.err('update_task', { id: r.ids.trip, patch: { tag: 'Nope' } })).toMatch(/Unknown tag/);
    expect(r.err('update_task', { id: 'missing', patch: { title: 'x' } })).toMatch(/No task/);
    expect(r.err('update_task', { id: r.ids.trip, patch: { recurrence: { freq: 'weekly', interval: 1, weekdays: [8] } } })).toMatch(/Invalid input/);
  });

  it('complete_task: marks done; a recurring task returns its next instance', () => {
    const r = rig();
    const done = r.ok('complete_task', { id: r.ids.trip });
    expect(done.changed.task).toMatchObject({ status: 'done' });
    expect(done.changed.next).toBeUndefined();

    const rec = r.ok('add_task', { title: 'Water plants', dueDate: TODAY, recurrence: { freq: 'daily', interval: 1 } }).changed;
    const res = r.ok('complete_task', { id: rec.id });
    expect(res.changed.task).toMatchObject({ id: rec.id, status: 'done' });
    expect(res.changed.next).toMatchObject({ id: `${rec.id}:2026-10-27`, title: 'Water plants', dueDate: '2026-10-27', recurring: true });
    expect(r.st.d.tasks[`${rec.id}:2026-10-27`]!.recurrenceParentId).toBe(rec.id);
    expect(r.err('complete_task', { id: rec.id })).toMatch(/open task/i);
  });

  it('drop_task: status dropped, reason required', () => {
    const r = rig();
    const res = r.ok('drop_task', { id: r.ids.trip, reason: 'not this term' });
    expect(res.changed.status).toBe('dropped');
    expect(task(r, 'trip').status).toBe('dropped');
    expect(live(r.st.d, 'activity').some((a) => a.type === 'dropped' && a.reason === 'not this term')).toBe(true);
    expect(r.err('drop_task', { id: r.ids.trip, reason: 'ab' })).toMatch(/Invalid input/);
    expect(r.err('drop_task', { id: r.ids.paper })).toMatch(/required/);
  });

  it('place_block: success, then rejection naming the fixed event or the block it overlaps', () => {
    const r = rig();
    const ok = r.ok('place_block', { taskId: r.ids.trip, date: TODAY, startMin: 900, endMin: 960 });
    expect(ok.changed).toMatchObject({ taskId: r.ids.trip, date: TODAY, start: '15:00', end: '16:00', kind: 'work', auto: false });
    expect(r.st.d.blocks[ok.changed.id]).toBeDefined();
    expect(task(r, 'trip').status).toBe('planned');

    const clash = r.err('place_block', { taskId: r.ids.trip, date: TODAY, startMin: 810, endMin: 870 });
    expect(clash).toMatch(/Not placed/);
    expect(clash).toContain('Physics class');
    expect(clash).toContain('13:00-14:00');
    const partial = r.err('place_block', { taskId: r.ids.trip, date: TODAY, startMin: 770, endMin: 790 });
    expect(partial).toContain('Physics class');
    const blockClash = r.err('place_block', { taskId: r.ids.trip, date: TODAY, startMin: 630, endMin: 700 });
    expect(blockClash).toContain('Read paper');
    expect(blockClash).toMatch(/planned block/);
    expect(r.err('place_block', { taskId: r.ids.trip, date: TODAY, startMin: 700, endMin: 700 })).toMatch(/end must be after/i);
    expect(r.err('place_block', { taskId: 'nope', date: TODAY, startMin: 700, endMin: 720 })).toMatch(/No open task/);
    // touching edges are fine
    r.ok('place_block', { taskId: r.ids.trip, date: TODAY, startMin: 840, endMin: 900 });
    expect(live(r.st.d, 'blocks').filter((b) => b.taskId === r.ids.trip)).toHaveLength(2);
  });

  it('place_block refuses a finished task', () => {
    const r = rig();
    r.ok('complete_task', { id: r.ids.trip });
    expect(r.err('place_block', { taskId: r.ids.trip, date: TODAY, startMin: 900, endMin: 960 })).toMatch(/No open task/);
  });

  it('move_block: moves, keeps length when only the start is given, refuses overlap with another block', () => {
    const r = rig();
    const b2 = r.ok('place_block', { taskId: r.ids.trip, date: TODAY, startMin: 900, endMin: 960 }).changed.id as string;
    const moved = r.ok('move_block', { id: b2, startMin: 1000 });
    expect(moved.changed).toMatchObject({ start: '16:40', end: '17:40', date: TODAY });
    const toTomorrow = r.ok('move_block', { id: b2, date: '2026-10-28', startMin: 480, endMin: 540 });
    expect(toTomorrow.changed).toMatchObject({ date: '2026-10-28', start: '08:00', end: '09:00' });
    const clash = r.err('move_block', { id: b2, date: TODAY, startMin: 630, endMin: 690 });
    expect(clash).toMatch(/Not moved/);
    expect(clash).toContain('Read paper');
    expect(r.st.d.blocks[b2]).toMatchObject({ date: '2026-10-28', startMin: 480 }); // unchanged by the refusal
    // a block may overlap its own old position
    r.ok('move_block', { id: b2, startMin: 500, endMin: 560 });
    expect(r.err('move_block', { id: 'nope', startMin: 1 })).toMatch(/No block/);
    // fixed events refuse too
    expect(r.err('move_block', { id: b2, date: TODAY, startMin: 790, endMin: 850 })).toContain('Physics class');
  });

  it('remove_block: recycles (the record stays), and undo restores it', () => {
    const r = rig();
    const id = r.ids.blockPaper!;
    const res = r.ok('remove_block', { id });
    expect(res.changed).toEqual({ id, removed: true });
    expect(Object.keys(r.st.d.blocks)).toContain(id);
    expect(r.st.d.blocks[id]!.deletedAt).not.toBeNull();
    expect(live(r.st.d, 'blocks')).toHaveLength(0);
    expect(task(r, 'paper').status).toBe('inbox');
    r.ok('undo', { undoToken: res.undoToken });
    expect(Object.keys(r.st.d.blocks)).toContain(id);
    expect(r.st.d.blocks[id]!.deletedAt).toBeNull();
    expect(task(r, 'paper').status).toBe('doing'); // its block is today's first again
    expect(r.err('remove_block', { id: 'nope' })).toMatch(/No block/);
  });

  it('skip_event_on and edit_event_on change one date and leave the series alone', () => {
    const r = rig();
    const skip = r.ok('skip_event_on', { eventId: r.ids.class, date: MON2 });
    expect(skip.changed).toEqual({ eventId: r.ids.class, date: MON2, skipped: true });
    expect(r.ok('get_day', { date: MON2 }).events).toEqual([]);
    expect(r.ok('get_day', { date: '2026-11-09' }).events).toHaveLength(1);

    const edit = r.ok('edit_event_on', { eventId: r.ids.class, date: '2026-11-09', patch: { title: 'Physics exam', startMin: 600, endMin: 720 } });
    expect(edit.changed).toEqual({ eventId: r.ids.class, date: '2026-11-09', title: 'Physics exam', start: '10:00', end: '12:00' });
    const day = r.ok('get_day', { date: '2026-11-09' });
    expect(day.events).toEqual([expect.objectContaining({ title: 'Physics exam', start: '10:00', end: '12:00', editedToday: true })]);
    expect(r.ok('get_day', { date: '2026-11-16' }).events[0]).toMatchObject({ title: 'Physics class', start: '13:00' });

    expect(r.err('edit_event_on', { eventId: r.ids.class, date: MON2, patch: {} })).toMatch(/Give a title/);
    expect(r.err('edit_event_on', { eventId: r.ids.class, date: MON2, patch: { startMin: 900, endMin: 800 } })).toMatch(/End must be after start/);
    expect(r.err('skip_event_on', { eventId: r.ids.dentist, date: '2026-10-27' })).toMatch(/repeating event/);
    expect(r.err('skip_event_on', { eventId: 'nope', date: MON2 })).toMatch(/No event/);
    expect(r.err('edit_event_on', { eventId: 'nope', date: MON2, patch: { title: 'x' } })).toMatch(/No event/);
  });

  it('add_note, add_project', () => {
    const r = rig();
    const n = r.ok('add_note', { body: 'Remember the lab goggles' });
    expect(n.changed).toMatchObject({ body: 'Remember the lab goggles' });
    expect(r.st.d.ideas[n.changed.id]).toMatchObject({ text: 'Remember the lab goggles', body: 'Remember the lab goggles', reviewed: false });
    const p = r.ok('add_project', { name: 'Science fair', color: 'tag5' });
    expect(p.changed.name).toBe('Science fair');
    expect(p.changed.columns.map((c: Any) => c.name)).toEqual(['To do', 'Doing', 'Done']);
    expect(r.st.d.projects[p.changed.id]!.color).toBe('tag5');
    const custom = r.ok('add_project', { name: 'Custom', columns: ['A', 'B'] });
    expect(custom.changed.columns.map((c: Any) => c.name)).toEqual(['A', 'B']);
  });
});

describe('undo', () => {
  it('reverts add_task by recycling the created task (no hard delete)', () => {
    const r = rig();
    const res = r.ok('add_task', { title: 'Oops, wrong' });
    const id = res.changed.id as string;
    expect(live(r.st.d, 'tasks').map((t) => t.id)).toContain(id);
    const undone = r.ok('undo', { undoToken: res.undoToken });
    expect(undone.undone).toMatch(/added "Oops, wrong"/);
    expect(Object.keys(r.st.d.tasks)).toContain(id);
    expect(r.st.d.tasks[id]!.deletedAt).not.toBeNull();
    expect(live(r.st.d, 'tasks').map((t) => t.id)).not.toContain(id);
  });

  it('reverts update_task fields', () => {
    const r = rig();
    const before = task(r, 'trip');
    const res = r.ok('update_task', { id: r.ids.trip, patch: { title: 'Changed', notes: 'new notes', priority: 'must', tag: 'Math', dueDate: '2026-12-01' } });
    expect(task(r, 'trip').title).toBe('Changed');
    r.ok('undo', { undoToken: res.undoToken });
    const after = task(r, 'trip');
    expect(after).toMatchObject({ title: before.title, notes: before.notes, priority: before.priority, tagId: before.tagId, dueDate: before.dueDate });
  });

  it('reverts complete_task including the spawned next instance', () => {
    const r = rig();
    const rec = r.ok('add_task', { title: 'Water plants', dueDate: TODAY, recurrence: { freq: 'daily', interval: 1 } }).changed;
    const res = r.ok('complete_task', { id: rec.id });
    const nextId = res.changed.next.id as string;
    r.ok('undo', { undoToken: res.undoToken });
    expect(r.st.d.tasks[rec.id]!.status).not.toBe('done');
    expect(r.st.d.tasks[nextId]!.deletedAt).not.toBeNull();
  });

  it('reverts move_block, place_block, skip and edit of an occurrence', () => {
    const r = rig();
    const placed = r.ok('place_block', { taskId: r.ids.trip, date: TODAY, startMin: 900, endMin: 960 });
    const id = placed.changed.id as string;
    const moved = r.ok('move_block', { id, startMin: 1000 });
    r.ok('undo', { undoToken: moved.undoToken });
    expect(r.st.d.blocks[id]).toMatchObject({ startMin: 900, endMin: 960 });
    r.ok('undo', { undoToken: placed.undoToken });
    expect(r.st.d.blocks[id]!.deletedAt).not.toBeNull();

    const skip = r.ok('skip_event_on', { eventId: r.ids.class, date: MON2 });
    r.ok('undo', { undoToken: skip.undoToken });
    expect(r.ok('get_day', { date: MON2 }).events).toHaveLength(1);
    const edit = r.ok('edit_event_on', { eventId: r.ids.class, date: MON2, patch: { title: 'Moved' } });
    expect(r.ok('get_day', { date: MON2 }).events[0].title).toBe('Moved');
    r.ok('undo', { undoToken: edit.undoToken });
    expect(r.ok('get_day', { date: MON2 }).events[0].title).toBe('Physics class');
  });

  it('a token works once; unknown tokens are rejected', () => {
    const r = rig();
    const res = r.ok('add_note', { body: 'note' });
    r.ok('undo', { undoToken: res.undoToken });
    expect(r.err('undo', { undoToken: res.undoToken })).toMatch(/Unknown or expired undo token/);
    expect(r.err('undo', { undoToken: 'does-not-exist' })).toMatch(/Unknown or expired undo token/);
    expect(r.err('undo', { undoToken: 'bad token!' })).toMatch(/Invalid input/);
  });

  it('the app toast path (undoToken on the Mcp object) works with the notified token', () => {
    const r = rig();
    r.ok('add_task', { title: 'Toast me' });
    const n = r.notes.at(-1)!;
    expect(r.mcp.undoToken(n.undoToken)).toEqual({ ok: true, result: { undone: expect.stringContaining('Toast me') } });
  });

  it('undo logs Claude activity', () => {
    const r = rig();
    const res = r.ok('add_note', { body: 'note' });
    const n = claudeLog(r.st.d).length;
    r.ok('undo', { undoToken: res.undoToken });
    const log = claudeLog(r.st.d);
    expect(log).toHaveLength(n + 1);
    expect(log.map((a) => a.reason).some((x) => x.startsWith('undo: '))).toBe(true);
  });
});

describe('every write is logged and announced', () => {
  const writes: [string, (r: Rig) => unknown][] = [
    ['add_task', () => ({ title: 'New one' })],
    ['update_task', (r) => ({ id: r.ids.trip, patch: { title: 'Renamed' } })],
    ['complete_task', (r) => ({ id: r.ids.trip })],
    ['drop_task', (r) => ({ id: r.ids.trip, reason: 'changed my mind' })],
    ['place_block', (r) => ({ taskId: r.ids.trip, date: TODAY, startMin: 900, endMin: 960 })],
    ['move_block', (r) => ({ id: r.ids.blockPaper, startMin: 700 })],
    ['remove_block', (r) => ({ id: r.ids.blockPaper })],
    ['skip_event_on', (r) => ({ eventId: r.ids.class, date: MON2 })],
    ['edit_event_on', (r) => ({ eventId: r.ids.class, date: MON2, patch: { title: 'Edited' } })],
    ['add_note', () => ({ body: 'a note' })],
    ['add_project', () => ({ name: 'Proj' })],
  ];
  it.each(writes)('%s logs a claude activity and calls notify with an undoToken', (name, args) => {
    const r = rig();
    const before = claudeLog(r.st.d).length;
    const res = r.ok(name, args(r));
    expect(typeof res.undoToken).toBe('string');
    const log = claudeLog(r.st.d);
    expect(log).toHaveLength(before + 1);
    expect(log.at(-1)!.reason.startsWith(`${name}: `)).toBe(true);
    expect(log.at(-1)!.at).toBe(T0);
    expect(r.notes).toHaveLength(1);
    expect(r.notes[0]!.undoToken).toBe(res.undoToken);
    expect(r.notes[0]!.text).toMatch(/^Claude: /);
  });

  it('move_card logs and notifies too', () => {
    const r = rig();
    const p = r.ok('add_project', { name: 'P' }).changed;
    const t = r.ok('add_task', { title: 'Card', projectId: p.id }).changed.id as string;
    r.notes.length = 0;
    const res = r.ok('move_card', { taskId: t, columnId: p.columns[1].id });
    expect(r.notes).toEqual([{ text: expect.stringMatching(/^Claude: moved/), undoToken: res.undoToken }]);
    expect(claudeLog(r.st.d).at(-1)!.reason).toMatch(/^move_card: /);
  });

  it('reads and refused writes do not log or notify', () => {
    const r = rig();
    r.ok('get_day', {});
    r.ok('list_tasks', {});
    r.err('place_block', { taskId: r.ids.trip, date: TODAY, startMin: 810, endMin: 870 });
    r.err('add_task', { title: 'x', tag: 'Nope' });
    expect(claudeLog(r.st.d)).toHaveLength(0);
    expect(r.notes).toHaveLength(0);
  });

  it('works without a notify hook', () => {
    const r = rig();
    const bare = new Mcp({ ...r.port, notify: undefined });
    expect(bare.call('add_note', { body: 'x' }).ok).toBe(true);
  });
});

describe('strict input checking', () => {
  it('rejects unknown tools', () => {
    expect(rig().err('delete_everything', {})).toMatch(/Unknown tool/);
  });
  it('rejects unknown fields, at the top and nested', () => {
    const r = rig();
    expect(r.err('get_day', { date: TODAY, extra: 1 })).toMatch(/args\.extra is not a known field/);
    expect(r.err('add_task', { title: 'x', hacker: true })).toMatch(/not a known field/);
    expect(r.err('update_task', { id: r.ids.trip, patch: { id: 'other' } })).toMatch(/args\.patch\.id is not a known field/);
    expect(r.err('add_task', { title: 'x', recurrence: { freq: 'daily', interval: 1, extra: 1 } })).toMatch(/not a known field/);
  });
  it('rejects wrong types and out-of-range values', () => {
    const r = rig();
    expect(r.err('get_day', { date: 20261026 })).toMatch(/must be a string/);
    expect(r.err('get_day', { date: '26/10/2026' })).toMatch(/wrong format/);
    expect(r.err('add_task', { title: 5 })).toMatch(/must be a string/);
    expect(r.err('add_task', { title: '' })).toMatch(/too short/);
    expect(r.err('add_task', { title: 'x'.repeat(121) })).toMatch(/too long/);
    expect(r.err('add_task', { title: 'x', priority: 'urgent' })).toMatch(/one of must, should, nice/);
    expect(r.err('add_task', { title: 'x', estimateMin: 1.5 })).toMatch(/whole number/);
    expect(r.err('add_task', { title: 'x', estimateMin: 0 })).toMatch(/>= 1/);
    expect(r.err('list_tasks', { overdue: 'yes' })).toMatch(/true or false/);
    expect(r.err('list_tasks', { limit: 1000 })).toMatch(/<= 200/);
    expect(r.err('place_block', { taskId: r.ids.trip, date: TODAY, startMin: -1, endMin: 60 })).toMatch(/>= 0/);
    expect(r.err('place_block', { taskId: r.ids.trip, date: TODAY, startMin: 0, endMin: 1441 })).toMatch(/<= 1440/);
    expect(r.err('search', { query: 'x', types: ['everything'] })).toMatch(/one of task, note, project, event/);
    expect(r.err('add_project', { name: 'x', columns: 'a' })).toMatch(/must be an array/);
    expect(r.err('add_project', { name: 'x', color: 'blue' })).toMatch(/one of tag1/);
    expect(r.err('get_day', 'today')).toMatch(/must be an object/);
    expect(r.err('get_day', [])).toMatch(/must be an object/);
  });
  it('rejects missing required fields', () => {
    const r = rig();
    expect(r.err('add_task', {})).toMatch(/args\.title is required/);
    expect(r.err('get_task', {})).toMatch(/args\.id is required/);
    expect(r.err('place_block', { taskId: 'x', date: TODAY, startMin: 1 })).toMatch(/args\.endMin is required/);
    expect(r.err('undo', {})).toMatch(/args\.undoToken is required/);
    expect(r.err('update_task', { id: r.ids.trip })).toMatch(/args\.patch is required/);
  });
  it('treats missing args as an empty object', () => {
    const r = rig();
    expect(r.mcp.call('list_projects', undefined).ok).toBe(true);
    expect(r.mcp.call('get_day', null).ok).toBe(true);
  });
  it('a rejected call changes nothing and does not use up the write budget', () => {
    const r = rig();
    const before = r.st.d;
    for (let i = 0; i < 40; i++) r.err('add_task', { title: 'x', bogus: 1 });
    expect(r.st.d).toBe(before);
    expect(r.call('add_task', { title: 'fine' }).ok).toBe(true);
  });
});

describe('rate limit', () => {
  it(`allows ${WRITES_PER_MINUTE} writes in a minute, refuses the next, allows again after the window`, () => {
    const r = rig();
    expect(WRITES_PER_MINUTE).toBe(30);
    for (let i = 0; i < 30; i++) r.ok('add_note', { body: `note ${i}` });
    const refused = r.err('add_note', { body: 'one too many' });
    expect(refused).toMatch(/Too many changes in a minute \(limit 30\)/);
    expect(live(r.st.d, 'ideas')).toHaveLength(30);
    // reads are never limited
    expect(r.call('list_notes', {}).ok).toBe(true);
    // still inside the window
    r.st.now += 59_000;
    expect(r.err('add_note', { body: 'still refused' })).toMatch(/Too many/);
    // window passed
    r.st.now += 2_000;
    expect(r.call('add_note', { body: 'allowed again' }).ok).toBe(true);
    expect(live(r.st.d, 'ideas')).toHaveLength(31);
  });

  it('the window slides: writes spread over time are not limited', () => {
    const r = rig();
    for (let i = 0; i < 100; i++) {
      r.st.now += 5_000;
      r.ok('add_note', { body: `n${i}` });
    }
    expect(live(r.st.d, 'ideas')).toHaveLength(100);
  });

  it('undo counts as a write', () => {
    const r = rig(undefined, 3);
    const a = r.ok('add_note', { body: '1' });
    r.ok('add_note', { body: '2' });
    r.ok('undo', { undoToken: a.undoToken });
    expect(r.err('add_note', { body: '4' })).toMatch(/limit 3/);
  });
});

describe('no hard deletes', () => {
  it('records created and then undone, or removed, are still in their collections', () => {
    const r = rig();
    const t = r.ok('add_task', { title: 'Temp' });
    const bl = r.ok('place_block', { taskId: t.changed.id, date: TODAY, startMin: 900, endMin: 960 });
    const rm = r.ok('remove_block', { id: bl.changed.id });
    r.ok('undo', { undoToken: rm.undoToken });
    r.ok('undo', { undoToken: bl.undoToken });
    r.ok('undo', { undoToken: t.undoToken });
    expect(Object.keys(r.st.d.blocks)).toContain(bl.changed.id);
    expect(Object.keys(r.st.d.tasks)).toContain(t.changed.id);
    expect(r.st.d.tombs).toEqual({});
  });
  it('there is no tool that deletes or changes settings', () => {
    const names = TOOLS.map((t) => t.name);
    expect(names.some((n) => /delete|purge|settings|restore|wipe/.test(n))).toBe(false);
  });
});

describe('coverage', () => {
  it('every tool in TOOLS was exercised by this file', () => {
    // runs last in this file: the rigs above record the tool names they called into their own sets,
    // so exercise each tool once more here against one shared rig
    const r = rig();
    const proj = r.ok('add_project', { name: 'Cov' }).changed;
    const card = r.ok('add_task', { title: 'Cov card', projectId: proj.id }).changed.id;
    const note = r.ok('add_note', { body: 'cov' });
    const block = r.ok('place_block', { taskId: r.ids.trip, date: TODAY, startMin: 900, endMin: 960 }).changed.id;
    const unplaced = run(r.st.d, { type: 'event.create', input: { title: 'Cov exam', tagId: null, scope: 'school', tz: 'Asia/Jakarta', startMin: null, endMin: null, durationMin: 45, date: TODAY, recur: null, notes: '' } });
    r.st.d = unplaced.d;
    const calls: [string, unknown][] = [
      ['get_day', {}], ['get_week', {}], ['list_tasks', {}], ['get_task', { id: r.ids.trip }], ['search', { query: 'trip' }], ['list_projects', {}], ['get_project', { id: proj.id }],
      ['list_events', {}], ['get_stats', { from: TODAY, to: TODAY }], ['get_review', { date: TODAY }], ['list_notes', {}], ['search_log', { query: 'cov' }], ['list_unplaced', {}], ['place_event', { eventId: unplaced.id, startMin: 1080 }], ['post_log', { body: 'cov post' }],
      ['update_task', { id: r.ids.trip, patch: { notes: 'x' } }], ['move_block', { id: block, startMin: 1000 }], ['remove_block', { id: block }],
      ['skip_event_on', { eventId: r.ids.class, date: MON2 }], ['edit_event_on', { eventId: r.ids.class, date: '2026-11-09', patch: { title: 'E' } }],
      ['move_card', { taskId: card, columnId: proj.columns[1].id }], ['drop_task', { id: r.ids.trip, reason: 'coverage' }], ['complete_task', { id: r.ids.paper }], ['undo', { undoToken: note.undoToken }],
    ];
    for (const [name, args] of calls) expect(r.call(name, args).ok, name).toBe(true);
    for (const n of ['add_project', 'add_task', 'add_note', 'place_block']) r.called.add(n);
    expect([...r.called].sort()).toEqual(TOOLS.map((t) => t.name).sort());
  });
});
