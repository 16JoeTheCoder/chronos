// Phase 3.7: !1..!4 priority and @label words in the quick-add parser.
import { describe, expect, it } from 'vitest';
import { parse } from '../../src/core/parser';
import { fixtureContext } from './helpers';

const p = (t: string) => parse(t, fixtureContext());

describe('priority and labels', () => {
  it('"essay draft fri !4 @school @Home" -> priority 4, lower-case labels, clean title', () => {
    const r = p('essay draft fri !4 @school @Home');
    expect(r.priority).toBe(4);
    expect(r.labels).toEqual(['school', 'home']);
    expect(r.title).toBe('essay draft');
    expect(r.date).toBe('2026-11-13');
    expect(r.title).not.toMatch(/[!@]/);
  });
  it('!1 .. !3 map to priorities 1 .. 3', () => {
    for (const n of [1, 2, 3] as const) expect(p(`essay draft !${n}`).priority).toBe(n);
  });
  it('"call at @5pm" keeps the time and makes no label', () => {
    const r = p('call at @5pm');
    expect(r.dueTime ?? r.startMin).toBe(17 * 60);
    expect(r.labels ?? []).toEqual([]);
  });
  it('"@noon lunch" makes no label "noon"', () => {
    const r = p('@noon lunch');
    expect(r.labels ?? []).not.toContain('noon');
    expect(r.labels ?? []).toEqual([]);
  });
});
