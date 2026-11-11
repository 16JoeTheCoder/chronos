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

/**
 * A key after `a` that grows slowly: bump the first digit that can be bumped and
 * drop the rest (one more character only every ~61 appends), instead of halving
 * the gap to "infinity" each time (which grew a character every ~6 appends).
 */
function keyAfter(a: string): string {
  if (!a) return midpoint('', null);
  const d = DIGITS.indexOf(a[0] as string);
  return d < DIGITS.length - 1 ? (DIGITS[d + 1] as string) : `${a[0]}${keyAfter(a.slice(1))}`;
}

/** A key strictly between a and b (either may be null for "start"/"end"). */
export function keyBetween(a: string | null, b: string | null): string {
  if (a !== null && b !== null && a >= b) throw new Error(`keyBetween: ${a} >= ${b}`);
  if (b !== null && /^0*$/.test(b)) throw new Error('keyBetween: no key below the zero key');
  return b === null ? keyAfter(a ?? '') : midpoint(a ?? '', b);
}

/** n evenly spaced, equally long keys in order (migrations and imports). */
export function keysFor(n: number): string[] {
  if (n <= 0) return [];
  let width = 1;
  while (DIGITS.length ** width < n + 1) width++;
  const span = DIGITS.length ** width;
  return Array.from({ length: n }, (_, i) => {
    let v = Math.floor(((i + 1) * span) / (n + 1));
    let k = '';
    for (let j = 0; j < width; j++, v = Math.floor(v / DIGITS.length)) k = DIGITS[v % DIGITS.length] + k;
    // Never end on the zero digit (keeps "between" always possible).
    return k.endsWith(ZERO) ? `${k}V` : k;
  });
}

export const isSortKey = (v: unknown): v is string => typeof v === 'string' && v.length > 0 && v.length <= 512 && [...v].every((c) => DIGITS.includes(c)) && !v.endsWith(ZERO);
