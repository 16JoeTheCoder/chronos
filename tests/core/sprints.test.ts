// Sprint checkpoints (§6.7): continue, ship (finish ritual), kill (typed reason).
import { describe, expect, it } from 'vitest';
import { apply } from '../../src/core/commands';
import { checkpointDue } from '../../src/core/tasks/sprints';
import { metrics } from '../../src/core/tasks/metrics';
import { ctx, fresh, HOUR, MIN, run, T0 } from '../helpers';

function sprint() {
  return run(fresh(), { type: 'task.create', input: { kind: 'sprint', title: 'Prototype', finishCondition: 'Demo runs end to end', checkpointEveryMin: 60 } }, { type: 'timer', action: 'start' });
}

describe('sprints', () => {
  it('defaults to a stopwatch and raises a checkpoint after each interval of work', () => {
    const { d, id } = sprint();
    const t = d.tasks[id]!;
    expect(t.timer.mode).toBe('stopwatch');
    expect(checkpointDue(t, T0 + 59 * MIN)).toBe(false);
    expect(checkpointDue(t, T0 + HOUR)).toBe(true);
    const c = run(d, [{ type: 'sprint.checkpoint', id, choice: 'continue' }, T0 + HOUR]).d;
    expect(checkpointDue(c.tasks[id]!, T0 + HOUR + 30 * MIN)).toBe(false);
    expect(checkpointDue(c.tasks[id]!, T0 + 2 * HOUR)).toBe(true);
  });

  it('ship runs the finish ritual; kill needs a reason', () => {
    const { d, id } = sprint();
    const shipped = run(d, [{ type: 'task.finish', id, phrase: 'I have finished this task' }, T0 + HOUR]).d;
    expect(shipped.tasks[id]?.outcome).toBe('shipped');
    expect(apply(d, { type: 'sprint.checkpoint', id, choice: 'kill', reason: '' }, ctx(T0 + HOUR)).ok).toBe(false);
    const killed = run(d, [{ type: 'sprint.checkpoint', id, choice: 'kill', reason: 'Idea does not hold up' }, T0 + HOUR]).d;
    expect(killed.tasks[id]?.outcome).toBe('killed');
    expect(killed.tasks[id]?.status).toBe('done');
    expect(metrics(killed, T0 + HOUR).sprints).toEqual({ shipped: 0, killed: 1, active: 0 });
  });
});
