// Focus metrics (§6.8): this week's started/finished/dropped, focused time today and this week.
import { describe, expect, it } from 'vitest';
import { metrics } from '../../src/core/tasks/metrics';
import { addTask, at, fresh, MIN, run } from '../helpers';

describe('metrics', () => {
  it('counts the week from Monday and focus including the live slice', () => {
    let a = addTask(fresh(), 'A', { estimateMin: 10 });
    let d = run(a.d, [{ type: 'timer', action: 'start' }, at(540)], [{ type: 'task.finish', id: a.id, phrase: 'I have finished this task' }, at(560)]).d;
    const b = addTask(d, 'B');
    d = run(b.d, [{ type: 'timer', action: 'start' }, at(600)]).d;
    const m = metrics(d, at(630));
    expect(m).toMatchObject({ started: 2, finished: 1, dropped: 0, finishedToday: 1 });
    expect(m.focusTodayMs).toBe(50 * MIN);
    expect(m.focusWeekMs).toBe(50 * MIN);
    expect(metrics(d, at(630, '2026-11-02')).finished).toBe(0); // next week
  });
});
