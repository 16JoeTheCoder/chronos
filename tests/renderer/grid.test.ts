// The Plan time grid (Phase 3.7 §5): fixed px per minute, half-hour lines, minute-aligned now-line.
import { describe, expect, it } from 'vitest';
import { PX_PER_MIN, timeGrid } from '../../src/renderer/runway/grid';
import { zonedToUtc } from '../../src/core/time/zone';

const TZ = 'Asia/Jakarta';
const DAY = '2026-10-26';
const MIN = 60_000;
const from = zonedToUtc(DAY, 6 * 60, TZ);
const to = zonedToUtc(DAY, 24 * 60, TZ);
const t = (h: number, m = 0, s = 0) => zonedToUtc(DAY, h * 60 + m, TZ) + s * 1000;

describe('timeGrid 06:00 - 24:00', () => {
  const now = t(21, 39, 45);
  const g = timeGrid(from, to, now, TZ);

  it('the width is minutes x PX_PER_MIN', () => {
    expect(g.width).toBe(18 * 60 * PX_PER_MIN);
  });
  it('x maps instants linearly and clamps to the grid', () => {
    expect(g.x(from)).toBe(0);
    expect(g.x(t(7))).toBe(60 * PX_PER_MIN);
    expect(g.x(to)).toBe(g.width);
    expect(g.x(from - 5 * MIN)).toBe(0);
    expect(g.x(to + 5 * MIN)).toBe(g.width);
  });
  it('the now-line sits on the current minute, exactly one minute left of the next one', () => {
    expect(g.now).not.toBeNull();
    expect(g.now!.x).toBe(g.x(t(21, 40)) - PX_PER_MIN);
    expect(g.now!.x).toBe(g.x(t(21, 39)));
    expect(g.now!.label).toBe('21:39');
  });
  it('seconds never move the now-line', () => {
    expect(timeGrid(from, to, t(21, 39, 0), TZ).now).toEqual(g.now);
    expect(timeGrid(from, to, t(21, 39, 59), TZ).now).toEqual(g.now);
    expect(timeGrid(from, to, t(21, 40, 0), TZ).now!.x).toBe(g.now!.x + PX_PER_MIN);
  });
  it('has a line every 30 minutes, from the start to the end', () => {
    expect(g.lines).toHaveLength(37);
    expect(g.lines[0]!.ts).toBe(from);
    expect(g.lines.at(-1)!.ts).toBe(to);
    for (let i = 1; i < g.lines.length; i++) {
      expect(g.lines[i]!.ts - g.lines[i - 1]!.ts).toBe(30 * MIN);
      expect(g.lines[i]!.x - g.lines[i - 1]!.x).toBe(30 * PX_PER_MIN);
    }
  });
  it('only whole hours carry a label', () => {
    for (const l of g.lines) {
      const onHour = (l.ts - from) % (60 * MIN) === 0;
      expect(l.major).toBe(onHour);
      expect(l.label === null).toBe(!onHour);
    }
    expect(g.lines[0]!.label).toBe('06:00');
    expect(g.lines[1]!.label).toBeNull();
    expect(g.lines[2]!.label).toBe('07:00');
  });
  it('now is null outside the grid', () => {
    expect(timeGrid(from, to, from - MIN, TZ).now).toBeNull();
    expect(timeGrid(from, to, to + MIN, TZ).now).toBeNull();
    expect(timeGrid(from, to, from, TZ).now).toMatchObject({ x: 0, label: '06:00' });
  });
});

describe('timeGrid starting off the half hour', () => {
  it('lines still sit on real :00 and :30 instants', () => {
    const g = timeGrid(t(6, 10), t(8, 10), t(7), TZ);
    expect(g.lines.map((l) => l.label)).toEqual([null, '07:00', null, '08:00']);
    expect(g.lines[0]!.ts).toBe(t(6, 30));
  });
});
