// Compiles lexicon.en.json into lookup tables, and the conservative fuzzy matcher (D11).
import raw from './lexicon.en.json';

export type ShortKey = 'today' | 'tomorrow' | 'tonight' | 'weekend' | 'endOfWeek' | 'yesterday';

const L = raw as unknown as {
  shorthand: Record<string, string[]>;
  weekdays: Record<string, string[]>;
  months: Record<string, string[]>;
  units: { minute: string[]; hour: string[] };
  quantityNouns: string[];
  timeContextWords: string[];
  dayPartsConsumedWithTime: string[];
  connectorsStrippedNextToConsumed: string[];
  timeWords: Record<string, number>;
  noteSignals: { hedgeStarters: string[]; functionWords: string[]; sentenceMinWords: number; sentenceMinFunctionWords: number };
  verbStarters: string[];
  fuzzy: { targets: string[]; maxDistanceShort: number; maxDistanceLong: number; neverCorrect: string[] };
};

const set = (xs: string[]) => new Set(xs.map((x) => x.toLowerCase()));
const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const alt = (xs: string[]) => [...xs].sort((a, b) => b.length - a.length).map(esc).join('|');

const shortMap = new Map<string, ShortKey>();
for (const [k, ws] of Object.entries(L.shorthand)) for (const w of ws) if (!w.includes(' ')) shortMap.set(w.toLowerCase(), k as ShortKey);

const weekdayMap = new Map<string, number>();
for (const [n, ws] of Object.entries(L.weekdays)) for (const w of ws) weekdayMap.set(w.toLowerCase(), Number(n));

const monthMap = new Map<string, number>();
for (const [n, ws] of Object.entries(L.months)) for (const w of ws) monthMap.set(w.toLowerCase(), Number(n));

const unitMap = new Map<string, 'minute' | 'hour'>();
for (const w of L.units.minute) unitMap.set(w, 'minute');
for (const w of L.units.hour) unitMap.set(w, 'hour');

/** Real words that fuzzy matching must never rewrite: every lexicon word, plus the data list. */
const neverCorrect = set([
  ...L.fuzzy.neverCorrect, ...L.noteSignals.hedgeStarters, ...L.noteSignals.functionWords, ...L.verbStarters,
  ...shortMap.keys(), ...weekdayMap.keys(), ...monthMap.keys(), ...unitMap.keys(), ...L.quantityNouns,
]);

const KEY_ROWS = ['qwertyuiop', 'asdfghjkl', 'zxcvbnm'];
const neighbours = new Map<string, Set<string>>();
KEY_ROWS.forEach((row, r) => {
  for (let c = 0; c < row.length; c++) {
    const near = new Set<string>();
    for (const [dr, dc] of [[0, -1], [0, 1], [-1, 0], [-1, 1], [1, -1], [1, 0]] as const) {
      const ch = KEY_ROWS[r + dr]?.[c + dc];
      if (ch) near.add(ch);
    }
    neighbours.set(row[c]!, near);
  }
});

const collapse = (s: string) => s.replace(/(.)\1+/g, '$1');

/** Edit distance: insert/delete 1, transposition 1, substitution 1 for a keyboard neighbour else 2. */
function distance(a: string, b: string, cap: number): number {
  const n = a.length, m = b.length;
  if (Math.abs(n - m) > cap) return cap + 1;
  const d: number[][] = Array.from({ length: n + 1 }, () => new Array<number>(m + 1).fill(0));
  for (let i = 0; i <= n; i++) d[i]![0] = i;
  for (let j = 0; j <= m; j++) d[0]![j] = j;
  for (let i = 1; i <= n; i++) {
    for (let j = 1; j <= m; j++) {
      const x = a[i - 1]!, y = b[j - 1]!;
      const sub = x === y ? 0 : neighbours.get(x)?.has(y) ? 1 : 2;
      let v = Math.min(d[i - 1]![j]! + 1, d[i]![j - 1]! + 1, d[i - 1]![j - 1]! + sub);
      if (i > 1 && j > 1 && x === b[j - 2] && a[i - 2] === y) v = Math.min(v, d[i - 2]![j - 2]! + 1);
      d[i]![j] = v;
    }
  }
  return d[n]![m]!;
}

/** The target a typo most plausibly means, or null. Same first letter; never a real word. */
export function fuzzyMatch(word: string, targets: readonly string[], maxCap?: number): string | null {
  const w = word.toLowerCase();
  if (neverCorrect.has(w)) return null;
  const c = collapse(w);
  if (c.length < 3) return null;
  let best: string | null = null;
  let bestD = 99;
  for (const t of targets) {
    if (t[0] !== c[0]) continue;
    const cap = Math.min(maxCap ?? 99, t.length <= 5 ? L.fuzzy.maxDistanceShort : L.fuzzy.maxDistanceLong);
    const dist = distance(c, collapse(t), cap);
    if (dist <= cap && dist < bestD) { best = t; bestD = dist; }
  }
  return best;
}

const unitTargets = L.fuzzy.targets.filter((t) => unitMap.has(t));
const dateTargets = L.fuzzy.targets.filter((t) => !unitMap.has(t) && !L.timeWords[t]);

/** 'minute' | 'hour' for a (possibly misspelled) unit word. Single letters only count when `glued`. */
export function unitOf(word: string, glued: boolean): 'minute' | 'hour' | null {
  const w = word.toLowerCase();
  const exact = unitMap.get(w);
  if (exact) return w.length === 1 && !glued ? null : exact;
  const t = fuzzyMatch(w, unitTargets);
  return t ? unitMap.get(t) ?? null : null;
}

export type DateWord = { kind: 'short'; key: ShortKey; fuzzy: boolean } | { kind: 'weekday'; dow: number; fuzzy: boolean };

export function dateWordOf(word: string): DateWord | null {
  const w = word.toLowerCase();
  const s = shortMap.get(w);
  if (s) return { kind: 'short', key: s, fuzzy: false };
  const d = weekdayMap.get(w);
  if (d) return { kind: 'weekday', dow: d, fuzzy: false };
  if (w.length < 5 || /^\d+$/.test(w)) return null;
  const t = fuzzyMatch(w, dateTargets, 1);
  if (!t) return null;
  const s2 = shortMap.get(t);
  if (s2) return { kind: 'short', key: s2, fuzzy: true };
  const d2 = weekdayMap.get(t);
  return d2 ? { kind: 'weekday', dow: d2, fuzzy: true } : null;
}

const WD = alt([...weekdayMap.keys()]);
const MONTH = alt([...monthMap.keys()]);

const dayParts = [...L.dayPartsConsumedWithTime].sort((a, b) => b.length - a.length);

export const LEX = {
  weekdayMap, monthMap,
  quantityNouns: set(L.quantityNouns),
  connectors: set(L.connectorsStrippedNextToConsumed),
  dayParts,
  dayPartSingles: set(dayParts.filter((p) => !p.includes(' '))),
  timeWords: L.timeWords,
  hedge: set(L.noteSignals.hedgeStarters),
  functionWords: set(L.noteSignals.functionWords),
  verbs: set(L.verbStarters),
  sentenceMinWords: L.noteSignals.sentenceMinWords,
  sentenceMinFunctionWords: L.noteSignals.sentenceMinFunctionWords,
  /** Words that signal a date in the line: lets a bare range like "10-1" count as clock times. */
  timeContext: new RegExp(`(?<![A-Za-z0-9])(?:${alt([...shortMap.keys(), ...weekdayMap.keys(), ...L.timeContextWords])})(?![A-Za-z0-9])|\\d\\s*(?:${MONTH})\\b|\\b(?:${MONTH})\\s*\\d`, 'i'),
  reWeekday: WD,
  reMonth: MONTH,
};
