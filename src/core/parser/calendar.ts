// Date arithmetic on whole days. A "day" is days since 1970-01-01 (UTC arithmetic, no time zone drift).

const DAY_MS = 86_400_000;

export function toDays(y: number, m: number, d: number): number {
  return Math.floor(Date.UTC(y, m - 1, d) / DAY_MS);
}

export function fromDays(days: number): { y: number; m: number; d: number } {
  const dt = new Date(days * DAY_MS);
  return { y: dt.getUTCFullYear(), m: dt.getUTCMonth() + 1, d: dt.getUTCDate() };
}

export function fmtDays(days: number): string {
  const { y, m, d } = fromDays(days);
  return `${String(y).padStart(4, '0')}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}

/** 1 = Monday ... 7 = Sunday. */
export function dowOf(days: number): number {
  return ((((days + 3) % 7) + 7) % 7) + 1;
}

/** First day on or after `days` that falls on weekday `dow`. */
export function nextDow(days: number, dow: number): number {
  return days + ((dow - dowOf(days) + 7) % 7);
}

const fmtCache = new Map<string, Intl.DateTimeFormat>();

function formatter(tz: string): Intl.DateTimeFormat {
  let f = fmtCache.get(tz);
  if (!f) {
    const opts: Intl.DateTimeFormatOptions = {
      year: 'numeric', month: 'numeric', day: 'numeric', hour: 'numeric', minute: 'numeric', hourCycle: 'h23',
    };
    try {
      f = new Intl.DateTimeFormat('en-US', { ...opts, timeZone: tz });
    } catch {
      f = new Intl.DateTimeFormat('en-US', { ...opts, timeZone: 'UTC' });
    }
    fmtCache.set(tz, f);
  }
  return f;
}

/** Wall-clock "today" and minutes since midnight in `tz`. */
export function localNow(now: Date, tz: string): { today: number; nowMin: number } {
  const t = now instanceof Date && !Number.isNaN(now.getTime()) ? now : new Date(0);
  const p: Record<string, number> = {};
  for (const part of formatter(tz).formatToParts(t)) if (part.type !== 'literal') p[part.type] = Number(part.value);
  return { today: toDays(p.year ?? 1970, p.month ?? 1, p.day ?? 1), nowMin: (p.hour ?? 0) * 60 + (p.minute ?? 0) };
}

export function parseHHMM(s: string): number {
  const m = /^(\d{1,2}):(\d{2})$/.exec(s);
  return m ? Number(m[1]) * 60 + Number(m[2]) : NaN;
}
