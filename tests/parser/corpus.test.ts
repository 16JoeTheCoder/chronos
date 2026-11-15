// Runs tests/parser/corpus.txt through the parser with fixture.json. Format: see the corpus header.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { parse } from '../../src/core/parser';
import type { ParseResult } from '../../src/core/parser';
import { fixtureContext } from './helpers';

const here = __dirname;
const ctx = fixtureContext();
const hhmm = (m: number) => `${String(Math.floor(m / 60) % 24).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;

interface Case { input: string; expect: string[]; line: number }

function load(file: string): Case[] {
  const out: Case[] = [];
  readFileSync(join(here, file), 'utf8').split(/\r?\n/).forEach((raw, i) => {
    const line = raw.replace(/ ## .*$/, '');
    if (!line.trim() || line.startsWith('#')) return;
    const at = line.indexOf(' → ');
    if (at < 0) return;
    out.push({ input: line.slice(0, at), expect: line.slice(at + 3).split(' | ').map((x) => x.trim()), line: i + 1 });
  });
  return out;
}

function timeCol(r: ParseResult): string | undefined {
  if (r.unplaced) return `unplaced ${r.durationMin}`;
  if (r.kind === 'fixed' && r.startMin !== undefined && r.endMin !== undefined) {
    return `${hhmm(r.startMin)}-${hhmm(r.endMin)}${r.endMin > 1440 ? '+1d' : ''}`;
  }
  if (r.dueTime !== undefined) return `due ${hhmm(r.dueTime)}`;
  return undefined;
}

function recCol(r: ParseResult): string | undefined {
  const c = r.recurrence;
  if (!c) return undefined;
  const names = ['', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'];
  if (c.freq === 'daily' && c.interval === 1) return 'daily';
  if (c.weekdays?.join() === '1,2,3,4,5') return 'weekdays';
  const days = (c.weekdays ?? []).map((d) => names[d]).join(' ');
  return c.interval === 1 ? `weekly ${days}` : `every ${c.interval} weeks ${days}`;
}

/** What the parser produced, in the same columns as the corpus. */
function actual(r: ParseResult): Record<string, string | undefined> {
  const proj = ctx.projects.find((p) => p.id === r.projectId)?.name;
  return {
    kind: r.kind, date: r.date, time: timeCol(r), est: r.estimateMin !== undefined ? String(r.estimateMin) : undefined,
    rec: recCol(r), project: proj, prio: r.priority !== undefined ? String(r.priority) : undefined, title: r.title,
  };
}

function check(c: Case): string[] {
  const got = actual(parse(c.input, ctx));
  const errs: string[] = [];
  const [kind, ...cols] = c.expect;
  if (got.kind !== kind) errs.push(`kind: want ${kind}, got ${got.kind}`);
  const want: Record<string, string> = {};
  for (const col of cols) {
    if (/^\d{4}-\d\d-\d\d$/.test(col)) want.date = col;
    else if (/^(\d\d:\d\d-|due |unplaced )/.test(col)) want.time = col;
    else { const m = /^(est|rec|project|prio|title)=(.*)$/.exec(col); if (m) want[m[1]!] = m[2]!; }
  }
  // Absent columns must be absent in the result, except project: corpus lines written before D13 revised
  // (e.g. "3 note feature on sc forms") do not list a project that the revised rule now sets.
  for (const k of ['date', 'time', 'est', 'rec', 'prio', 'title'] as const) {
    if (got[k] !== want[k]) errs.push(`${k}: want ${want[k] ?? '(none)'}, got ${got[k] ?? '(none)'}`);
  }
  if (want.project !== undefined && got.project !== want.project) errs.push(`project: want ${want.project}, got ${got.project ?? '(none)'}`);
  return errs;
}

describe('corpus.txt', () => {
  const cases = load('corpus.txt');
  it('has the expected size', () => expect(cases.length).toBeGreaterThanOrEqual(117));
  for (const c of cases) {
    it(`line ${c.line}: ${c.input}`, () => expect(check(c)).toEqual([]));
  }
});
