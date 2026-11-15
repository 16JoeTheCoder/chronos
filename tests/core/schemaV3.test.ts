// Schema v3 rules: unplaced events, event placing, new settings and device fields, the misparse report.
import { describe, expect, it } from 'vitest';
import { apply, type EventInput } from '../../src/core/commands';
import { defaultDevice, defaultSettings } from '../../src/core/model/defaults';
import { PARSER_REPORTS_MAX, type Data } from '../../src/core/model/types';
import { live, settingsOf } from '../../src/core/repo/repo';
import { expandEvents, unplacedOn, upcoming } from '../../src/core/time/schedule';
import { recordProblem, validateDevice, validateEventFields, validateSettings } from '../../src/core/validation';
import { ctx, fresh, run, T0, TODAY } from '../helpers';

const base = { tagId: null, scope: 'school' as const, tz: 'Asia/Jakarta', date: TODAY, recur: null, notes: '' };
const placed = (title: string, startMin: number, endMin: number): EventInput => ({ ...base, title, startMin, endMin });
const unplaced = (title: string, durationMin?: number): EventInput => ({ ...base, title, startMin: null, endMin: null, ...(durationMin ? { durationMin } : {}) });

describe('unplaced events', () => {
  it('create: durationMin defaults to 60, a placed event gets end - start', () => {
    const a = run(fresh(), { type: 'event.create', input: unplaced('Math test') });
    const id = a.id;
    expect(a.d.events[id]).toMatchObject({ startMin: null, endMin: null, durationMin: 60 });
    const b = run(a.d, { type: 'event.create', input: unplaced('Chem test', 45) });
    expect(b.d.events[b.id]?.durationMin).toBe(45);
    const c = run(b.d, { type: 'event.create', input: placed('Dentist', 600, 690) });
    expect(c.d.events[c.id]).toMatchObject({ startMin: 600, endMin: 690, durationMin: 90 });
    for (const e of live(c.d, 'events')) expect(recordProblem('events', e)).toBeNull();
  });

  it('validation: both times null or both set; recurring events are always placed', () => {
    expect(validateEventFields({ ...unplaced('x'), durationMin: 30 })).toEqual({});
    expect(validateEventFields({ ...base, title: 'x', startMin: 600, endMin: null })).toHaveProperty('time');
    expect(validateEventFields({ ...base, title: 'x', startMin: null, endMin: 600 })).toHaveProperty('time');
    expect(validateEventFields({ ...base, title: 'x', startMin: 700, endMin: 600 })).toHaveProperty('time');
    expect(validateEventFields({ ...base, title: 'x', startMin: null, endMin: null, date: null, recur: { weekdays: [1], everyNWeeks: 1, anchorDate: TODAY, from: null, until: null } })).toHaveProperty('time');
    expect(validateEventFields({ ...unplaced('x'), durationMin: 0 })).toHaveProperty('durationMin');
    expect(validateEventFields({ ...unplaced('x'), durationMin: 1441 })).toHaveProperty('durationMin');
    const e = run(fresh(), { type: 'event.create', input: placed('A', 600, 660) }).d;
    const ev = Object.values(e.events)[0]!;
    expect(recordProblem('events', { ...ev, endMin: null })).toBe('bad time');
    expect(recordProblem('events', { ...ev, startMin: null, endMin: null, date: null })).toBe('bad time');
    expect(recordProblem('events', { ...ev, startMin: null, endMin: null })).toBeNull();
    expect(recordProblem('events', { ...ev, durationMin: 'x' })).toBe('bad durationMin');
  });

  it('expansion, upcoming and time-left skip them; unplacedOn lists them', () => {
    let d: Data = fresh();
    d = run(d, { type: 'event.create', input: unplaced('Math test') }, { type: 'event.create', input: placed('Dentist', 600, 660) }).d;
    expect(expandEvents(d, TODAY).map((i) => i.event.title)).toEqual(['Dentist']);
    expect(upcoming(d, T0, TODAY, 48).map((i) => i.event.title)).toEqual(['Dentist']);
    expect(unplacedOn(d, TODAY).map((e) => e.title)).toEqual(['Math test']);
    expect(unplacedOn(d, '2026-10-27')).toEqual([]);
  });

  it('event.place sets start and end from durationMin, once', () => {
    const a = run(fresh(), { type: 'event.create', input: unplaced('Math test', 45) });
    const b = run(a.d, { type: 'event.place', id: a.id, startMin: 780 });
    expect(b.d.events[a.id]).toMatchObject({ startMin: 780, endMin: 825, durationMin: 45 });
    expect(expandEvents(b.d, TODAY).map((i) => [i.startMin, i.endMin])).toEqual([[780, 825]]);
    expect(unplacedOn(b.d, TODAY)).toEqual([]);
    expect(apply(b.d, { type: 'event.place', id: a.id, startMin: 900 }, ctx()).ok).toBe(false);
    expect(apply(a.d, { type: 'event.place', id: a.id, startMin: 1430 }, ctx()).ok).toBe(false);
    expect(apply(a.d, { type: 'event.place', id: 'nope', startMin: 600 }, ctx()).ok).toBe(false);
  });

  it('a placed event can be made unplaced again by updating it', () => {
    const a = run(fresh(), { type: 'event.create', input: placed('Exam', 600, 690) });
    const b = run(a.d, { type: 'event.update', id: a.id, input: unplaced('Exam', 90) });
    expect(b.d.events[a.id]).toMatchObject({ startMin: null, endMin: null, durationMin: 90 });
  });
});

describe('new settings', () => {
  const s = () => defaultSettings();
  it('defaults are valid', () => expect(validateSettings(s())).toEqual({}));
  it('themeSchedule', () => {
    expect(validateSettings({ ...s(), themeSchedule: [{ from: '07:00', themeId: 'a' }, { from: '19:30', themeId: 'b' }] })).toEqual({});
    expect(validateSettings({ ...s(), themeSchedule: [{ from: '7:00', themeId: 'a' }] })).toHaveProperty('themeSchedule');
    expect(validateSettings({ ...s(), themeSchedule: [{ from: '24:00', themeId: 'a' }] })).toHaveProperty('themeSchedule');
    expect(validateSettings({ ...s(), themeSchedule: [{ from: '07:00', themeId: '' }] })).toHaveProperty('themeSchedule');
  });
  it('weekly target, sound, energy, widgets, planning', () => {
    expect(validateSettings({ ...s(), weeklyFocusTargetH: 169 })).toHaveProperty('weeklyFocusTargetH');
    expect(validateSettings({ ...s(), weeklyFocusTargetH: 0 })).toEqual({});
    expect(validateSettings({ ...s(), sound: { enabled: true, volume: 1.2, muteInFocus: false } })).toHaveProperty('sound');
    expect(validateSettings({ ...s(), sound: { enabled: 1, volume: 0.5, muteInFocus: false } as never })).toHaveProperty('sound');
    expect(validateSettings({ ...s(), energy: { livingReactor: true, holographicDepth: true, reactiveData: true } as never })).toHaveProperty('energy');
    expect(validateSettings({ ...s(), widgets: { day: true, momentum: true, notes: true, wellness: 'x' } as never })).toHaveProperty('widgets');
    expect(validateSettings({ ...s(), planning: { defaultBlockMin: 4, learnEstimates: true, breakAfterMin: 75 } })).toHaveProperty('planning');
    expect(validateSettings({ ...s(), planning: { defaultBlockMin: 30, learnEstimates: 'y', breakAfterMin: 75 } as never })).toHaveProperty('planning');
    expect(validateSettings({ ...s(), planning: { defaultBlockMin: 30, learnEstimates: false, breakAfterMin: 241 } })).toHaveProperty('planning');
  });
  it('parserReports: bounded count and string lengths', () => {
    const r = { at: 1, input: 'a', expected: 'b', actual: 'c' };
    expect(validateSettings({ ...s(), parserReports: Array(200).fill(r) })).toEqual({});
    expect(validateSettings({ ...s(), parserReports: Array(201).fill(r) })).toHaveProperty('parserReports');
    expect(validateSettings({ ...s(), parserReports: [{ ...r, input: 'x'.repeat(301) }] })).toHaveProperty('parserReports');
    expect(validateSettings({ ...s(), parserReports: [{ at: 1, input: 'a' }] as never })).toHaveProperty('parserReports');
  });
  it('a settings record with a bad v3 field is rejected by recordProblem', () => {
    expect(recordProblem('settings', { ...s(), planning: null })).toBe('bad planning');
  });
});

describe('device settings', () => {
  it('composerProjectId and onboarded', () => {
    const dev = defaultDevice('dev', 'PC');
    expect(dev).toMatchObject({ composerProjectId: null, onboarded: false });
    expect(validateDevice(dev)).toEqual({});
    expect(validateDevice({ ...dev, composerProjectId: 'p-1', onboarded: true })).toEqual({});
    expect(validateDevice({ ...dev, composerProjectId: 5 as never })).toHaveProperty('composerProjectId');
    expect(validateDevice({ ...dev, onboarded: 'yes' as never })).toHaveProperty('experimental');
  });
});

describe('parser.report', () => {
  const report = (i: number) => ({ type: 'parser.report' as const, input: `line ${i}`, expected: 'task', actual: 'event' });
  it('appends with the time and caps at 200, oldest dropped', () => {
    let d = fresh();
    for (let i = 0; i < PARSER_REPORTS_MAX + 5; i++) d = run(d, report(i)).d;
    const r = settingsOf(d).parserReports;
    expect(r).toHaveLength(PARSER_REPORTS_MAX);
    expect(r[0]?.input).toBe('line 5');
    expect(r.at(-1)).toEqual({ at: T0, input: `line ${PARSER_REPORTS_MAX + 4}`, expected: 'task', actual: 'event' });
    expect(validateSettings(settingsOf(d))).toEqual({});
  });
  it('trims, truncates long text and refuses an empty input', () => {
    const d = run(fresh(), { type: 'parser.report', input: `  ${'x'.repeat(400)} `, expected: 'e'.repeat(900), actual: '' }).d;
    const r = settingsOf(d).parserReports[0]!;
    expect(r.input).toHaveLength(300);
    expect(r.expected).toHaveLength(500);
    expect(apply(fresh(), { type: 'parser.report', input: '  ', expected: 'a', actual: 'b' }, ctx()).ok).toBe(false);
  });
});

describe('notes in projects', () => {
  it('idea.add files a note under a live project and refuses an unknown one', () => {
    const p = run(fresh(), { type: 'project.create', name: 'Chronos' });
    const n = run(p.d, { type: 'idea.add', text: 'ship it', taskId: null, projectId: p.id });
    expect(n.d.ideas[n.id]?.projectId).toBe(p.id);
    expect(run(p.d, { type: 'idea.add', text: 'x', taskId: null }).d.ideas).not.toEqual({});
    expect(apply(p.d, { type: 'idea.add', text: 'x', taskId: null, projectId: 'nope' }, ctx()).ok).toBe(false);
  });
});
