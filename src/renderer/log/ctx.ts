// Renderer-side helpers for the Log: parser context, labels.
import { builtinRules, type ParseContext } from '../../core/parser';
import type { Data } from '../../core/model/types';
import { settingsOf } from '../../core/repo/repo';
import { localParts } from '../../core/time/zone';

export function parseCtx(d: Data, now = Date.now()): ParseContext {
  const s = settingsOf(d);
  return {
    now: new Date(now),
    timeZone: s.timezone,
    dayStartMin: s.dayStartMin,
    dayEndMin: s.dayEndMin,
    defaultBlockMin: 45,
    tags: Object.values(d.tags).filter((t) => t.deletedAt === null).map((t) => ({ id: t.id, name: t.name })),
    projects: Object.values(d.projects).filter((p) => p.deletedAt === null && !p.archived).map((p) => ({ id: p.id, name: p.name })),
    rules: builtinRules,
    weekStartsOn: 1,
    source: 'log',
  };
}

export const liveProjects = (d: Data) => Object.values(d.projects).filter((p) => p.deletedAt === null && !p.archived).sort((a, b) => (a.sortKey < b.sortKey ? -1 : 1) || a.name.localeCompare(b.name));

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const DAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
const pad = (n: number) => String(n).padStart(2, '0');

/** "Today 10:05", "Yesterday 21:40", "Mon 26 Oct 10:05". */
export function whenLabel(ts: number, tz: string, today: string, yesterday: string): string {
  const p = localParts(ts, tz);
  const time = `${pad(p.hour)}:${pad(p.minute)}`;
  if (p.date === today) return `Today ${time}`;
  if (p.date === yesterday) return `Yesterday ${time}`;
  return `${DAYS[p.weekday - 1]} ${p.day} ${MONTHS[p.month - 1]} ${time}`;
}

export const MONTH_NAMES = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
