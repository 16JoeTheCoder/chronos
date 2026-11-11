// Recurring tasks: nextDate and the instance spawned when one is finished.
import { describe, expect, it } from 'vitest';
import { apply } from '../../src/core/commands';
import type { Data, Task, TaskRecurrence } from '../../src/core/model/types';
import { get, live } from '../../src/core/repo/repo';
import { nextDate, spawnNext } from '../../src/core/tasks/recurrence';
import { addTask, ctx, fresh, MIN, run, T0 } from '../helpers';

const MON = '2026-10-26';
const WED = '2026-10-28';
const FRI = '2026-10-30';

describe('nextDate', () => {
  it('daily every day and every 3 days', () => {
    expect(nextDate({ freq: 'daily', interval: 1 }, MON)).toBe('2026-10-27');
    expect(nextDate({ freq: 'daily', interval: 3 }, MON)).toBe('2026-10-29');
    expect(nextDate({ freq: 'daily', interval: 1 }, '2026-12-31')).toBe('2027-01-01');
    expect(nextDate({ freq: 'daily', interval: 1 }, '2028-02-28')).toBe('2028-02-29');
  });

  it('weekly without weekdays: the same weekday next week', () => {
    expect(nextDate({ freq: 'weekly', interval: 1 }, MON)).toBe('2026-11-02');
    expect(nextDate({ freq: 'weekly', interval: 1, weekdays: [] }, WED)).toBe('2026-11-04');
    expect(nextDate({ freq: 'weekly', interval: 1 }, '2026-11-01')).toBe('2026-11-08'); // a Sunday
  });

  it('weekly with weekdays [1,3,5]: Wednesday -> Friday, Friday -> next Monday, Monday -> Wednesday', () => {
    const r: TaskRecurrence = { freq: 'weekly', interval: 1, weekdays: [1, 3, 5] };
    expect(nextDate(r, WED)).toBe(FRI);
    expect(nextDate(r, FRI)).toBe('2026-11-02');
    expect(nextDate(r, MON)).toBe(WED);
    expect(nextDate(r, '2026-10-31')).toBe('2026-11-02'); // from a Saturday
  });

  it('weekly every 2 weeks skips a week', () => {
    expect(nextDate({ freq: 'weekly', interval: 2 }, MON)).toBe('2026-11-09');
    expect(nextDate({ freq: 'weekly', interval: 2, weekdays: [1] }, MON)).toBe('2026-11-09');
    // another weekday in the same week still counts before the gap week
    expect(nextDate({ freq: 'weekly', interval: 2, weekdays: [1, 3] }, MON)).toBe(WED);
    expect(nextDate({ freq: 'weekly', interval: 2, weekdays: [1, 3] }, WED)).toBe('2026-11-09');
  });

  it('is always strictly after the start date', () => {
    for (const r of [{ freq: 'daily', interval: 1 }, { freq: 'weekly', interval: 1, weekdays: [1, 2, 3, 4, 5, 6, 7] }, { freq: 'weekly', interval: 4, weekdays: [7] }] as TaskRecurrence[]) {
      expect(nextDate(r, MON) > MON).toBe(true);
    }
    expect(nextDate({ freq: 'weekly', interval: 1, weekdays: [1, 2, 3, 4, 5, 6, 7] }, MON)).toBe('2026-10-27');
  });
});

const recurring = (d: Data, title: string, recurrence: TaskRecurrence | null, extra: Record<string, unknown> = {}) => addTask(d, title, { recurrence, dueDate: MON, ...extra });
const spawned = (d: Data, rootId: string) => live(d, 'tasks').filter((t) => t.recurrenceParentId === rootId);

describe('task.finish on a recurring task', () => {
  it('creates exactly one next task with the deterministic id and the root as parent', () => {
    const a = recurring(fresh(), 'Water plants', { freq: 'daily', interval: 1 });
    const { d } = run(a.d, { type: 'task.finish', id: a.id });
    const next = spawned(d, a.id);
    expect(next).toHaveLength(1);
    expect(next[0]!.id).toBe(`${a.id}:2026-10-27`);
    expect(next[0]).toMatchObject({ recurrenceParentId: a.id, dueDate: '2026-10-27', title: 'Water plants', recurrence: { freq: 'daily', interval: 1 }, source: 'typed' });
    expect(live(d, 'tasks')).toHaveLength(2);
    expect(d.tasks[a.id]).toMatchObject({ status: 'done', outcome: 'finished' });
  });

  it('the new instance is inbox and fresh (no runtime, no tracked work), unlike the finished one', () => {
    const a = recurring(fresh(), 'Water plants', { freq: 'daily', interval: 1 });
    const other = addTask(a.d, 'Another task'); // takes the focus slot after the finish
    const { d } = run(other.d, { type: 'timer', action: 'start' }, [{ type: 'task.finish', id: a.id }, T0 + 25 * MIN]);
    const done = d.tasks[a.id]!;
    const next = d.tasks[`${a.id}:2026-10-27`] as Task;
    expect(done.completedAt).not.toBeNull();
    expect(next.status).toBe('inbox');
    expect(next).toMatchObject({ workMs: 0, breakMs: 0, pomodorosCompleted: 0, startedAt: null, completedAt: null, outcome: null, parkedAt: null, dropCount: 0 });
    expect(next.runtime).toEqual({ status: 'idle', phase: 'work', phaseElapsedMs: 0, sliceStartedAt: null, cycleSessions: 0, expiredNotified: false });
    expect(next.sortKey > done.sortKey).toBe(true);
  });

  it('copies the fields that define the task', () => {
    const tag = run(fresh(), { type: 'tag.create', input: { name: 'Home', color: 'tag1', kind: 'general' } });
    const a = recurring(tag.d, 'Water plants', { freq: 'daily', interval: 1 }, { tagId: tag.id, priority: 'must', estimateMin: 15, finishCondition: 'All plants watered', notes: 'Use the green can', dueTime: 480 });
    const { d } = run(a.d, { type: 'task.finish', id: a.id });
    expect(d.tasks[`${a.id}:2026-10-27`]).toMatchObject({ tagId: tag.id, priority: 'must', estimateMin: 15, finishCondition: 'All plants watered', notes: 'Use the green can', dueTime: 480, kind: 'task' });
  });

  it('finishing the instance creates <rootId>:<date2>, not a nested id', () => {
    const a = recurring(fresh(), 'Water plants', { freq: 'daily', interval: 1 });
    const d1 = run(a.d, { type: 'task.finish', id: a.id }).d;
    const inst = `${a.id}:2026-10-27`;
    const d2 = run(d1, { type: 'task.finish', id: inst }).d;
    expect(d2.tasks[`${a.id}:2026-10-28`]).toBeDefined();
    expect(d2.tasks[`${a.id}:2026-10-28`]!.recurrenceParentId).toBe(a.id);
    expect(Object.keys(d2.tasks).some((k) => k.split(':').length > 2)).toBe(false);
    expect(Object.keys(d2.tasks)).toHaveLength(3);
  });

  it('steps weekly weekdays from the due date', () => {
    const a = addTask(fresh(), 'Gym', { dueDate: WED, recurrence: { freq: 'weekly', interval: 1, weekdays: [5, 1, 3] } });
    expect(a.d.tasks[a.id]!.recurrence).toEqual({ freq: 'weekly', interval: 1, weekdays: [1, 3, 5] }); // cleaned
    const d = run(a.d, { type: 'task.finish', id: a.id }).d;
    expect(spawned(d, a.id).map((t) => t.id)).toEqual([`${a.id}:${FRI}`]);
  });

  it('without a due date it steps from the completion date', () => {
    const a = addTask(fresh(), 'Stretch', { recurrence: { freq: 'daily', interval: 2 } });
    const d = run(a.d, { type: 'task.finish', id: a.id }).d;
    expect(spawned(d, a.id).map((t) => t.id)).toEqual([`${a.id}:2026-10-28`]);
  });

  it('finishing twice does not create a second instance', () => {
    const a = recurring(fresh(), 'Water plants', { freq: 'daily', interval: 1 });
    const d1 = run(a.d, { type: 'task.finish', id: a.id }).d;
    const again = apply(d1, { type: 'task.finish', id: a.id }, ctx(T0));
    expect(again.ok).toBe(false);
    expect(live(d1, 'tasks')).toHaveLength(2);
    // reopen + finish again lands on the same id and keeps one instance
    const d2 = run(d1, { type: 'task.reopen', id: a.id }, { type: 'task.finish', id: a.id }).d;
    expect(spawned(d2, a.id)).toHaveLength(1);
    expect(Object.keys(d2.tasks)).toHaveLength(2);
  });

  it('two devices finishing independently derive the same next record', () => {
    const a = recurring(fresh(), 'Water plants', { freq: 'weekly', interval: 1, weekdays: [1, 3] });
    const onA = apply(a.d, { type: 'task.finish', id: a.id }, ctx(T0, 'devA'));
    const onB = apply(a.d, { type: 'task.finish', id: a.id }, ctx(T0 + 3 * MIN, 'devB'));
    if (!onA.ok || !onB.ok) throw new Error('finish failed');
    const idsA = Object.keys(onA.d.tasks).sort();
    expect(Object.keys(onB.d.tasks).sort()).toEqual(idsA);
    const id = `${a.id}:${WED}`;
    expect(idsA).toContain(id);
    const strip = (t: Task) => {
      const { createdAt: _c, updatedAt: _u, deviceId: _d, ...rest } = t;
      return rest;
    };
    expect(strip(onA.d.tasks[id]!)).toEqual(strip(onB.d.tasks[id]!));
  });

  it('spawnNext is idempotent and never recreates a purged instance', () => {
    const a = recurring(fresh(), 'Water plants', { freq: 'daily', interval: 1 });
    const t = a.d.tasks[a.id] as Task;
    const once = spawnNext(a.d, t, ctx(T0));
    expect(Object.keys(once.tasks)).toHaveLength(2);
    expect(spawnNext(once, t, ctx(T0))).toBe(once);
    const id = `${a.id}:2026-10-27`;
    const purged: Data = { ...a.d, tombs: { tasks: { [id]: { id, updatedAt: 1, deletedAt: 1, deviceId: 'x', v: 2, purged: true } } } };
    expect(spawnNext(purged, t, ctx(T0))).toBe(purged);
  });

  it('keeps a project task in its project and column', () => {
    const p = run(fresh(), { type: 'project.create', name: 'Home' });
    const a = recurring(p.d, 'Water plants', { freq: 'daily', interval: 1 }, { projectId: p.id });
    const col = a.d.tasks[a.id]!.columnId;
    expect(col).not.toBeNull();
    const d = run(a.d, { type: 'task.finish', id: a.id }).d;
    expect(d.tasks[`${a.id}:2026-10-27`]).toMatchObject({ projectId: p.id, columnId: col });
  });
});

describe('no spawn', () => {
  it('finishing a non-recurring task creates nothing', () => {
    const a = addTask(fresh(), 'One off', { dueDate: MON });
    const { d } = run(a.d, { type: 'task.finish', id: a.id });
    expect(Object.keys(d.tasks)).toEqual([a.id]);
  });

  it('dropping (task.close) a recurring task does not spawn the next one', () => {
    const a = recurring(fresh(), 'Water plants', { freq: 'daily', interval: 1 });
    const { d } = run(a.d, { type: 'task.close', id: a.id, reason: 'not needed' });
    expect(d.tasks[a.id]!.status).toBe('dropped');
    expect(Object.keys(d.tasks)).toEqual([a.id]);
  });

  it('task.drop (park) of the focused recurring task does not spawn either', () => {
    const a = recurring(fresh(), 'Water plants', { freq: 'daily', interval: 1 }, { finishCondition: 'Plants are watered' });
    const { d } = run(a.d, { type: 'timer', action: 'start' }, { type: 'task.drop', id: a.id, reason: 'later please' });
    expect(Object.keys(d.tasks)).toEqual([a.id]);
  });

  it('get returns the instance by its deterministic id', () => {
    const a = recurring(fresh(), 'x', { freq: 'daily', interval: 1 });
    const d = run(a.d, { type: 'task.finish', id: a.id }).d;
    expect(get(d, 'tasks', `${a.id}:2026-10-27`)).toBeDefined();
  });
});
