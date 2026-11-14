// Public types of the quick-add parser. Pure data shapes, no logic.

export type ParseKind = 'fixed' | 'task' | 'note';
export type RuleSource = 'builtin' | 'user' | 'learned';

export interface ParserRule {
  id: string;
  /** A word or phrase, case-insensitive, whole-word. */
  match: string;
  aliases?: string[];
  kind?: ParseKind;
  /** Length for a fixed event typed with a start and no end. */
  defaultDurationMin?: number;
  /** A fixed word with a date only becomes an event with no time yet (test, exam). */
  allowDateOnly?: boolean;
  /** Fixed length comes from ctx.timetable, then ctx.bells (classes). */
  usesSchedule?: boolean;
  tagId?: string;
  projectId?: string;
  source: RuleSource;
}

/** *.chronos-parser.json */
export interface ParserPack {
  $schema: 'chronos-parser-pack/1';
  name: string;
  version: number;
  /** Length of a fixed event with a start and no end, unless a rule says otherwise (D17). */
  defaultFixedDurationMin?: number;
  rules: ParserRule[];
}

export interface Bell { id: string; start: string; end: string }
/** One weekly period. `day` 1 = Monday ... 7 = Sunday; times are 'HH:MM'. */
export interface TimetableEntry { day: number; start: string; end: string; title: string; aliases?: string[] }

export interface ParseContext {
  /** Injected, never read from the clock inside the parser. */
  now: Date;
  /** IANA zone, e.g. 'Asia/Jakarta'. All output is local wall time. */
  timeZone: string;
  dayStartMin: number;
  dayEndMin: number;
  defaultBlockMin: number;
  tags: { id: string; name: string }[];
  projects: { id: string; name: string; aliases?: string[] }[];
  /** User + learned (+ built-in) rules. If no 'builtin' rule is present, the built-in pack is added underneath. */
  rules: ParserRule[];
  weekStartsOn: 1;
  bells?: Bell[];
  /** That day's recurring schedule (exceptions already applied by the caller). */
  timetable?: TimetableEntry[];
  /** Characters the user marked as literal (Backspace on a chip); never interpreted. */
  literalRanges?: { start: number; end: number }[];
  /** 'notepad': a line without a prefix stays a plain note. Default 'quick'. */
  mode?: 'quick' | 'notepad';
  source?: 'user' | 'claude' | 'voice' | 'notepad' | 'log';
}

export type SpanRole = 'date' | 'time' | 'timeRange' | 'duration' | 'recurrence' | 'kindKeyword' | 'project' | 'tag' | 'priority';

export interface Span {
  start: number;
  end: number;
  text: string;
  role: SpanRole;
  value: unknown;
  /** True when the text stays in the title (project words, kind keywords). */
  inTitle?: boolean;
}

export interface Recurrence { freq: 'daily' | 'weekly'; interval: number; weekdays?: number[]; until?: string }

export interface ParseResult {
  kind: ParseKind;
  title: string;
  date?: string;
  startMin?: number;
  endMin?: number;
  /** Fixed event on `date` with no time yet (tests/exams without a timetable match); it is `durationMin` long. */
  unplaced?: boolean;
  durationMin?: number;
  dueTime?: number;
  estimateMin?: number;
  recurrence?: Recurrence;
  projectId?: string;
  tagId?: string;
  priority?: 1 | 2 | 3;
  spans: Span[];
  confidence: 'high' | 'medium' | 'low';
  warnings: string[];
  alternatives?: Partial<ParseResult>[];
}
