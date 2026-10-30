// Time-zone helpers built on Intl only. All timestamps are UTC ms; wall time is
// (date 'YYYY-MM-DD', minutes from local midnight) in an IANA zone. DST-safe:
// offsets are looked up per instant, never assumed constant across a day.

export interface LocalParts {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
  /** 1 = Mon .. 7 = Sun */
  weekday: number;
  date: string;
  /** Minutes since local midnight. */
  minutes: number;
}

const fmtCache = new Map<string, Intl.DateTimeFormat>();
function fmt(tz: string): Intl.DateTimeFormat {
  let f = fmtCache.get(tz);
  if (!f) {
    f = new Intl.DateTimeFormat('en-US', {
      timeZone: tz,
      hourCycle: 'h23',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    });
    fmtCache.set(tz, f);
  }
  return f;
}

export function isValidZone(tz: unknown): tz is string {
  if (typeof tz !== 'string' || !tz) return false;
  try {
    fmt(tz);
    return true;
  } catch {
    return false;
  }
}

const pad = (n: number) => String(n).padStart(2, '0');
export const dateStr = (y: number, m: number, d: number) => `${y}-${pad(m)}-${pad(d)}`;

export function parseDate(date: string): { y: number; m: number; d: number } {
  const [y, m, d] = date.split('-').map(Number);
  return { y: y ?? 1970, m: m ?? 1, d: d ?? 1 };
}

export function localParts(ts: number, tz: string): LocalParts {
  const p: Record<string, number> = {};
  for (const part of fmt(tz).formatToParts(ts)) if (part.type !== 'literal') p[part.type] = Number(part.value);
  const year = p.year ?? 1970, month = p.month ?? 1, day = p.day ?? 1, hour = p.hour ?? 0, minute = p.minute ?? 0, second = p.second ?? 0;
  const date = dateStr(year, month, day);
  return { year, month, day, hour, minute, second, weekday: weekdayOf(date), date, minutes: hour * 60 + minute };
}

/** Offset of tz from UTC at instant ts, in ms (Jakarta: +7h). */
function offsetAt(ts: number, tz: string): number {
  const p = localParts(ts, tz);
  return Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second) - Math.floor(ts / 1000) * 1000;
}

/**
 * The instant at which the wall clock in tz shows `minutes` past midnight on `date`.
 * Minutes may exceed 1440 (next day). A wall time skipped by spring-forward is
 * shifted forward by the gap (02:30 -> 03:30); an ambiguous fall-back time maps
 * to its first occurrence.
 */
export function zonedToUtc(date: string, minutes: number, tz: string): number {
  const { y, m, d } = parseDate(date);
  const wall = Date.UTC(y, m - 1, d, 0, minutes);
  // Offsets a day either side cover both sides of any DST change on this date.
  const candidates = [wall - offsetAt(wall - 86_400_000, tz), wall - offsetAt(wall + 86_400_000, tz)];
  const exact = candidates.filter((t) => t + offsetAt(t, tz) === wall);
  return exact.length ? Math.min(...exact) : Math.max(...candidates);
}

/** [start, end) of the local day in UTC ms (23 or 25 hours long on DST days). */
export function dayBounds(date: string, tz: string): [number, number] {
  return [zonedToUtc(date, 0, tz), zonedToUtc(addDays(date, 1), 0, tz)];
}

export function dateOf(ts: number, tz: string): string {
  return localParts(ts, tz).date;
}

export function addDays(date: string, n: number): string {
  const { y, m, d } = parseDate(date);
  const t = new Date(Date.UTC(y, m - 1, d + n));
  return dateStr(t.getUTCFullYear(), t.getUTCMonth() + 1, t.getUTCDate());
}

export function daysBetween(a: string, b: string): number {
  const pa = parseDate(a), pb = parseDate(b);
  return Math.round((Date.UTC(pb.y, pb.m - 1, pb.d) - Date.UTC(pa.y, pa.m - 1, pa.d)) / 86_400_000);
}

/** 1 = Mon .. 7 = Sun */
export function weekdayOf(date: string): number {
  const { y, m, d } = parseDate(date);
  return ((new Date(Date.UTC(y, m - 1, d)).getUTCDay() + 6) % 7) + 1;
}

/** Monday of the week containing date. */
export function mondayOf(date: string): string {
  return addDays(date, 1 - weekdayOf(date));
}
