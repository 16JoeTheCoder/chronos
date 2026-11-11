// Per-occurrence exceptions on repeating events: skip, edit, merge, and how they expand.
import { describe, expect, it } from 'vitest';
import { apply, type Command } from '../../src/core/commands';
import type { Data } from '../../src/core/model/types';
import { get } from '../../src/core/repo/repo';
import { expandEvents } from '../../src/core/time/schedule';
import { addDays } from '../../src/core/time/zone';
import { at, ctx, fresh, run, T0 } from '../helpers';

const MON = '2026-10-26';
const MON2 = '2026-11-02';
const MON3 = '2026-11-09';

const weekly = (over: Record<string, unknown> = {}) => ({
  title: 'Physics',
  tagId: null,
  scope: 'school' as const,
  tz: 'Asia/Jakarta',
  startMin: 540,
  endMin: 600,
  date: null,
  recur: { weekdays: [1], everyNWeeks: 1 as const, anchorDate: MON, from: null, until: null },
  notes: '',
  ...over,
});

function setup(over: Record<string, unknown> = {}) {
  const r = run(fresh(), { type: 'event.create', input: weekly(over) });
  return { d: r.d, id: r.id };
}
const on = (d: Data, date: string) => expandEvents(d, date);
const fails = (d: Data, cmd: Command) => {
  const r = apply(d, cmd, ctx(T0));
  if (r.ok) throw new Error(`${cmd.type} unexpectedly succeeded`);
  return r;
};

describe('event.skip', () => {
  it('removes that date only', () => {
    const { d: d0, id } = setup();
    const { d } = run(d0, { type: 'event.skip', id, date: MON2 });
    expect(on(d, MON)).toHaveLength(1);
    expect(on(d, MON2)).toHaveLength(0);
    expect(on(d, MON3)).toHaveLength(1);
  });

  it('uses the id x-<eventId>-<date> and stores a skip with null overrides', () => {
    const { d: d0, id } = setup();
    const r = run(d0, { type: 'event.skip', id, date: MON2 });
    expect(r.id).toBe(`x-${id}-${MON2}`);
    expect(r.d.eventExceptions[`x-${id}-${MON2}`]).toMatchObject({ eventId: id, date: MON2, kind: 'skip', title: null, startMin: null, endMin: null, tagId: null, deletedAt: null });
  });

  it('is idempotent: skipping twice keeps one exception', () => {
    const { d: d0, id } = setup();
    const { d } = run(d0, { type: 'event.skip', id, date: MON2 }, { type: 'event.skip', id, date: MON2 });
    expect(Object.keys(d.eventExceptions)).toEqual([`x-${id}-${MON2}`]);
    expect(on(d, MON2)).toHaveLength(0);
  });

  it('fails for a one-off event, an unknown event and a bad date', () => {
    const one = run(fresh(), { type: 'event.create', input: weekly({ recur: null, date: MON }) });
    expect(fails(one.d, { type: 'event.skip', id: one.id, date: MON }).ok).toBe(false);
    expect(fails(one.d, { type: 'event.editOn', id: one.id, date: MON, patch: { title: 'x' } }).ok).toBe(false);
    expect(fails(fresh(), { type: 'event.skip', id: 'nope', date: MON }).ok).toBe(false);
    const { d, id } = setup();
    expect(fails(d, { type: 'event.skip', id, date: 'monday' }).ok).toBe(false);
  });

  it('does not touch other events on the same date', () => {
    const a = setup();
    const b = run(a.d, { type: 'event.create', input: weekly({ title: 'Chem', startMin: 700, endMin: 760 }) });
    const { d } = run(b.d, { type: 'event.skip', id: a.id, date: MON2 });
    expect(on(d, MON2).map((i) => i.event.title)).toEqual(['Chem']);
  });
});

describe('event.editOn', () => {
  it('overrides title, start and end for that date only', () => {
    const { d: d0, id } = setup();
    const { d } = run(d0, { type: 'event.editOn', id, date: MON2, patch: { title: 'Physics (exam)', startMin: 600, endMin: 720 } });
    const [i] = on(d, MON2);
    expect(i).toMatchObject({ date: MON2, startMin: 600, endMin: 720, exceptionId: `x-${id}-${MON2}` });
    expect(i!.event.title).toBe('Physics (exam)');
    expect(i!.start).toBe(at(600, MON2));
    expect(i!.end).toBe(at(720, MON2));
    // next week and the week before are unchanged
    for (const date of [MON, MON3]) {
      const [x] = on(d, date);
      expect(x).toMatchObject({ startMin: 540, endMin: 600, exceptionId: null });
      expect(x!.event.title).toBe('Physics');
    }
    expect(d.events[id]).toEqual(d0.events[id]);
  });

  it('a title-only edit keeps the times, a time-only edit keeps the title', () => {
    const { d: d0, id } = setup();
    const t = run(d0, { type: 'event.editOn', id, date: MON2, patch: { title: 'Lab' } }).d;
    expect(on(t, MON2)[0]).toMatchObject({ startMin: 540, endMin: 600 });
    expect(on(t, MON2)[0]!.event.title).toBe('Lab');
    const m = run(d0, { type: 'event.editOn', id, date: MON2, patch: { startMin: 570, endMin: 630 } }).d;
    expect(on(m, MON2)[0]!.event.title).toBe('Physics');
    expect(on(m, MON2)[0]).toMatchObject({ startMin: 570, endMin: 630 });
  });

  it('a tag override applies for that date', () => {
    const { d: d0, id } = setup();
    const tag = run(d0, { type: 'tag.create', input: { name: 'Exam', color: 'tag3', kind: 'class' } });
    const { d } = run(tag.d, { type: 'event.editOn', id, date: MON2, patch: { tagId: tag.id } });
    expect(on(d, MON2)[0]!.event.tagId).toBe(tag.id);
    expect(on(d, MON3)[0]!.event.tagId).toBeNull();
    expect(fails(tag.d, { type: 'event.editOn', id, date: MON2, patch: { tagId: 'no-such-tag' } }).ok).toBe(false);
  });

  it('editing again merges with the previous edit', () => {
    const { d: d0, id } = setup();
    const a = run(d0, { type: 'event.editOn', id, date: MON2, patch: { title: 'Lab' } }).d;
    const b = run(a, { type: 'event.editOn', id, date: MON2, patch: { startMin: 600, endMin: 660 } }).d;
    expect(on(b, MON2)[0]).toMatchObject({ startMin: 600, endMin: 660 });
    expect(on(b, MON2)[0]!.event.title).toBe('Lab');
    expect(b.eventExceptions[`x-${id}-${MON2}`]).toMatchObject({ kind: 'edit', title: 'Lab', startMin: 600, endMin: 660 });
    // a later patch overrides only the field it names
    const c = run(b, { type: 'event.editOn', id, date: MON2, patch: { title: 'Exam' } }).d;
    expect(c.eventExceptions[`x-${id}-${MON2}`]).toMatchObject({ title: 'Exam', startMin: 600, endMin: 660 });
    expect(Object.keys(c.eventExceptions)).toHaveLength(1);
  });

  it('a null in the patch clears that override', () => {
    const { d: d0, id } = setup();
    const a = run(d0, { type: 'event.editOn', id, date: MON2, patch: { title: 'Lab', startMin: 600, endMin: 660 } }).d;
    const b = run(a, { type: 'event.editOn', id, date: MON2, patch: { title: null } }).d;
    expect(on(b, MON2)[0]!.event.title).toBe('Physics');
    expect(on(b, MON2)[0]).toMatchObject({ startMin: 600, endMin: 660 });
  });

  it('skip after edit turns it into a skip', () => {
    const { d: d0, id } = setup();
    const a = run(d0, { type: 'event.editOn', id, date: MON2, patch: { title: 'Lab', startMin: 600, endMin: 660 } }).d;
    const b = run(a, { type: 'event.skip', id, date: MON2 }).d;
    expect(on(b, MON2)).toHaveLength(0);
    expect(b.eventExceptions[`x-${id}-${MON2}`]).toMatchObject({ kind: 'skip', title: null, startMin: null, endMin: null });
  });

  it('edit after skip brings the date back, edited, without stale overrides', () => {
    const { d: d0, id } = setup();
    const a = run(d0, { type: 'event.skip', id, date: MON2 }, { type: 'event.editOn', id, date: MON2, patch: { title: 'Back' } }).d;
    expect(on(a, MON2)).toHaveLength(1);
    expect(on(a, MON2)[0]).toMatchObject({ startMin: 540, endMin: 600 });
    expect(on(a, MON2)[0]!.event.title).toBe('Back');
  });

  it('rejects an end that is not after the start, with a field error', () => {
    const { d, id } = setup();
    for (const patch of [{ startMin: 600, endMin: 600 }, { startMin: 700, endMin: 650 }, { endMin: 500 }, { startMin: 700 }, { startMin: -5, endMin: 100 }, { endMin: 1441, startMin: 10 }]) {
      const r = fails(d, { type: 'event.editOn', id, date: MON2, patch });
      expect(r.ok, JSON.stringify(patch)).toBe(false);
      if (!r.ok) expect(r.fields, JSON.stringify(patch)).toHaveProperty('time');
    }
    expect(Object.keys(d.eventExceptions)).toHaveLength(0);
    const empty = fails(d, { type: 'event.editOn', id, date: MON2, patch: { title: '   ' } });
    if (!empty.ok) expect(empty.fields).toHaveProperty('title');
  });

  it('a failed edit leaves the previous edit alone', () => {
    const { d: d0, id } = setup();
    const a = run(d0, { type: 'event.editOn', id, date: MON2, patch: { title: 'Lab' } }).d;
    fails(a, { type: 'event.editOn', id, date: MON2, patch: { endMin: 100 } });
    expect(a.eventExceptions[`x-${id}-${MON2}`]!.title).toBe('Lab');
  });

  it('recycling the exception restores the original occurrence; editing again revives it', () => {
    const { d: d0, id } = setup();
    const xid = `x-${id}-${MON2}`;
    const a = run(d0, { type: 'event.editOn', id, date: MON2, patch: { title: 'Lab' } }).d;
    const gone = run(a, { type: 'recycle', coll: 'eventExceptions', id: xid, confirmed: true }).d;
    expect(on(gone, MON2)[0]!.event.title).toBe('Physics');
    expect(on(gone, MON2)[0]!.exceptionId).toBeNull();
    const back = run(gone, { type: 'event.editOn', id, date: MON2, patch: { startMin: 570 } }).d;
    expect(get(back, 'eventExceptions', xid)?.deletedAt).toBeNull();
    // the old title is not resurrected from the recycled record
    expect(on(back, MON2)[0]!.event.title).toBe('Physics');
    expect(on(back, MON2)[0]!.startMin).toBe(570);
  });
});

describe('event.update (edit every week)', () => {
  it('changes future dates but leaves existing exception records untouched', () => {
    const { d: d0, id } = setup();
    const d1 = run(d0, { type: 'event.editOn', id, date: MON2, patch: { title: 'Special', startMin: 600, endMin: 660 } }, { type: 'event.skip', id, date: MON3 }).d;
    const before = structuredClone({ edit: d1.eventExceptions[`x-${id}-${MON2}`], skip: d1.eventExceptions[`x-${id}-${MON3}`] });
    const d2 = run(d1, { type: 'event.update', id, input: weekly({ title: 'Physics II', startMin: 480, endMin: 540 }) }).d;
    expect({ edit: d2.eventExceptions[`x-${id}-${MON2}`], skip: d2.eventExceptions[`x-${id}-${MON3}`] }).toEqual(before);
    expect(Object.keys(d2.eventExceptions).sort()).toEqual(Object.keys(d1.eventExceptions).sort());
    // an unexcepted week follows the new series
    const w = on(d2, '2026-11-16')[0]!;
    expect(w.event.title).toBe('Physics II');
    expect(w).toMatchObject({ startMin: 480, endMin: 540 });
    // the edited week still shows its overrides, the skipped one is still skipped
    expect(on(d2, MON2)[0]).toMatchObject({ startMin: 600, endMin: 660 });
    expect(on(d2, MON2)[0]!.event.title).toBe('Special');
    expect(on(d2, MON3)).toHaveLength(0);
  });

  it('rejects invalid input with field errors', () => {
    const { d, id } = setup();
    const r = fails(d, { type: 'event.update', id, input: weekly({ startMin: 600, endMin: 600 }) });
    if (!r.ok) expect(r.fields).toHaveProperty('time');
    expect(fails(d, { type: 'event.update', id: 'missing', input: weekly() }).ok).toBe(false);
  });
});

describe('day boundaries', () => {
  it('an event 23:00-24:00 ends at the next local midnight', () => {
    const { d, id } = setup({ title: 'Late', startMin: 1380, endMin: 1440 });
    const [i] = on(d, MON);
    expect(i).toMatchObject({ startMin: 1380, endMin: 1440 });
    expect(i!.end - i!.start).toBe(60 * 60_000);
    expect(i!.end).toBe(at(0, addDays(MON, 1)));
    // it does not appear on the next date (Tuesday) and a skip removes only Monday's
    expect(on(d, addDays(MON, 1))).toHaveLength(0);
    const s = run(d, { type: 'event.skip', id, date: MON }).d;
    expect(on(s, MON)).toHaveLength(0);
    expect(on(s, MON2)).toHaveLength(1);
  });

  it('an exception can move an event to 00:00-00:30', () => {
    const { d: d0, id } = setup();
    const { d } = run(d0, { type: 'event.editOn', id, date: MON2, patch: { startMin: 0, endMin: 30 } });
    const [i] = on(d, MON2);
    expect(i).toMatchObject({ startMin: 0, endMin: 30 });
    expect(i!.start).toBe(at(0, MON2));
    expect(i!.end).toBe(at(30, MON2));
    expect(on(d, MON3)[0]).toMatchObject({ startMin: 540, endMin: 600 });
  });

  it('an exception can stretch an event to the end of the day (endMin 1440)', () => {
    const { d: d0, id } = setup();
    const { d } = run(d0, { type: 'event.editOn', id, date: MON2, patch: { startMin: 1400, endMin: 1440 } });
    expect(on(d, MON2)[0]!.end).toBe(at(0, addDays(MON2, 1)));
  });

  it('expansion is by local date in the event zone, not by UTC date', () => {
    // 00:30 WIB Monday is still Sunday in UTC: it must belong to Monday.
    const { d } = setup({ startMin: 30, endMin: 90 });
    const [i] = on(d, MON);
    expect(i!.start).toBe(at(30, MON));
    expect(new Date(i!.start).toISOString().slice(0, 10)).toBe('2026-10-25');
    expect(on(d, '2026-10-25')).toHaveLength(0);
  });

  it('an exception id is stable per (event, date): same inputs, same id on two devices', () => {
    const { d, id } = setup();
    const a = apply(d, { type: 'event.skip', id, date: MON2 }, ctx(T0, 'devA'));
    const b = apply(d, { type: 'event.skip', id, date: MON2 }, ctx(T0 + 5000, 'devB'));
    expect(a.ok && b.ok && a.id === b.id).toBe(true);
    expect(a.ok && a.id).toBe(`x-${id}-${MON2}`);
  });
});
