// School timetable helpers: the weekly recurring school CalEvents as per-weekday periods, the
// bell grid (device-local), and the parser's view of one day. No React here except the hook.

import { useSyncExternalStore } from 'react';
import { formatHM, parseHM } from '../../core/format';
import type { Bell, TimetableEntry } from '../../core/parser/types';
import type { Data } from '../../core/model/types';
import { live } from '../../core/repo/repo';
import { expandEvents } from '../../core/time/schedule';
import { weekdayOf } from '../../core/time/zone';

/** One period of the weekly grid: an event on one weekday. */
export interface Period {
  eventId: string;
  /** 1 = Monday .. 7 = Sunday */
  day: number;
  startMin: number;
  endMin: number;
  title: string;
  /** The event repeats on several days, so editing it changes them all. */
  shared: boolean;
}

/** The weekly recurring school events (every week, no end date), one row per weekday, in time order. */
export function periodsOf(d: Data): Period[] {
  const out: Period[] = [];
  for (const ev of live(d, 'events')) {
    if (!ev.recur || ev.scope !== 'school' || ev.startMin === null || ev.endMin === null) continue;
    for (const day of ev.recur.weekdays) out.push({ eventId: ev.id, day, startMin: ev.startMin, endMin: ev.endMin, title: ev.title, shared: ev.recur.weekdays.length > 1 });
  }
  return out.sort((a, b) => a.day - b.day || a.startMin - b.startMin || (a.eventId < b.eventId ? -1 : 1));
}

/** What the parser gets as ParseContext.timetable for `date`: that day's school periods, exceptions applied (skips drop out, edits apply). */
export function timetableFor(d: Data, date: string): TimetableEntry[] {
  const day = weekdayOf(date);
  return expandEvents(d, date)
    .filter((i) => i.event.recur !== null && i.event.scope === 'school')
    .map((i) => ({ day, start: formatHM(i.startMin), end: formatHM(i.endMin), title: i.event.title }));
}

// ---- Bell grid: device-local (no synced field exists for it; see decision D-14x) ----

const KEY = 'chronos.bells.v1';
const subs = new Set<() => void>();
let cache: { raw: string | null; bells: Bell[] } | null = null;

function read(): Bell[] {
  let raw: string | null = null;
  try { raw = localStorage.getItem(KEY); } catch { /* storage blocked */ }
  if (cache && cache.raw === raw) return cache.bells;
  let bells: Bell[] = [];
  try {
    const j: unknown = raw ? JSON.parse(raw) : [];
    if (Array.isArray(j)) bells = j.filter((b): b is Bell => !!b && typeof b.id === 'string' && parseHM(b.start) !== null && parseHM(b.end) !== null);
  } catch { /* corrupt: start empty */ }
  cache = { raw, bells };
  return bells;
}

/** The bell grid (period starts and ends). The parser takes this as ParseContext.bells. */
export const loadBells = (): Bell[] => read();

export function saveBells(bells: Bell[]): void {
  const sorted = [...bells].sort((a, b) => (parseHM(a.start) ?? 0) - (parseHM(b.start) ?? 0));
  try { localStorage.setItem(KEY, JSON.stringify(sorted)); } catch { /* best effort */ }
  cache = null;
  subs.forEach((f) => f());
}

export function useBells(): Bell[] {
  return useSyncExternalStore((f) => { subs.add(f); return () => subs.delete(f); }, read);
}
