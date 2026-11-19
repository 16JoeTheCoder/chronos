// Queue derivation and the single-focus rules (§6.4), plus finish/drop/reopen/recycle.
import { describe, expect, it } from 'vitest';
import { apply } from '../../src/core/commands';
import { live } from '../../src/core/repo/repo';
import { activeTask, deriveQueue } from '../../src/core/tasks/tasks';
import { addTask, at, ctx, fresh, MIN, run, T0 } from '../helpers';

const titles = (d: ReturnType<typeof fresh>) => deriveQueue(d, T0).map((t) => t.title);

describe('queue derivation', () => {
  it('scheduled blocks first in time order, then priority, then order', () => {
    let d = fresh();
    d = addTask(d, 'nice one', { priority: 'nice' }).d;
    d = addTask(d, 'should one', { priority: 'should' }).d;
    d = addTask(d, 'must one', { priority: 'must' }).d;
    const late = addTask(d, 'late block');
    const early = addTask(late.d, 'early block');
    d = run(early.d, { type: 'block.create', taskId: late.id, date: '2026-10-26', startMin: 900, endMin: 960 }, { type: 'block.create', taskId: early.id, date: '2026-10-26', startMin: 600, endMin: 630 }).d;
    expect(titles(d)).toEqual(['early block', 'late block', 'must one', 'should one', 'nice one']);
    expect(activeTask(d)).toBeUndefined(); // nothing is promoted automatically
  });

  it('a new task is queued but never active until started; finish conditions are retired', () => {
    let d = run(fresh(), { type: 'task.create', input: { title: 'Inbox thought', priority: 'must' } }).d;
    expect(activeTask(d)).toBeUndefined();
    const real = addTask(d, 'Real task');
    d = real.d;
    expect(activeTask(d)).toBeUndefined();
    expect(d.tasks[real.id]?.finishCondition).toBe('');
    expect(d.tasks[real.id]?.labels).toEqual([]);
    expect(d.tasks[real.id]?.priority).toBe('none');
    const r = apply(d, { type: 'task.create', input: { title: 'x', finishCondition: 'short' } }, ctx());
    expect(r.ok).toBe(true);
    d = run(d, { type: 'task.start', id: real.id }).d;
    expect(activeTask(d)?.title).toBe('Real task');
  });

  it('locks the active task once its timer has run: re-derivation never changes it', () => {
    let { d, id } = addTask(fresh(), 'First');
    d = run(d, { type: 'task.start', id }, { type: 'timer', action: 'start' }, [{ type: 'timer', action: 'pause' }, T0 + MIN]).d;
    d = addTask(d, 'Urgent', { priority: 'must' }).d;
    expect(activeTask(d)?.id).toBe(id);
  });

  it('planning is free before the first start: a new must task heads the queue but does not take focus', () => {
    let d = addTask(fresh(), 'First').d;
    d = addTask(d, 'Urgent', { priority: 'must' }).d;
    expect(activeTask(d)).toBeUndefined();
    expect(titles(d)).toEqual(['Urgent', 'First']);
  });

  it('reorders within the queue and adopts the neighbour priority', () => {
    let d = addTask(fresh(), 'A', { priority: 'should' }).d;
    const b = addTask(d, 'B', { priority: 'nice' });
    d = run(b.d, { type: 'task.reorder', id: b.id, direction: 'up' }).d;
    expect(titles(d)).toEqual(['B', 'A']);
    expect(d.tasks[b.id]?.priority).toBe('should');
  });
});

describe('finish, drop, reopen', () => {
  it('finish (held in the app, no typed phrase) stops the timer and logs sessions; done tasks cannot finish again', () => {
    let { d, id } = addTask(fresh(), 'Essay');
    d = run(d, { type: 'timer', action: 'start' }).d; // nothing doing: takes the queue head
    d = run(d, [{ type: 'task.finish', id }, T0 + 30 * MIN]).d;
    expect(apply(d, { type: 'task.finish', id }, ctx(T0 + 31 * MIN)).ok).toBe(false);
    const t = d.tasks[id]!;
    expect(t.status).toBe('done');
    expect(t.outcome).toBe('finished');
    expect(t.workMs).toBe(30 * MIN);
    expect(live(d, 'sessions')).toHaveLength(1);
    expect(live(d, 'activity').map((a) => a.type)).toEqual(['started', 'finished']);
  });

  it('drop needs a reason, keeps time, parks the task at the back and clears its blocks', () => {
    let d = addTask(fresh(), 'Other', { priority: 'nice' }).d;
    const r = addTask(d, 'Hard', { priority: 'must' });
    d = run(r.d, { type: 'block.create', taskId: r.id, date: '2026-10-26', startMin: 540, endMin: 600 }, { type: 'task.start', id: r.id }, { type: 'timer', action: 'start' }).d;
    expect(apply(d, { type: 'task.drop', id: r.id, reason: 'no' }, ctx(T0 + MIN)).ok).toBe(false);
    d = run(d, [{ type: 'task.drop', id: r.id, reason: 'Blocked on data' }, T0 + 10 * MIN]).d;
    const t = d.tasks[r.id]!;
    expect(t.status).toBe('inbox');
    expect(t.dropCount).toBe(1);
    expect(t.workMs).toBe(10 * MIN);
    expect(live(d, 'blocks')).toHaveLength(0);
    expect(activeTask(d)).toBeUndefined(); // nothing is promoted after a drop
    expect(t.parkedAt).not.toBeNull();
    expect(t.startedAt).toBeNull();
    expect(titles(d)).toEqual(['Other', 'Hard']);
    expect(live(d, 'activity').find((a) => a.type === 'dropped')?.reason).toBe('Blocked on data');
  });

  it('a dropped task is not re-locked and nothing is promoted: a new must task does not take focus', () => {
    let { d, id } = addTask(fresh(), 'Only');
    d = run(d, { type: 'task.start', id }, { type: 'timer', action: 'start' }, [{ type: 'task.drop', id, reason: 'Wrong idea' }, T0 + MIN]).d;
    expect(activeTask(d)).toBeUndefined();
    d = addTask(d, 'Urgent', { priority: 'must' }).d;
    expect(activeTask(d)).toBeUndefined();
    expect(d.tasks[id]?.workMs).toBe(MIN);
  });

  it('reopen brings a finished task back with its totals', () => {
    let { d, id } = addTask(fresh(), 'Essay');
    d = run(d, { type: 'task.start', id }, { type: 'timer', action: 'start' }, [{ type: 'task.finish', id }, T0 + 5 * MIN], { type: 'task.reopen', id }).d;
    expect(d.tasks[id]?.status).toBe('inbox');
    expect(d.tasks[id]?.outcome).toBeNull();
    expect(d.tasks[id]?.completedAt).toBeNull();
    expect(d.tasks[id]?.startedAt).toBeNull();
    expect(d.tasks[id]?.workMs).toBe(5 * MIN);
  });

  it('recycling a task with tracked time needs confirmation; restore brings it back', () => {
    let { d, id } = addTask(fresh(), 'Essay');
    d = run(d, { type: 'timer', action: 'start' }, [{ type: 'timer', action: 'pause' }, T0 + MIN]).d;
    const r = apply(d, { type: 'recycle', coll: 'tasks', id, confirmed: false }, ctx());
    expect(r.ok ? '' : r.error).toBe('confirm-required');
    d = run(d, { type: 'recycle', coll: 'tasks', id, confirmed: true }).d;
    expect(activeTask(d)).toBeUndefined();
    d = run(d, { type: 'restore', coll: 'tasks', id }).d;
    expect(activeTask(d)?.id).toBe(id);
  });
});

describe('blocks and the timer', () => {
  it('allows blocks over fixed events but rejects blocks overlapping other blocks', () => {
    let { d, id } = addTask(fresh(), 'Essay');
    d = run(d, { type: 'event.create', input: { title: 'Physics', tagId: null, scope: 'school', tz: 'Asia/Jakarta', startMin: 600, endMin: 660, date: '2026-10-26', recur: null, notes: '' } }).d;
    expect(apply(d, { type: 'block.create', taskId: id, date: '2026-10-26', startMin: 630, endMin: 700 }, ctx()).ok).toBe(true);
    d = run(d, { type: 'block.create', taskId: id, date: '2026-10-26', startMin: 660, endMin: 700 }).d;
    expect(apply(d, { type: 'block.create', taskId: null, date: '2026-10-26', startMin: 690, endMin: 720 }, ctx()).ok).toBe(false);
  });

  it('inside a block, a countdown runs to the block end and records overrun', () => {
    let { d, id } = addTask(fresh(), 'Essay');
    d = run(d, { type: 'block.create', taskId: id, date: '2026-10-26', startMin: 540, endMin: 570 }, [{ type: 'timer', action: 'start' }, at(550)]).d;
    expect(d.tasks[id]?.timer.countdown.durationMs).toBe(20 * MIN);
    d = run(d, [{ type: 'timer', action: 'pause' }, at(580)]).d;
    const s = live(d, 'sessions')[0]!;
    expect(s.overrunMs).toBe(10 * MIN);
    expect(s.blockId).not.toBeNull();
  });
});
