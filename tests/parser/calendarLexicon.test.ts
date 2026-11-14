import { describe, expect, it } from 'vitest';
import { dowOf, fmtDays, fromDays, localNow, nextDow, parseHHMM, toDays } from '../../src/core/parser/calendar';
import { dateWordOf, fuzzyMatch, unitOf } from '../../src/core/parser/lexicon';

describe('parser calendar', () => {
  it('round-trips whole days and formats ISO dates', () => {
    const d = toDays(2026, 11, 11);
    expect(fromDays(d)).toEqual({ y: 2026, m: 11, d: 11 });
    expect(fmtDays(d)).toBe('2026-11-11');
  });
  it('knows the weekday (Mon = 1) and finds the next one', () => {
    const wed = toDays(2026, 11, 11);
    expect(dowOf(wed)).toBe(3);
    expect(dowOf(nextDow(wed, 1))).toBe(1);
    expect(nextDow(wed, 3)).toBe(wed);
  });
  it('reads wall-clock time in a zone and HH:MM strings', () => {
    const n = localNow(new Date('2026-11-11T14:22:00+07:00'), 'Asia/Jakarta');
    expect(fmtDays(n.today)).toBe('2026-11-11');
    expect(n.nowMin).toBe(14 * 60 + 22);
    expect(parseHHMM('09:05')).toBe(545);
    expect(parseHHMM('9')).toBeNaN();
  });
});

describe('parser lexicon', () => {
  it('fuzzy-matches only close typos and never short words', () => {
    expect(fuzzyMatch('tomorow', ['tomorrow'])).toBe('tomorrow');
    expect(fuzzyMatch('xy', ['tomorrow'])).toBeNull();
  });
  it('reads units, date words and weekdays', () => {
    expect(unitOf('mins', false)).toBe('minute');
    expect(unitOf('hr', false)).toBe('hour');
    expect(dateWordOf('tomorrow')).toMatchObject({ kind: 'short', key: 'tomorrow', fuzzy: false });
    expect(dateWordOf('friday')).toMatchObject({ kind: 'weekday', dow: 5 });
    expect(dateWordOf('banana')).toBeNull();
  });
});
