// Log drafts end to end: autosave sequence, publish, drafts hidden from feed and stats, edited flag.
import { describe, expect, it } from 'vitest';
import { apply, type Command, type Result } from '../../src/core/commands';
import { EDITED_AFTER_MS, feedOf, isEdited, monthStats } from '../../src/core/log/calendar';
import type { Data } from '../../src/core/model/types';
import { discardDraft, publishDraft, saveDraft } from '../../src/renderer/log/logic';
import { MIN, T0, ctx, fresh } from '../helpers';

function exec() {
  const st = { d: fresh() as Data, t: T0, log: [] as Command[] };
  const fn = async (c: Command): Promise<Result> => {
    st.log.push(c);
    const r = apply(st.d, c, ctx(st.t));
    if (r.ok) st.d = r.d;
    return r;
  };
  return { st, fn };
}
const ideas = (d: Data) => Object.values(d.ideas).filter((n) => n.deletedAt === null);
const stats = (d: Data) => monthStats(ideas(d), 'Asia/Jakarta', 2026, 10, '2026-10-26');

describe('Log draft flow', () => {
  it('autosave adds once then edits; the draft stays out of the feed and the stats', async () => {
    const { st, fn } = exec();
    let id = await saveDraft(fn, null, 'first line', null);
    expect(id).toBeTruthy();
    st.t += 5_000;
    id = await saveDraft(fn, id, 'first line and more', null);
    st.t += 5_000;
    id = await saveDraft(fn, id, 'first line and more words', null);
    expect(st.log.map((c) => c.type)).toEqual(['idea.add', 'idea.edit', 'idea.edit']);
    expect(ideas(st.d)).toHaveLength(1);
    expect(ideas(st.d)[0]!.draft).toBe(true);
    expect(feedOf(st.d.ideas)).toHaveLength(0);
    expect(stats(st.d).posts).toBe(0);
  });

  it('publish moves the draft into the feed at the publish time, unedited, and counts in the stats', async () => {
    const { st, fn } = exec();
    const id = await saveDraft(fn, null, 'a post', null);
    st.t += 20 * MIN;
    expect(await publishDraft(fn, id, 'a post, finished', null)).toBe(id);
    const feed = feedOf(st.d.ideas);
    expect(feed.map((n) => n.id)).toEqual([id]);
    expect(st.d.ideas[id!]!.draft).toBe(false);
    expect(st.d.ideas[id!]!.publishedAt).toBe(T0 + 20 * MIN);
    expect(isEdited(st.d.ideas[id!]!)).toBe(false);
    expect(stats(st.d).posts).toBe(1);
  });

  it('a later edit past the grace period marks the post edited', async () => {
    const { st, fn } = exec();
    const id = await publishDraft(fn, null, 'posted', null);
    expect(isEdited(st.d.ideas[id!]!)).toBe(false);
    st.t += EDITED_AFTER_MS + MIN;
    expect((await fn({ type: 'idea.edit', id: id!, body: 'posted, then changed' })).ok).toBe(true);
    expect(isEdited(st.d.ideas[id!]!)).toBe(true);
    expect(feedOf(st.d.ideas)).toHaveLength(1);
  });

  it('an empty draft saves nothing and discarding recycles it', async () => {
    const { st, fn } = exec();
    expect(await saveDraft(fn, null, '   ', null)).toBeNull();
    expect(st.log).toHaveLength(0);
    const id = await saveDraft(fn, null, 'x', null);
    await discardDraft(fn, id);
    expect(ideas(st.d)).toHaveLength(0);
  });
});
