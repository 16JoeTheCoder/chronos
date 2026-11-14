import { describe, expect, it } from 'vitest';
import { sessionId } from '../../src/core/model/ids';
import type { Data } from '../../src/core/model/types';
import { BREAK_GAP_MIN, breakDue, focusChains, PROMPT_WINDOW_MIN } from '../../src/core/planning/wellness';
import { create, update } from '../../src/core/repo/repo';
import { addTask, at, ctx, fresh, MIN, run } from '../helpers';

/** One task with a block 09:00-10:30 (90 min) and the given work stretches (minutes after midnight). */
function world(stretches: [number, number][], block: [number, number] = [540, 630]) {
  const t = addTask(fresh(), 'Deep work');
  let d: Data = run(t.d, { type: 'block.create', taskId: t.id, date: '2026-10-26', startMin: block[0], endMin: block[1] }).d;
  for (const [s, e] of stretches) d = create(d, 'sessions', { taskId: t.id, blockId: null, startedAt: at(s), endedAt: at(e), phase: 'work', overrunMs: 0 }, ctx(), sessionId(t.id, at(s))).d;
  return { d, id: t.id, blockId: Object.values(d.blocks)[0]!.id };
}

describe('focus chains', () => {
  it('merges work across gaps shorter than 5 minutes, splits at 5 or more; breaks never join', () => {
    const { d } = world([[540, 580], [582, 600], [605, 620]]);
    expect(focusChains(d, at(700)).map((c) => [c.start, c.end].map((x) => (x - at(0)) / MIN))).toEqual([[540, 600], [605, 620]]);
    expect(BREAK_GAP_MIN).toBe(5);
  });
  it('counts the slice running now', () => {
    const { d, id } = world([]);
    const t = d.tasks[id]!;
    const running = update(d, 'tasks', id, { runtime: { ...t.runtime, status: 'running', sliceStartedAt: at(540) } }, ctx());
    expect(focusChains(running, at(600))).toEqual([{ start: at(540), end: at(600) }]);
  });
});

describe('break prompt', () => {
  it('appears when a block ends after 75+ min of continuous focus', () => {
    const { d, blockId } = world([[540, 630]]);
    const p = breakDue(d, at(631));
    expect(p).toMatchObject({ blockId, focusedMin: 90, blockEndedAt: at(630) });
  });
  it('never mid-block', () => {
    const { d } = world([[540, 630]]);
    expect(breakDue(d, at(600))).toBeNull();
    expect(breakDue(d, at(629))).toBeNull();
    expect(breakDue(d, at(540))).toBeNull();
  });
  it('not for a short block, and the threshold follows planning.breakAfterMin', () => {
    const short = world([[540, 600]], [540, 600]);
    expect(breakDue(short.d, at(601))).toBeNull();
    const d = run(short.d, { type: 'settings.update', patch: { planning: { defaultBlockMin: 30, learnEstimates: true, breakAfterMin: 45 } } }).d;
    expect(breakDue(d, at(601))?.focusedMin).toBe(60);
  });
  it('a 2-minute pause keeps the focus continuous; a 6-minute gap does not', () => {
    expect(breakDue(world([[540, 580], [582, 630]]).d, at(631))?.focusedMin).toBe(90);
    expect(breakDue(world([[540, 570], [576, 630]]).d, at(631))).toBeNull(); // 54 min since the last break
  });
  it('is not offered when the block ended with no focus in it', () => {
    expect(breakDue(world([]).d, at(631))).toBeNull();
  });
  it('is not offered inside the next block (back to back)', () => {
    const w = world([[540, 630]]);
    const t2 = addTask(w.d, 'Next');
    const d = run(t2.d, { type: 'block.create', taskId: t2.id, date: '2026-10-26', startMin: 630, endMin: 690 }).d;
    expect(breakDue(d, at(631))).toBeNull();
  });
  it('lapses after the window or once the user has rested 5 minutes, and is not repeated once shown', () => {
    const { d, blockId } = world([[540, 630]]);
    expect(breakDue(d, at(630 + 4))).not.toBeNull();
    expect(breakDue(d, at(630 + BREAK_GAP_MIN))).toBeNull();
    expect(breakDue(d, at(630 + PROMPT_WINDOW_MIN + 1))).toBeNull();
    expect(breakDue(d, at(631), new Set([blockId]))).toBeNull();
  });
  it('counts the running slice when the timer continues past the block end', () => {
    const { d, id, blockId } = world([]);
    const t = d.tasks[id]!;
    const running = update(d, 'tasks', id, { runtime: { ...t.runtime, status: 'running', sliceStartedAt: at(540) } }, ctx());
    expect(breakDue(running, at(635))).toMatchObject({ blockId, focusedMin: 90 });
  });
});
