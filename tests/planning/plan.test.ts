import { describe, expect, it } from 'vitest';
import { apply } from '../../src/core/commands';
import { autoBlockId } from '../../src/core/model/ids';
import type { Block, Data } from '../../src/core/model/types';
import { autoPlan, freeGaps, movableBlocks, replan } from '../../src/core/planning/plan';
import { live, update } from '../../src/core/repo/repo';
import { revertOpsBetween } from '../../src/core/undo';
import { addTask, at, ctx, fresh, MIN, run, T0, TODAY } from '../helpers';

const ev = (d: Data, title: string, startMin: number, endMin: number, date = TODAY) =>
  run(d, { type: 'event.create', input: { title, tagId: null, scope: 'other', tz: 'Asia/Jakarta', startMin, endMin, date, recur: null, notes: '' } }).d;
const blocks = (d: Data, date = TODAY): Block[] => live(d, 'blocks').filter((b) => b.date === date).sort((a, b) => a.startMin - b.startMin);
const spans = (d: Data, date = TODAY) => blocks(d, date).map((b) => `${b.title} ${b.startMin}-${b.endMin}${b.auto ? ' auto' : ''}`);

describe('free gaps', () => {
  it('today starts now, after fixed events, before the end-of-day buffer', () => {
    const d = ev(fresh(), 'Class', 600, 660);
    expect(freeGaps(d, TODAY, T0)).toEqual([{ startMin: 540, endMin: 600 }, { startMin: 660, endMin: 1290 }]);
  });
  it('snaps the start up to the snap size and skips slivers', () => {
    let d = run(fresh(), { type: 'settings.update', patch: { snapMin: 15 } }).d;
    d = ev(d, 'Class', 555, 600);
    expect(freeGaps(d, TODAY, T0 + 2 * MIN)).toEqual([{ startMin: 600, endMin: 1290 }]); // 09:02 -> 09:15, class at 09:15: no sliver
  });
  it('other days start at the day start; past days have none; existing blocks and unplaced events do not count', () => {
    let d = run(fresh(), { type: 'event.create', input: { title: 'Test', tagId: null, scope: 'other', tz: 'Asia/Jakarta', startMin: null, endMin: null, date: '2026-10-27', recur: null, notes: '' } }).d;
    expect(freeGaps(d, '2026-10-27', T0)).toEqual([{ startMin: 360, endMin: 1290 }]);
    expect(freeGaps(d, '2026-10-25', T0)).toEqual([]);
    const t = addTask(d, 'A');
    d = run(t.d, { type: 'block.create', taskId: t.id, date: '2026-10-27', startMin: 600, endMin: 660 }).d;
    expect(freeGaps(d, '2026-10-27', T0)).toEqual([{ startMin: 360, endMin: 600 }, { startMin: 660, endMin: 1290 }]);
  });
  it('honours the time-left variants (transition pad after fixed events)', () => {
    let d = run(fresh(), { type: 'settings.update', patch: { timeLeft: { gapFilterMin: 0, transitionMin: 10, mealReserveMin: 0 } } }).d;
    d = ev(d, 'Class', 600, 660);
    expect(freeGaps(d, TODAY, T0)).toEqual([{ startMin: 540, endMin: 600 }, { startMin: 670, endMin: 1290 }]);
  });
});

describe('auto-plan', () => {
  function world() {
    let d = ev(fresh(), 'Class', 600, 660); // 10:00-11:00 fixed
    d = addTask(d, 'Nice thing', { priority: 'nice', estimateMin: 30 }).d;
    d = addTask(d, 'Big must', { priority: 'must', estimateMin: 60 }).d;
    d = addTask(d, 'Quick should', { priority: 'should', estimateMin: 30 }).d;
    return d;
  }

  it('orders by priority and fills gaps first-fit around fixed events', () => {
    const r = autoPlan(world(), TODAY, ctx());
    // gaps: 09:00-10:00 and 11:00-21:30. must(60) takes the first gap whole, then should(30) and nice(30) go after the class.
    expect(spans(r.d)).toEqual(['Big must 540-600 auto', 'Quick should 660-690 auto', 'Nice thing 690-720 auto']);
    expect(r.unplaced).toEqual([]);
    expect(r.placed.map((p) => p.title)).toEqual(['Big must', 'Quick should', 'Nice thing']);
  });

  it('breaks priority ties by due date, then sortKey; tasks without a due date go last', () => {
    let d = fresh();
    d = addTask(d, 'No due first created', { estimateMin: 30 }).d;
    d = addTask(d, 'Due later', { estimateMin: 30, dueDate: '2026-10-30' }).d;
    d = addTask(d, 'Due sooner', { estimateMin: 30, dueDate: '2026-10-27' }).d;
    d = addTask(d, 'No due second created', { estimateMin: 30 }).d;
    expect(autoPlan(d, TODAY, ctx()).placed.map((p) => p.title)).toEqual(['Due sooner', 'Due later', 'No due first created', 'No due second created']);
  });

  it('uses the default block (30) and learned estimates for tasks without one', () => {
    const r = autoPlan(addTask(fresh(), 'No estimate').d, TODAY, ctx());
    expect(r.placed[0]).toMatchObject({ startMin: 540, endMin: 570 });
  });

  it('never moves or touches a manual block, and plans around it', () => {
    let d = addTask(fresh(), 'Manual task').d;
    const manualTask = Object.values(d.tasks)[0]!;
    d = run(d, { type: 'block.create', taskId: manualTask.id, date: TODAY, startMin: 540, endMin: 600 }).d;
    d = addTask(d, 'Auto task', { estimateMin: 30 }).d;
    const manual = blocks(d)[0]!;
    const r = autoPlan(d, TODAY, ctx());
    expect(r.d.blocks[manual.id]).toBe(manual); // same object: not even rewritten
    expect(spans(r.d)).toEqual(['Manual task 540-600', 'Auto task 600-630 auto']);
  });

  it('skips tasks that already have a block today or later, started, done and dropped tasks', () => {
    let d = fresh();
    const planned = addTask(d, 'Planned', { estimateMin: 30 });
    d = run(planned.d, { type: 'block.create', taskId: planned.id, date: '2026-10-28', startMin: 600, endMin: 630 }).d;
    const started = addTask(d, 'Started');
    d = update(started.d, 'tasks', started.id, { startedAt: T0 - 5 * MIN }, ctx());
    const done = addTask(d, 'Done');
    d = update(done.d, 'tasks', done.id, { status: 'done', outcome: 'finished', completedAt: T0 }, ctx());
    const gone = addTask(d, 'Dropped');
    d = update(gone.d, 'tasks', gone.id, { status: 'dropped' }, ctx());
    d = addTask(d, 'Free', { estimateMin: 30 }).d;
    expect(autoPlan(d, TODAY, ctx()).placed.map((p) => p.title)).toEqual(['Free']);
  });

  it('stops at the end-of-day buffer and reports what did not fit', () => {
    let d = ev(fresh(), 'Long', 540, 1260); // leaves 21:00-21:30 free
    d = addTask(d, 'A', { estimateMin: 25, priority: 'must' }).d;
    d = addTask(d, 'B', { estimateMin: 25 }).d;
    const r = autoPlan(d, TODAY, ctx());
    expect(r.placed.map((p) => p.title)).toEqual(['A']);
    expect(r.unplaced).toHaveLength(1);
    expect(Math.max(...blocks(r.d).map((b) => b.endMin))).toBeLessThanOrEqual(1290);
  });

  it('creates auto blocks with deterministic ids, and running it twice adds nothing', () => {
    const d = addTask(fresh(), 'A', { estimateMin: 30 });
    const r = autoPlan(d.d, TODAY, ctx());
    expect(r.placed[0]?.blockId).toBe(autoBlockId(d.id, TODAY));
    expect(r.d.blocks[autoBlockId(d.id, TODAY)]).toMatchObject({ auto: true, taskId: d.id, kind: 'work', date: TODAY });
    const again = autoPlan(r.d, TODAY, ctx());
    expect(again.placed).toEqual([]);
    expect(live(again.d, 'blocks')).toHaveLength(1);
  });

  it('plans a later day from its day start', () => {
    const r = autoPlan(addTask(fresh(), 'A', { estimateMin: 30 }).d, '2026-10-27', ctx());
    expect(r.placed[0]).toMatchObject({ startMin: 360, endMin: 390 });
  });
});

describe('plan.auto command', () => {
  const d0 = () => {
    let d = ev(fresh(), 'Class', 600, 660);
    d = addTask(d, 'A', { estimateMin: 60, priority: 'must' }).d;
    return addTask(d, 'B', { estimateMin: 30 }).d;
  };

  it('is one commit that fills the day, marks tasks planned and returns one undo for all of it', () => {
    const before = d0();
    const r = apply(before, { type: 'plan.auto' }, ctx());
    if (!r.ok) throw new Error(r.error);
    expect(r.id).toBe('2');
    expect(blocks(r.d)).toHaveLength(2);
    expect(Object.values(r.d.tasks).every((t) => t.status === 'planned' || t.status === 'doing')).toBe(true);
    expect(r.undo?.length).toBeGreaterThan(0);
    const back = apply(r.d, { type: 'records.revert', ops: r.undo! }, ctx(T0 + MIN));
    if (!back.ok) throw new Error(back.error);
    expect(blocks(back.d)).toEqual([]);
    for (const t of Object.values(before.tasks)) expect(back.d.tasks[t.id]?.status, t.title).toBe(t.status);
  });

  it('undo leaves manual blocks alone', () => {
    let d = d0();
    const t = Object.values(d.tasks)[0]!;
    d = run(d, { type: 'block.create', taskId: t.id, date: TODAY, startMin: 700, endMin: 760 }).d;
    const r = apply(d, { type: 'plan.auto' }, ctx());
    if (!r.ok) throw new Error(r.error);
    const back = apply(r.d, { type: 'records.revert', ops: r.undo! }, ctx(T0 + MIN));
    if (!back.ok) throw new Error(back.error);
    expect(spans(back.d)).toEqual(['A 700-760']);
  });

  it('refuses a past date; the undo ops equal revertOpsBetween', () => {
    expect(apply(d0(), { type: 'plan.auto', date: '2026-10-25' }, ctx()).ok).toBe(false);
    const d = d0();
    const r = apply(d, { type: 'plan.auto' }, ctx());
    if (!r.ok) throw new Error(r.error);
    expect(r.undo).toEqual(revertOpsBetween(d, r.d, T0));
  });
});

describe('re-plan', () => {
  /** A, B auto-planned from 09:00; a manual block at 10:30-11:30. */
  function planned() {
    let d = addTask(fresh(), 'A', { estimateMin: 30, priority: 'must' }).d;
    d = addTask(d, 'B', { estimateMin: 30 }).d;
    const m = addTask(d, 'Manual', { priority: 'nice' });
    d = run(m.d, { type: 'block.create', taskId: m.id, date: TODAY, startMin: 630, endMin: 690 }).d;
    return autoPlan(d, TODAY, ctx()).d;
  }
  const idOf = (d: Data, title: string) => Object.values(d.tasks).find((t) => t.title === title)!.id;

  it('moves missed auto blocks forward, in order, into the gaps that remain; the manual block stays', () => {
    const d = planned();
    expect(spans(d)).toEqual(['A 540-570 auto', 'B 570-600 auto', 'Manual 630-690']);
    const r = replan(d, TODAY, ctx(at(620))); // 10:20
    expect(r.moved.map((m) => [m.startMin, m.endMin])).toEqual([[690, 720], [720, 750]]);
    expect(r.stuck).toEqual([]);
    expect(spans(r.d)).toEqual(['Manual 630-690', 'A 690-720 auto', 'B 720-750 auto']);
    expect(r.d.blocks[blocks(d).find((b) => b.title === 'Manual')!.id]).toBe(blocks(d).find((b) => b.title === 'Manual')!);
  });

  it('uses a gap before the manual block when there is room', () => {
    const r = replan(planned(), TODAY, ctx(at(9 * 60 + 40))); // 09:40: A (09:00-09:30) missed, B (09:30-10:00) in progress
    expect(r.moved.map((m) => [m.startMin, m.endMin])).toEqual([[600, 630]]);
    expect(spans(r.d)).toEqual(['B 570-600 auto', 'A 600-630 auto', 'Manual 630-690']);
  });

  it('leaves in-progress, started, finished and future auto blocks alone', () => {
    let d = planned();
    expect(replan(d, TODAY, ctx(at(560))).moved).toEqual([]); // 09:20: A is in progress
    d = update(d, 'tasks', idOf(d, 'A'), { startedAt: T0 }, ctx());
    d = update(d, 'tasks', idOf(d, 'B'), { status: 'done', outcome: 'finished', completedAt: T0 }, ctx());
    expect(replan(d, TODAY, ctx(at(620))).moved).toEqual([]);
    expect(movableBlocks(planned(), TODAY, at(535))).toEqual([]); // before the first block starts
  });

  it('a missed manual block is never moved', () => {
    const d = planned();
    const r = replan(d, TODAY, ctx(at(1000))); // 16:40: everything is behind us
    expect(r.moved.map((m) => m.taskId)).toEqual([idOf(d, 'A'), idOf(d, 'B')]);
    expect(spans(r.d)).toContain('Manual 630-690');
  });

  it('reports blocks that find no room and leaves them where they are', () => {
    let d = planned();
    d = ev(d, 'All evening', 1000, 1290);
    const r = replan(d, TODAY, ctx(at(1000)));
    expect(r.moved).toEqual([]);
    expect(r.stuck).toHaveLength(2);
    expect(spans(r.d)).toEqual(spans(d));
  });

  it('only acts on today', () => {
    expect(replan(planned(), '2026-10-27', ctx(at(1000))).moved).toEqual([]);
  });

  it('plan.replan is one command with one undo', () => {
    const d = planned();
    const r = apply(d, { type: 'plan.replan' }, ctx(at(620)));
    if (!r.ok) throw new Error(r.error);
    expect(r.id).toBe('2');
    const back = apply(r.d, { type: 'records.revert', ops: r.undo! }, ctx(at(621)));
    if (!back.ok) throw new Error(back.error);
    expect(spans(back.d)).toEqual(spans(d));
  });
});
