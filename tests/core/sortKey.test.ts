// Fractional indexing keys.
import { describe, expect, it } from 'vitest';
import { apply } from '../../src/core/commands';
import { isSortKey, keyBetween, keysFor } from '../../src/core/model/sortKey';
import { recordProblem } from '../../src/core/validation';
import { ctx, fresh } from '../helpers';

/** Small deterministic PRNG so failures reproduce. */
function rng(seed: number) {
  return () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const strictlySorted = (xs: string[]) => xs.every((x, i) => i === 0 || (xs[i - 1] as string) < x);

describe('keyBetween', () => {
  it('null bounds: first key, before a key, after a key', () => {
    const first = keyBetween(null, null);
    expect(isSortKey(first)).toBe(true);
    const after = keyBetween(first, null);
    const before = keyBetween(null, first);
    expect(before < first && first < after).toBe(true);
    expect([before, first, after].every(isSortKey)).toBe(true);
  });

  it('returns a key strictly between two adjacent keys', () => {
    const [a, b] = keysFor(2) as [string, string];
    const m = keyBetween(a, b);
    expect(a < m && m < b).toBe(true);
    // and between a key and its own immediate successor-ish neighbour
    for (const [x, y] of [['V', 'W'], ['a', 'a1'], ['a1', 'a2'], ['Zz', 'a'], ['1', '2']] as const) {
      const k = keyBetween(x, y);
      expect(x < k && k < y, `${x} < ${k} < ${y}`).toBe(true);
      expect(isSortKey(k)).toBe(true);
    }
  });

  it('500 random insertions keep a strictly sorted list of valid, unique keys', () => {
    const rand = rng(42);
    const list: string[] = [];
    for (let n = 0; n < 500; n++) {
      const i = Math.floor(rand() * (list.length + 1));
      const k = keyBetween(list[i - 1] ?? null, list[i] ?? null);
      expect(isSortKey(k), k).toBe(true);
      if (i > 0) expect(list[i - 1]! < k).toBe(true);
      if (i < list.length) expect(k < list[i]!).toBe(true);
      list.splice(i, 0, k);
    }
    expect(list).toHaveLength(500);
    expect(strictlySorted(list)).toBe(true);
    expect(new Set(list).size).toBe(500);
  });

  it('always inserting at the front, at the back and in the same gap stays sorted', () => {
    for (const mode of ['front', 'back', 'gap'] as const) {
      let list: string[] = keysFor(2);
      for (let n = 0; n < 200; n++) {
        if (mode === 'front') list = [keyBetween(null, list[0] as string), ...list];
        else if (mode === 'back') list = [...list, keyBetween(list.at(-1) as string, null)];
        else list = [list[0] as string, keyBetween(list[0] as string, list[1] as string), ...list.slice(1)];
      }
      expect(strictlySorted(list), mode).toBe(true);
      expect(list.every(isSortKey), mode).toBe(true);
    }
  });

  it('throws when a >= b', () => {
    expect(() => keyBetween('b', 'a')).toThrow();
    expect(() => keyBetween('a', 'a')).toThrow();
    expect(() => keyBetween('V', 'V')).toThrow();
  });

  it('throws when asked for a key below the zero key', () => {
    expect(() => keyBetween(null, '0')).toThrow();
    expect(() => keyBetween(null, '000')).toThrow();
  });
});

describe('keysFor', () => {
  it('returns n strictly increasing valid keys', () => {
    expect(keysFor(0)).toEqual([]);
    expect(keysFor(1)).toHaveLength(1);
    for (const n of [2, 3, 10, 62, 63, 300]) {
      const ks = keysFor(n);
      expect(ks, String(n)).toHaveLength(n);
      expect(strictlySorted(ks), String(n)).toBe(true);
      expect(ks.every(isSortKey), String(n)).toBe(true);
    }
  });

  // Regression (fixed, D-126): appending keys grows them ~1 char per 6 appends, so keysFor(500) (and 500 task.create calls) exceed isSortKey's 64-char limit (src/core/model/sortKey.ts keyBetween/midpoint)
  it('keeps every key valid for n = 500 (migration of a big v1 file)', () => {
    const ks = keysFor(500);
    expect(strictlySorted(ks)).toBe(true);
    expect(ks.every(isSortKey)).toBe(true);
  });

  // Regression (fixed, D-126): same growth through task.create: the ~385th task gets a key longer than 64 chars, which recordProblem rejects ("bad sortKey") on load
  it('task.create keeps sortKeys valid after 450 tasks', () => {
    let d = fresh();
    for (let i = 0; i < 450; i++) {
      const r = apply(d, { type: 'task.create', input: { title: `Task ${i}` } }, ctx());
      if (!r.ok) throw new Error(r.error);
      d = r.d;
    }
    for (const t of Object.values(d.tasks)) expect(recordProblem('tasks', t), t.id).toBeNull();
  });

  it('is deterministic', () => {
    expect(keysFor(25)).toEqual(keysFor(25));
    // Balanced: every key the same short length, strictly increasing.
    const k = keysFor(5000);
    expect(new Set(k.map((x) => x.length)).size).toBeLessThanOrEqual(2);
    expect(Math.max(...k.map((x) => x.length))).toBeLessThanOrEqual(4);
  });
});

describe('isSortKey', () => {
  it('accepts base-62 strings that do not end in the zero digit', () => {
    for (const k of ['V', 'a', 'Zz', 'a1', '1', '0V', 'A'.repeat(64)]) expect(isSortKey(k), k).toBe(true);
  });
  it('rejects everything else', () => {
    for (const k of ['', '0', 'a0', '00', 'a b', 'a-b', 'é', 'A'.repeat(513), 1, null, undefined, {}, []]) expect(isSortKey(k), String(k)).toBe(false);
  });
});
