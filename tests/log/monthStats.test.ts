// Log "This month" stats and filter chips, computed from notes only (Phase 3.5 §5).
import { describe, expect, it } from 'vitest';
import { monthStats, projectsWithPosts, wordCount } from '../../src/core/log';
import type { Idea } from '../../src/core/model/types';
import { at, TZ } from '../helpers';

const note = (id: string, date: string, body: string, extra: Partial<Idea> = {}): Idea => ({
  id, body, text: body, taskId: null, projectId: null, parsedTaskIds: [], reviewed: false,
  createdAt: at(600, date), updatedAt: at(600, date), deviceId: 'd', deletedAt: null, v: 1, ...extra,
} as unknown as Idea);

const notes = [
  note('a', '2026-10-24', 'Ramp pitch from 10 m/s and compare.'),
  note('b', '2026-10-25', '- Find data\n- Reply to coach', { parsedTaskIds: ['L0:t1', 'L1:t2'], projectId: 'p1' }),
  note('c', '2026-10-26', 'Two words'),
  note('d', '2026-10-26', 'Same day'),
  note('e', '2026-09-30', 'Last month, not counted'),
  note('x', '2026-10-20', 'Deleted', { deletedAt: 1 } as Partial<Idea>),
];

describe('monthStats', () => {
  it('counts posts, words, active days, streak and tasks for the month', () => {
    expect(monthStats(notes, TZ, 2026, 10, '2026-10-26')).toEqual({ posts: 4, words: 7 + 5 + 2 + 2, activeDays: 3, streak: 3, tasks: 2 });
  });
  it('a streak survives a day with no post yet', () => {
    expect(monthStats(notes, TZ, 2026, 10, '2026-10-27').streak).toBe(3);
    expect(monthStats(notes, TZ, 2026, 10, '2026-10-28').streak).toBe(0);
  });
  it('an empty month is all zeros', () => {
    expect(monthStats([], TZ, 2026, 10, '2026-10-26')).toEqual({ posts: 0, words: 0, activeDays: 0, streak: 0, tasks: 0 });
  });
  it('words ignore task markers and punctuation', () => {
    expect(wordCount('- Find data — now')).toBe(3);
    expect(wordCount('   ')).toBe(0);
  });
  it('filter chips list projects with live posts', () => {
    expect([...projectsWithPosts(notes)]).toEqual(['p1']);
  });
});
