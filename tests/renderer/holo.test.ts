// Stark tilt (Phase 3.5 §8): at most 3 degrees, and the CSS multiplier matches.
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { MAX_TILT_DEG, tiltOf } from '../../src/renderer/moments/holo';

describe('holographic tilt', () => {
  it('is capped at 3 degrees', () => {
    expect(MAX_TILT_DEG).toBe(3);
    const css = readFileSync('src/renderer/styles/screens.css', 'utf8');
    const m = css.match(/rotateY\(calc\(var\(--tx, 0\) \* (\d+)deg\)\)/);
    expect(Number(m?.[1]) * 0.5).toBe(MAX_TILT_DEG);
    expect(tiltOf(1000, 1000, { left: 0, top: 0, width: 10, height: 10 })).toEqual({ tx: 0.5, ty: 0.5 });
  });
});
