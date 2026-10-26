import { describe, expect, it } from 'vitest';
import { clip, merge, overlaps, subtract, total } from '../../src/core/time/intervals';

describe('intervals', () => {
  it('merges, clips and subtracts', () => {
    expect(merge([[5, 8], [1, 3], [2, 4], [8, 9]])).toEqual([[1, 4], [5, 9]]);
    expect(clip([[0, 5], [8, 12]], [2, 10])).toEqual([[2, 5], [8, 10]]);
    expect(subtract([0, 10], [[2, 3], [5, 12]])).toEqual([[0, 2], [3, 5]]);
    expect(total([[0, 2], [3, 5]])).toBe(4);
    expect(overlaps([0, 2], [2, 3])).toBe(false);
    expect(overlaps([0, 3], [2, 3])).toBe(true);
  });
});
