// WCAG 2.2 AA contrast for the token pairs the UI actually uses, in both themes (§9.12).
import fs from 'node:fs';
import { describe, expect, it } from 'vitest';

const css = fs.readFileSync('src/renderer/public/tokens.css', 'utf8');

function block(selector: string): Record<string, string> {
  const start = css.indexOf(`${selector} {`);
  const body = css.slice(start, css.indexOf('}', start));
  return Object.fromEntries([...body.matchAll(/--([\w-]+):\s*(#[0-9A-Fa-f]{6})/g)].map((m) => [m[1] as string, m[2] as string]));
}

function luminance(hex: string): number {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255).map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  return 0.2126 * (r as number) + 0.7152 * (g as number) + 0.0722 * (b as number);
}
const ratio = (a: string, b: string) => {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x) as [number, number];
  return (hi + 0.05) / (lo + 0.05);
};

const dark = block(':root');
const light = { ...dark, ...block(':root[data-theme="light"]') };
const TEXT: [string, string][] = [['text', 'bg'], ['text', 's1'], ['text', 's2'], ['text-2', 'bg'], ['text-2', 's1'], ['text-2', 's2'], ['text-3', 'bg'], ['text-3', 's1'], ['on-inverse', 'inverse'], ['on-accent', 'accent'], ['accent-text', 'bg'], ['warn', 'bg'], ['warn', 's1'], ['danger', 'bg'], ['ok', 'bg']];
// The orange accent itself is decorative (caps, the primary fill); meaningful orange marks use --now.
const MARKS: [string, string][] = [['line-strong', 'bg'], ['ring', 'bg'], ['now', 'bg'], ...(['tag1', 'tag2', 'tag3', 'tag4', 'tag5', 'tag6', 'tag7', 'tag8'].map((t) => [t, 'bg']) as [string, string][])];

describe.each([['dark', dark], ['light', light]] as const)('%s theme', (_name, t) => {
  it.each(TEXT)('text %s on %s >= 4.5:1', (fg, bg) => {
    expect(ratio(t[fg] as string, t[bg] as string)).toBeGreaterThanOrEqual(4.5);
  });
  it.each(MARKS)('mark %s on %s >= 3:1', (fg, bg) => {
    expect(ratio(t[fg] as string, t[bg] as string)).toBeGreaterThanOrEqual(3);
  });
});
