import { describe, expect, it } from 'vitest';
import { live } from '../../src/core/repo/repo';
import { computableHolidays, easter, seedHolidays } from '../../src/core/time/holidays';
import { ctx, fresh } from '../helpers';

describe('holidays', () => {
  it.each([[2026, '2026-04-05'], [2027, '2027-03-28'], [2028, '2028-04-16'], [2029, '2029-04-01'], [2030, '2030-04-21']])('Easter %i = %s', (y, date) => {
    expect(easter(y)).toBe(date);
  });

  it('derives Good Friday and Ascension from Easter', () => {
    const h = computableHolidays(2026);
    expect(h.find((x) => x.name === 'Good Friday')?.date).toBe('2026-04-03');
    expect(h.find((x) => x.name === 'Ascension of Jesus')?.date).toBe('2026-05-14');
    expect(h.map((x) => x.date)).toContain('2026-08-17');
  });

  it('seeds this year and next as unconfirmed closures, idempotently, never resurrecting deleted ones', () => {
    let d = seedHolidays(fresh(), 2026, ctx());
    expect(live(d, 'closures')).toHaveLength(14);
    expect(live(d, 'closures').every((c) => !c.confirmed && c.source === 'holiday')).toBe(true);
    expect(seedHolidays(d, 2026, ctx())).toBe(d);
    d = { ...d, closures: Object.fromEntries(Object.entries(d.closures).filter(([id]) => id !== 'hol-2026-12-25')), tombs: { closures: { 'hol-2026-12-25': { id: 'hol-2026-12-25', updatedAt: 1, deletedAt: 1, deviceId: 'x', v: 1, purged: true } } } };
    expect(seedHolidays(d, 2026, ctx()).closures['hol-2026-12-25']).toBeUndefined();
  });
});
