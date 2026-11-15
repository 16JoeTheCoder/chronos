// Recurrence: the event instances that appear on a local date, after scope
// switches, confirmed closures and per-occurrence exceptions are applied. An
// exception either cancels the date ('skip') or overrides title / start / end /
// tag for that date only ('edit'); the series itself is never touched.

import { live, settingsOf } from '../repo/repo';
import type { CalEvent, Closure, Data, Scope } from '../model/types';
import { addDays, daysBetween, mondayOf, weekdayOf, zonedToUtc } from './zone';

export interface Instance {
  /** The event as it appears on this date (exception overrides applied). */
  event: CalEvent;
  /** The exception applied to this date, if any. */
  exceptionId: string | null;
  date: string;
  startMin: number;
  endMin: number;
  /** UTC ms */
  start: number;
  end: number;
}

/** Does a recurring event fall on this date (weekday, term range, week A/B)? */
export function occursOn(ev: CalEvent, date: string): boolean {
  if (ev.date !== null) return ev.date === date;
  const r = ev.recur;
  if (!r || !r.weekdays.includes(weekdayOf(date))) return false;
  if (r.from && date < r.from) return false;
  if (r.until && date > r.until) return false;
  // Week parity counts whole weeks between the Mondays, so any anchor day in week A works.
  const weeks = Math.floor(daysBetween(mondayOf(r.anchorDate), mondayOf(date)) / 7);
  return ((weeks % r.everyNWeeks) + r.everyNWeeks) % r.everyNWeeks === 0;
}

/** Confirmed closures covering date. */
export function closuresOn(d: Data, date: string): Closure[] {
  return live(d, 'closures').filter((c) => c.confirmed && c.startDate <= date && date <= c.endDate);
}

export function closedScopes(d: Data, date: string): Set<Scope> {
  return new Set(closuresOn(d, date).flatMap((c) => c.scopes));
}

export function expandEvents(d: Data, date: string): Instance[] {
  const s = settingsOf(d);
  const closed = closedScopes(d, date);
  const exceptions = live(d, 'eventExceptions').filter((x) => x.date === date);
  const out: Instance[] = [];
  for (const ev of live(d, 'events')) {
    if (!occursOn(ev, date)) continue;
    if (ev.recur) {
      if (!s.timetable.enabled || !s.timetable.scopes[ev.scope]) continue;
    }
    if (closed.has(ev.scope)) continue;
    const ex = exceptions.find((x) => x.eventId === ev.id);
    if (ex?.kind === 'skip') continue;
    const edit = ex?.kind === 'edit' ? ex : null;
    const startMin = edit?.startMin ?? ev.startMin;
    const endMin = edit?.endMin ?? ev.endMin;
    // An unplaced event ("to place") has no time on the runway yet.
    if (startMin === null || endMin === null || endMin <= startMin) continue;
    const event = edit && (edit.title !== null || edit.tagId !== null) ? { ...ev, title: edit.title ?? ev.title, tagId: edit.tagId ?? ev.tagId } : ev;
    out.push({ event, exceptionId: ex?.id ?? null, date, startMin, endMin, start: zonedToUtc(date, startMin, ev.tz), end: zonedToUtc(date, endMin, ev.tz) });
  }
  return out.sort((a, b) => a.start - b.start);
}

/** One-off events on this date that have no time yet (the runway's "to place" tray). */
export function unplacedOn(d: Data, date: string): CalEvent[] {
  const closed = closedScopes(d, date);
  return live(d, 'events')
    .filter((ev) => ev.date === date && (ev.startMin === null || ev.endMin === null) && !closed.has(ev.scope))
    .sort((a, b) => a.createdAt - b.createdAt || (a.id < b.id ? -1 : 1));
}

/** Instances in the next `hours` from now, scanning the local dates that window touches. */
export function upcoming(d: Data, now: number, today: string, hours: number): Instance[] {
  const until = now + hours * 3_600_000;
  const out: Instance[] = [];
  for (let i = 0; i <= Math.ceil(hours / 24) + 1; i++) {
    const date = addDays(today, i);
    for (const inst of expandEvents(d, date)) if (inst.start >= now && inst.start < until) out.push(inst);
  }
  return out.sort((a, b) => a.start - b.start);
}
