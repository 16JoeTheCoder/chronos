// Fractional indexing: string keys that sort lexicographically, with a key
// between any two (so moving a card is one record write). Base-62 digits; keys
// never end in the zero digit, which keeps "between" always possible.

const DIGITS = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz';
const ZERO = DIGITS[0] as string;

function midpoint(a: string, b: string | null): string {
  // a < b (b === null means +infinity). Walk digit by digit.
  let out = '';
  for (let i = 0; ; i++) {
    const da = i < a.length ? DIGITS.indexOf(a[i] as string) : 0;
    const db = b === null ? DIGITS.length : i < b.length ? DIGITS.indexOf(b[i] as string) : DIGITS.length;
    if (db - da > 1) return out + DIGITS[Math.floor((da + db) / 2)];
    out += DIGITS[da];
    // The digits are equal or adjacent: anything that extends `a` here is still below b
    // once b's digit is larger, so continue with no upper bound.
    if (db > da) b = null;
  }
}

/** A key strictly between a and b (either may be null for "start"/"end"). */
export function keyBetween(a: string | null, b: string | null): string {
  if (a !== null && b !== null && a >= b) throw new Error(`keyBetween: ${a} >= ${b}`);
  if (b !== null && /^0*$/.test(b)) throw new Error('keyBetween: no key below the zero key');
  return midpoint(a ?? '', b);
}

/** n evenly spaced keys in order (for migrations and imports). */
export function keysFor(n: number): string[] {
  const out: string[] = [];
  let prev: string | null = null;
  for (let i = 0; i < n; i++) out.push((prev = keyBetween(prev, null)));
  return out;
}

export const isSortKey = (v: unknown): v is string => typeof v === 'string' && v.length > 0 && v.length <= 64 && [...v].every((c) => DIGITS.includes(c)) && !v.endsWith(ZERO);
