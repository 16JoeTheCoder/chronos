import { describe, expect, it } from 'vitest';
import { activeColumn, classifySwipe, lockAxis } from '../../src/renderer/components/gesture';
import { quickDates } from '../../src/renderer/tasks/dates';

describe('classifySwipe', () => {
  it('reads long horizontal travel as left or right', () => {
    expect(classifySwipe(120, 8, 400)).toBe('right');
    expect(classifySwipe(-120, -8, 400)).toBe('left');
  });
  it('reads long vertical travel as up or down', () => {
    expect(classifySwipe(4, 150, 400)).toBe('down');
    expect(classifySwipe(4, -150, 400)).toBe('up');
  });
  it('ignores short or diagonal movement', () => {
    expect(classifySwipe(30, 2, 400)).toBeNull();
    expect(classifySwipe(100, 90, 400)).toBeNull();
    expect(classifySwipe(0, 0, 100)).toBeNull();
  });
  it('lets a fast flick travel less', () => {
    expect(classifySwipe(44, 3, 150)).toBe('right');
    expect(classifySwipe(44, 3, 600)).toBeNull();
  });
  it('honours a custom minimum', () => {
    expect(classifySwipe(70, 0, 500, { min: 67 })).toBe('right');
  });
});

describe('lockAxis', () => {
  it('stays undecided inside the slop', () => {
    expect(lockAxis(3, 4)).toBeNull();
  });
  it('locks to the dominant axis', () => {
    expect(lockAxis(20, 3)).toBe('x');
    expect(lockAxis(3, 20)).toBe('y');
  });
  it('treats a near-diagonal as vertical (scrolling wins)', () => {
    expect(lockAxis(12, 11)).toBe('y');
  });
});

describe('activeColumn', () => {
  it('rounds to the nearest snapped column', () => {
    expect(activeColumn(0, 300, 12, 4)).toBe(0);
    expect(activeColumn(160, 300, 12, 4)).toBe(1);
    expect(activeColumn(312, 300, 12, 4)).toBe(1);
    expect(activeColumn(624, 300, 12, 4)).toBe(2);
  });
  it('clamps to the columns that exist', () => {
    expect(activeColumn(99_999, 300, 12, 3)).toBe(2);
    expect(activeColumn(-50, 300, 12, 3)).toBe(0);
    expect(activeColumn(10, 0, 12, 3)).toBe(0);
  });
});

describe('quickDates', () => {
  it('offers today, tomorrow, next Monday and none', () => {
    const q = quickDates('2026-10-28'); // a Wednesday
    expect(q.map((x) => x.label)).toEqual(['Today', 'Tomorrow', 'Next week', 'No date']);
    expect(q.map((x) => x.date)).toEqual(['2026-10-28', '2026-10-29', '2026-11-02', null]);
  });
});
