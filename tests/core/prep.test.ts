// Prep nudges (§6.5): explicit (dueEventId) and implicit (same tag, deadline by the event date).
import { describe, expect, it } from 'vitest';
import { prepNudges } from '../../src/core/time/prep';
import { addTask, at, fresh, run, TZ } from '../helpers';

describe('prepNudges', () => {
  it('finds tasks due before a tagged event and flags tight ones', () => {
    const tag = run(fresh(), { type: 'tag.create', input: { name: 'Physics', color: 'tag1', kind: 'class' } });
    let { d, id: evId } = run(tag.d, { type: 'event.create', input: { title: 'Physics', tagId: tag.id, scope: 'school', tz: TZ, startMin: 640, endMin: 700, date: '2026-10-26', recur: null, notes: '' } });
    const explicit = addTask(d, 'Worksheet', { estimateMin: 25, dueEventId: evId });
    const implicit = addTask(explicit.d, 'Read chapter', { estimateMin: 120, tagId: tag.id, deadline: '2026-10-26' });
    d = addTask(implicit.d, 'Unrelated', { estimateMin: 30, tagId: tag.id }).d; // no deadline: not implicit
    const n = prepNudges(d, at(600));
    expect(n.map((x) => x.task.title).sort()).toEqual(['Read chapter', 'Worksheet']);
    const ws = n.find((x) => x.task.title === 'Worksheet')!;
    expect(ws.freeBeforeMin).toBe(40);
    expect(ws.needsMin).toBe(25);
    expect(ws.tight).toBe(false);
    expect(n.find((x) => x.task.title === 'Read chapter')?.tight).toBe(true);
  });
});
