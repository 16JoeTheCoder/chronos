// Recurrence: weekly, week A/B, term dates, exceptions, scope switches, closures.
import { describe, expect, it } from 'vitest';
import type { EventInput } from '../../src/core/commands';
import { expandEvents } from '../../src/core/time/schedule';
import { fresh, run, TZ } from '../helpers';

const ev = (over: Partial<EventInput> = {}): EventInput => ({
  title: 'Physics', tagId: null, scope: 'school', tz: TZ, startMin: 640, endMin: 700, date: null,
  recur: { weekdays: [1, 3], everyNWeeks: 1, anchorDate: '2026-10-26', from: null, until: null }, notes: '', ...over,
});
const titles = (d: ReturnType<typeof fresh>, date: string) => expandEvents(d, date).map((i) => i.event.title);

describe('expandEvents', () => {
  it('expands weekly events on matching weekdays only', () => {
    const { d } = run(fresh(), { type: 'event.create', input: ev() });
    expect(titles(d, '2026-10-26')).toEqual(['Physics']); // Mon
    expect(titles(d, '2026-10-27')).toEqual([]); // Tue
    expect(titles(d, '2026-10-28')).toEqual(['Physics']); // Wed
  });

  it('honours week A/B (every 2 weeks from the anchor week) and term dates', () => {
    const { d } = run(fresh(), { type: 'event.create', input: ev({ recur: { weekdays: [1], everyNWeeks: 2, anchorDate: '2026-10-28', from: '2026-10-01', until: '2026-11-30' } }) });
    expect(titles(d, '2026-10-26')).toEqual(['Physics']);
    expect(titles(d, '2026-11-02')).toEqual([]);
    expect(titles(d, '2026-11-09')).toEqual(['Physics']);
    expect(titles(d, '2026-10-12')).toEqual(['Physics']);
    expect(titles(d, '2026-09-28')).toEqual([]); // before from
    expect(titles(d, '2026-12-07')).toEqual([]); // after until
  });

  it('applies skip and move exceptions', () => {
    let { d, id } = run(fresh(), { type: 'event.create', input: ev() });
    d = run(d, { type: 'event.skip', id, date: '2026-10-26' }).d;
    expect(titles(d, '2026-10-26')).toEqual([]);
    expect(titles(d, '2026-10-28')).toEqual(['Physics']);
  });

  it('scope switches and the master switch hide recurring events but not one-offs', () => {
    let { d } = run(fresh(), { type: 'event.create', input: ev() }, { type: 'event.create', input: ev({ title: 'Dentist', date: '2026-10-26', recur: null, scope: 'other' }) });
    d = run(d, { type: 'settings.update', patch: { timetable: { enabled: true, scopes: { school: false, work: true, uni: true, other: true } } } }).d;
    expect(titles(d, '2026-10-26')).toEqual(['Dentist']);
    d = run(d, { type: 'settings.update', patch: { timetable: { enabled: false, scopes: { school: true, work: true, uni: true, other: true } } } }).d;
    expect(titles(d, '2026-10-26')).toEqual(['Dentist']);
  });

  it('a confirmed closure hides only its scopes', () => {
    let { d } = run(fresh(), { type: 'event.create', input: ev() }, { type: 'event.create', input: ev({ title: 'Shift', scope: 'work' }) });
    const unconfirmed = run(d, { type: 'closure.create', input: { name: 'Break', startDate: '2026-10-26', endDate: '2026-10-30', scopes: ['school'], confirmed: false } }).d;
    expect(titles(unconfirmed, '2026-10-26')).toEqual(['Physics', 'Shift']);
    d = run(d, { type: 'closure.create', input: { name: 'Break', startDate: '2026-10-26', endDate: '2026-10-30', scopes: ['school'], confirmed: true } }).d;
    expect(titles(d, '2026-10-26')).toEqual(['Shift']);
    expect(titles(d, '2026-11-02')).toEqual(['Physics', 'Shift']);
  });
});
