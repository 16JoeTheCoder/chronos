import { describe, expect, it } from 'vitest';
import { apply, type Command } from '../../src/core/commands';
import { boardCards, doingColumnId, focusSlotOverflow, neighbourColumn, planMove, stepWithin, summarize, type Move } from '../../src/core/board';
import type { Data } from '../../src/core/model/types';
import { addTask, ctx, fresh, run } from '../helpers';

function setup() {
  let { d, id: pid } = run(fresh(), { type: 'project.create', name: 'Wind' });
  const names = ['A', 'B', 'C', 'D'];
  const ids: Record<string, string> = {};
  for (const n of names) {
    const r = addTask(d, n, { projectId: pid, columnId: 'todo' });
    d = r.d;
    ids[n] = r.id;
  }
  return { d, pid, ids };
}

const asCmd = (m: Move): Command => ({ type: 'task.moveCard', id: m.id, columnId: m.columnId, beforeId: m.beforeId });
function exec(d: Data, moves: Move[]): Data {
  let out = d;
  for (const m of moves) {
    const r = apply(out, asCmd(m), ctx());
    if (!r.ok) throw new Error(r.error);
    out = r.d;
  }
  return out;
}
const titles = (d: Data, pid: string, col: string) => boardCards(d, d.projects[pid]!)[col]!.map((t) => t.title);

describe('board: focus slot', () => {
  it('finds the doing column', () => {
    const { d, pid } = setup();
    expect(doingColumnId(d.projects[pid]!.columns)).toBe('doing');
    expect(doingColumnId([{ id: 'x', name: ' DOING ' }])).toBe('x');
    expect(doingColumnId([{ id: 'x', name: 'Next' }])).toBeNull();
  });

  it('moves a card into an empty focus slot', () => {
    const { d, pid, ids } = setup();
    const plan = planMove(d, ids.B!, 'doing', null);
    if (!plan.ok) throw new Error(plan.error);
    expect(plan.swapped).toBeNull();
    const out = exec(d, plan.moves);
    expect(titles(out, pid, 'doing')).toEqual(['B']);
    expect(titles(out, pid, 'todo')).toEqual(['A', 'C', 'D']);
  });

  it('swaps when the slot is taken: the displaced card takes the old place', () => {
    const { d, pid, ids } = setup();
    const first = planMove(d, ids.B!, 'doing', null);
    if (!first.ok) throw new Error(first.error);
    const d1 = exec(d, first.moves);
    const plan = planMove(d1, ids.C!, 'doing', null);
    if (!plan.ok) throw new Error(plan.error);
    expect(plan.swapped?.title).toBe('B');
    const d2 = exec(d1, plan.moves);
    expect(titles(d2, pid, 'doing')).toEqual(['C']);
    // C was between A and D; B takes its place.
    expect(titles(d2, pid, 'todo')).toEqual(['A', 'B', 'D']);
    expect(focusSlotOverflow(d2, d2.projects[pid]!)).toEqual([]);
  });

  it('one undo restores both cards', () => {
    const { d, pid, ids } = setup();
    const d1 = exec(d, (planMove(d, ids.B!, 'doing', null) as { moves: Move[] }).moves);
    const plan = planMove(d1, ids.C!, 'doing', null);
    if (!plan.ok) throw new Error(plan.error);
    const d2 = exec(d1, plan.moves);
    const d3 = exec(d2, plan.undo);
    expect(titles(d3, pid, 'doing')).toEqual(['B']);
    expect(titles(d3, pid, 'todo')).toEqual(['A', 'C', 'D']);
  });

  it('never leaves two cards in the slot, whatever the order of drops', () => {
    const { d, pid, ids } = setup();
    let cur = d;
    for (const n of ['A', 'C', 'B', 'D', 'A']) {
      const plan = planMove(cur, ids[n]!, 'doing', null);
      if (plan.ok) cur = exec(cur, plan.moves);
      expect(titles(cur, pid, 'doing')).toHaveLength(1);
    }
    expect(titles(cur, pid, 'doing')).toEqual(['A']);
    expect(titles(cur, pid, 'todo').sort()).toEqual(['B', 'C', 'D']);
  });

  it('dropping the slot card on the slot is refused, and moving it out works', () => {
    const { d, pid, ids } = setup();
    const d1 = exec(d, (planMove(d, ids.A!, 'doing', null) as { moves: Move[] }).moves);
    expect(planMove(d1, ids.A!, 'doing', null).ok).toBe(false);
    const out = planMove(d1, ids.A!, 'done', null);
    expect(out.ok).toBe(true);
    expect(titles(exec(d1, (out as { moves: Move[] }).moves), pid, 'done')).toEqual(['A']);
  });

  it('reorders inside an ordinary column and refuses no-ops', () => {
    const { d, pid, ids } = setup();
    expect(planMove(d, ids.A!, 'todo', ids.B!).ok).toBe(false);
    const plan = planMove(d, ids.D!, 'todo', ids.A!);
    expect(titles(exec(d, (plan as { moves: Move[] }).moves), pid, 'todo')).toEqual(['D', 'A', 'B', 'C']);
  });

  it('flags overflow created outside the board', () => {
    const { d, pid, ids } = setup();
    const cur = exec(d, [{ id: ids.A!, columnId: 'doing', beforeId: null }, { id: ids.B!, columnId: 'doing', beforeId: null }]);
    expect(focusSlotOverflow(cur, cur.projects[pid]!).map((t) => t.title)).toEqual(['B']);
  });

  it('rejects unknown columns, cards and missing projects', () => {
    const { d, ids } = setup();
    expect(planMove(d, ids.A!, 'nope', null).ok).toBe(false);
    expect(planMove(d, 'nope', 'doing', null).ok).toBe(false);
    const loose = addTask(d, 'Loose');
    expect(planMove(loose.d, loose.id, 'doing', null).ok).toBe(false);
  });
});

describe('board: keyboard helpers and summary', () => {
  it('neighbourColumn and stepWithin', () => {
    const { d, pid, ids } = setup();
    const cols = d.projects[pid]!.columns;
    expect(neighbourColumn(cols, 'todo', 1)).toBe('doing');
    expect(neighbourColumn(cols, 'todo', -1)).toBeNull();
    expect(neighbourColumn(cols, 'done', 1)).toBeNull();
    const list = boardCards(d, d.projects[pid]!).todo!;
    expect(stepWithin(list, ids.A!, -1)).toBeNull();
    expect(stepWithin(list, ids.A!, 1)).toEqual({ beforeId: ids.C });
    expect(stepWithin(list, ids.D!, 1)).toBeNull();
    expect(stepWithin(list, ids.D!, -1)).toEqual({ beforeId: ids.C });
  });

  it('summarises done and estimated minutes left', () => {
    const { d, pid, ids } = setup();
    const out = exec(d, [{ id: ids.A!, columnId: 'done', beforeId: null }]);
    const s = summarize(out, out.projects[pid]!, 30);
    expect(s).toEqual({ total: 4, done: 1, leftMin: 90 });
  });
});
