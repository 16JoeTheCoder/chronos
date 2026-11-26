import { describe, expect, it } from 'vitest';
import { apply } from '../../src/core/commands';
import { emptyData } from '../../src/core/model/defaults';
import { feedOf, isEdited, monthStats, projectsWithPosts } from '../../src/core/log/calendar';
import { rambleProblem, recordProblem } from '../../src/core/validation';

const ctx = (now: number) => ({ now, deviceId: 'dev', deviceName: 'PC' });

describe('Log drafts (D-184)', () => {
  it('a draft stays out of the feed and stats, publish moves it in at the publish time without the edited flag', () => {
    const r = apply(emptyData(), { type: 'idea.add', text: 'half a thought', taskId: null, draft: true }, ctx(1_000));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const id = r.id!;
    expect(r.d.ideas[id]!.draft).toBe(true);
    expect(feedOf(r.d.ideas)).toHaveLength(0);
    expect(monthStats(Object.values(r.d.ideas), 'UTC', 1970, 1, '1970-01-01').posts).toBe(0);
    expect(projectsWithPosts(Object.values(r.d.ideas)).size).toBe(0);
    const p = apply(r.d, { type: 'idea.edit', id, body: 'a whole thought', draft: false }, ctx(600_000));
    expect(p.ok).toBe(true);
    if (!p.ok) return;
    const n = p.d.ideas[id]!;
    expect(n.draft).toBe(false);
    expect(n.publishedAt).toBe(600_000);
    expect(feedOf(p.d.ideas).map((x) => x.id)).toEqual([id]);
    expect(isEdited(n)).toBe(false);
    expect(recordProblem('ideas', n)).toBeNull();
    const back = apply(p.d, { type: 'idea.edit', id, draft: true }, ctx(700_000));
    expect(back.ok).toBe(false);
  });

  it('records without the field are published (old devices)', () => {
    const r = apply(emptyData(), { type: 'idea.add', text: 'posted', taskId: null }, ctx(5));
    if (!r.ok) throw new Error('add failed');
    expect(r.d.ideas[r.id!]!.draft).toBeUndefined();
    expect(feedOf(r.d.ideas)).toHaveLength(1);
    expect(recordProblem('ideas', { ...r.d.ideas[r.id!]!, draft: 'yes' })).toBe('bad draft');
  });
});

describe('rambles reserve (D-185)', () => {
  const base = { id: 'r1', createdAt: 1, updatedAt: 1, deviceId: 'phone', deletedAt: null, v: 4, fv: {}, fw: {} };
  const ok = { ...base, recordedAt: 1, durationSec: 30, device: 'Pixel', projectId: null, transcript: '', status: 'pending', output: null, model: null, processedAt: null };
  it('accepts a pending ramble and a processed one', () => {
    expect(rambleProblem(ok)).toBeNull();
    expect(rambleProblem({ ...ok, status: 'processed', output: { points: ['a'], summary: 's', tasks: ['t'] }, model: 'm', processedAt: 2 })).toBeNull();
  });
  it('rejects bad status and output', () => {
    expect(rambleProblem({ ...ok, status: 'done' })).toBe('bad status');
    expect(rambleProblem({ ...ok, output: { points: 'a' } })).toBe('bad output');
  });
});
