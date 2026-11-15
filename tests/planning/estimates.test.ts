import { describe, expect, it } from 'vitest';
import { sessionId } from '../../src/core/model/ids';
import type { Data } from '../../src/core/model/types';
import { actualFocusMin, estimateFor, estimateMin, similarFinished } from '../../src/core/planning/estimates';
import { create, update } from '../../src/core/repo/repo';
import { addTask, ctx, fresh, MIN, run, T0 } from '../helpers';

/** A finished task that took `workMin` minutes, completed `n` minutes after T0 (later n = more recent). */
function finished(d: Data, title: string, workMin: number, n: number, extra: Record<string, unknown> = {}): { d: Data; id: string } {
  const t = addTask(d, title, extra);
  const out = update(t.d, 'tasks', t.id, { status: 'done', outcome: 'finished', completedAt: T0 + n * MIN, workMs: workMin * MIN }, ctx());
  return { d: out, id: t.id };
}

describe('estimates', () => {
  it('uses the task estimate when set', () => {
    const t = addTask(fresh(), 'A', { estimateMin: 50 });
    expect(estimateFor(t.d, t.d.tasks[t.id]!)).toEqual({ min: 50, source: 'set', samples: 0 });
  });

  it('falls back to planning.defaultBlockMin (30, and what the user set)', () => {
    const t = addTask(fresh(), 'A');
    expect(estimateFor(t.d, t.d.tasks[t.id]!)).toEqual({ min: 30, source: 'default', samples: 0 });
    const d = run(t.d, { type: 'settings.update', patch: { planning: { defaultBlockMin: 45, learnEstimates: true, breakAfterMin: 75 } } }).d;
    expect(estimateMin(d, d.tasks[t.id]!)).toBe(45);
  });

  it('learns the median of finished tasks with the same project (3+ samples)', () => {
    let d = fresh();
    const p = run(d, { type: 'project.create', name: 'Chronos' });
    d = p.d;
    for (const [i, m] of [20, 40, 60].entries()) d = finished(d, `done ${i}`, m, i, { projectId: p.id }).d;
    const t = addTask(d, 'New', { projectId: p.id });
    expect(estimateFor(t.d, t.d.tasks[t.id]!)).toEqual({ min: 40, source: 'learned', samples: 3 });
  });

  it('needs at least 3 samples', () => {
    let d = fresh();
    const p = run(d, { type: 'project.create', name: 'Chronos' });
    d = p.d;
    for (const [i, m] of [20, 40].entries()) d = finished(d, `done ${i}`, m, i, { projectId: p.id }).d;
    const t = addTask(d, 'New', { projectId: p.id });
    expect(estimateFor(t.d, t.d.tasks[t.id]!).source).toBe('default');
  });

  it('matches by tag too, and ignores other projects, tags, killed and unmeasured tasks', () => {
    let d = fresh();
    const tag = run(d, { type: 'tag.create', input: { name: 'Math', color: 'tag1', kind: 'class' } });
    const other = run(tag.d, { type: 'tag.create', input: { name: 'Home', color: 'tag2', kind: 'general' } });
    d = other.d;
    for (const [i, m] of [30, 30, 90].entries()) d = finished(d, `math ${i}`, m, i, { tagId: tag.id }).d;
    d = finished(d, 'home', 5, 10, { tagId: other.id }).d;
    d = finished(d, 'unmeasured', 0, 11, { tagId: tag.id }).d;
    const killed = finished(d, 'killed', 500, 12, { tagId: tag.id });
    d = update(killed.d, 'tasks', killed.id, { outcome: 'killed' }, ctx());
    const t = addTask(d, 'New math', { tagId: tag.id });
    expect(estimateFor(t.d, t.d.tasks[t.id]!)).toEqual({ min: 30, source: 'learned', samples: 3 });
  });

  it('uses only the last 5 finished, newest first', () => {
    let d = fresh();
    const p = run(d, { type: 'project.create', name: 'X' });
    d = p.d;
    // oldest two are huge and must be ignored; the last five are 10,20,30,40,50 -> median 30
    for (const [i, m] of [300, 300, 10, 20, 30, 40, 50].entries()) d = finished(d, `t${i}`, m, i, { projectId: p.id }).d;
    const t = addTask(d, 'New', { projectId: p.id });
    expect(similarFinished(t.d, t.d.tasks[t.id]!)).toHaveLength(5);
    expect(estimateFor(t.d, t.d.tasks[t.id]!)).toMatchObject({ min: 30, samples: 5 });
  });

  it('rounds to 5 minutes and stays within 5-480', () => {
    let d = fresh();
    const p = run(d, { type: 'project.create', name: 'X' });
    d = p.d;
    for (const [i, m] of [22, 23, 24].entries()) d = finished(d, `t${i}`, m, i, { projectId: p.id }).d;
    let t = addTask(d, 'New', { projectId: p.id });
    expect(estimateMin(t.d, t.d.tasks[t.id]!)).toBe(25);
    for (const [i, m] of [1, 1, 1].entries()) d = finished(d, `s${i}`, m, 20 + i, { projectId: p.id }).d;
    t = addTask(d, 'Newer', { projectId: p.id });
    expect(estimateMin(t.d, t.d.tasks[t.id]!)).toBe(5);
  });

  it('learnEstimates off means the default', () => {
    let d = fresh();
    const p = run(d, { type: 'project.create', name: 'X' });
    d = p.d;
    for (const [i, m] of [60, 60, 60].entries()) d = finished(d, `t${i}`, m, i, { projectId: p.id }).d;
    d = run(d, { type: 'settings.update', patch: { planning: { defaultBlockMin: 30, learnEstimates: false, breakAfterMin: 75 } } }).d;
    const t = addTask(d, 'New', { projectId: p.id });
    expect(estimateFor(t.d, t.d.tasks[t.id]!).source).toBe('default');
  });

  it('actual focus time is the larger of tracked time and recorded sessions', () => {
    const f = finished(fresh(), 'A', 10, 0);
    expect(actualFocusMin(f.d, f.d.tasks[f.id]!)).toBe(10);
    const d = create(f.d, 'sessions', { taskId: f.id, blockId: null, startedAt: T0, endedAt: T0 + 25 * MIN, phase: 'work', overrunMs: 0 }, ctx(), sessionId(f.id, T0)).d;
    expect(actualFocusMin(d, d.tasks[f.id]!)).toBe(25);
  });
});
