// Property tests with a seeded PRNG (no dependency): never throws, spans never overlap, parse is pure.
import { describe, expect, it } from 'vitest';
import { parseUnsafe } from '../../src/core/parser/parse';
import { parse } from '../../src/core/parser';
import { fixtureContext } from './helpers';

function rng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const WORDS = ['at', 'by', 'due', 'for', 'to', 'from', 'till', 'every', 'other', 'next', 'this', 'in', 'on', 'of', 'the', 'morning', 'tomorrow', 'tmr', 'today', 'tonight', 'mon', 'fri', 'sunday', 'nov', 'dec', 'noon', 'half', 'past', 'quarter', 'daily',
  'weekdays', 'class', 'test', 'exam', 'call', 'gym', 'study', 'hw', 'meeting', 'chronos', 'sc', 'note', 'task', 'event', 'double', 'min', 'mins', 'hrs', 'h', 'm', 'am', 'pm', '4pm', '10to1pm', '3p[m', '16:00', '7:45', '1h30', '~30m', '!1', '#chronos', '//', '- ', '[] ', '@', '12/11', '2026-12-20', '3-5', '10-1', '99', '0', '24:61', '13pm', '😀', 'é', '\u0001', '\n', '\t'];
const CHARS = 'abcdefghijklmnopqrstuvwxyz0123456789 :.,-–/~!#@[](){}$%^&*+=?\'"\\|<>;_é中😀\u0000\u0001\t\n';

function randomInput(r: () => number): string {
  const len = Math.floor(r() * 501);
  let out = '';
  if (r() < 0.5) {
    while (out.length < len) out += WORDS[Math.floor(r() * WORDS.length)] + (r() < 0.85 ? ' ' : '');
  } else {
    for (let i = 0; i < len; i++) out += CHARS[Math.floor(r() * CHARS.length)];
  }
  return out.slice(0, len);
}

describe('properties', () => {
  const ctx = fixtureContext();
  const r = rng(20261114);
  const inputs = Array.from({ length: 1500 }, () => randomInput(r));

  it('never throws (not even internally) on random input up to 500 chars', () => {
    for (const t of inputs) {
      expect(() => parseUnsafe(t, ctx), JSON.stringify(t)).not.toThrow();
      expect(() => parse(t, ctx)).not.toThrow();
    }
    for (const bad of ['', ' ', '\n', undefined as unknown as string, null as unknown as string, 42 as unknown as string]) expect(() => parse(bad, ctx)).not.toThrow();
  });

  it('survives hostile contexts', () => {
    const odd = fixtureContext({ timeZone: 'Not/AZone', now: new Date(NaN), rules: [], projects: [], bells: [{ id: 'x', start: 'zz', end: '' }], timetable: [{ day: 9, start: '', end: 'x', title: '' }], literalRanges: [{ start: -5, end: 9999 }, { start: 4, end: 2 }] });
    for (const t of inputs.slice(0, 200)) expect(() => parse(t, odd)).not.toThrow();
  });

  it('spans stay inside the text, are ordered, and never overlap', () => {
    for (const t of inputs) {
      const spans = parse(t, ctx).spans;
      let prev = 0;
      for (const s of spans) {
        expect(s.start, JSON.stringify(t)).toBeGreaterThanOrEqual(prev);
        expect(s.end).toBeGreaterThan(s.start);
        expect(s.end).toBeLessThanOrEqual(t.length);
        expect(s.text).toBe(t.slice(s.start, s.end));
        prev = s.end;
      }
    }
  });

  it('is pure: same input and context give equal output, and the context is not mutated', () => {
    const before = structuredClone(ctx);
    for (const t of inputs.slice(0, 500)) {
      const a = parse(t, ctx);
      const b = parse(t, ctx);
      expect(b).toEqual(a);
      expect(parse(t, structuredClone(ctx))).toEqual(a);
    }
    expect(ctx).toEqual(before);
  });

  it('end of a fixed event is after its start', () => {
    for (const t of inputs) {
      const res = parse(t, ctx);
      if (res.kind === 'fixed' && res.startMin !== undefined) expect(res.endMin!).toBeGreaterThan(res.startMin);
      if (res.startMin !== undefined) expect(res.startMin).toBeGreaterThanOrEqual(0);
    }
  });
});
