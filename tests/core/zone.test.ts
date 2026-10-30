// Zones and DST: Berlin and Zurich spring-forward / fall-back days, Jakarta (no DST).
import { describe, expect, it } from 'vitest';
import { addDays, dateOf, dayBounds, localParts, mondayOf, weekdayOf, zonedToUtc } from '../../src/core/time/zone';
import { HOUR, MIN } from '../helpers';

describe('Asia/Jakarta (UTC+7, no DST)', () => {
  it('maps wall time both ways', () => {
    const t = zonedToUtc('2026-10-26', 9 * 60, 'Asia/Jakarta');
    expect(new Date(t).toISOString()).toBe('2026-10-26T02:00:00.000Z');
    expect(localParts(t, 'Asia/Jakarta')).toMatchObject({ date: '2026-10-26', hour: 9, minute: 0, weekday: 1 });
    const [s, e] = dayBounds('2026-10-26', 'Asia/Jakarta');
    expect(e - s).toBe(24 * HOUR);
  });
});

describe.each(['Europe/Berlin', 'Europe/Zurich'])('%s', (tz) => {
  it('spring-forward day is 23 h; 02:30 does not exist and shifts to 03:30', () => {
    const [s, e] = dayBounds('2026-03-29', tz);
    expect(e - s).toBe(23 * HOUR);
    expect(new Date(zonedToUtc('2026-03-29', 1 * 60 + 30, tz)).toISOString()).toBe('2026-03-29T00:30:00.000Z');
    expect(new Date(zonedToUtc('2026-03-29', 3 * 60, tz)).toISOString()).toBe('2026-03-29T01:00:00.000Z');
    expect(localParts(zonedToUtc('2026-03-29', 2 * 60 + 30, tz), tz).minutes).toBe(3 * 60 + 30);
  });

  it('fall-back day is 25 h; ambiguous 02:30 maps to the first occurrence', () => {
    const [s, e] = dayBounds('2026-10-25', tz);
    expect(e - s).toBe(25 * HOUR);
    expect(new Date(zonedToUtc('2026-10-25', 2 * 60 + 30, tz)).toISOString()).toBe('2026-10-25T00:30:00.000Z');
    expect(zonedToUtc('2026-10-25', 4 * 60, tz) - zonedToUtc('2026-10-25', 1 * 60, tz)).toBe(4 * HOUR);
  });

  it('dateOf respects local midnight', () => {
    expect(dateOf(Date.UTC(2026, 6, 1, 22, 30), tz)).toBe('2026-07-02');
    expect(dateOf(Date.UTC(2026, 0, 1, 22, 30), tz)).toBe('2026-01-01');
    expect(zonedToUtc('2026-07-02', 0, tz) + 30 * MIN).toBe(Date.UTC(2026, 6, 1, 22, 30));
  });
});

describe('calendar arithmetic', () => {
  it('adds days across months and finds Mondays', () => {
    expect(addDays('2026-12-31', 1)).toBe('2027-01-01');
    expect(addDays('2028-03-01', -1)).toBe('2028-02-29');
    expect(weekdayOf('2026-10-26')).toBe(1);
    expect(weekdayOf('2026-11-01')).toBe(7);
    expect(mondayOf('2026-11-01')).toBe('2026-10-26');
  });
});
