// Behaviour beyond the corpus: spec grammar with no corpus line, notepad prefixes, context data, literal ranges.
import { describe, expect, it } from 'vitest';
import { parse, parseNotepad } from '../../src/core/parser';
import { fixtureContext } from './helpers';

const ctx = fixtureContext();
const p = (t: string, over = {}) => parse(t, fixtureContext(over));

describe('bare numbers and clock words (D6)', () => {
  it('bare hour after a preposition: 1-6 pm, 7-11 am, 12 noon', () => {
    expect(p('submit form at 5').dueTime).toBe(17 * 60);
    expect(p('submit form at 9').dueTime).toBe(9 * 60);
    expect(p('submit form at 12').dueTime).toBe(12 * 60);
    expect(p('submit form by 17:30').dueTime).toBe(17 * 60 + 30);
  });
  it('a bare number without a preposition stays in the title', () => {
    for (const t of ['buy 4 tires', 'room 204 booking', 'AS 9702 paper 2', 'beat 3-1', 'read pages 10-20', 'ch 5 notes', 'v0.3 release', 'PR #12']) {
      const r = p(t);
      expect(r.dueTime, t).toBeUndefined();
      expect(r.startMin, t).toBeUndefined();
      expect(r.title, t).toBe(t);
    }
  });
  it('noon, midnight, half 5, quarter past 4, 1700, 5.30, 5p', () => {
    expect(p('lunch at noon').dueTime).toBe(720);
    expect(p('submit half 5').dueTime).toBe(17 * 60 + 30);
    expect(p('submit quarter past 4').dueTime).toBe(16 * 60 + 15);
    expect(p('submit at 1700').dueTime).toBe(1020);
    expect(p('submit at 5.30').dueTime).toBe(17 * 60 + 30);
    expect(p('submit 5p').dueTime).toBe(1020);
    expect(p('submit 5 pm').dueTime).toBe(1020);
  });
});

describe('dates', () => {
  it('weekday rules', () => {
    expect(p('x wed').date).toBe('2026-11-11');
    expect(p('x next fri').date).toBe('2026-11-20');
    expect(p('x this fri').date).toBe('2026-11-13');
    expect(p('x weekend').date).toBe('2026-11-14');
    expect(p('x in 2 weeks').date).toBe('2026-11-25');
  });
  it('absolute dates, day first', () => {
    expect(p('x 5 dec').date).toBe('2026-12-05');
    expect(p('x dec 5 2027').date).toBe('2027-12-05');
    expect(p('x 5/12').date).toBe('2026-12-05');
    expect(p('x 3 nov').date).toBe('2027-11-03');
  });
  it('yesterday is warned and not consumed', () => {
    const r = p('call mom yesterday');
    expect(r.date).toBeUndefined();
    expect(r.warnings.join()).toMatch(/yesterday/);
    expect(r.title).toBe('call mom yesterday');
  });
  it('recurrence until', () => {
    const r = p('gym every mon until dec 5 6pm');
    expect(r.recurrence).toEqual({ freq: 'weekly', interval: 1, weekdays: [1], until: '2026-12-05' });
    expect(r.title).toBe('gym');
  });
  it('mon/wed/fri', () => {
    expect(p('run mon/wed/fri 6pm').recurrence?.weekdays).toEqual([1, 3, 5]);
  });
});

describe('fuzzy matching stays conservative (D11)', () => {
  it('fixes typos only in unit and date slots', () => {
    expect(p('x tomorow').date).toBe('2026-11-12');
    expect(p('x 30 minuts').estimateMin).toBe(30);
    expect(p('x 2 hours').estimateMin).toBe(120);
  });
  it('never rewrites real words', () => {
    const r = p('sunny day at the beach');
    expect(r.date).toBeUndefined();
    expect(p('buy 5 mind maps').estimateMin).toBeUndefined();
    expect(p('x 200 m sprint').estimateMin).toBeUndefined();
  });
});

describe('tests and exams (D16) and fixed lengths (D17, D2)', () => {
  it('takes the matching timetable period', () => {
    const r = p('Math test monday');
    expect(r).toMatchObject({ kind: 'fixed', date: '2026-11-16', startMin: 465, endMin: 545 });
    expect(r.unplaced).toBeUndefined();
  });
  it('no match: unplaced 60 min', () => {
    expect(p('Chemistry exam fri')).toMatchObject({ kind: 'fixed', date: '2026-11-13', unplaced: true, durationMin: 60 });
  });
  it('a test with a time is a normal fixed event', () => {
    expect(p('math test tomorrow 3pm')).toMatchObject({ kind: 'fixed', startMin: 900, endMin: 960 });
  });
  it('class at a bell start = one period; double = two', () => {
    expect(p('chem class 10:00 thursday')).toMatchObject({ startMin: 600, endMin: 680 });
    expect(p('chem class double 8:25 friday')).toMatchObject({ startMin: 505, endMin: 585, title: 'chem class' });
  });
  it('default 1 h, call 30 min, explicit length wins', () => {
    expect(p('gym 5pm')).toMatchObject({ startMin: 1020, endMin: 1080 });
    expect(p('call dad 5pm')).toMatchObject({ startMin: 1020, endMin: 1050 });
    expect(p('call dad 5pm for 2h')).toMatchObject({ startMin: 1020, endMin: 1140 });
  });
  it('a time that runs past midnight is flagged', () => {
    const r = p('gym 11:30pm');
    expect(r.endMin).toBe(1410 + 60);
    expect(r.warnings.join()).toMatch(/midnight/);
  });
});

describe('prefixes and notepad mode', () => {
  it('prefix forces the kind and is removed', () => {
    expect(p('- buy milk')).toMatchObject({ kind: 'task', title: 'buy milk' });
    expect(p('[] buy milk')).toMatchObject({ kind: 'task', title: 'buy milk' });
    expect(p('task gym 5pm').kind).toBe('task');
    expect(p('event buy milk')).toMatchObject({ kind: 'fixed', unplaced: true });
    expect(p('note buy milk 5pm')).toMatchObject({ kind: 'note', title: 'buy milk 5pm' });
  });
  it('notepad lines: prefixed lines parse, the rest stays a note', () => {
    const out = parseNotepad('Ideas for the week\n- gym 5pm\r\n\n@ call dad 9pm\nplain text tomorrow', ctx);
    expect(out.map((l) => l.result.kind)).toEqual(['note', 'task', 'fixed', 'note']);
    expect(out[3]!.result.title).toBe('plain text tomorrow');
    expect(out[2]!.offset).toBe('Ideas for the week\n- gym 5pm\r\n\n'.length);
  });
});

describe('chips, projects, literal ranges', () => {
  it('# project is removed from the title; a project word stays', () => {
    const a = p('fix bug #chronos');
    expect(a.projectId).toBe('p-chronos');
    expect(a.title).toBe('fix bug');
    const b = p('fix chronos bug');
    expect(b.projectId).toBe('p-chronos');
    expect(b.title).toBe('fix chronos bug');
  });
  it('literal ranges are never interpreted', () => {
    const r = p('call mom 4pm tomorrow', { literalRanges: [{ start: 9, end: 12 }] });
    expect(r.startMin ?? r.dueTime).toBeUndefined();
    expect(r.date).toBe('2026-11-12');
    expect(r.title).toBe('call mom 4pm');
  });
  it('spans point at the original text and never overlap', () => {
    const r = p('Meeting with SC in the morning of Monday 7:30AM');
    for (const s of r.spans) expect(r.title === '' || 'Meeting with SC in the morning of Monday 7:30AM'.slice(s.start, s.end)).toBe(s.text);
    expect(r.spans.map((s) => s.role)).toEqual(expect.arrayContaining(['project', 'kindKeyword', 'date', 'time']));
  });
  it('user rules reclassify a word', () => {
    const rules = [...ctx.rules, { id: 'u-lab', match: 'lab', kind: 'fixed' as const, source: 'user' as const }];
    expect(p('lab 3pm', { rules }).kind).toBe('fixed');
    const task = [...ctx.rules, { id: 'u-gym', match: 'gym', kind: 'task' as const, source: 'user' as const }];
    expect(p('gym 5-6pm', { rules: task }).kind).toBe('task');
  });
  it('a rule with a project id sets the project', () => {
    const rules = [...ctx.rules, { id: 'u-esp', match: 'esp32', projectId: 'p-greenmech', source: 'user' as const }];
    expect(p('wire esp32 board', { rules }).projectId).toBe('p-greenmech');
  });
});

describe('notes vs tasks (D10)', () => {
  it('uncertain lines carry the other reading', () => {
    const r = p('pizza');
    expect(r.kind).toBe('task');
    expect(r.confidence).toBe('low');
    expect(r.alternatives?.[0]?.kind).toBe('note');
  });
  it('fixed has a task alternative; timed task has a fixed one', () => {
    expect(p('gym 5pm').alternatives?.[0]).toMatchObject({ kind: 'task', dueTime: 1020 });
    expect(p('submit form 5pm').alternatives?.[0]).toMatchObject({ kind: 'fixed', startMin: 1020 });
  });
});
