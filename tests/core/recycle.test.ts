// Purge: content wiped at 7 days (stub kept), stub dropped at 60 days.
import { describe, expect, it } from 'vitest';
import { purge, recycled } from '../../src/core/repo/recycle';
import { addTask, fresh, run, T0 } from '../helpers';

const DAY = 86_400_000;

describe('recycle and purge', () => {
  it('lists, wipes after 7 days and drops the stub after 60', () => {
    const { d, id } = addTask(fresh(), 'Secret plan');
    const gone = run(d, { type: 'recycle', coll: 'tasks', id, confirmed: true }).d;
    expect(recycled(gone).map((x) => x.rec.id)).toEqual([id]);
    expect(purge(gone, T0 + 6 * DAY, 'devA')).toBe(gone);
    const wiped = purge(gone, T0 + 7 * DAY, 'devA');
    expect(wiped.tasks[id]).toBeUndefined();
    expect(wiped.tombs.tasks?.[id]).toMatchObject({ id, purged: true, deletedAt: T0 });
    expect(JSON.stringify(wiped)).not.toContain('Secret plan');
    expect(purge(wiped, T0 + 60 * DAY, 'devA').tombs.tasks?.[id]).toBeUndefined();
  });
});
