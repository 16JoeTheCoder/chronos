// The one status transition, driven through the commands every screen uses (Phase 3.7 §1).
import { describe, expect, it } from 'vitest';
import { apply } from '../../src/core/commands';
import type { Command } from '../../src/core/commands';
import type { Data } from '../../src/core/model/types';
import { live, timerOf } from '../../src/core/repo/repo';
import { active } from '../../src/core/tasks/selectors';
import { addTask, ctx, fresh, MIN, run, T0 } from '../helpers';

const doingIds = (d: Data) => live(d, 'tasks').filter((t) => t.status === 'doing').map((t) => t.id);
const sessionsOf = (d: Data, id: string) => live(d, 'sessions').filter((s) => s.taskId === id);

function two() {
  const a = addTask(fresh(), 'A');
  const b = addTask(a.d, 'B');
  return { d: b.d, a: a.id, b: b.id };
}

describe('start / pause', () => {
  it('task.start pauses the other doing task: session recorded, work kept, timer follows the new one', () => {
    const { d: d0, a, b } = two();
    let d = run(d0, [{ type: 'task.start', id: a, run: true }, T0]).d;
    expect(d.tasks[a]!.runtime.status).toBe('running');
    d = run(d, [{ type: 'task.start', id: b }, T0 + 10 * MIN]).d;
    const ta = d.tasks[a]!;
    expect(ta.status).not.toBe('doing');
    expect(ta.runtime.status).toBe('paused');
    expect(ta.workMs).toBe(10 * MIN);
    expect(sessionsOf(d, a)).toHaveLength(1);
    expect(d.tasks[b]!.status).toBe('doing');
    expect(timerOf(d).taskId).toBe(b);
    expect(doingIds(d)).toEqual([b]);
  });

  it('task.pause closes the session, keeps workMs, leaves nothing doing and the timer empty', () => {
    const { d: d0, a } = two();
    let d = run(d0, [{ type: 'task.start', id: a, run: true }, T0], [{ type: 'task.pause', id: a }, T0 + 7 * MIN]).d;
    expect(d.tasks[a]!.status).not.toBe('doing');
    expect(d.tasks[a]!.runtime.status).toBe('paused');
    expect(d.tasks[a]!.workMs).toBe(7 * MIN);
    expect(sessionsOf(d, a)).toHaveLength(1);
    expect(doingIds(d)).toEqual([]);
    expect(timerOf(d).taskId).toBeNull();
    // pausing a task that is not in focus changes nothing
    d = run(d, { type: 'task.pause', id: a }).d;
    expect(doingIds(d)).toEqual([]);
  });
});

describe('finish / reopen', () => {
  it('task.finish sets done, outcome and completedAt', () => {
    const { d: d0, a } = two();
    const d = run(d0, [{ type: 'task.start', id: a, run: true }, T0], [{ type: 'task.finish', id: a }, T0 + 5 * MIN]).d;
    expect(d.tasks[a]).toMatchObject({ status: 'done', outcome: 'finished', completedAt: T0 + 5 * MIN, workMs: 5 * MIN });
    expect(timerOf(d).taskId).toBeNull();
    expect(active(d)).toBeUndefined();
  });

  it('a project task finishes into the Done column', () => {
    const p = run(fresh(), { type: 'project.create', name: 'P' });
    const t = addTask(p.d, 'Card', { projectId: p.id });
    expect(t.d.tasks[t.id]!.columnId === null || t.d.tasks[t.id]!.columnId === 'todo').toBe(true);
    const d = run(t.d, { type: 'task.finish', id: t.id }).d;
    expect(d.tasks[t.id]).toMatchObject({ status: 'done', columnId: 'done' });
  });

  it('task.reopen clears completedAt and outcome', () => {
    const { d: d0, a } = two();
    let d = run(d0, { type: 'task.finish', id: a }).d;
    expect(d.tasks[a]!.completedAt).not.toBeNull();
    d = run(d, { type: 'task.reopen', id: a }).d;
    expect(d.tasks[a]).toMatchObject({ completedAt: null, outcome: null });
    expect(['inbox', 'planned']).toContain(d.tasks[a]!.status);
  });
});

describe('board round trip', () => {
  function board() {
    const p = run(fresh(), { type: 'project.create', name: 'Board' });
    expect(p.d.projects[p.id]!.columns.map((c) => c.id)).toEqual(['todo', 'doing', 'done']);
    const a = addTask(p.d, 'Card A', { projectId: p.id, columnId: 'todo' });
    const b = addTask(a.d, 'Card B', { projectId: p.id, columnId: 'todo' });
    return { d: b.d, a: a.id, b: b.id };
  }
  const move = (id: string, columnId: string, now = T0): [Command, number] => [{ type: 'task.moveCard', id, columnId, beforeId: null }, now];

  it('done, back to doing, back to todo: no stale done state left', () => {
    const { d: d0, a } = board();
    let d = run(d0, move(a, 'done')).d;
    expect(d.tasks[a]).toMatchObject({ status: 'done', columnId: 'done' });
    expect(d.tasks[a]!.completedAt).not.toBeNull();

    d = run(d, move(a, 'doing', T0 + MIN)).d;
    expect(d.tasks[a]).toMatchObject({ status: 'doing', columnId: 'doing', completedAt: null, outcome: null });
    expect(active(d)?.id).toBe(a);

    d = run(d, move(a, 'todo', T0 + 2 * MIN)).d;
    expect(['inbox', 'planned']).toContain(d.tasks[a]!.status);
    expect(d.tasks[a]).toMatchObject({ columnId: 'todo', completedAt: null, outcome: null });
    expect(active(d)).toBeUndefined();
  });

  it('a second card moved into doing pauses the first and sends it back to todo', () => {
    const { d: d0, a, b } = board();
    let d = run(d0, move(a, 'doing')).d;
    d = run(d, move(b, 'doing', T0 + MIN)).d;
    expect(d.tasks[b]).toMatchObject({ status: 'doing', columnId: 'doing' });
    expect(d.tasks[a]!.status).not.toBe('doing');
    expect(d.tasks[a]!.columnId).toBe('todo');
    expect(doingIds(d)).toEqual([b]);
  });
});

describe('task.sort', () => {
  it('gives a sortKey strictly between its neighbours', () => {
    const a = addTask(fresh(), 'A');
    const b = addTask(a.d, 'B');
    const c = addTask(b.d, 'C');
    const d = run(c.d, { type: 'task.sort', id: c.id, afterId: a.id, beforeId: b.id }).d;
    const [ka, kb, kc] = [d.tasks[a.id]!.sortKey, d.tasks[b.id]!.sortKey, d.tasks[c.id]!.sortKey];
    expect(ka < kc && kc < kb).toBe(true);
  });

  it('sets the due date (drop on an Upcoming day) and can clear it', () => {
    const a = addTask(fresh(), 'A');
    let d = run(a.d, { type: 'task.sort', id: a.id, afterId: null, beforeId: null, dueDate: '2026-10-30' }).d;
    expect(d.tasks[a.id]!.dueDate).toBe('2026-10-30');
    d = run(d, { type: 'task.sort', id: a.id, afterId: null, beforeId: null, dueDate: null }).d;
    expect(d.tasks[a.id]!.dueDate).toBeNull();
    expect(apply(d, { type: 'task.sort', id: a.id, afterId: null, beforeId: null, dueDate: 'soon' }, ctx()).ok).toBe(false);
  });

  it('into the Done section completes it', () => {
    const p = run(fresh(), { type: 'project.create', name: 'P' });
    const a = addTask(p.d, 'A', { projectId: p.id, columnId: 'todo' });
    const d = run(a.d, { type: 'task.sort', id: a.id, afterId: null, beforeId: null, columnId: 'done' }).d;
    expect(d.tasks[a.id]).toMatchObject({ status: 'done', columnId: 'done' });
    expect(d.tasks[a.id]!.completedAt).not.toBeNull();
  });
});

describe('back to back starts', () => {
  it('two quick task.start commands on different tasks leave exactly one doing: the second', () => {
    const { d: d0, a, b } = two();
    const r1 = apply(d0, { type: 'task.start', id: a, run: true }, ctx(T0));
    expect(r1.ok).toBe(true);
    if (!r1.ok) return;
    const r2 = apply(r1.d, { type: 'task.start', id: b, run: true }, ctx(T0 + 1));
    expect(r2.ok).toBe(true);
    if (!r2.ok) return;
    expect(doingIds(r2.d)).toEqual([b]);
    expect(timerOf(r2.d).taskId).toBe(b);
    expect(r2.d.tasks[a]!.runtime.status).not.toBe('running');
    expect(r2.d.tasks[b]!.runtime.status).toBe('running');
  });
});
