// applyCorrection / learned-rule precedence, and pack import / export / migration.
import { describe, expect, it } from 'vitest';
import { applyCorrection, builtinPack, builtinRules, emptyLearnState, exportPack, importPack, mergePacks, migratePack, PACK_VERSION, parse, validatePack } from '../../src/core/parser';
import type { ParserRule } from '../../src/core/parser';
import { fixtureContext } from './helpers';

const ctx = (rules: ParserRule[]) => fixtureContext({ rules: [...builtinRules, ...rules] });

describe('applyCorrection', () => {
  it('learns a rule after two identical corrections, not after one', () => {
    // "gym" is a built-in fixed word; the user says it is a task, twice.
    const r = parse('gym tomorrow', ctx([]));
    const i = r.spans.findIndex((s) => s.role === 'kindKeyword');
    expect(i).toBeGreaterThanOrEqual(0);
    const one = applyCorrection(r, i, { kind: 'task' }, emptyLearnState());
    expect(one.rule).toBeNull();
    expect(one.state.rules).toEqual([]);
    const two = applyCorrection(r, i, { kind: 'task' }, one.state);
    expect(two.rule).toMatchObject({ match: 'gym', kind: 'task', source: 'learned' });
    expect(two.state.rules).toHaveLength(1);
    expect(two.state.pending).toEqual({});
    // and it takes effect
    expect(parse('gym 5pm', ctx(two.state.rules)).kind).toBe('task');
    expect(parse('gym 5pm', ctx([])).kind).toBe('fixed');
  });

  it('does not count different corrections together', () => {
    const r = parse('lab tomorrow', ctx([]));
    const a = applyCorrection(r, -1, { kind: 'fixed', match: 'lab' });
    const b = applyCorrection(r, -1, { kind: 'task', match: 'lab' }, a.state);
    expect(b.rule).toBeNull();
  });

  it('works for words without a chip and for project corrections', () => {
    const r = parse('lab 3pm', ctx([]));
    let st = emptyLearnState();
    st = applyCorrection(r, -1, { projectId: 'p-greenmech', match: 'lab' }, st).state;
    const out = applyCorrection(r, -1, { projectId: 'p-greenmech', match: 'lab' }, st);
    expect(out.rule).toMatchObject({ match: 'lab', projectId: 'p-greenmech' });
    expect(parse('lab notes', ctx(out.state.rules)).projectId).toBe('p-greenmech');
  });

  it('is pure: the previous state is not mutated', () => {
    const r = parse('lab 3pm', ctx([]));
    const s0 = emptyLearnState();
    applyCorrection(r, -1, { kind: 'fixed', match: 'lab' }, s0);
    expect(s0).toEqual({ rules: [], pending: {} });
  });

  it('a user rule is never replaced by learning', () => {
    const user: ParserRule = { id: 'u-gym', match: 'gym', kind: 'fixed', source: 'user' };
    const r = parse('gym tomorrow', ctx([user]));
    let st = { rules: [user], pending: {} };
    st = applyCorrection(r, -1, { kind: 'task', match: 'gym' }, st).state;
    const out = applyCorrection(r, -1, { kind: 'task', match: 'gym' }, st);
    expect(out.rule).toBeNull();
    expect(out.state.rules).toEqual([user]);
  });

  it('a learned rule the user later overrides is removed', () => {
    const learned: ParserRule = { id: 'l-lab-kind', match: 'lab', kind: 'fixed', source: 'learned' };
    const out = applyCorrection(parse('lab 3pm', ctx([learned])), -1, { kind: 'task', match: 'lab' }, { rules: [learned], pending: {} });
    expect(out.state.rules).toEqual([]);
    expect(out.rule).toBeNull();
  });
});

describe('rule precedence: user > learned > built-in', () => {
  const rule = (source: ParserRule['source'], kind: ParserRule['kind']): ParserRule => ({ id: `${source}-lab`, match: 'lab', kind, source });
  it('user beats learned beats built-in', () => {
    expect(parse('lab 3pm', ctx([])).kind).toBe('task'); // no rule: a time only = task
    expect(parse('lab 3pm', ctx([rule('learned', 'fixed')])).kind).toBe('fixed');
    expect(parse('lab 3pm', ctx([rule('learned', 'fixed'), rule('user', 'task')])).kind).toBe('task');
    expect(parse('lab 3pm', ctx([rule('user', 'task'), rule('learned', 'fixed')])).kind).toBe('task');
  });
  it('a learned rule beats the built-in word', () => {
    const learned: ParserRule = { id: 'l-gym', match: 'gym', kind: 'task', source: 'learned' };
    expect(parse('gym 5pm', ctx([learned])).kind).toBe('task');
  });
});

describe('packs', () => {
  it('the built-in pack is valid and current', () => {
    expect(validatePack(builtinPack)).toEqual([]);
    expect(builtinPack.version).toBe(PACK_VERSION);
    expect(builtinRules.every((r) => r.source === 'builtin')).toBe(true);
  });

  it('exports and imports round-trip', () => {
    const rules: ParserRule[] = [{ id: 'u1', match: 'lab', aliases: ['practical'], kind: 'fixed', defaultDurationMin: 90, source: 'user' }];
    const text = exportPack({ name: 'Mine', rules });
    expect(JSON.parse(text)).toMatchObject({ $schema: 'chronos-parser-pack/1', name: 'Mine', version: PACK_VERSION });
    const back = importPack(text);
    expect(back).toMatchObject({ ok: true });
    if (back.ok) expect(back.pack.rules).toEqual(rules);
    const ctxWith = ctx(back.ok ? back.pack.rules : []);
    expect(parse('practical 3pm', ctxWith)).toMatchObject({ kind: 'fixed', startMin: 900, endMin: 990 });
  });

  it('imports with the chosen source', () => {
    const r = importPack(exportPack({ name: 'x', rules: [{ id: 'a', match: 'a', kind: 'task', source: 'user' }] }), 'learned');
    expect(r.ok && r.pack.rules[0]!.source).toBe('learned');
  });

  it('migrates a version-0 pack (no version, defaultDuration, no source)', () => {
    const old = { $schema: 'chronos-parser-pack/1', name: 'Old', rules: [{ id: 'o1', match: 'lab', kind: 'fixed', defaultDuration: 45 }] };
    const m = migratePack(old);
    expect(m).toMatchObject({ version: PACK_VERSION, name: 'Old' });
    expect(m!.rules[0]).toMatchObject({ defaultDurationMin: 45 });
    expect(m!.rules[0]).not.toHaveProperty('defaultDuration');
    const r = importPack(JSON.stringify(old));
    expect(r.ok && r.pack.rules[0]).toMatchObject({ defaultDurationMin: 45, source: 'user' });
  });

  it('rejects bad packs with reasons', () => {
    expect(importPack('nope')).toEqual({ ok: false, errors: ['not valid JSON'] });
    expect(importPack('{"name":"x"}')).toMatchObject({ ok: false });
    expect(importPack(JSON.stringify({ name: 'x', version: PACK_VERSION + 1, rules: [] }))).toMatchObject({ ok: false, errors: [expect.stringMatching(/newer/)] });
    const bad = importPack(JSON.stringify({ name: 'x', version: 1, rules: [{ id: 'a', match: '', kind: 'bogus' }, { id: 'a', match: 'b' }, { match: 'c' }] }));
    expect(bad.ok).toBe(false);
    if (!bad.ok) expect(bad.errors.join('|')).toMatch(/empty match.*kind must be.*duplicate id.*missing id/s);
  });

  it('merges by match and reports conflicts; ids stay unique', () => {
    const mine: ParserRule[] = [{ id: 'a', match: 'lab', kind: 'task', source: 'user' }, { id: 'b', match: 'gym', kind: 'fixed', source: 'user' }];
    const theirs: ParserRule[] = [{ id: 'a', match: 'Lab', kind: 'fixed', source: 'user' }, { id: 'a', match: 'pool', kind: 'fixed', source: 'user' }];
    const keep = mergePacks(mine, theirs, 'existing');
    expect(keep.conflicts).toHaveLength(1);
    expect(keep.rules.find((r) => r.match.toLowerCase() === 'lab')!.kind).toBe('task');
    expect(new Set(keep.rules.map((r) => r.id)).size).toBe(keep.rules.length);
    const take = mergePacks(mine, theirs, 'incoming');
    expect(take.rules.find((r) => r.match.toLowerCase() === 'lab')!.kind).toBe('fixed');
    expect(mergePacks(mine, mine).conflicts).toEqual([]);
  });
});
