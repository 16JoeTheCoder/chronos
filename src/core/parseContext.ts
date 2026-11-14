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
    // Phase 1 rules were {keyword, kind}; the validator still lets them through.
    rules: s.parserRules.map((r, i) => ('match' in r ? r : { id: `user-${i}`, match: (r as unknown as { keyword: string }).keyword, kind: (r as unknown as { kind: 'fixed' | 'task' }).kind, source: 'user' as const })),
    weekStartsOn: 1,
    source,
    ...extra,
  };
}
