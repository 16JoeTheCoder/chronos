// Mini calendar and feed helpers. Pure; dates are YYYY-MM-DD in the user's zone.

import type { Idea } from '../model/types';
import { addDays, dateOf, dateStr, weekdayOf } from '../time/zone';

export interface DayCell {
  date: string;
  inMonth: boolean;
}

/** Six Monday-first weeks covering the month (month is 1..12). */
export function monthGrid(year: number, month: number): DayCell[] {
  const first = dateStr(year, month, 1);
  const start = addDays(first, -(weekdayOf(first) - 1));
  return Array.from({ length: 42 }, (_, i) => {
    const date = addDays(start, i);
    return { date, inMonth: Number(date.slice(5, 7)) === month };
  });
}

export interface DayMark {
  /** Posts that day (all projects). */
  count: number;
  /** Posts that day in the current project (second mark). */
  inProject: boolean;
}

/** Days that have posts. `projectId` null = no current project, so no second marks. */
export function dayMarks(notes: readonly Idea[], tz: string, projectId: string | null): Map<string, DayMark> {
  const m = new Map<string, DayMark>();
  for (const n of notes) {
    if (n.deletedAt !== null) continue;
    const date = dateOf(n.createdAt, tz);
    const cur = m.get(date) ?? { count: 0, inProject: false };
    cur.count++;
    if (projectId !== null && n.projectId === projectId) cur.inProject = true;
    m.set(date, cur);
  }
  return m;
}

export const shiftMonth = (year: number, month: number, by: number): { year: number; month: number } => {
  const t = year * 12 + (month - 1) + by;
  return { year: Math.floor(t / 12), month: (t % 12) + 1 };
};

/** Live notes, newest first; a project filter keeps only that project's posts. */
export function feedOf(ideas: Record<string, Idea>, projectId: string | null = null): Idea[] {
  return Object.values(ideas)
    .filter((n) => n.deletedAt === null && (projectId === null || n.projectId === projectId))
    .sort((a, b) => b.createdAt - a.createdAt || (a.id < b.id ? 1 : -1));
}

/** Index in a newest-first feed of the first post on `date`, or the newest post before it. -1 = nothing that old. */
export function indexForDay(feed: readonly Idea[], date: string, tz: string): number {
  // The feed is sorted, so a binary search on the day finds the boundary.
  let lo = 0;
  let hi = feed.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (dateOf(feed[mid]!.createdAt, tz) > date) lo = mid + 1;
    else hi = mid;
  }
  return lo < feed.length ? lo : -1;
}

/** A post is "edited" when it was last saved well after it was posted. */
export const EDITED_AFTER_MS = 60_000;
export const isEdited = (n: Pick<Idea, 'createdAt' | 'updatedAt'>): boolean => n.updatedAt - n.createdAt > EDITED_AFTER_MS;

/** Windowing: first/last item to render for a scroll position, from item heights. */
export function visibleRange(heights: readonly number[], scrollTop: number, viewport: number, overscan = 600): { start: number; end: number; top: number; total: number } {
  const offsets = new Array<number>(heights.length + 1);
  offsets[0] = 0;
  for (let i = 0; i < heights.length; i++) offsets[i + 1] = offsets[i]! + heights[i]!;
  const total = offsets[heights.length]!;
  const lo = Math.max(0, scrollTop - overscan);
  const hi = scrollTop + viewport + overscan;
  const find = (y: number) => {
    let a = 0;
    let b = heights.length;
    while (a < b) {
      const m = (a + b) >> 1;
      if (offsets[m + 1]! <= y) a = m + 1;
      else b = m;
    }
    return a;
  };
  const start = Math.min(find(lo), Math.max(0, heights.length - 1));
  const end = Math.min(heights.length, find(hi) + 1);
  return { start, end, top: offsets[start] ?? 0, total };
}

/** Offset (px) of item `i`. */
export const offsetOf = (heights: readonly number[], i: number): number => {
  let y = 0;
  for (let k = 0; k < i && k < heights.length; k++) y += heights[k]!;
  return y;
};

export interface MonthStats {
  posts: number;
  words: number;
  /** Days in the month with at least one post. */
  activeDays: number;
  /** Consecutive days with a post, ending today (or yesterday when today has none yet). */
  streak: number;
  /** Task lines turned into tasks by posts this month (linked lines, see core/log/links). */
  tasks: number;
}

const wordCount = (s: string): number => (s.trim() ? s.trim().split(/\s+/).filter((w) => /[\p{L}\p{N}]/u.test(w)).length : 0);

/** "This month" in the Log's side column. Computed from notes only (no new fields). month is 1..12. */
export function monthStats(notes: readonly Idea[], tz: string, year: number, month: number, today: string): MonthStats {
  const prefix = `${year}-${String(month).padStart(2, '0')}-`;
  const days = new Set<string>();
  const all = new Set<string>();
  let posts = 0;
  let words = 0;
  let tasks = 0;
  for (const n of notes) {
    if (n.deletedAt !== null) continue;
    const date = dateOf(n.createdAt, tz);
    all.add(date);
    if (!date.startsWith(prefix)) continue;
    posts++;
    days.add(date);
    words += wordCount(n.body);
    tasks += n.parsedTaskIds.length;
  }
  let streak = 0;
  let day = all.has(today) ? today : addDays(today, -1);
  while (all.has(day)) {
    streak++;
    day = addDays(day, -1);
  }
  return { posts, words, activeDays: days.size, streak, tasks };
}

/** Projects that have at least one live post, for the Log's filter chips. */
export function projectsWithPosts(notes: readonly Idea[]): Set<string> {
  const s = new Set<string>();
  for (const n of notes) if (n.deletedAt === null && n.projectId) s.add(n.projectId);
  return s;
}

export { wordCount };
