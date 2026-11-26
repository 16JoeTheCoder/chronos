// Read and Write views: markdown-light, editing helpers, day grouping, the draft -> publish command sequence.
import { describe, expect, it } from 'vitest';
import { apply, type Command, type Result } from '../../src/core/commands';
import { bulletEnter } from '../../src/core/log/smartText';
import { dayMarks, feedOf, monthStats, searchLog } from '../../src/core/log';
import { SearchIndex } from '../../src/core/search';
import type { Data } from '../../src/core/model/types';
import { dayHeading, discardDraft, editCommand, groupByDay, latestDraft, publishDraft, readLocalDraft, resumeDraft, saveDraft, takePosts, wrapSelection, writeLocalDraft, LOCAL_DRAFT_KEY } from '../../src/renderer/log/logic';
import { inlineText, parseBlocks, parseInline, safeHref } from '../../src/renderer/log/markdown';
import { MIN, T0, TZ, ctx, fresh } from '../helpers';

/** An executor over in-memory data, like the controller: commands run in order against one Data. */
function exec(start: Data) {
  const st = { d: start, log: [] as Command[], t: T0 };
  const fn = async (c: Command): Promise<Result> => {
    st.log.push(c);
    const r = apply(st.d, c, ctx(st.t));
    if (r.ok) st.d = r.d;
    return r;
  };
  return { st, fn };
}

describe('markdown-light', () => {
  it('bold, italic, links', () => {
    expect(parseInline('a **b** c')).toEqual([{ t: 'text', s: 'a ' }, { t: 'b', c: [{ t: 'text', s: 'b' }] }, { t: 'text', s: ' c' }]);
    expect(parseInline('*it* and _it2_')).toEqual([{ t: 'i', c: [{ t: 'text', s: 'it' }] }, { t: 'text', s: ' and ' }, { t: 'i', c: [{ t: 'text', s: 'it2' }] }]);
    const a = parseInline('see [docs](https://example.org/x) now');
    expect(a[1]).toEqual({ t: 'a', href: 'https://example.org/x', c: [{ t: 'text', s: 'docs' }] });
  });
  it('bare web links become links, trailing punctuation stays out', () => {
    const n = parseInline('go to https://example.org/a.');
    expect(n[1]).toMatchObject({ t: 'a', href: 'https://example.org/a' });
    expect(inlineText(n)).toBe('go to https://example.org/a.');
  });
  it('unsafe schemes are dropped, the text stays', () => {
    expect(safeHref('javascript:alert(1)')).toBeNull();
    expect(safeHref('data:text/html,x')).toBeNull();
    expect(safeHref('file:///etc/passwd')).toBeNull();
    expect(safeHref('//evil.example')).toBeNull();
    const n = parseInline('[click](javascript:alert(1)) done');
    expect(n.some((x) => x.t === 'a')).toBe(false);
    expect(inlineText(n)).toBe('click done');
  });
  it('snake_case and lone stars are left alone', () => {
    expect(inlineText(parseInline('my_var_name and 2 * 3'))).toBe('my_var_name and 2 * 3');
    expect(parseInline('my_var_name').some((x) => x.t === 'i')).toBe(false);
  });
  it('lists and paragraphs', () => {
    const b = parseBlocks(['Intro line', 'second line', '', '- one', '- **two**', '* three', '', 'after']);
    expect(b.map((x) => x.t)).toEqual(['p', 'ul', 'p']);
    expect(b[1]).toMatchObject({ t: 'ul' });
    expect((b[1] as { items: unknown[] }).items).toHaveLength(3);
    expect(inlineText((b[0] as unknown as { c: never[] }).c)).toBe('Intro line\nsecond line');
  });
  it('tags in text stay text (no HTML is ever produced)', () => {
    expect(inlineText(parseInline('<script>x</script> **b**'))).toBe('<script>x</script> b');
  });
});

describe('editing helpers', () => {
  it('Enter in a bullet continues it; an empty bullet ends the list', () => {
    const v = '- one';
    const a = bulletEnter(v, v.length)!;
    expect(a.value).toBe('- one\n- ');
    const b = bulletEnter(a.value, a.value.length)!;
    expect(b.value).toBe('- one\n');
    expect(bulletEnter('plain', 5)).toBeNull();
  });
  it('Ctrl+B / Ctrl+I wrap, and wrap again unwraps', () => {
    const w = wrapSelection('say hello now', 4, 9, '**');
    expect(w.value).toBe('say **hello** now');
    expect(w.value.slice(w.start, w.end)).toBe('hello');
    const u = wrapSelection(w.value, w.start, w.end, '**');
    expect(u.value).toBe('say hello now');
    const i = wrapSelection('x', 0, 1, '*');
    expect(i.value).toBe('*x*');
    const empty = wrapSelection('ab', 1, 1, '*');
    expect(empty.value).toBe('a**b');
    expect(empty.start).toBe(2);
  });
  it('italic does not unwrap half of a bold', () => {
    const w = wrapSelection('**hi**', 2, 4, '*');
    expect(w.value).toBe('***hi***');
  });
});

describe('day grouping', () => {
  it('headings read "Tuesday 17 November"', () => {
    expect(dayHeading('2026-11-17', '2026-11-26')).toBe('Tuesday 17 November');
    expect(dayHeading('2025-12-31', '2026-11-26')).toBe('Wednesday 31 December 2025');
  });
  it('newest first, grouped by day in the user zone; drafts never appear', () => {
    let { d } = { d: fresh() };
    const add = (text: string, now: number, extra: Partial<Command> = {}) => {
      const r = apply(d, { type: 'idea.add', text, taskId: null, ...extra } as Command, ctx(now));
      if (!r.ok) throw new Error(r.error);
      d = r.d;
      return r.id!;
    };
    const day = 24 * 60 * MIN;
    add('old', T0 - day);
    add('mid', T0);
    add('late', T0 + 30 * MIN);
    add('secret draft', T0 + 40 * MIN, { draft: true });
    const groups = groupByDay(feedOf(d.ideas), TZ);
    expect(groups.map((g) => g.posts.map((p) => p.body))).toEqual([['late', 'mid'], ['old']]);
    expect(groups[0]!.date > groups[1]!.date).toBe(true);
    expect(takePosts(groups, 1)).toHaveLength(1);
    expect(takePosts(groups, 3)).toHaveLength(2);
    // core agrees: drafts are out of marks, stats and search
    expect(dayMarks(Object.values(d.ideas), TZ, null).size).toBe(2);
    const ms = monthStats(Object.values(d.ideas), TZ, 2026, 10, '2026-10-26');
    expect(ms.posts).toBe(3);
    expect(ms.words).toBe(3);
    const res = searchLog(d, new SearchIndex(), 'secret', { tz: TZ, today: '2026-10-26', limit: 10 });
    expect(res.hits).toHaveLength(0);
  });
});

describe('draft -> publish flow', () => {
  it('first autosave adds a draft, later saves edit it, publish ends it', async () => {
    const { st, fn } = exec(fresh());
    let id = await saveDraft(fn, null, 'first words', null);
    expect(id).toBeTruthy();
    id = await saveDraft(fn, id, 'first words and more', null);
    expect(st.log.map((c) => c.type)).toEqual(['idea.add', 'idea.edit']);
    expect(st.log[0]).toMatchObject({ draft: true });
    expect(feedOf(st.d.ideas)).toHaveLength(0); // still hidden
    expect(latestDraft(st.d.ideas)?.id).toBe(id);

    st.t = T0 + 20 * MIN;
    const pid = await publishDraft(fn, id, 'first words and more', null);
    expect(pid).toBe(id);
    expect(st.log[st.log.length - 1]).toMatchObject({ type: 'idea.edit', id, body: 'first words and more', projectId: null, draft: false });
    const post = st.d.ideas[id!]!;
    expect(post.draft).toBe(false);
    expect(post.publishedAt).toBe(T0 + 20 * MIN);
    expect(feedOf(st.d.ideas).map((n) => n.id)).toEqual([id]);
    expect(latestDraft(st.d.ideas)).toBeNull();
  });
  it('publishing before any autosave adds then publishes', async () => {
    const { st, fn } = exec(fresh());
    const id = await publishDraft(fn, null, 'quick', null);
    expect(id).toBeTruthy();
    expect(st.log.map((c) => c.type)).toEqual(['idea.add', 'idea.edit']);
    expect(feedOf(st.d.ideas)).toHaveLength(1);
  });
  it('empty text saves and publishes nothing; Back on an empty draft recycles it', async () => {
    const { st, fn } = exec(fresh());
    expect(await saveDraft(fn, null, '   ', null)).toBeNull();
    expect(await publishDraft(fn, null, '', null)).toBeNull();
    expect(st.log).toHaveLength(0);
    const id = await saveDraft(fn, null, 'x', null);
    await discardDraft(fn, id);
    expect(st.log[st.log.length - 1]).toMatchObject({ type: 'recycle', coll: 'ideas', confirmed: true });
    expect(latestDraft(st.d.ideas)).toBeNull();
  });
  it('editing a published post keeps task links on their lines', () => {
    const note = { id: 'n1', body: 'a\nTASK b', parsedTaskIds: ['L1:t_1'], projectId: null };
    const c = editCommand(note, 'new first\nTASK b', null);
    expect(c).toMatchObject({ type: 'idea.edit', id: 'n1', parsedTaskIds: ['L1:t_1'] });
    expect(editCommand(note, 'a\nTASK b', null)).toBeNull();
    expect(editCommand(note, '  ', null)).toBeNull();
  });
});

describe('local draft copy', () => {
  const mem = () => {
    const m = new Map<string, string>();
    return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v), removeItem: (k: string) => void m.delete(k), m };
  };
  it('round trips, clears on empty, survives blocked storage', () => {
    const s = mem();
    writeLocalDraft(s, { id: null, body: 'hi', projectId: null, at: 5 });
    expect(readLocalDraft(s)).toEqual({ id: null, body: 'hi', projectId: null, at: 5 });
    writeLocalDraft(s, { id: null, body: '  ', projectId: null, at: 6 });
    expect(s.m.has(LOCAL_DRAFT_KEY)).toBe(false);
    expect(readLocalDraft(null)).toBeNull();
    expect(() => writeLocalDraft({ setItem: () => { throw new Error('blocked'); }, removeItem: () => { throw new Error('blocked'); } }, { id: null, body: 'x', projectId: null, at: 1 })).not.toThrow();
  });
  it('Write resumes the draft record, or a newer local copy of it', async () => {
    const { st, fn } = exec(fresh());
    const id = (await saveDraft(fn, null, 'from the store', null))!;
    expect(resumeDraft(st.d.ideas, null)).toMatchObject({ id, body: 'from the store' });
    expect(resumeDraft(st.d.ideas, { id, body: 'typed since', projectId: null, at: T0 + 1000 })).toMatchObject({ id, body: 'typed since' });
    expect(resumeDraft(st.d.ideas, { id, body: 'stale', projectId: null, at: T0 - 1000 })).toMatchObject({ body: 'from the store' });
    expect(resumeDraft({}, { id: null, body: 'only local', projectId: null, at: 1 })).toMatchObject({ id: null, body: 'only local' });
    expect(resumeDraft({}, null)).toBeNull();
  });
});
