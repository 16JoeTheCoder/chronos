// Search filters, phrases, highlight, calendar marks, edited flag, windowing.
import { describe, expect, it } from 'vitest';
import { dayMarks, EDITED_AFTER_MS, feedOf, highlight, indexForDay, isEdited, monthGrid, parseQuery, searchLog, shiftMonth, visibleRange } from '../../src/core/log';
import { SearchIndex } from '../../src/core/search';
import type { Data } from '../../src/core/model/types';
import { apply } from '../../src/core/commands';
import { at, ctx, fresh, run, TZ } from '../helpers';

const TODAY = '2026-10-26';
function world() {
  let d: Data = fresh();
  const proj = run(d, { type: 'project.create', name: 'Robotics club' });
  d = proj.d;
  const post = (text: string, date: string, projectId: string | null = null) => {
    const r = apply(d, { type: 'idea.add', text, taskId: null, projectId }, ctx(at(10 * 60, date)));
    if (!r.ok) throw new Error(r.error);
    d = r.d;
    return r.id!;
  };
  const a = post('Servo tuning went well\n- order new servos', '2026-10-20', proj.id);
  const b = post('Check-in: tired but fine', '2026-10-22');
  const c = post('Servo noise is back, the quick brown fox', '2026-10-25', proj.id);
  const e = post('Lunch with the team', '2026-10-25');
  return { d, proj: proj.id, a, b, c, e };
}
const ids = (w: ReturnType<typeof world>, q: string) => searchLog(w.d, new SearchIndex(), q, { tz: TZ, today: TODAY }).hits.map((h) => h.id);

describe('query parsing', () => {
  it('splits words, phrases and filters', () => {
    const q = parseQuery('servo "quick brown" project:robotics before:2026-10-26 after:today is:task', TODAY);
    expect(q).toMatchObject({ words: ['servo'], phrases: ['quick brown'], project: 'robotics', before: '2026-10-26', after: TODAY, isTask: true, invalid: [] });
  });
  it('quoted filter values, unknown keys and bad dates', () => {
    expect(parseQuery('project:"Robotics club"', TODAY).project).toBe('Robotics club');
    expect(parseQuery('foo:bar', TODAY).words).toEqual(['foo:bar']);
    expect(parseQuery('before:soon is:done', TODAY).invalid).toEqual(['before:soon', 'is:done']);
    expect(parseQuery('before:yesterday', TODAY).before).toBe('2026-10-25');
  });
});

describe('search filters', () => {
  it('finds words, newest-relevant, and nothing for an empty query', () => {
    const w = world();
    expect(new Set(ids(w, 'servo'))).toEqual(new Set([w.a, w.c]));
    expect(ids(w, '')).toEqual([]);
  });
  it('exact phrases are substrings, not words', () => {
    const w = world();
    expect(ids(w, '"quick brown"')).toEqual([w.c]);
    expect(ids(w, '"brown quick"')).toEqual([]);
    expect(ids(w, 'servo "noise is back"')).toEqual([w.c]);
  });
  it('project: matches name prefix or id', () => {
    const w = world();
    expect(new Set(ids(w, 'project:robot'))).toEqual(new Set([w.a, w.c]));
    expect(ids(w, `servo project:${w.proj}`).length).toBe(2);
    expect(ids(w, 'project:nothing')).toEqual([]);
  });
  it('before: and after: are exclusive and use the user zone', () => {
    const w = world();
    expect(new Set(ids(w, 'after:2026-10-20'))).toEqual(new Set([w.b, w.c, w.e]));
    expect(new Set(ids(w, 'before:2026-10-25'))).toEqual(new Set([w.a, w.b]));
    expect(ids(w, 'servo before:2026-10-25')).toEqual([w.a]);
  });
  it('is:task keeps posts with task lines or links', () => {
    const w = world();
    expect(ids(w, 'is:task')).toEqual([w.a]);
    const linked = run(w.d, { type: 'idea.edit', id: w.b, parsedTaskIds: ['L0:x'] }).d;
    expect(new Set(searchLog(linked, new SearchIndex(), 'is:task', { tz: TZ, today: TODAY }).hits.map((h) => h.id))).toEqual(new Set([w.a, w.b]));
  });
  it('filter-only results are newest first; recycled notes never match', () => {
    const w = world();
    const first = ids(w, 'after:2026-10-01');
    expect(first.slice(-1)).toEqual([w.a]);
    const gone = run(w.d, { type: 'recycle', coll: 'ideas', id: w.c, confirmed: true }).d;
    expect(searchLog(gone, new SearchIndex(), 'servo', { tz: TZ, today: TODAY }).hits.map((h) => h.id)).toEqual([w.a]);
  });
  it('highlights words and phrases, case-insensitively', () => {
    expect(highlight('Servo noise is back', { words: ['servo'], phrases: [] })).toEqual([{ text: 'Servo', hit: true }, { text: ' noise is back', hit: false }]);
    expect(highlight('a quick brown fox', { words: [], phrases: ['quick brown'] }).filter((s) => s.hit).map((s) => s.text)).toEqual(['quick brown']);
    expect(highlight('x', { words: [], phrases: [] })).toEqual([{ text: 'x', hit: false }]);
  });
});

describe('edited flag', () => {
  it('is false for a quick fix and true well after posting', () => {
    expect(isEdited({ createdAt: 1000, updatedAt: 1000 })).toBe(false);
    expect(isEdited({ createdAt: 1000, updatedAt: 1000 + EDITED_AFTER_MS })).toBe(false);
    expect(isEdited({ createdAt: 1000, updatedAt: 1001 + EDITED_AFTER_MS })).toBe(true);
  });
  it('an edit through idea.edit later sets it', () => {
    const w = world();
    const t = at(10 * 60, '2026-10-20');
    const r = apply(w.d, { type: 'idea.edit', id: w.a, body: 'Servo tuning went very well' }, ctx(t + 10 * 60_000));
    expect(r.ok && isEdited(r.d.ideas[w.a]!)).toBe(true);
  });
});

describe('calendar and feed', () => {
  it('marks days with posts and current-project days', () => {
    const w = world();
    const m = dayMarks(Object.values(w.d.ideas), TZ, w.proj);
    expect(m.get('2026-10-25')).toEqual({ count: 2, inProject: true });
    expect(m.get('2026-10-22')).toEqual({ count: 1, inProject: false });
    expect(m.has('2026-10-21')).toBe(false);
    expect(dayMarks(Object.values(w.d.ideas), TZ, null).get('2026-10-25')?.inProject).toBe(false);
  });
  it('month grid is six Monday-first weeks', () => {
    const g = monthGrid(2026, 10);
    expect(g).toHaveLength(42);
    expect(g[0]).toEqual({ date: '2026-09-28', inMonth: false });
    expect(g.filter((c) => c.inMonth)).toHaveLength(31);
    expect(shiftMonth(2026, 1, -1)).toEqual({ year: 2025, month: 12 });
    expect(shiftMonth(2026, 12, 1)).toEqual({ year: 2027, month: 1 });
  });
  it('feed is newest first, filtered by project; indexForDay finds the day or the next older post', () => {
    const w = world();
    expect(feedOf(w.d.ideas).map((n) => n.id).slice(0, 2).sort()).toEqual([w.c, w.e].sort());
    expect(feedOf(w.d.ideas, w.proj).map((n) => n.id)).toEqual([w.c, w.a]);
    const f = feedOf(w.d.ideas);
    expect(indexForDay(f, '2026-10-22', TZ)).toBe(2);
    expect(indexForDay(f, '2026-10-24', TZ)).toBe(2);
    expect(indexForDay(f, '2026-12-01', TZ)).toBe(0);
    expect(indexForDay(f, '2026-01-01', TZ)).toBe(-1);
  });
  it('windowing renders a slice of thousands of rows', () => {
    const h = Array.from({ length: 5000 }, () => 100);
    const v = visibleRange(h, 100_000, 800, 200);
    expect(v.start).toBe(998);
    expect(v.end).toBeLessThan(1015);
    expect(v.top).toBe(99_800);
    expect(v.total).toBe(500_000);
    expect(visibleRange([], 0, 800)).toMatchObject({ start: 0, end: 0, total: 0 });
  });
});
