import fixture from './fixture.json';
import { builtinRules } from '../../src/core/parser';
import type { ParseContext } from '../../src/core/parser';

/** The context corpus.txt assumes: now = Wed 2026-11-11 14:22 Asia/Jakarta. */
export function fixtureContext(over: Partial<ParseContext> = {}): ParseContext {
  return {
    now: new Date('2026-11-11T14:22:00+07:00'),
    timeZone: fixture.timeZone,
    dayStartMin: fixture.dayStartMin,
    dayEndMin: fixture.dayEndMin,
    defaultBlockMin: fixture.defaultBlockMin,
    tags: fixture.tags,
    projects: fixture.projects,
    rules: builtinRules,
    weekStartsOn: 1,
    bells: fixture.bells,
    timetable: fixture.timetable,
    ...over,
  };
}
