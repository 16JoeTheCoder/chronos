// The parser's context for "now" from the app data (palette, notepad, MCP add_task).
// Pure; the caller adds the day's timetable and the bell grid when it has them (renderer-side data).

import type { Data } from './model/types';
import type { Bell, ParseContext, TimetableEntry } from './parser/types';
import { live, settingsOf } from './repo/repo';

export function buildParseContext(d: Data, now: number, source: NonNullable<ParseContext['source']>, extra: { timetable?: TimetableEntry[]; bells?: Bell[]; mode?: ParseContext['mode'] } = {}): ParseContext {
  const s = settingsOf(d);
  return {
    now: new Date(now),
    timeZone: s.timezone,
    dayStartMin: s.dayStartMin,
    dayEndMin: s.dayEndMin,
    defaultBlockMin: s.planning.defaultBlockMin,
    tags: live(d, 'tags').map((t) => ({ id: t.id, name: t.name })),
    projects: live(d, 'projects').map((p) => ({ id: p.id, name: p.name })),
    rules: s.parserRules.map((r, i) => ({ id: `user-${i}`, match: r.keyword, kind: r.kind, source: 'user' as const })),
    weekStartsOn: 1,
    source,
    ...extra,
  };
}
