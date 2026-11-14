import { describe, expect, it } from 'vitest';
import {
  exportTheme, importTheme, parseColor, composite, contrast, resolveActiveTheme, resolveVariant, themeToCssVars, validateTheme,
  type ChronosTheme,
} from '../../src/core/theme';
import { BUNDLED_FONT_FAMILIES, builtInThemes, findTheme, listThemeChoices, DEFAULT_THEME_ID } from '../../src/renderer/themes';
import schema from '../../src/renderer/themes/schema.json';

const clone = <T,>(x: T): T => JSON.parse(JSON.stringify(x));
const tactile = () => clone(builtInThemes.find((t) => t.id === 'tactile-instrument')!);

describe('launch themes', () => {
  for (const t of builtInThemes) {
    it(`${t.id} validates, passes contrast, no warnings`, () => {
      const r = validateTheme(t, { bundledFamilies: BUNDLED_FONT_FAMILIES });
      expect(r.errors).toEqual([]);
      expect(r.ok).toBe(true);
      expect(r.warnings).toEqual([]);
    });
  }
  it('registry: ids, default and signatures', () => {
    expect(DEFAULT_THEME_ID).toBe('tactile-instrument');
    const sig = (id: string) => findTheme(id).motion.signature.kind;
    expect(sig('tactile-instrument')).toBe('ticking-digits');
    expect(sig('stark-workshop')).toBe('reactor-ring');
    expect(sig('tars-gargantua')).toBe('slab-monolith');
    expect(sig('tars-gargantua/day')).toBe('slab-monolith');
    expect(sig('tars-gargantua/night')).toBe('accretion-ring');
    expect(findTheme('tars-gargantua/night').mode).toBe('dark');
    expect(findTheme('tars-gargantua/night').name).toBe('Gargantua');
    expect(findTheme('nope').id).toBe('tactile-instrument');
    expect(listThemeChoices().map((c) => c.id)).toEqual([
      'tactile-instrument', 'stark-workshop', 'tars-gargantua/day', 'tars-gargantua/night',
    ]);
  });
  it('schema.json declares chronos-theme/1', () => {
    expect(JSON.stringify(schema)).toContain('chronos-theme/1');
  });
});

describe('validation', () => {
  it('rejects bad structure with readable reasons', () => {
    const t = tactile() as any;
    delete t.color.accent;
    t.color.text = 'not-a-colour';
    t.motion.signature.kind = 'sparkles';
    t.fonts.display.source = 'google';
    const r = validateTheme(t);
    expect(r.ok).toBe(false);
    expect(r.errors.join('\n')).toMatch(/"color.accent" is missing/);
    expect(r.errors.join('\n')).toMatch(/"color.text" is not a valid colour/);
    expect(r.errors.join('\n')).toMatch(/signature.kind/);
    expect(r.errors.join('\n')).toMatch(/must be bundled/);
  });
  it('rejects failing body text contrast, with composited rgba', () => {
    const t = tactile() as any;
    t.color.text2 = '#C0C3C8';
    const r = validateTheme(t);
    expect(r.ok).toBe(false);
    expect(r.errors[0]).toMatch(/"color.text2" on ground is [\d.]+:1, body text needs at least 4.5:1/);
    const u = tactile() as any;
    u.color.text = 'rgba(21,23,26,0.3)';
    expect(validateTheme(u).ok).toBe(false);
  });
  it('rejects onAccent vs accent below 4.5 and warns on weak status colours', () => {
    const t = tactile() as any;
    t.color.onAccent = '#3A3D42';
    expect(validateTheme(t).errors.join()).toMatch(/onAccent/);
    const w = tactile() as any;
    w.color.danger = '#D0D2D6';
    const r = validateTheme(w);
    expect(r.ok).toBe(true);
    expect(r.warnings.join()).toMatch(/"color.danger"/);
  });
  it('validates each variant and reports which one fails', () => {
    const t = clone(builtInThemes.find((x) => x.id === 'tars-gargantua')!) as any;
    t.variants.night.color.muted = '#222222';
    const r = validateTheme(t);
    expect(r.ok).toBe(false);
    expect(r.errors[0]).toMatch(/^\[night\]/);
    t.defaultVariant = 'dusk';
    expect(validateTheme(t).errors.join()).toMatch(/defaultVariant/);
  });
  it('contrast math', () => {
    expect(contrast([0, 0, 0, 1], [255, 255, 255, 1])).toBeCloseTo(21, 1);
    expect(parseColor('#fff')).toEqual([255, 255, 255, 1]);
    expect(parseColor('rgba(0,0,0,0.5)')).toEqual([0, 0, 0, 0.5]);
    expect(parseColor('banana')).toBeNull();
    expect(composite([0, 0, 0, 0.5], [255, 255, 255, 1])[0]).toBeCloseTo(127.5);
  });
});

describe('import / export', () => {
  it('round-trips', () => {
    const r = importTheme(exportTheme(tactile()));
    expect(r.ok).toBe(true);
    expect(r.theme?.id).toBe('tactile-instrument');
  });
  it('rejects bad JSON, wrong schema and bad themes with a reason', () => {
    expect(importTheme('{nope').errors[0]).toMatch(/not valid JSON/);
    expect(importTheme('[]').errors[0]).toMatch(/JSON object/);
    expect(importTheme('{"$schema":"x","id":"A/b"}').errors.join()).toMatch(/\$schema/);
    const bad = tactile() as any;
    bad.color.muted = '#E0E2E5';
    const r = importTheme(JSON.stringify(bad));
    expect(r.ok).toBe(false);
    expect(r.theme).toBeUndefined();
    expect(r.errors[0]).toMatch(/contrast/);
  });
});

describe('resolveActiveTheme', () => {
  const sched = [
    { from: '07:00', themeId: 'tars-gargantua/day' },
    { from: '19:30', themeId: 'tars-gargantua/night' },
  ];
  const at = (h: number, m: number) => resolveActiveTheme('stark-workshop', sched, h * 60 + m);
  it('empty schedule = manual theme', () => {
    expect(resolveActiveTheme('stark-workshop', [], 600)).toBe('stark-workshop');
  });
  it('switches on the exact minute', () => {
    expect(at(6, 59)).toBe('tars-gargantua/night');
    expect(at(7, 0)).toBe('tars-gargantua/day');
    expect(at(19, 29)).toBe('tars-gargantua/day');
    expect(at(19, 30)).toBe('tars-gargantua/night');
  });
  it('wraps midnight', () => {
    expect(at(0, 0)).toBe('tars-gargantua/night');
    expect(at(23, 59)).toBe('tars-gargantua/night');
  });
  it('single entry applies all day; order of input does not matter; bad rows ignored', () => {
    expect(resolveActiveTheme('x', [{ from: '12:00', themeId: 'a' }], 60)).toBe('a');
    expect(resolveActiveTheme('x', [...sched].reverse(), 8 * 60)).toBe('tars-gargantua/day');
    expect(resolveActiveTheme('x', [{ from: '25:99', themeId: 'a' }], 60)).toBe('x');
  });
});

describe('themeToCssVars', () => {
  it('maps tokens to the documented names', () => {
    const v = themeToCssVars(findTheme('stark-workshop'));
    expect(v['--c-ground']).toBe('#03060B');
    expect(v['--c-panel-hero']).toBe('rgba(79,216,255,0.07)');
    expect(v['--c-text-2']).toBe('#CFE9F5');
    expect(v['--c-on-accent']).toBe('#03060B');
    expect(v['--c-fixed-block']).toBe('#5F7D8E');
    expect(v['--r-sm']).toBe('10px');
    expect(v['--r-pill']).toBe('999px');
    expect(v['--depth-float']).toBe('0 18px 40px rgba(0,0,0,0.45)');
    expect(v['--font-display']).toBe('"Chakra Petch", system-ui, sans-serif');
    expect(v['--font-num']).toBe('"Chakra Petch", system-ui, sans-serif');
    expect(v['--ease']).toBe('cubic-bezier(.16,1,.3,1)');
    expect(v['--dur-fast']).toBe('160ms');
    expect(v['--dur-base']).toBe('420ms');
    expect(v['--focus-widget-opacity']).toBe('0.18');
    expect(v['--focus-widget-blur']).toBe('1.5px');
  });
  it('applies variants and monospace numerals', () => {
    const raw = builtInThemes.find((t) => t.id === 'tars-gargantua') as ChronosTheme;
    const day = themeToCssVars(raw);
    const night = themeToCssVars(raw, 'night');
    expect(day['--c-ground']).toBe('#E9E7E1');
    expect(night['--c-ground']).toBe('#000000');
    expect(night['--c-ring-bright']).toBe('#FFF4E2');
    expect(day['--font-num']).toBe('"Red Hat Mono", monospace');
    expect(night['--font-num']).toBe('"Michroma", system-ui, sans-serif');
    expect(resolveVariant(raw, 'night').motion.signature.kind).toBe('accretion-ring');
  });
});
