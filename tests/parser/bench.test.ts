// Speed: the quick-add re-parses on every keystroke, so a parse must stay far under 5 ms.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { parse } from '../../src/core/parser';
import { fixtureContext } from './helpers';

const lines = readFileSync(join(__dirname, 'corpus.txt'), 'utf8').split(/\r?\n/)
  .filter((l) => l.trim() && !l.startsWith('#') && l.includes(' → ')).map((l) => l.slice(0, l.indexOf(' → ')));

describe('benchmark', () => {
  const ctx = fixtureContext();
  it('averages well under 5 ms per parse over the corpus (1 000 parses)', () => {
    for (const l of lines) parse(l, ctx); // warm up
    const n = 1000;
    const t0 = performance.now();
    for (let i = 0; i < n; i++) parse(lines[i % lines.length]!, ctx);
    const avg = (performance.now() - t0) / n;
    console.log(`parser average: ${avg.toFixed(3)} ms per parse`);
    expect(avg).toBeLessThan(1.5);
  });
  it('a 120-character line stays under 5 ms, worst case', () => {
    const long = 'Student Council Meeting for 30 minutes on Monday morning 8am with Mr. Tjong about the budget draft 3 pages #sc';
    const t0 = performance.now();
    for (let i = 0; i < 200; i++) parse(long, ctx);
    expect((performance.now() - t0) / 200).toBeLessThan(5);
  });
});
