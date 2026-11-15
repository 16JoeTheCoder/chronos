// A parse becomes a command (palette Add, notepad lines). Pure and unit-tested; the parser
// decides what the text means, this only maps it onto the data model.

import type { Command, EventInput } from '../../core/commands';
import type { Data, Priority } from '../../core/model/types';
import { buildParseContext } from '../../core/parseContext';
import { parse, type ParseContext, type ParseResult } from '../../core/parser';
import { settingsOf } from '../../core/repo/repo';
import { todayOf } from '../../core/tasks/tasks';
import { loadBells, timetableFor } from '../schedule/timetableData';

const PRIORITY: Record<1 | 2 | 3, Priority> = { 1: 'must', 2: 'should', 3: 'nice' };

/** Parser context for "now". Timetable and bells come from the schedule module (device-local bells). */
export function parseCtx(d: Data, now: number, source: NonNullable<ParseContext['source']>, mode: ParseContext['mode'] = 'quick', date?: string): ParseContext {
  return buildParseContext(d, now, source, { mode, timetable: timetableFor(d, date ?? todayOf(d, now)), bells: loadBells() });
}

/** Parse with the timetable of the day the text names (tests and exams use it, D16): a second pass only when the date is not today. */
export function parseLine(text: string, d: Data, now: number, source: NonNullable<ParseContext['source']> = 'user', mode: ParseContext['mode'] = 'quick'): ParseResult {
  const first = parse(text, parseCtx(d, now, source, mode));
  return first.date && first.date !== todayOf(d, now) ? parse(text, parseCtx(d, now, source, mode, first.date)) : first;
}

/** Task, event or note for a parse; `asTask` forces a fixed event to a task (Shift+Enter). */
export function commandFromParse(r: ParseResult, d: Data, now: number, asTask = false): Command | null {
  const title = r.title.trim();
  if (!title) return null;
  const kind = asTask && r.kind === 'fixed' ? 'task' : r.kind;
  if (kind === 'note') return { type: 'idea.add', text: title, taskId: null };
  if (kind === 'task') {
    return {
      type: 'task.create',
      input: {
        title: title.slice(0, 120),
        source: 'parsed',
        tagId: r.tagId ?? null,
        projectId: r.projectId ?? null,
        ...(r.priority ? { priority: PRIORITY[r.priority] } : {}),
        estimateMin: r.estimateMin ?? r.durationMin ?? null,
        dueDate: r.date ?? null,
        dueTime: r.dueTime ?? r.startMin ?? null,
        recurrence: r.recurrence ? { freq: r.recurrence.freq, interval: r.recurrence.interval, ...(r.recurrence.weekdays ? { weekdays: r.recurrence.weekdays } : {}) } : null,
      },
    };
  }
  const s = settingsOf(d);
  const date = r.date ?? todayOf(d, now);
  const placed = !r.unplaced && r.startMin !== undefined;
  const start = placed ? (r.startMin as number) : null;
  const rec = r.recurrence;
  const input: EventInput = {
    title: title.slice(0, 120),
    tagId: r.tagId ?? null,
    scope: 'other',
    tz: s.timezone,
    startMin: start,
    endMin: start === null ? null : Math.min(1440, r.endMin ?? start + (r.durationMin ?? 60)),
    ...(start === null ? { durationMin: r.durationMin ?? 60 } : {}),
    date: rec ? null : date,
    recur: rec ? { weekdays: rec.weekdays?.length ? rec.weekdays : rec.freq === 'daily' ? [1, 2, 3, 4, 5, 6, 7] : [1], everyNWeeks: Math.min(4, Math.max(1, rec.freq === 'weekly' ? rec.interval : 1)) as 1, anchorDate: date, from: null, until: rec.until ?? null } : null,
    notes: '',
  };
  return { type: 'event.create', input };
}

export interface Chip { key: string; label: string }

const WD = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const hm = (m: number) => `${String(Math.floor(m / 60) % 24).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
const dur = (m: number) => (m >= 60 ? `${Math.floor(m / 60)}h${m % 60 ? ` ${m % 60}m` : ''}` : `${m}m`);

/** "Thu 12 Nov" for a YYYY-MM-DD date. */
export function dateLabel(date: string): string {
  const t = new Date(`${date}T00:00:00Z`);
  return Number.isNaN(t.getTime()) ? date : `${WD[t.getUTCDay()]} ${t.getUTCDate()} ${MON[t.getUTCMonth()]}`;
}

/** What the parser understood, as chips under the box (kind first). */
export function chipsOf(r: ParseResult, d: Data): Chip[] {
  const c: Chip[] = [{ key: 'kind', label: r.kind === 'fixed' ? 'Fixed event' : r.kind === 'task' ? 'Task' : 'Note' }];
  if (r.date) c.push({ key: 'date', label: dateLabel(r.date) });
  if (r.startMin !== undefined && !r.unplaced) c.push({ key: 'time', label: r.endMin !== undefined ? `${hm(r.startMin)} to ${hm(r.endMin)}` : hm(r.startMin) });
  else if (r.dueTime !== undefined) c.push({ key: 'time', label: `by ${hm(r.dueTime)}` });
  if (r.unplaced) c.push({ key: 'unplaced', label: 'time to place' });
  if (r.estimateMin ?? r.durationMin) c.push({ key: 'dur', label: dur((r.estimateMin ?? r.durationMin) as number) });
  if (r.recurrence) c.push({ key: 'rec', label: r.recurrence.freq === 'daily' ? 'every day' : r.recurrence.interval > 1 ? `every ${r.recurrence.interval} weeks` : 'every week' });
  if (r.priority) c.push({ key: 'prio', label: PRIORITY[r.priority] });
  if (r.projectId && d.projects[r.projectId]) c.push({ key: 'proj', label: d.projects[r.projectId]!.name });
  if (r.tagId && d.tags[r.tagId]) c.push({ key: 'tag', label: d.tags[r.tagId]!.name });
  return c;
}

/** One line of what the parser produced, for "Report misparse". */
export const describeParse = (r: ParseResult, d: Data): string => `${chipsOf(r, d).map((c) => c.label).join(' | ')} | title: ${r.title}`.slice(0, 500);
