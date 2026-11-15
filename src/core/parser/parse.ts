// The parser. Scans the line phase by phase; each phase claims characters ("pieces") that later phases skip.
// Phases: prefix, #tags/priority, recurrence, time ranges, durations, single times, dates, rule/project words,
// title cleanup, then classification (fixed / task / note). Pure and deterministic: no clock, no I/O.
import * as chrono from 'chrono-node';
import { dowOf, fmtDays, fromDays, localNow, nextDow, parseHHMM, toDays } from './calendar';
import { LEX, dateWordOf, unitOf } from './lexicon';
import { builtinPack, builtinRules } from './packs';
import type { ParseContext, ParseKind, ParseResult, ParserRule, Recurrence, Span, SpanRole } from './types';

// ---------------------------------------------------------------- regexes

const AN = 'A-Za-z0-9';
const WD = LEX.reWeekday;
const MON = LEX.reMonth;
const MER = String.raw`(?:\s*[ap]\.?m\.?|[ap]\W?m|[ap])`;
const NUM = String.raw`(\d{1,2})(?::(\d{2}))?`;
const PREP = String.raw`(?:(?<![${AN}])(?:at|by|due|from|till|until)\s+|@\s*)`;

const RE_RANGE = new RegExp(String.raw`(?<![\w:.\/\-])(?:(from\s+|at\s+|@\s*))?${NUM}(${MER})?\s*(?:to|till|until|[-–—])\s*${NUM}(${MER})?(?![\w:.\/]|[-–—]\d)`, 'gi');
const RE_HM = /(?<![\w.])(for\s+)?(~\s*)?(\d+)\s*(?:hours?|hrs?|h)(?:(\d{2})|\s*(\d{1,2})\s*(?:minutes?|mins?|m))(?![\w])/gi;
const RE_DUR = /(?<![\w.])(for\s+)?(~\s*)?(\d+(?:[.,]\d+)?)(\s*)([a-z]+)(?![\w])/gi;
const RE_T_MER = new RegExp(String.raw`(${PREP})?(?<![\d:.\/\-])(\d{1,2})(?::(\d{2}))?(${MER})(?![a-z])`, 'gi');
const RE_T_COLON = new RegExp(String.raw`(${PREP})?(?<![\d:.\/\-])(\d{1,2}):(\d{2})(?![\w:])`, 'gi');
const RE_T_BARE = new RegExp(String.raw`(${PREP})(?<![\d:.\/\-])(\d{4}|\d{1,2}(?:[.:]\d{2})?)(?![\w:.\/\-])`, 'gi');
const RE_T_WORD = new RegExp(String.raw`(${PREP})?(?<![${AN}])(noon|midday|midnight)(?![${AN}])`, 'gi');
const RE_T_FRAC = /(?<![A-Za-z0-9])(?:(half)\s+(?:past\s+)?|quarter\s+(past|to)\s+)(\d{1,2})(?![A-Za-z0-9:.])/gi;
const RE_EOW = /(?<![A-Za-z0-9])end\s+of\s+(?:the\s+)?week(?![A-Za-z0-9])/gi;
const RE_TOKEN = /[A-Za-z0-9]+/g;
const RE_MONTH_FIRST = new RegExp(String.raw`(?<![${AN}])(${MON})\.?\s+(\d{1,2})(?:st|nd|rd|th)?(?:\s*,?\s*(\d{4}))?(?![${AN}])`, 'gi');
const RE_DAY_FIRST = new RegExp(String.raw`(?<![${AN}])(\d{1,2})(?:st|nd|rd|th)?\s+(?:of\s+)?(${MON})\.?(?:\s*,?\s*(\d{4}))?(?![${AN}])`, 'gi');
const RE_CHRONO_PRE = /\d{4}-\d{1,2}-\d{1,2}|\d{1,2}\/\d{1,2}|\bin\s+(?:\d+|a|an)\s+(?:day|week|month)/i;
const RE_CHRONO_OK = /^(?:\d{4}-\d{1,2}-\d{1,2}|\d{1,2}\/\d{1,2}(?:\/\d{2,4})?|in\s+(?:\d+|a|an)\s+(?:day|week|month)s?)$/i;
const RE_HASH = /(?<![\w#])#([A-Za-z][\w-]*)/g;
const RE_PRIO = /(?<!\S)!([123])(?![\w])/g;
const REC: [RegExp, (m: RegExpExecArray) => Recurrence | null][] = [
  [new RegExp(String.raw`(?<![${AN}])every\s+other\s+(${WD})(?![${AN}])`, 'gi'), (m) => ({ freq: 'weekly', interval: 2, weekdays: [wdNum(m[1])] })],
  [new RegExp(String.raw`(?<![${AN}])every\s+((?:${WD})(?:\s*(?:,|&|and|\/)?\s*(?:${WD}))*)(?![${AN}])`, 'gi'), (m) => ({ freq: 'weekly', interval: 1, weekdays: weekdaysIn(m[1] ?? '') })],
  [new RegExp(String.raw`(?<![${AN}])every\s+(\d+)\s*(day|week)s?(?![${AN}])`, 'gi'), (m) => ({ freq: m[2]!.toLowerCase() === 'day' ? 'daily' : 'weekly', interval: Math.max(1, Number(m[1])) })],
  [new RegExp(String.raw`(?<![${AN}])(?:every\s*day|daily)(?![${AN}])`, 'gi'), () => ({ freq: 'daily', interval: 1 })],
  [new RegExp(String.raw`(?<![${AN}])weekdays(?![${AN}])`, 'gi'), () => ({ freq: 'weekly', interval: 1, weekdays: [1, 2, 3, 4, 5] })],
  [new RegExp(String.raw`(?<![${AN}])(?:weekly|every\s+week)(?![${AN}])`, 'gi'), () => ({ freq: 'weekly', interval: 1 })],
  [new RegExp(String.raw`(?<![${AN}\/])((?:${WD})(?:\/(?:${WD}))+)(?![${AN}\/])`, 'gi'), (m) => ({ freq: 'weekly', interval: 1, weekdays: weekdaysIn(m[1] ?? '') })],
];
const RE_PREFIX: [RegExp, ParseKind][] = [
  [/^\s*(?:note\s+|\/\/\s*)(?=\S)/i, 'note'],
  [/^\s*(?:task\s+|-\s+|\[\s?\]\s*)(?=\S)/i, 'task'],
  [/^\s*(?:event\s+|@\s+)(?=\S)/i, 'fixed'],
];

function wdNum(s: string | undefined): number { return LEX.weekdayMap.get((s ?? '').toLowerCase()) ?? 1; }
function weekdaysIn(s: string): number[] {
  const out = new Set<number>();
  for (const m of s.matchAll(new RegExp(WD, 'gi'))) out.add(wdNum(m[0]));
  return [...out].sort((a, b) => a - b);
}

// ---------------------------------------------------------------- rule index (cached per rules array)

interface RuleIdx { re: RegExp | null; byKey: Map<string, ParserRule>; fixedRe: RegExp | null; defaultFixedMin: number }
const RANK: Record<string, number> = { builtin: 0, learned: 1, user: 2 };
const escRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const phraseRe = (keys: string[]) => keys.length ? new RegExp(`(?<![${AN}])(?:${[...keys].sort((a, b) => b.length - a.length).map((k) => escRe(k).replace(/\s+/g, '\\s+')).join('|')})(?![${AN}])`, 'gi') : null;
const norm = (s: string) => s.trim().toLowerCase().replace(/\s+/g, ' ');
const ruleCache = new WeakMap<ParserRule[], RuleIdx>();

function ruleIndex(rules: ParserRule[]): RuleIdx {
  const hit = ruleCache.get(rules);
  if (hit) return hit;
  const all = rules.some((r) => r.source === 'builtin') ? rules : [...builtinRules, ...rules];
  const byKey = new Map<string, ParserRule>();
  for (const r of all) {
    for (const w of [r.match, ...(r.aliases ?? [])]) {
      if (typeof w !== 'string' || !w.trim()) continue;
      const k = norm(w);
      const cur = byKey.get(k);
      if (!cur || (RANK[r.source] ?? 0) >= (RANK[cur.source] ?? 0)) byKey.set(k, r);
    }
  }
  const fixedKeys = [...byKey].filter(([, r]) => r.kind === 'fixed').map(([k]) => k);
  const idx = { re: phraseRe([...byKey.keys()]), byKey, fixedRe: phraseRe(fixedKeys), defaultFixedMin: builtinPack.defaultFixedDurationMin ?? 60 };
  ruleCache.set(rules, idx);
  return idx;
}

// ---------------------------------------------------------------- state

interface Piece { start: number; end: number; role: SpanRole; value: unknown; eat: boolean; prep?: string; estimate?: boolean; fuzzy?: boolean; inferred?: boolean; mins?: number; dateRank?: number; rule?: ParserRule }
interface St {
  src: string; work: string; used: Uint8Array; pieces: Piece[];
  today: number; nowMin: number; ctx: ParseContext;
  rec?: Recurrence; deadline: boolean; double: boolean; warnings: string[];
}

function take(s: St, start: number, end: number, role: SpanRole, value: unknown, extra: Partial<Piece> = {}): Piece | null {
  if (start < 0 || end > s.src.length || start >= end) return null;
  for (let i = start; i < end; i++) if (s.used[i]) return null;
  s.used.fill(1, start, end);
  const eat = extra.eat ?? true;
  s.work = s.work.slice(0, start) + '\u0001'.repeat(end - start) + s.work.slice(end);
  const p: Piece = { start, end, role, value, eat, ...extra };
  s.pieces.push(p);
  return p;
}

// ---------------------------------------------------------------- time helpers

const to24 = (h: number, mer: 'a' | 'p'): number | null => (h >= 1 && h <= 12 ? (h % 12) + (mer === 'p' ? 12 : 0) : null);
const merOf = (m: string | undefined): 'a' | 'p' | undefined => { const c = m?.trim().toLowerCase()[0]; return c === 'a' ? 'a' : c === 'p' ? 'p' : undefined; };

/** Bare-hour rule: 1-6 = pm, 7-11 = am, 12 = noon, 13-23 = 24 h clock; "04:30" (leading zero) is 24 h. */
function bareHour(raw: string, h: number): number | null {
  if (h > 23) return null;
  if (raw.length === 2 && raw.startsWith('0')) return h;
  if (h >= 1 && h <= 6) return h + 12;
  return h;
}

interface Clock { h: number; raw: string; mi: number; mer?: 'a' | 'p' }

function clockMin(c: Clock, mer = c.mer): number | null {
  if (c.mi > 59) return null;
  const h = mer ? to24(c.h, mer) : bareHour(c.raw, c.h);
  return h === null ? null : h * 60 + c.mi;
}

function rangeMins(a: Clock, b: Clock): { s: number; e: number } | null {
  let s: number | null, e: number | null;
  if (a.mer && b.mer) {
    s = clockMin(a); e = clockMin(b);
    if (s === null || e === null) return null;
    if (e <= s) e += 1440;
  } else if (a.mer) {
    s = clockMin(a); e = clockMin(b, b.h >= 1 && b.h <= 12 ? a.mer : undefined);
    if (s === null || e === null) return null;
    for (let i = 0; i < 2 && e <= s; i++) e += 720;
    if (e <= s) e += 1440;
  } else if (b.mer) {
    e = clockMin(b); s = clockMin(a, b.mer);
    if (s === null || e === null) return null;
    if (s >= e) s = clockMin(a, b.mer === 'p' ? 'a' : 'p');
    if (s === null || s >= e) return null;
  } else {
    s = clockMin(a); e = clockMin(b);
    if (s === null || e === null) return null;
    for (let i = 0; i < 2 && e <= s; i++) e += 720;
    if (e <= s) e += 1440;
  }
  return { s, e };
}

// ---------------------------------------------------------------- phases

function phaseHashAndPriority(s: St): { hash: boolean; priority?: 1 | 2 | 3 } {
  let hash = false;
  let priority: 1 | 2 | 3 | undefined;
  for (const m of s.work.matchAll(RE_HASH)) {
    const name = m[1]!.toLowerCase();
    const proj = s.ctx.projects.find((p) => p.name.toLowerCase() === name || p.aliases?.some((a) => a.toLowerCase() === name));
    if (proj) { if (take(s, m.index!, m.index! + m[0].length, 'project', { projectId: proj.id, via: 'hash' })) hash = true; continue; }
    const tag = s.ctx.tags.find((t) => t.name.toLowerCase() === name);
    if (tag && take(s, m.index!, m.index! + m[0].length, 'tag', { tagId: tag.id })) hash = true;
  }
  for (const m of s.work.matchAll(RE_PRIO)) {
    if (priority === undefined && take(s, m.index!, m.index! + m[0].length, 'priority', Number(m[1]))) priority = Number(m[1]) as 1 | 2 | 3;
  }
  return { hash, priority };
}

function phaseRecurrence(s: St): void {
  for (const [re, make] of REC) {
    for (const m of s.work.matchAll(re)) {
      const rec = make(m as RegExpExecArray);
      if (rec && take(s, m.index!, m.index! + m[0].length, 'recurrence', rec)) { s.rec = rec; return; }
    }
  }
}

function hasTimeContext(s: St, idx: RuleIdx): boolean {
  return LEX.timeContext.test(s.src) || (idx.fixedRe ? new RegExp(idx.fixedRe.source, 'i').test(s.work) : false);
}

function phaseRanges(s: St, idx: RuleIdx): void {
  for (const m of s.work.matchAll(RE_RANGE)) {
    const [, pre, h1, m1, mer1, h2, m2, mer2] = m;
    const hasColon = (x?: string) => x !== undefined;
    const a: Clock = { h: Number(h1), raw: h1!, mi: Number(m1 ?? 0), mer: merOf(mer1) };
    const b: Clock = { h: Number(h2), raw: h2!, mi: Number(m2 ?? 0), mer: merOf(mer2) };
    const explicit = a.mer || b.mer || hasColon(m1) || hasColon(m2);
    let inferred = false;
    if (!explicit) {
      // D6: two bare numbers are a clock range only with a time word around and both read as 12 h hours.
      const before = s.work.slice(Math.max(0, m.index! - 24), m.index!).trim().split(/\s+/).pop()?.toLowerCase() ?? '';
      if (a.h < 1 || a.h > 12 || b.h < 1 || b.h > 12 || a.h === b.h || LEX.quantityNouns.has(before)) continue;
      if (!pre && !hasTimeContext(s, idx)) continue;
      inferred = true;
    }
    const r = rangeMins(a, b);
    if (!r) continue;
    take(s, m.index!, m.index! + m[0].length, 'timeRange', { startMin: r.s, endMin: r.e }, { prep: pre?.trim().toLowerCase(), inferred, mins: r.s });
    return;
  }
}

function phaseDuration(s: St): void {
  for (const m of s.work.matchAll(RE_HM)) {
    const mins = Number(m[3]) * 60 + Number(m[4] ?? m[5]);
    if (mins > 0 && mins <= 1440 && take(s, m.index!, m.index! + m[0].length, 'duration', { minutes: mins, estimate: !!m[2] }, { mins, estimate: !!m[2] })) return;
  }
  for (const m of s.work.matchAll(RE_DUR)) {
    const word = m[5]!;
    const unit = unitOf(word, m[4] === '');
    if (!unit) continue;
    const n = Number(m[3]!.replace(',', '.'));
    const mins = Math.round(unit === 'hour' ? n * 60 : n);
    if (!(mins > 0 && mins <= 1440)) continue;
    const fuzzy = !/^(?:m|min|mins|minutes?|h|hr|hrs|hours?)$/i.test(word);
    if (take(s, m.index!, m.index! + m[0].length, 'duration', { minutes: mins, estimate: !!m[2] }, { mins, estimate: !!m[2], fuzzy })) return;
  }
}

function phaseSingleTime(s: St): void {
  type Cand = { index: number; len: number; min: number; prep?: string; fuzzy?: boolean };
  const cands: Cand[] = [];
  const prepOf = (p: string | undefined) => p?.trim().toLowerCase().replace(/\s+/g, '') || undefined;
  const hm = (rawH: string, mi: string | undefined, mer: 'a' | 'p' | undefined, bare: boolean): number | null => {
    const h = Number(rawH), m = Number(mi ?? 0);
    if (m > 59) return null;
    const hh = mer ? to24(h, mer) : bare || mi !== undefined ? bareHour(rawH, h) : null;
    return hh === null ? null : hh * 60 + m;
  };
  const nextWordBlocks = (end: number) => {
    const w = /^\s*([A-Za-z]+)/.exec(s.work.slice(end))?.[1]?.toLowerCase();
    return !!w && (LEX.quantityNouns.has(w) || unitOf(w, false) !== null);
  };
  for (const m of s.work.matchAll(RE_T_MER)) {
    const min = hm(m[2]!, m[3], merOf(m[4]), true);
    if (min !== null) cands.push({ index: m.index!, len: m[0].length, min, prep: prepOf(m[1]), fuzzy: !/^\s*[ap]\.?m\.?$/i.test(m[4] ?? '') });
  }
  for (const m of s.work.matchAll(RE_T_COLON)) {
    const min = hm(m[2]!, m[3], undefined, true);
    if (min !== null) cands.push({ index: m.index!, len: m[0].length, min, prep: prepOf(m[1]) });
  }
  for (const m of s.work.matchAll(RE_T_BARE)) {
    const body = m[2]!;
    if (nextWordBlocks(m.index! + m[0].length)) continue;
    let min: number | null = null;
    if (/^\d{4}$/.test(body)) { const h = Number(body.slice(0, 2)), mi = Number(body.slice(2)); min = h < 24 && mi < 60 ? h * 60 + mi : null; }
    else { const [h, mi] = body.split(/[.:]/); min = hm(h!, mi, undefined, true); }
    if (min !== null) cands.push({ index: m.index!, len: m[0].length, min, prep: prepOf(m[1]) });
  }
  for (const m of s.work.matchAll(RE_T_WORD)) {
    const v = LEX.timeWords[m[2]!.toLowerCase()];
    if (v !== undefined) cands.push({ index: m.index!, len: m[0].length, min: prepOf(m[1]) === 'by' || prepOf(m[1]) === 'due' ? Math.min(v, 1439) : v % 1440, prep: prepOf(m[1]) });
  }
  for (const m of s.work.matchAll(RE_T_FRAC)) {
    const h = bareHour(m[3]!, Number(m[3]));
    if (h === null || h < 0) continue;
    const half = !!m[1];
    cands.push({ index: m.index!, len: m[0].length, min: half ? h * 60 + 30 : (m[2]!.toLowerCase() === 'past' ? h * 60 + 15 : h * 60 - 15) });
  }
  cands.sort((a, b) => a.index - b.index);
  for (const c of cands) {
    if (take(s, c.index, c.index + c.len, 'time', { min: c.min }, { prep: c.prep, mins: c.min, fuzzy: c.fuzzy })) return;
  }
}

function validYmd(y: number, m: number, d: number): number | null {
  if (m < 1 || m > 12 || d < 1 || d > 31) return null;
  const days = toDays(y, m, d);
  const back = fromDays(days);
  return back.m === m && back.d === d ? days : null;
}

function phaseDates(s: St): void {
  const today = s.today;
  const claim = (start: number, end: number, rank: number, days: number | null, extra: Partial<Piece> = {}) => {
    if (days === null) return;
    let a = start;
    if (rank === 4 && s.rec) {
      const u = /(?:until|till)\s+$/i.exec(s.work.slice(Math.max(0, start - 8), start));
      if (u) { a = start - u[0].length; s.rec.until = fmtDays(days); }
    }
    take(s, a, end, 'date', { date: fmtDays(days) }, { ...extra, dateRank: rank, mins: days });
  };
  const yearFor = (m: number, d: number, y?: string): number | null => {
    if (y) return validYmd(Number(y), m, d);
    const cur = fromDays(today).y;
    const v = validYmd(cur, m, d);
    return v !== null && v < today ? validYmd(cur + 1, m, d) : v;
  };
  // Absolute: "nov 20", "12 nov", "12 nov 2026"
  for (const m of s.work.matchAll(RE_MONTH_FIRST)) claim(m.index!, m.index! + m[0].length, 4, yearFor(LEX.monthMap.get(m[1]!.toLowerCase())!, Number(m[2]), m[3]));
  for (const m of s.work.matchAll(RE_DAY_FIRST)) claim(m.index!, m.index! + m[0].length, 4, yearFor(LEX.monthMap.get(m[2]!.toLowerCase())!, Number(m[1]), m[3]));
  // Numeric, ISO and "in N days": chrono-node (day/month order)
  const plain = s.work.replace(/\u0001/g, ' ');
  if (RE_CHRONO_PRE.test(plain)) {
    const ref = new Date(fromDays(today).y, fromDays(today).m - 1, fromDays(today).d, 12, 0, 0);
    for (const r of chrono.en.GB.parse(plain, ref, { forwardDate: true })) {
      if (!RE_CHRONO_OK.test(r.text.trim())) continue;
      const y = r.start.get('year'), mo = r.start.get('month'), d = r.start.get('day');
      if (y && mo && d) claim(r.index, r.index + r.text.length, /^in/i.test(r.text) ? 3 : 4, validYmd(y, mo, d));
    }
  }
  // End of week
  for (const m of s.work.matchAll(RE_EOW)) claim(m.index!, m.index! + m[0].length, 2, nextDow(today, 5));
  // Single words: today, tmr, weekdays, with next/this
  for (const m of s.work.matchAll(RE_TOKEN)) {
    const w = dateWordOf(m[0]);
    if (!w) continue;
    const at = m.index!;
    if (w.kind === 'short') {
      if (w.key === 'yesterday') { s.warnings.push('yesterday is in the past; date ignored'); continue; }
      const days = w.key === 'tomorrow' ? today + 1 : w.key === 'weekend' ? nextDow(today, 6) : w.key === 'endOfWeek' ? nextDow(today, 5) : today;
      claim(at, at + m[0].length, 2, days, { fuzzy: w.fuzzy });
    } else {
      const mod = /(?<![A-Za-z])(next|this|coming)\s+$/i.exec(s.work.slice(Math.max(0, at - 10), at));
      let days = nextDow(today, w.dow);
      if (mod && mod[1]!.toLowerCase() === 'next') days = today - (dowOf(today) - 1) + 7 + (w.dow - 1);
      claim(mod ? at - mod[0].length : at, at + m[0].length, 1, days, { fuzzy: w.fuzzy });
    }
  }
}

function phaseWords(s: St, idx: RuleIdx): ParserRule[] {
  const matched: ParserRule[] = [];
  // Project names and aliases: the word stays in the title.
  const names = new Map<string, string>();
  for (const p of s.ctx.projects) for (const n of [p.name, ...(p.aliases ?? [])]) if (n?.trim()) names.set(norm(n), p.id);
  const pre = phraseRe([...names.keys()]);
  if (pre) for (const m of s.work.matchAll(pre)) {
    const id = names.get(norm(m[0]));
    if (id) take(s, m.index!, m.index! + m[0].length, 'project', { projectId: id, via: 'name' }, { eat: false });
  }
  if (idx.re) for (const m of s.work.matchAll(idx.re)) {
    const rule = idx.byKey.get(norm(m[0]));
    if (!rule) continue;
    const role: SpanRole = rule.kind ? 'kindKeyword' : rule.projectId ? 'project' : rule.tagId ? 'tag' : 'kindKeyword';
    const value = role === 'project' ? { projectId: rule.projectId, via: 'rule', ruleId: rule.id } : role === 'tag' ? { tagId: rule.tagId, ruleId: rule.id } : { kind: rule.kind, ruleId: rule.id, source: rule.source };
    if (take(s, m.index!, m.index! + m[0].length, role, value, { eat: false, rule })) matched.push(rule);
  }
  if (s.ctx.bells?.length) for (const m of s.work.matchAll(/(?<![A-Za-z])double(?![A-Za-z])/gi)) if (take(s, m.index!, m.index! + m[0].length, 'kindKeyword', { double: true })) s.double = true;
  return matched;
}

/** D12: remove connectors (at/on/by/due/for) and day parts next to consumed pieces; a leading "in" after a duration. */
function phaseCleanup(s: St): void {
  const src = s.src;
  const isSp = (c: string | undefined) => c !== undefined && /\s/.test(c);
  const free = (a: number, b: number) => { for (let i = a; i < b; i++) if (s.used[i]) return false; return true; };
  const wordBefore = (end: number) => { const m = /([A-Za-z]+)$/.exec(src.slice(Math.max(0, end - 12), end)); return m ? { start: end - m[1]!.length, text: m[1]!.toLowerCase() } : null; };
  for (const p of [...s.pieces].filter((x) => x.eat).sort((a, b) => a.start - b.start)) {
    for (let changed = true; changed;) {
      changed = false;
      let j = p.start;
      while (j > 0 && isSp(src[j - 1])) j--;
      for (const phrase of LEX.dayParts) {
        const a = j - phrase.length;
        if (a >= 0 && src.slice(a, j).toLowerCase() === phrase && !/[A-Za-z0-9]/.test(src[a - 1] ?? ' ') && free(a, p.start)) { s.used.fill(1, a, p.start); p.start = a; changed = true; break; }
      }
      if (changed) continue;
      const w = wordBefore(j);
      if (w && LEX.connectors.has(w.text) && !/[A-Za-z0-9]/.test(src[w.start - 1] ?? ' ') && free(w.start, p.start)) {
        if (w.text === 'by' || w.text === 'due') s.deadline = true;
        s.used.fill(1, w.start, p.start); p.start = w.start; changed = true; continue;
      }
      let k = p.end;
      while (k < src.length && isSp(src[k])) k++;
      const r = /^[A-Za-z]+/.exec(src.slice(k, k + 12))?.[0];
      if (r && LEX.dayPartSingles.has(r.toLowerCase()) && !/[A-Za-z0-9]/.test(src[k + r.length] ?? ' ') && free(p.end, k + r.length)) { s.used.fill(1, p.end, k + r.length); p.end = k + r.length; changed = true; continue; }
      if (p.role === 'duration' && r?.toLowerCase() === 'in' && !/[A-Za-z0-9]/.test(src[k + 2] ?? ' ') && free(p.end, k + 2) && !blanked(s, p.start)) { s.used.fill(1, p.end, k + 2); p.end = k + 2; changed = true; }
    }
  }
}

// ---------------------------------------------------------------- classification + result

/** The text before `end` with consumed pieces removed. */
function blanked(s: St, end = s.src.length): string {
  let out = '';
  for (let i = 0; i < end; i++) out += s.pieces.some((p) => p.eat && i >= p.start && i < p.end) ? ' ' : s.src[i];
  return tidy(out);
}
const buildTitle = (s: St) => blanked(s);

const tidy = (t: string) => t.replace(/\s+/g, ' ').replace(/^[\s,;:\-–—]+/, '').replace(/[\s,;:!\-–—]+$/, '');
const firstWord = (t: string) => (/^[^\s]+/.exec(t.trim())?.[0] ?? '').toLowerCase().replace(/[^a-z0-9'’]/g, '');

function matchTimetable(ctx: ParseContext, days: number, subject: string): { startMin: number; endMin: number } | null {
  const dow = dowOf(days);
  const words = subject.toLowerCase().split(/\s+/).filter(Boolean);
  const cands: string[] = [];
  for (let n = 1; n <= Math.min(3, words.length); n++) cands.push(words.slice(-n).join(' '));
  const rows = (ctx.timetable ?? []).filter((e) => e.day === dow).sort((a, b) => parseHHMM(a.start) - parseHHMM(b.start));
  for (const e of rows) {
    const names = [e.title, ...(e.aliases ?? [])].map((x) => x.toLowerCase());
    if (cands.some((c) => names.some((n) => n === c || n.startsWith(c) || (n.length >= 3 && c.startsWith(n))))) {
      const st = parseHHMM(e.start), en = parseHHMM(e.end);
      if (!Number.isNaN(st) && !Number.isNaN(en) && en > st) return { startMin: st, endMin: en };
    }
  }
  return null;
}

/** Length from the schedule: a timetable period starting then (for classes, or when its title is in the event title), else one bell. */
function scheduleLength(ctx: ParseContext, days: number, start: number, isClass: boolean, double: boolean, title: string): number | null {
  const lower = title.toLowerCase();
  const words = lower.split(/\s+/).filter((w) => w.length >= 4);
  const entry = (ctx.timetable ?? []).find((e) => {
    if (e.day !== dowOf(days) || parseHHMM(e.start) !== start) return false;
    return isClass || [e.title, ...(e.aliases ?? [])].map((x) => x.toLowerCase()).some((n) => lower.includes(n) || words.some((w) => n.startsWith(w)));
  });
  if (entry) { const d = parseHHMM(entry.end) - start; if (d > 0) return d; }
  const useBells = isClass;
  if (useBells) {
    const bells = ctx.bells ?? [];
    const i = bells.findIndex((b) => parseHHMM(b.start) === start);
    const b = bells[i];
    if (b) {
      const last = double && bells[i + 1] ? bells[i + 1]! : b;
      const d = parseHHMM(last.end) - start;
      if (d > 0) return d;
    }
  }
  return null;
}

export function parseUnsafe(input: string, ctx: ParseContext): ParseResult {
  const src = typeof input === 'string' ? input : String(input ?? '');
  const { today, nowMin } = localNow(ctx.now, ctx.timeZone);
  const s: St = { src, work: src, used: new Uint8Array(src.length), pieces: [], today, nowMin, ctx, deadline: false, double: false, warnings: [] };
  const idx = ruleIndex(ctx.rules ?? []);

  for (const r of ctx.literalRanges ?? []) {
    const a = Math.max(0, Math.floor(r.start)), b = Math.min(src.length, Math.floor(r.end));
    if (a < b) { s.used.fill(1, a, b); s.work = s.work.slice(0, a) + '\u0001'.repeat(b - a) + s.work.slice(b); }
  }

  // Explicit prefixes: note / // , task / - / [] , event / @
  let forced: ParseKind | undefined;
  for (const [re, kind] of RE_PREFIX) {
    const m = re.exec(src);
    if (m && take(s, m.index, m[0].length, 'kindKeyword', { kind, prefix: true })) { forced = kind; break; }
  }
  if (forced === 'note' || (!forced && ctx.mode === 'notepad')) return finishNote(s, forced ? 'high' : 'medium', forced ? undefined : []);

  const { hash, priority } = phaseHashAndPriority(s);
  phaseRecurrence(s);
  phaseRanges(s, idx);
  phaseDuration(s);
  if (!s.pieces.some((p) => p.role === 'timeRange')) phaseSingleTime(s);
  phaseDates(s);
  const matched = phaseWords(s, idx);
  phaseCleanup(s);

  const of = (role: SpanRole) => s.pieces.find((p) => p.role === role);
  const range = of('timeRange'), single = of('time'), dur = of('duration');
  const datePieces = s.pieces.filter((p) => p.role === 'date');
  const bestDate = [...datePieces].sort((a, b) => (b.dateRank ?? 0) - (a.dateRank ?? 0))[0];
  const hasTime = !!(range || single);
  const hasStart = !!single && !range;
  if (single && (single.prep === 'by' || single.prep === 'due')) s.deadline = true;
  const hasLen = !!dur && !dur.estimate;

  // Kind from keyword rules: user > learned > built-in; a built-in task word beats a built-in fixed word (D8).
  const kindRules = matched.filter((r) => r.kind);
  const topRank = Math.max(-1, ...kindRules.map((r) => RANK[r.source] ?? 0));
  const top = kindRules.filter((r) => (RANK[r.source] ?? 0) === topRank);
  const override = topRank > 0;
  const K: ParseKind | undefined = top.length ? (override ? top[0]!.kind : top.some((r) => r.kind === 'task') ? 'task' : top[0]!.kind) : undefined;
  const dateOnlyOK = K === 'fixed' && top.some((r) => r.kind === 'fixed' && r.allowDateOnly);

  const titleNow = buildTitle(s);
  const words = src.trim().split(/\s+/);
  const verbStart = LEX.verbs.has(firstWord(titleNow)) || LEX.verbs.has(firstWord(src.replace(/^\s*(?:task|event|note)\s+|^\s*[-@]\s+|^\s*\[\s?\]\s*/i, '')));
  const taskKw = kindRules.some((r) => r.kind === 'task');
  const hashOrTag = hash;
  const strong = taskKw || verbStart || hasTime || !!dur || priority !== undefined || hashOrTag;

  let kind: ParseKind;
  if (forced) kind = forced;
  else if (override && K) kind = K === 'fixed' ? (hasTime || (dateOnlyOK && bestDate) ? 'fixed' : 'task') : K;
  else if (range) kind = 'fixed';
  else if (hasStart && !s.deadline && hasLen) kind = 'fixed';
  else if (s.deadline && (hasTime || bestDate)) kind = 'task';
  else if (K === 'task') kind = 'task';
  else if (K === 'fixed' && hasStart) kind = 'fixed';
  else if (K === 'fixed' && dateOnlyOK && bestDate) kind = 'fixed';
  else kind = 'task';

  if (kind === 'note') return finishNote(s, 'high');
  if (!forced && !strong) {
    const first = firstWord(src);
    const fn = words.filter((w) => LEX.functionWords.has(w.toLowerCase().replace(/[^a-z']/g, ''))).length;
    const sentence = words.length >= LEX.sentenceMinWords && fn >= LEX.sentenceMinFunctionWords;
    if (LEX.hedge.has(first) || sentence) return finishNote(s, LEX.hedge.has(first) && sentence ? 'high' : 'medium', undefined, true);
  }

  // ---- fields
  const out: ParseResult = { kind, title: titleNow, spans: [], confidence: 'high', warnings: s.warnings };
  const proj = s.pieces.find((p) => p.role === 'project' && (p.value as { via?: string }).via !== 'rule') ?? s.pieces.find((p) => p.role === 'project');
  const projectId = (proj?.value as { projectId?: string } | undefined)?.projectId ?? top.find((r) => r.projectId)?.projectId;
  if (projectId) out.projectId = projectId;
  const tagId = (s.pieces.find((p) => p.role === 'tag')?.value as { tagId?: string } | undefined)?.tagId ?? matched.find((r) => r.tagId)?.tagId;
  if (tagId) out.tagId = tagId;
  if (priority !== undefined) out.priority = priority;
  if (s.rec) {
    out.recurrence = s.rec;
  }

  let date: number | undefined = bestDate?.mins;
  if (date === undefined && s.rec) date = s.rec.weekdays?.length ? Math.min(...s.rec.weekdays.map((d) => nextDow(today, d))) : today;
  if (date === undefined && (hasTime || kind === 'fixed')) date = today;
  if (s.rec && s.rec.freq === 'weekly' && !s.rec.weekdays) s.rec.weekdays = [dowOf(date ?? today)];
  if (date !== undefined) out.date = fmtDays(date);

  if (kind === 'fixed') {
    let startMin: number | undefined, endMin: number | undefined;
    if (range) { startMin = (range.value as { startMin: number }).startMin; endMin = (range.value as { endMin: number }).endMin; }
    else if (single) {
      startMin = single.mins!;
      const fixedRules = [...kindRules].filter((r) => r.kind === 'fixed').sort((a, b) => (RANK[b.source] ?? 0) - (RANK[a.source] ?? 0));
      let len = dur?.mins ?? null;
      if (len === null) {
        len = scheduleLength(ctx, date!, startMin, fixedRules.some((r) => r.usesSchedule), s.double, titleNow);
      }
      len ??= fixedRules.find((r) => r.defaultDurationMin)?.defaultDurationMin ?? idx.defaultFixedMin;
      endMin = startMin + len;
    } else {
      // A fixed event with no time yet: a test/exam takes its timetable period, otherwise it waits to be placed (D16).
      const kw = s.pieces.filter((p) => p.rule?.allowDateOnly).sort((a, b) => a.start - b.start)[0];
      const subject = kw ? blanked(s, kw.start) : '';
      const hit = date !== undefined && subject ? matchTimetable(ctx, date, subject) : null;
      if (hit) { startMin = hit.startMin; endMin = hit.endMin; }
      else { out.unplaced = true; out.durationMin = dur?.mins ?? idx.defaultFixedMin; }
    }
    if (startMin !== undefined && endMin !== undefined) {
      out.startMin = startMin; out.endMin = endMin;
      if (endMin > 1440) out.warnings.push('ends after midnight (next day)');
      if (date === today && startMin < nowMin) out.warnings.push('time already passed today');
    }
  } else {
    if (range) out.dueTime = (range.value as { startMin: number }).startMin;
    else if (single) out.dueTime = single.mins!;
    if (dur) out.estimateMin = dur.mins!;
  }

  if (!out.title) { out.confidence = 'low'; out.warnings.push('nothing left for a title'); }
  else if (!forced && !strong) out.confidence = 'low';
  else if (s.pieces.some((p) => p.fuzzy || p.inferred)) out.confidence = 'medium';

  out.spans = toSpans(s);
  const alt = alternative(out, !forced && !strong);
  if (alt) out.alternatives = [alt];
  return out;
}

function toSpans(s: St): Span[] {
  return [...s.pieces].sort((a, b) => a.start - b.start).map((p) => ({
    start: p.start, end: p.end, text: s.src.slice(p.start, p.end), role: p.role, value: p.value, ...(p.eat ? {} : { inTitle: true }),
  }));
}

function finishNote(s: St, confidence: ParseResult['confidence'], spans?: Span[], uncertain = false): ParseResult {
  const prefix = s.pieces.find((p) => p.role === 'kindKeyword' && (p.value as { prefix?: boolean }).prefix);
  const title = prefix ? tidy(s.src.slice(prefix.end)) : s.src.trim();
  const out: ParseResult = { kind: 'note', title, spans: spans ?? (prefix ? toSpans(s) : []), confidence, warnings: [] };
  if (uncertain || !prefix) out.alternatives = [{ kind: 'task', title }];
  return out;
}

/** The other reading, for Shift+Enter. */
function alternative(r: ParseResult, noEvidence: boolean): Partial<ParseResult> | null {
  if (r.kind === 'fixed' && r.startMin !== undefined) return { kind: 'task', title: r.title, date: r.date, dueTime: r.startMin };
  if (r.kind === 'task' && r.dueTime !== undefined && r.date) return { kind: 'fixed', title: r.title, date: r.date, startMin: r.dueTime, endMin: r.dueTime + 60 };
  if (r.kind === 'task' && noEvidence) return { kind: 'note', title: r.title };
  return null;
}

export function parse(text: string, ctx: ParseContext): ParseResult {
  try {
    return parseUnsafe(text, ctx);
  } catch {
    const t = typeof text === 'string' ? text.trim() : '';
    return { kind: 'note', title: t, spans: [], confidence: 'low', warnings: ['could not read this line'] };
  }
}
