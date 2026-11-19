// The shared task selectors (Phase 3.7 §1): every screen lists tasks through these.
import { describe, expect, it } from 'vitest';
import { active, all, byProject, done, expiredDone, forDay, inbox, labelsInUse, paused, today, upcoming } from '../../src/core/tasks/selectors';
import type { Command } from '../../src/core/commands';
import type { Data } from '../../src/core/model/types';
import { at, fresh, HOUR, MIN, run, T0, TODAY } from '../helpers';

const YESTERDAY = '2026-10-25';
const TOMORROW = '2026-10-27';
const CREATED_BEFORE = at(9 * 60, YESTERDAY);

/** Build a world step by step; every task is created "yesterday" unless `made` says otherwise. */
function make(d: Data, input: Record<string, unknown>, createdAt = CREATED_BEFORE): { d: Data; id: string } {
  return run(d, [{ type: 'task.create', input: { title: 'x', ...input } } as Command, createdAt]);
}
const titles = (ts: { title: string }[]) => ts.map((t) => t.title);

describe('inbox', () => {
  it('holds open tasks with no date, no project and no block today or later', () => {
    let d = fresh();
    const proj = run(d, { type: 'project.create', name: 'P' });
    d = proj.d;
    d = make(d, { title: 'plain' }).d;
    d = make(d, { title: 'dated', dueDate: TOMORROW }).d;
    d = make(d, { title: 'in project', projectId: proj.id }).d;
    const planned = make(d, { title: 'planned later' });
    d = run(planned.d, { type: 'block.create', taskId: planned.id, date: TOMORROW, startMin: 600, endMin: 660 }).d;
    const past = make(d, { title: 'past block' });
    d = run(past.d, { type: 'block.create', taskId: past.id, date: YESTERDAY, startMin: 600, endMin: 660 }).d;
    const fin = make(d, { title: 'finished' });
    d = run(fin.d, { type: 'task.finish', id: fin.id }).d;
    expect(titles(inbox(d, T0)).sort()).toEqual(['past block', 'plain']);
    // a block today also takes it out
    const todayBlock = run(d, { type: 'block.create', taskId: past.id, date: TODAY, startMin: 700, endMin: 760 }).d;
    expect(titles(inbox(todayBlock, T0))).toEqual(['plain']);
  });
});

describe('today', () => {
  it('has tasks due today or overdue, planned today, created today without a date, or doing', () => {
    let d = fresh();
    d = make(d, { title: 'due today', dueDate: TODAY }).d;
    d = make(d, { title: 'overdue', dueDate: YESTERDAY }).d;
    const pl = make(d, { title: 'planned today', dueDate: '2026-11-05' });
    d = run(pl.d, { type: 'block.create', taskId: pl.id, date: TODAY, startMin: 600, endMin: 660 }).d;
    d = make(d, { title: 'new today' }, T0).d;
    const doing = make(d, { title: 'doing', dueDate: '2026-11-20' });
    d = run(doing.d, { type: 'task.start', id: doing.id }).d;
    // not today:
    d = make(d, { title: 'later', dueDate: TOMORROW }).d;
    d = make(d, { title: 'old undated' }).d;
    const fin = make(d, { title: 'finished today', dueDate: TODAY });
    d = run(fin.d, { type: 'task.finish', id: fin.id }).d;
    expect(titles(today(d, T0)).sort()).toEqual(['doing', 'due today', 'new today', 'overdue', 'planned today']);
  });
});

describe('upcoming', () => {
  it('starts with the overdue group, then 14 day groups, each sorted by due time', () => {
    let d = fresh();
    d = make(d, { title: 'late', dueDate: '2026-10-23' }).d;
    d = make(d, { title: 'late2', dueDate: YESTERDAY }).d;
    d = make(d, { title: 'afternoon', dueDate: TOMORROW, dueTime: 15 * 60 }).d;
    d = make(d, { title: 'no time', dueDate: TOMORROW }).d;
    d = make(d, { title: 'morning', dueDate: TOMORROW, dueTime: 8 * 60 }).d;
    d = make(d, { title: 'far', dueDate: '2026-12-25' }).d;
    d = make(d, { title: 'undated' }).d;
    const g = upcoming(d, T0);
    expect(g).toHaveLength(15);
    expect(g[0]).toMatchObject({ overdue: true, date: '2026-10-23' });
    expect(titles(g[0]!.tasks).sort()).toEqual(['late', 'late2']);
    expect(g.slice(1).every((x) => !x.overdue)).toBe(true);
    expect(g[1]!.date).toBe(TODAY);
    expect(g[2]!.date).toBe(TOMORROW);
    expect(titles(g[2]!.tasks)).toEqual(['morning', 'afternoon', 'no time']);
    expect(g.at(-1)!.date).toBe('2026-11-08');
    expect(g.flatMap((x) => titles(x.tasks))).not.toContain('far');
  });
  it('has no overdue group when nothing is overdue', () => {
    const d = make(fresh(), { title: 'a', dueDate: TOMORROW }).d;
    const g = upcoming(d, T0);
    expect(g).toHaveLength(14);
    expect(g[0]).toMatchObject({ date: TODAY, overdue: false });
  });
});

describe('all, byProject, active, paused, done', () => {
  it('all lists every open task and nothing finished or dropped', () => {
    let d = fresh();
    const a = make(d, { title: 'a' });
    const b = make(a.d, { title: 'b' });
    const c = make(b.d, { title: 'c' });
    d = run(c.d, { type: 'task.finish', id: a.id }).d;
    d = run(d, { type: 'task.start', id: c.id }, { type: 'task.drop', id: c.id, reason: 'later' }).d;
    d = run(d, { type: 'task.close', id: b.id, reason: 'not needed' }).d;
    expect(titles(all(d))).toEqual(['c']);
  });

  it('byProject includes done tasks and excludes dropped ones', () => {
    let d = fresh();
    const proj = run(d, { type: 'project.create', name: 'P' });
    const other = run(proj.d, { type: 'project.create', name: 'Q' });
    const open = make(other.d, { title: 'open', projectId: proj.id });
    const fin = make(open.d, { title: 'fin', projectId: proj.id });
    const drp = make(fin.d, { title: 'drp', projectId: proj.id });
    const els = make(drp.d, { title: 'else', projectId: other.id });
    d = run(els.d, { type: 'task.finish', id: fin.id }, { type: 'task.close', id: drp.id, reason: 'nope' }).d;
    expect(titles(byProject(d, proj.id)).sort()).toEqual(['fin', 'open']);
    expect(titles(byProject(d, other.id))).toEqual(['else']);
  });

  it('active is the one doing task', () => {
    const a = make(fresh(), { title: 'a' });
    expect(active(a.d)).toBeUndefined();
    const d = run(a.d, { type: 'task.start', id: a.id }).d;
    expect(active(d)?.id).toBe(a.id);
  });

  it('paused = open, not doing, runtime paused or work banked', () => {
    const a = make(fresh(), { title: 'ran' });
    const b = make(a.d, { title: 'never started' });
    const c = make(b.d, { title: 'doing' });
    let d = run(c.d, [{ type: 'task.start', id: a.id, run: true }, T0], [{ type: 'task.start', id: c.id, run: true }, T0 + 10 * MIN]).d;
    expect(titles(paused(d))).toEqual(['ran']);
    expect(d.tasks[a.id]!.workMs).toBe(10 * MIN);
    expect(d.tasks[a.id]!.runtime.status).toBe('paused');
    // a finished task never shows as paused
    d = run(d, { type: 'task.finish', id: a.id }).d;
    expect(paused(d)).toEqual([]);
    expect(active(d)?.id).toBe(c.id);
  });

  it('done is newest completedAt first', () => {
    let d = fresh();
    const a = make(d, { title: 'first' });
    const b = make(a.d, { title: 'second' });
    const c = make(b.d, { title: 'open' });
    d = run(c.d, [{ type: 'task.finish', id: a.id }, T0], [{ type: 'task.finish', id: b.id }, T0 + HOUR]).d;
    expect(titles(done(d))).toEqual(['second', 'first']);
  });
});

describe('forDay', () => {
  it('lists open tasks due on the date or planned on it', () => {
    let d = fresh();
    d = make(d, { title: 'due', dueDate: TOMORROW }).d;
    const pl = make(d, { title: 'planned' });
    d = run(pl.d, { type: 'block.create', taskId: pl.id, date: TOMORROW, startMin: 600, endMin: 660 }).d;
    d = make(d, { title: 'other day', dueDate: TODAY }).d;
    const fin = make(d, { title: 'fin', dueDate: TOMORROW });
    d = run(fin.d, { type: 'task.finish', id: fin.id }).d;
    expect(titles(forDay(d, TOMORROW)).sort()).toEqual(['due', 'planned']);
    expect(titles(forDay(d, TODAY))).toEqual(['other day']);
  });
});

describe('labelsInUse', () => {
  it('counts labels, most used first, ties alphabetical', () => {
    let d = fresh();
    d = make(d, { title: 'a', labels: ['school', 'home'] }).d;
    d = make(d, { title: 'b', labels: ['school'] }).d;
    d = make(d, { title: 'c', labels: ['chores', 'school'] }).d;
    expect(labelsInUse(d)).toEqual(['school', 'chores', 'home']);
    expect(labelsInUse(fresh())).toEqual([]);
  });
});

describe('expiredDone', () => {
  it('keeps everything when hours is 0; otherwise returns done tasks past the window', () => {
    const a = make(fresh(), { title: 'old' });
    const b = make(a.d, { title: 'recent' });
    const c = make(b.d, { title: 'open' });
    const now = T0 + 100 * HOUR;
    const d = run(c.d, [{ type: 'task.finish', id: a.id }, now - 25 * HOUR], [{ type: 'task.finish', id: b.id }, now - 23 * HOUR]).d;
    expect(expiredDone(d, now, 0)).toEqual([]);
    expect(titles(expiredDone(d, now, 24))).toEqual(['old']);
    expect(titles(expiredDone(d, now, 72))).toEqual([]);
    expect(titles(expiredDone(d, now, 12)).sort()).toEqual(['old', 'recent']);
  });
});
