// MCP: post_log, search_log, list_unplaced, place_event (docs/MCP.md) with the Phase 1 safety rules.
import { describe, expect, it } from 'vitest';
import { apply, type Command } from '../../src/core/commands';
import { Mcp, type StorePort } from '../../src/core/mcp/handlers';
import type { Data } from '../../src/core/model/types';
import { live } from '../../src/core/repo/repo';
import { ctx, fresh, run, T0, TODAY } from '../helpers';

type Any = Record<string, any>;
const input = (title: string, startMin: number | null, endMin: number | null, date = TODAY, durationMin?: number) => ({ title, tagId: null, scope: 'other' as const, tz: 'Asia/Jakarta', startMin, endMin, date, recur: null, notes: '', ...(durationMin ? { durationMin } : {}) });

function rig(limit?: number) {
  let d: Data = fresh();
  const proj = run(d, { type: 'project.create', name: 'Chronos' });
  d = proj.d;
  const exam = run(d, { type: 'event.create', input: input('Math exam', null, null, TODAY, 90) });
  d = exam.d;
  const later = run(d, { type: 'event.create', input: input('Bio test', null, null, '2026-10-29') });
  d = later.d;
  d = run(d, { type: 'event.create', input: input('Class', 600, 660) }).d;
  const st = { d, now: T0 };
  const port: StorePort = {
    data: () => st.d,
    now: () => st.now,
    run: (cmd: Command) => {
      const r = apply(st.d, cmd, ctx(st.now, 'mcp'));
      if (!r.ok) return { ok: false, error: r.error, fields: r.fields };
      st.d = r.d;
      return { ok: true, id: r.id };
    },
  };
  const mcp = new Mcp(port, limit);
  const ok = (name: string, args?: unknown): Any => {
    const r = mcp.call(name, args ?? {});
    if (!r.ok) throw new Error(`${name} failed: ${r.error}`);
    return r.result as Any;
  };
  const err = (name: string, args?: unknown): string => {
    const r = mcp.call(name, args ?? {});
    if (r.ok) throw new Error(`${name} unexpectedly succeeded`);
    return r.error;
  };
  return { st, mcp, ok, err, project: proj.id, exam: exam.id, later: later.id };
}

describe('post_log', () => {
  it('posts a note, optionally under a project, and can be undone', () => {
    const r = rig();
    const a = r.ok('post_log', { body: 'Check-in: parser works', projectId: r.project });
    expect(a.changed).toMatchObject({ body: 'Check-in: parser works', projectId: r.project });
    expect(r.st.d.ideas[a.changed.id]).toMatchObject({ body: 'Check-in: parser works', projectId: r.project, taskId: null });
    const b = r.ok('post_log', { body: 'plain' });
    expect(r.st.d.ideas[b.changed.id]?.projectId).toBeNull();
    r.ok('undo', { undoToken: a.undoToken });
    expect(r.st.d.ideas[a.changed.id]?.deletedAt).not.toBeNull();
    expect(live(r.st.d, 'activity').some((x) => x.type === 'claude' && x.reason.startsWith('post_log'))).toBe(true);
  });
  it('checks its input and the project', () => {
    const r = rig();
    expect(r.err('post_log', { body: '' })).toMatch(/Invalid input/);
    expect(r.err('post_log', { body: 'x', extra: 1 })).toMatch(/not a known field/);
    expect(r.err('post_log', { body: 'x', projectId: 'nope' })).toMatch(/No project/);
  });
  it('is a write: the rate limit applies', () => {
    const r = rig(2);
    r.ok('post_log', { body: 'one' });
    r.ok('post_log', { body: 'two' });
    expect(r.err('post_log', { body: 'three' })).toMatch(/Too many changes/);
  });
});

describe('search_log', () => {
  it('finds posts by text with their project, and not deleted ones', () => {
    const r = rig();
    r.ok('post_log', { body: 'Fixed the quarterback parser bug', projectId: r.project });
    const gone = r.ok('post_log', { body: 'quarterback secret' });
    r.ok('post_log', { body: 'Unrelated groceries' });
    r.ok('undo', { undoToken: gone.undoToken });
    const out = r.ok('search_log', { query: 'quarterback' });
    expect(out.results).toHaveLength(1);
    expect(out.results[0]).toMatchObject({ body: 'Fixed the quarterback parser bug', project: 'Chronos' });
    expect(r.ok('search_log', { query: 'zzzz' }).results).toEqual([]);
  });
  it('does not return tasks or events', () => {
    const r = rig();
    expect(r.ok('search_log', { query: 'Math exam' }).results).toEqual([]);
  });
});

describe('list_unplaced', () => {
  it('lists one day, or every unplaced event from today on', () => {
    const r = rig();
    expect(r.ok('list_unplaced', { date: TODAY }).events).toEqual([{ id: r.exam, title: 'Math exam', date: TODAY, durationMin: 90 }]);
    expect(r.ok('list_unplaced', { date: '2026-10-28' }).events).toEqual([]);
    expect(r.ok('list_unplaced').events.map((e: Any) => e.title)).toEqual(['Math exam', 'Bio test']);
    expect(r.ok('get_day', {}).unplaced).toEqual([{ id: r.exam, title: 'Math exam', durationMin: 90 }]);
    expect(r.ok('get_day', {}).events.map((e: Any) => e.title)).toEqual(['Class']);
  });
});

describe('place_event', () => {
  it('gives the event its time, keeps its length, undoes', () => {
    const r = rig();
    const a = r.ok('place_event', { eventId: r.exam, startMin: 780 });
    expect(a.changed).toMatchObject({ eventId: r.exam, date: TODAY, start: '13:00', end: '14:30' });
    expect(r.st.d.events[r.exam]).toMatchObject({ startMin: 780, endMin: 870, durationMin: 90 });
    expect(r.ok('list_unplaced', { date: TODAY }).events).toEqual([]);
    r.ok('undo', { undoToken: a.undoToken });
    expect(r.st.d.events[r.exam]).toMatchObject({ startMin: null, endMin: null });
  });
  it('is refused, with the reason, on overlap or past midnight, and for placed or unknown events', () => {
    const r = rig();
    expect(r.err('place_event', { eventId: r.exam, startMin: 630 })).toMatch(/overlaps the fixed event "Class"/);
    expect(r.err('place_event', { eventId: r.exam, startMin: 1400 })).toMatch(/within the day/);
    expect(r.st.d.events[r.exam]?.startMin).toBeNull();
    r.ok('place_event', { eventId: r.exam, startMin: 780 });
    expect(r.err('place_event', { eventId: r.exam, startMin: 900 })).toMatch(/already has a time/);
    expect(r.err('place_event', { eventId: 'nope', startMin: 900 })).toMatch(/No such one-off/);
    expect(r.err('place_event', { eventId: r.later, startMin: 1500 })).toMatch(/Invalid input/);
  });
});
