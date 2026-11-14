import { describe, expect, it } from 'vitest';
import { apply } from '../../src/core/commands';
import { reviewId } from '../../src/core/model/ids';
import type { Data } from '../../src/core/model/types';
import { isReviewed, pendingReview, reviewCandidates, reviewDueAt } from '../../src/core/planning/review';
import { live, update } from '../../src/core/repo/repo';
import { addTask, at, ctx, fresh, MIN, run, T0, TODAY } from '../helpers';

const TOMORROW = '2026-10-27';
const EVENING = at(21 * 60 + 30); // 21:30 = dayEnd 22:00 - buffer 30

/** Four tasks planned today, a fifth overdue and unplanned, a sixth already done. */
function day() {
  let d: Data = fresh();
  const ids: Record<string, string> = {};
  for (const [key, extra] of Object.entries({
    done: { priority: 'must' },
    tomorrow: { priority: 'should', estimateMin: 45 },
    later: { priority: 'nice' },
    drop: { priority: 'nice', dueDate: TODAY },
    overdue: { dueDate: '2026-10-20' },
  })) {
    const t = addTask(d, key, extra);
    d = t.d;
    ids[key] = t.id;
  }
  for (const [key, start] of [['done', 540], ['tomorrow', 600], ['later', 660]] as const) d = run(d, { type: 'block.create', taskId: ids[key]!, date: TODAY, startMin: start, endMin: start + 30 }).d;
  const fin = addTask(d, 'finished earlier');
  d = update(fin.d, 'tasks', fin.id, { status: 'done', outcome: 'finished', completedAt: T0 }, ctx());
  return { d, ids };
}

describe('who is asked', () => {
  it('open tasks planned today or due by today, most important first; not finished ones', () => {
    const { d, ids } = day();
    expect(reviewCandidates(d, TODAY).map((t) => t.id)).toEqual([ids.done, ids.overdue, ids.tomorrow, ids.drop, ids.later]);
  });
  it('is not due before dayEnd - buffer, due after, and on demand', () => {
    const { d } = day();
    expect(reviewDueAt(d, TODAY)).toBe(EVENING);
    expect(pendingReview(d, EVENING - MIN)).toBeNull();
    expect(pendingReview(d, EVENING)?.date).toBe(TODAY);
    expect(pendingReview(d, T0, true)?.tasks).toHaveLength(5);
  });
  it('asks nothing when nothing is unfinished', () => {
    expect(pendingReview(fresh(), EVENING, true)).toBeNull();
  });
  it('does not ask again about an overdue task that was parked as unscheduled', () => {
    const { d, ids } = day();
    const r = run(d, { type: 'review.submit', date: '2026-10-25', outcomes: [{ taskId: ids.overdue!, action: 'unscheduled' }] }).d;
    expect(reviewCandidates(r, TODAY).map((t) => t.id)).not.toContain(ids.overdue);
  });
  it('leaves the task being timed right now alone', () => {
    const { d, ids } = day();
    const t = d.tasks[ids.done!]!;
    const running = update(d, 'tasks', t.id, { runtime: { ...t.runtime, status: 'running', sliceStartedAt: T0 } }, ctx());
    expect(reviewCandidates(running, TODAY).map((x) => x.id)).not.toContain(t.id);
  });
});

describe('review.submit', () => {
  const answers = (ids: Record<string, string>) => [
    { taskId: ids.done!, action: 'done' as const },
    { taskId: ids.tomorrow!, action: 'tomorrow' as const },
    { taskId: ids.later!, action: 'unscheduled' as const },
    { taskId: ids.drop!, action: 'dropped' as const },
  ];

  it('applies every answer and writes review-<date>', () => {
    const { d, ids } = day();
    const r = apply(d, { type: 'review.submit', date: TODAY, outcomes: answers(ids) }, ctx(EVENING));
    if (!r.ok) throw new Error(r.error);
    const t = r.d.tasks;
    expect(t[ids.done!]).toMatchObject({ status: 'done', outcome: 'finished' });
    expect(t[ids.drop!]).toMatchObject({ status: 'dropped' });
    expect(t[ids.later!]?.status).toBe('inbox');
    expect(['planned', 'doing']).toContain(t[ids.tomorrow!]?.status);
    const todays = live(r.d, 'blocks').filter((b) => b.date === TODAY);
    expect(todays.map((b) => b.taskId)).toEqual([ids.done]); // the finished task keeps its block as history
    const tm = live(r.d, 'blocks').filter((b) => b.date === TOMORROW);
    expect(tm).toHaveLength(1);
    expect(tm[0]).toMatchObject({ taskId: ids.tomorrow, auto: true, startMin: 360, endMin: 405 });
    expect(r.d.reviews[reviewId(TODAY)]).toMatchObject({ id: 'review-2026-10-26', date: TODAY, outcomes: answers(ids) });
    expect(r.id).toBe('review-2026-10-26');
    expect(live(r.d, 'activity').some((a) => a.type === 'dropped' && a.taskId === ids.drop)).toBe(true);
  });

  it('is asked once: afterwards nothing is pending, and a second submit is refused', () => {
    const { d, ids } = day();
    const r = run(d, [{ type: 'review.submit', date: TODAY, outcomes: answers(ids) }, EVENING]);
    expect(isReviewed(r.d, TODAY)).toBe(true);
    expect(pendingReview(r.d, EVENING, true)).toBeNull();
    expect(apply(r.d, { type: 'review.submit', date: TODAY, outcomes: [] }, ctx(EVENING)).ok).toBe(false);
  });

  it('never prompts twice across devices: both write the same document id, and the synced one hides the prompt', () => {
    const { d, ids } = day();
    const a = apply(d, { type: 'review.submit', date: TODAY, outcomes: answers(ids) }, ctx(EVENING, 'devA'));
    const b = apply(d, { type: 'review.submit', date: TODAY, outcomes: [{ taskId: ids.done!, action: 'done' }] }, ctx(EVENING + MIN, 'devB'));
    if (!a.ok || !b.ok) throw new Error('submit failed');
    expect(Object.keys(a.d.reviews)).toEqual(['review-2026-10-26']);
    expect(Object.keys(b.d.reviews)).toEqual(Object.keys(a.d.reviews));
    // device B receives A's review (same id): it is reviewed and not prompted
    const synced = { ...d, reviews: a.d.reviews };
    expect(pendingReview(synced, EVENING + 5 * MIN, true)).toBeNull();
    expect(apply(synced, { type: 'review.submit', date: TODAY, outcomes: [] }, ctx(EVENING + 5 * MIN, 'devB')).ok).toBe(false);
  });

  it('is undone as one action', () => {
    const { d, ids } = day();
    const r = apply(d, { type: 'review.submit', date: TODAY, outcomes: answers(ids) }, ctx(EVENING));
    if (!r.ok) throw new Error(r.error);
    const back = apply(r.d, { type: 'records.revert', ops: r.undo! }, ctx(EVENING + MIN));
    if (!back.ok) throw new Error(back.error);
    expect(live(back.d, 'reviews')).toEqual([]);
    for (const k of ['done', 'tomorrow', 'later', 'drop'] as const) expect(back.d.tasks[ids[k]!]?.status, k).toBe(d.tasks[ids[k]!]?.status);
    expect(live(back.d, 'blocks').map((b) => `${b.taskId}${b.date}${b.startMin}`).sort()).toEqual(live(d, 'blocks').map((b) => `${b.taskId}${b.date}${b.startMin}`).sort());
  });

  it('keeps a task unscheduled when tomorrow has no room', () => {
    let { d, ids } = day();
    d = run(d, { type: 'event.create', input: { title: 'Trip', tagId: null, scope: 'other', tz: 'Asia/Jakarta', startMin: 360, endMin: 1320, date: TOMORROW, recur: null, notes: '' } }).d;
    const r = run(d, [{ type: 'review.submit', date: TODAY, outcomes: [{ taskId: ids.tomorrow!, action: 'tomorrow' }] }, EVENING]);
    expect(live(r.d, 'blocks').filter((b) => b.taskId === ids.tomorrow)).toEqual([]);
    expect(r.d.tasks[ids.tomorrow!]?.status).toBe('inbox');
    expect(r.d.reviews[reviewId(TODAY)]).toBeDefined();
  });

  it('rejects bad answers and ignores tasks that were already closed elsewhere', () => {
    const { d, ids } = day();
    const bad = (outcomes: unknown) => apply(d, { type: 'review.submit', date: TODAY, outcomes: outcomes as never }, ctx(EVENING)).ok;
    expect(bad([{ taskId: ids.done, action: 'later' }])).toBe(false);
    expect(bad([{ taskId: ids.done, action: 'done' }, { taskId: ids.done, action: 'dropped' }])).toBe(false);
    expect(bad([{ taskId: '', action: 'done' }])).toBe(false);
    expect(apply(d, { type: 'review.submit', date: 'x', outcomes: [] }, ctx(EVENING)).ok).toBe(false);
    const closed = update(d, 'tasks', ids.done!, { status: 'done', outcome: 'finished', completedAt: T0 }, ctx());
    expect(apply(closed, { type: 'review.submit', date: TODAY, outcomes: [{ taskId: ids.done!, action: 'dropped' }] }, ctx(EVENING)).ok).toBe(true);
  });
});
