// Half-open intervals [start, end) on a number line (UTC ms). Pure set maths
// used by time-left, the runway's free stretches and prep nudges.

export type Interval = [number, number];

export const len = (i: Interval) => Math.max(0, i[1] - i[0]);
export const total = (xs: Interval[]) => xs.reduce((s, i) => s + len(i), 0);

/** Sort and merge overlapping or touching intervals; drops empty ones. */
export function merge(xs: Interval[]): Interval[] {
  const sorted = xs.filter((i) => i[1] > i[0]).sort((a, b) => a[0] - b[0]);
  const out: Interval[] = [];
  for (const [s, e] of sorted) {
    const last = out[out.length - 1];
    if (last && s <= last[1]) last[1] = Math.max(last[1], e);
    else out.push([s, e]);
  }
  return out;
}

export function clip(xs: Interval[], w: Interval): Interval[] {
  return xs.map(([s, e]): Interval => [Math.max(s, w[0]), Math.min(e, w[1])]).filter((i) => i[1] > i[0]);
}

/** The parts of `w` not covered by any interval in `xs`. */
export function subtract(w: Interval, xs: Interval[]): Interval[] {
  const out: Interval[] = [];
  let cur = w[0];
  for (const [s, e] of merge(clip(xs, w))) {
    if (s > cur) out.push([cur, s]);
    cur = Math.max(cur, e);
  }
  if (cur < w[1]) out.push([cur, w[1]]);
  return out;
}

export function overlaps(a: Interval, b: Interval): boolean {
  return a[0] < b[1] && b[0] < a[1];
}
