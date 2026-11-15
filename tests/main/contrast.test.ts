// Colours come from the theme engine now (see tests/theme for the theme contrast rules). What is
// left in tokens.css is the tag palette: data colours, which must read as marks (3:1) on the ground
// of every launch theme in the same mode.
import fs from 'node:fs';
import { describe, expect, it } from 'vitest';
import { contrast, parseColor } from '../../src/core/theme/color';
import { findTheme } from '../../src/renderer/themes';

const css = fs.readFileSync('src/renderer/public/tokens.css', 'utf8');
function tags(selector: string): Record<string, string> {
  const start = css.indexOf(`${selector} {`);
  const body = css.slice(start, css.indexOf('}', start));
  return Object.fromEntries([...body.matchAll(/--(tag\d):\s*(#[0-9A-Fa-f]{6})/g)].map((m) => [m[1] as string, m[2] as string]));
}
const palettes = { dark: tags(':root[data-mode="dark"]'), light: tags(':root[data-mode="light"]') };
const THEMES = ['tactile-instrument', 'stark-workshop', 'tars-gargantua/day', 'tars-gargantua/night'];

describe.each(THEMES)('tag palette on %s', (id) => {
  const t = findTheme(id);
  const ground = parseColor(t.color.ground);
  it.each(Object.entries(palettes[t.mode]))('%s >= 3:1', (_n, hex) => {
    expect(contrast(parseColor(hex)!, ground!)).toBeGreaterThanOrEqual(3);
  });
});
it('has all eight tags in both modes', () => {
  expect(Object.keys(palettes.dark)).toHaveLength(8);
  expect(Object.keys(palettes.light)).toHaveLength(8);
});
it('keeps no other hard-coded colour in tokens.css', () => {
  const rest = css.replace(/--tag\d:\s*#[0-9A-Fa-f]{6};/g, '');
  expect(rest).not.toMatch(/#[0-9A-Fa-f]{3,8}\b/);
});
