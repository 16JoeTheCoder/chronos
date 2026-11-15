import type { ScheduleEntry } from './types';

export function parseHHMM(s: string): number | null {
  const m = /^(\d{1,2}):(\d{2})$/.exec(s);
  if (!m) return null;
  const h = +m[1]!, min = +m[2]!;
  return h < 24 && min < 60 ? h * 60 + min : null;
}

/**
 * Which theme id is active at `nowMinutes` (0..1439, minutes since local midnight).
 * Empty (or entirely invalid) schedule = the manual `themeId`. Otherwise the entry with the latest
 * `from` <= now wins; before the first entry of the day the last entry wraps over midnight.
 */
export function resolveActiveTheme(themeId: string, themeSchedule: ScheduleEntry[], nowMinutes: number): string {
  const rows = themeSchedule
    .map((e, i) => ({ at: parseHHMM(e.from), id: e.themeId, i }))
    .filter((r): r is { at: number; id: string; i: number } => r.at !== null && !!r.id)
    .sort((a, b) => a.at - b.at || a.i - b.i);
  if (!rows.length) return themeId;
  let pick = rows[rows.length - 1]!;
  for (const r of rows) if (r.at <= nowMinutes) pick = r;
  return pick.id;
}

export const minutesOfDay = (d: Date) => d.getHours() * 60 + d.getMinutes();
