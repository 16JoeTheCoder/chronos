// Indonesian public holidays that can be computed (§6.3). Everything movable by
// lunar or other calendars is user-entered. Seeded as unconfirmed closures with
// deterministic ids, so seeding is idempotent on one device and across devices.

import { create, get, type Ctx } from '../repo/repo';
import type { Data } from '../model/types';
import { addDays, dateStr } from './zone';

/** Western Easter Sunday (anonymous Gregorian computus). */
export function easter(year: number): string {
  const a = year % 19, b = Math.floor(year / 100), c = year % 100;
  const d = Math.floor(b / 4), e = b % 4, f = Math.floor((b + 8) / 25), g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4), k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * m + 114) / 31);
  const day = ((h + l - 7 * m + 114) % 31) + 1;
  return dateStr(year, month, day);
}

export function computableHolidays(year: number): { name: string; date: string }[] {
  const e = easter(year);
  return [
    { name: "New Year's Day", date: dateStr(year, 1, 1) },
    { name: 'Good Friday', date: addDays(e, -2) },
    { name: 'Labour Day', date: dateStr(year, 5, 1) },
    { name: 'Ascension of Jesus', date: addDays(e, 39) },
    { name: 'Pancasila Day', date: dateStr(year, 6, 1) },
    { name: 'Independence Day', date: dateStr(year, 8, 17) },
    { name: 'Christmas Day', date: dateStr(year, 12, 25) },
  ];
}

export const holidayId = (date: string) => `hol-${date}`;

/** Seed this year and next. Existing ids (even recycled or purged) are never re-created. */
export function seedHolidays(d: Data, year: number, ctx: Ctx): Data {
  let out = d;
  for (const y of [year, year + 1]) {
    for (const h of computableHolidays(y)) {
      const id = holidayId(h.date);
      if (get(out, 'closures', id) || out.tombs.closures?.[id]) continue;
      out = create(out, 'closures', { name: h.name, startDate: h.date, endDate: h.date, scopes: [], source: 'holiday', confirmed: false }, ctx, id).d;
    }
  }
  return out;
}
