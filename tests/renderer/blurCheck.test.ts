// Palette blur falls back to dim-only when the frame-time check shows drift.
import { describe, expect, it, vi } from 'vitest';
vi.mock('../../src/renderer/api', () => ({ api: {} }));
import { keepBlur } from '../../src/renderer/palette/blurCheck';
describe('palette blur check', () => {
  it('keeps the blur when ticks stay near 16 ms and drops it when they drift', () => {
    expect(keepBlur([16, 17, 16, 18, 16])).toBe(true);
    expect(keepBlur([40, 35, 50, 16, 45])).toBe(false);
    expect(keepBlur([])).toBe(true);
  });
});
