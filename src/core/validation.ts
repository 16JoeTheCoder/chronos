// Validation, the single gate (D-110): field validators for the renderer's inline
// errors and for commands (every IPC/MCP payload is re-checked here), and whole-record
// validators used by the store loader, the sync pull and imports. Pure.

import { isValidZone } from './time/zone';
import { isSortKey } from './model/sortKey';
import { isId } from './model/ids';
import { SNAP_OPTIONS } from './model/defaults';
import { COLLS, PARSER_REPORTS_MAX, PRIORITIES, SCHEMA_V, SCOPES, TAG_COLORS, TASK_SOURCES, TASK_STATUSES, type Coll, type DeviceSettings, type Settings } from './model/types';

export const MIN_FINISH_CONDITION = 8;
const SEC = 1000;
const MIN = 60 * SEC;
const HOUR = 60 * MIN;

export type Errors = Record<string, string>;

export const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
export const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
export const isBool = (v: unknown): v is boolean => typeof v === 'boolean';
export const isStr = (v: unknown): v is string => typeof v === 'string';
export const inRange = (v: unknown, min: number, max: number): v is number => isNum(v) && v >= min && v <= max;
export const isDate = (v: unknown): v is string => isStr(v) && /^\d{4}-\d{2}-\d{2}$/.test(v) && !Number.isNaN(Date.parse(`${v}T00:00:00Z`));
export const isMinute = (v: unknown): v is number => Number.isInteger(v) && inRange(v, 0, 1440);

export function isDropReason(s: unknown): boolean {
  return isStr(s) && s.trim().length >= 3;
}

export function hasFinishCondition(s: string): boolean {
  return s.trim().length >= MIN_FINISH_CONDITION;
}

export function validateTimer(cfg: unknown, prefix = 'timer'): Errors {
  const e: Errors = {};
  if (!isObj(cfg) || !['countdown', 'pomodoro', 'stopwatch'].includes(cfg.mode as string)) return { [`${prefix}.mode`]: 'Choose a timer mode.' };
  const c = cfg.countdown;
  if (!isObj(c) || !inRange(c.durationMs, SEC, 24 * HOUR)) e[`${prefix}.countdown`] = 'Countdown must be between 1 second and 24 hours.';
  else if (c.onExpire !== 'stop' && c.onExpire !== 'continue') e[`${prefix}.countdown`] = 'Choose what happens at zero.';
  const p = cfg.pomodoro;
  if (!isObj(p)) return { ...e, [`${prefix}.pomodoro`]: 'Pomodoro settings are missing.' };
  if (!inRange(p.workMs, MIN, 180 * MIN)) e[`${prefix}.workMs`] = 'Work must be 1-180 minutes.';
  if (!inRange(p.shortBreakMs, MIN, 60 * MIN)) e[`${prefix}.shortBreakMs`] = 'Short break must be 1-60 minutes.';
  if (!inRange(p.longBreakMs, MIN, 60 * MIN)) e[`${prefix}.longBreakMs`] = 'Long break must be 1-60 minutes.';
  if (!Number.isInteger(p.sessionsBeforeLongBreak) || !inRange(p.sessionsBeforeLongBreak, 1, 12)) e[`${prefix}.sessions`] = 'Sessions must be a whole number 1-12.';
  if (!isBool(p.autoStartBreaks) || !isBool(p.autoStartWork)) e[`${prefix}.auto`] = 'Invalid auto-start flags.';
  return e;
}

export interface TaskFields {
  title?: unknown;
  finishCondition?: unknown;
  notes?: unknown;
  priority?: unknown;
  estimateMin?: unknown;
  dueDate?: unknown;
  dueTime?: unknown;
  recurrence?: unknown;
  checkpointEveryMin?: unknown;
  timer?: unknown;
}

/** {freq, interval, weekdays?}: daily or weekly, every 1-52, weekdays 1-7. */
export function isTaskRecurrence(r: unknown): boolean {
  if (!isObj(r) || (r.freq !== 'daily' && r.freq !== 'weekly')) return false;
  if (!Number.isInteger(r.interval) || !inRange(r.interval, 1, 52)) return false;
  if (r.weekdays === undefined) return true;
  return Array.isArray(r.weekdays) && r.weekdays.length <= 7 && r.weekdays.every((w) => Number.isInteger(w) && w >= 1 && w <= 7);
}

/** Title is required; the finish condition may be empty (inbox task) but if given must be >= 8 characters. */
export function validateTaskFields(t: TaskFields): Errors {
  const e: Errors = {};
  if (t.title !== undefined && (!isStr(t.title) || t.title.trim().length < 1 || t.title.trim().length > 120)) e.title = 'Title must be 1-120 characters.';
  if (t.finishCondition !== undefined) {
    const fc = isStr(t.finishCondition) ? t.finishCondition.trim() : null;
    if (fc === null || (fc.length > 0 && fc.length < MIN_FINISH_CONDITION) || fc.length > 500) e.finishCondition = 'Describe what finished looks like (at least 8 characters).';
  }
  if (t.notes !== undefined && (!isStr(t.notes) || t.notes.length > 5000)) e.notes = 'Notes are too long.';
  if (t.priority !== undefined && !PRIORITIES.includes(t.priority as never)) e.priority = 'Invalid priority.';
  if (t.estimateMin !== undefined && t.estimateMin !== null && !(Number.isInteger(t.estimateMin) && inRange(t.estimateMin, 1, 24 * 60))) e.estimateMin = 'Estimate must be 1 minute to 24 hours.';
  if (t.dueDate !== undefined && t.dueDate !== null && !isDate(t.dueDate)) e.dueDate = 'Use a date like 2026-10-26.';
  if (t.dueTime !== undefined && t.dueTime !== null && !(Number.isInteger(t.dueTime) && inRange(t.dueTime, 0, 1439))) e.dueTime = 'Use a time like 14:30.';
  if (t.recurrence !== undefined && t.recurrence !== null && !isTaskRecurrence(t.recurrence)) e.recurrence = 'Repeat daily or weekly, every 1-52.';
  if (t.checkpointEveryMin !== undefined && t.checkpointEveryMin !== null && !(Number.isInteger(t.checkpointEveryMin) && inRange(t.checkpointEveryMin, 15, 600))) e.checkpointEveryMin = 'Checkpoints every 15-600 minutes.';
  if (t.timer !== undefined) Object.assign(e, validateTimer(t.timer));
  return e;
}

export function validateTag(t: { name?: unknown; color?: unknown; kind?: unknown }): Errors {
  const e: Errors = {};
  if (t.name !== undefined && (!isStr(t.name) || !t.name.trim() || t.name.length > 40)) e.name = 'Tag name must be 1-40 characters.';
  if (t.color !== undefined && !TAG_COLORS.includes(t.color as never)) e.color = 'Pick a colour.';
  if (t.kind !== undefined && !['class', 'project', 'general'].includes(t.kind as string)) e.kind = 'Invalid tag kind.';
  return e;
}

export function validateEventFields(ev: Record<string, unknown>): Errors {
  const e: Errors = {};
  if (!isStr(ev.title) || !ev.title.trim() || ev.title.length > 120) e.title = 'Title must be 1-120 characters.';
  if (!SCOPES.includes(ev.scope as never)) e.scope = 'Choose a scope.';
  if (!isValidZone(ev.tz)) e.tz = 'Unknown time zone.';
  const unplaced = ev.startMin === null && ev.endMin === null;
  if (unplaced) {
    // "To place": a one-off event with a date and a length but no time yet (v3).
    if (ev.date === null) e.time = 'Only a one-off event can be unplaced.';
  } else if (!isMinute(ev.startMin) || !isMinute(ev.endMin) || (ev.endMin as number) <= (ev.startMin as number)) e.time = 'End must be after start.';
  if (ev.durationMin !== undefined && !(Number.isInteger(ev.durationMin) && inRange(ev.durationMin, 1, 1440))) e.durationMin = 'Length must be 1 minute to 24 hours.';
  if (ev.date !== null && !isDate(ev.date)) e.date = 'Use a date like 2026-10-26.';
  const r = ev.recur;
  if (ev.date === null) {
    if (!isObj(r)) e.recur = 'Pick at least one day.';
    else {
      if (!Array.isArray(r.weekdays) || !r.weekdays.length || !r.weekdays.every((w) => Number.isInteger(w) && w >= 1 && w <= 7)) e.days = 'Pick at least one day.';
      if (![1, 2, 3, 4].includes(r.everyNWeeks as number)) e.everyNWeeks = 'Repeat every 1-4 weeks.';
      if (!isDate(r.anchorDate)) e.anchorDate = 'Use a date like 2026-10-26.';
      if ((r.from !== null && !isDate(r.from)) || (r.until !== null && !isDate(r.until))) e.range = 'Use dates like 2026-10-26.';
      else if (r.from && r.until && r.until < r.from) e.range = 'Until must be after from.';
    }
  }
  if (!isStr(ev.notes) || ev.notes.length > 5000) e.notes = 'Notes are too long.';
  return e;
}

const bools = (o: unknown, keys: string[]): boolean => isObj(o) && keys.every((k) => isBool(o[k]));
/** A misparse report (docs/parser): bounded strings so 200 of them stay far under Firestore's 1 MiB document limit. */
export const REPORT_MAX = { input: 300, expected: 500, actual: 500 };
const isParserReport = (r: unknown): boolean => isObj(r) && isNum(r.at) && isStr(r.input) && r.input.length <= REPORT_MAX.input && isStr(r.expected) && r.expected.length <= REPORT_MAX.expected && isStr(r.actual) && r.actual.length <= REPORT_MAX.actual;

export function validateSettings(s: Settings): Errors {
  const e: Errors = {};
  if (!isStr(s.displayName) || s.displayName.length > 40) e.displayName = 'Name must be up to 40 characters.';
  if (!isValidZone(s.timezone)) e.timezone = 'Unknown time zone.';
  if (!isMinute(s.dayStartMin) || !isMinute(s.dayEndMin) || s.dayEndMin - s.dayStartMin < 60) e.day = 'The day must be at least an hour long.';
  if (!(Number.isInteger(s.bufferMin) && inRange(s.bufferMin, 0, 240))) e.bufferMin = 'Buffer must be 0-240 minutes.';
  const v = s.timeLeft;
  if (!isObj(v) || ![v.gapFilterMin, v.transitionMin, v.mealReserveMin].every((n) => Number.isInteger(n) && inRange(n, 0, 240))) e.timeLeft = 'Each variant must be 0-240 minutes.';
  if (!isObj(s.timetable) || !isBool(s.timetable.enabled) || !SCOPES.every((k) => isBool(s.timetable.scopes?.[k]))) e.timetable = 'Invalid timetable switches.';
  Object.assign(e, validateTimer(s.timerDefaults, 'timerDefaults'));
  if (s.blockEnd !== 'continue' && s.blockEnd !== 'stop') e.blockEnd = 'Invalid block-end behaviour.';
  if (!(Number.isInteger(s.prepLeadMin) && inRange(s.prepLeadMin, 5, 24 * 60))) e.prepLeadMin = 'Reminder lead must be 5 minutes to 24 hours.';
  if (!(Number.isInteger(s.checkpointEveryMin) && inRange(s.checkpointEveryMin, 15, 600))) e.checkpointEveryMin = 'Checkpoints every 15-600 minutes.';
  if (!['dark', 'light', 'system'].includes(s.theme)) e.theme = 'Unknown theme.';
  if (s.accent !== null && !(isStr(s.accent) && /^#[0-9a-f]{6}$/i.test(s.accent))) e.accent = 'Pick a colour.';
  if (s.runwayPosition !== 'top' && s.runwayPosition !== 'bottom') e.runwayPosition = 'Invalid position.';
  if (s.reduceMotion !== null && !isBool(s.reduceMotion)) e.reduceMotion = 'Invalid flag.';
  if (!isBool(s.holidaysEnabled) || !isBool(s.onboarded)) e.flags = 'Invalid flag.';
  if (!isStr(s.themeId) || !s.themeId || s.themeId.length > 40) e.themeId = 'Unknown theme.';
  if (s.customTheme !== null && !(isObj(s.customTheme) && Object.keys(s.customTheme).length <= 64 && Object.values(s.customTheme).every((v) => isStr(v) && v.length <= 64))) e.customTheme = 'Invalid custom theme.';
  if (!SNAP_OPTIONS.includes(s.snapMin)) e.snapMin = 'Snap must be 5, 10, 15 or 30 minutes.';
  if (!Array.isArray(s.themeSchedule) || s.themeSchedule.length > 24 || !s.themeSchedule.every((x) => isObj(x) && isStr(x.from) && /^([01]\d|2[0-3]):[0-5]\d$/.test(x.from) && isStr(x.themeId) && x.themeId.length > 0 && x.themeId.length <= 40)) e.themeSchedule = 'Invalid theme schedule.';
  if (!inRange(s.weeklyFocusTargetH, 0, 168)) e.weeklyFocusTargetH = 'Use 0-168 hours.';
  const so = s.sound;
  if (!isObj(so) || !isBool(so.enabled) || !inRange(so.volume, 0, 1) || !isBool(so.muteInFocus)) e.sound = 'Invalid sound.';
  if (!bools(s.energy, ['livingReactor', 'holographicDepth', 'reactiveData', 'motion'])) e.energy = 'Invalid energy.';
  if (!bools(s.widgets, ['day', 'momentum', 'notes', 'wellness'])) e.widgets = 'Invalid widgets.';
  if (!Array.isArray(s.parserReports) || s.parserReports.length > PARSER_REPORTS_MAX || !s.parserReports.every(isParserReport)) e.parserReports = 'Invalid parser reports.';
  const pl = s.planning;
  if (!isObj(pl) || !(Number.isInteger(pl.defaultBlockMin) && inRange(pl.defaultBlockMin, 5, 480)) || !isBool(pl.learnEstimates) || !(Number.isInteger(pl.breakAfterMin) && inRange(pl.breakAfterMin, 15, 240))) e.planning = 'Invalid planning.';
  if (!Array.isArray(s.parserRules) || s.parserRules.length > 200 || !s.parserRules.every(isParserRule)) e.parserRules = 'Invalid parser rules.';
  return e;
}

/** Electron accelerator check: modifiers joined by "+" ending in exactly one key. */
export function isValidAccelerator(acc: unknown): boolean {
  if (!isStr(acc) || acc.length > 60) return false;
  const parts = acc.split('+').map((p) => p.trim());
  if (parts.length < 2 || parts.some((p) => !p)) return false;
  const mods = new Set(['ctrl', 'control', 'alt', 'shift', 'super', 'meta', 'cmdorctrl', 'commandorcontrol', 'altgr', 'option']);
  const key = (parts[parts.length - 1] ?? '').toLowerCase();
  const keyOk = /^([a-z0-9]|f([1-9]|1[0-9]|2[0-4])|space|tab|enter|return|backspace|delete|insert|home|end|pageup|pagedown|up|down|left|right|escape|esc|plus|[`\-=[\];',./\\])$/.test(key);
  return keyOk && !mods.has(key) && parts.slice(0, -1).every((m) => mods.has(m.toLowerCase()));
}

const optStr = (v: unknown, max: number) => v === undefined || (isStr(v) && v.length <= max);
const optBool = (v: unknown) => v === undefined || isBool(v);

/** A ParserRule (core/parser/types). The Phase 1 `{keyword, kind}` shape is still accepted on read; the parser maps it. */
export function isParserRule(r: unknown): boolean {
  if (!isObj(r)) return false;
  if ('keyword' in r && !('match' in r)) return isStr(r.keyword) && r.keyword.trim().length > 0 && r.keyword.length <= 60 && (r.kind === 'fixed' || r.kind === 'task');
  return (
    isStr(r.id) && r.id.length > 0 && r.id.length <= 80 &&
    isStr(r.match) && r.match.trim().length > 0 && r.match.length <= 60 &&
    (r.aliases === undefined || (Array.isArray(r.aliases) && r.aliases.length <= 20 && r.aliases.every((a) => isStr(a) && a.trim().length > 0 && a.length <= 60))) &&
    (r.kind === undefined || r.kind === 'fixed' || r.kind === 'task' || r.kind === 'note') &&
    (r.defaultDurationMin === undefined || (Number.isInteger(r.defaultDurationMin) && inRange(r.defaultDurationMin as number, 1, 1440))) &&
    optBool(r.allowDateOnly) && optBool(r.usesSchedule) && optStr(r.tagId, 160) && optStr(r.projectId, 160) &&
    (r.source === 'builtin' || r.source === 'user' || r.source === 'learned')
  );
}

export function validateDevice(s: DeviceSettings): Errors {
  const e: Errors = {};
  for (const k of ['launchAtLogin', 'skipLaunchScreen', 'sound', 'notifications', 'liveOnDesktop', 'overlayHideInFullscreen'] as const) if (!isBool(s[k])) e[k] = 'Invalid flag.';
  if (!['taskbar-left', 'taskbar-right', 'free'].includes(s.widgetDock)) e.widgetDock = 'Invalid dock.';
  const sc = s.shortcuts;
  const keys = ['toggle', 'startPause', 'capture'] as const;
  for (const k of keys) if (!isValidAccelerator(sc[k])) e[`shortcuts.${k}`] = 'Use a format like Ctrl+Alt+Space.';
  if (new Set(keys.map((k) => sc[k].toLowerCase())).size !== keys.length) e.shortcuts = 'Shortcuts must differ.';
  if (s.stackFolder !== null && (!isStr(s.stackFolder) || s.stackFolder.length > 1000)) e.stackFolder = 'Invalid folder.';
  if (s.displayId !== null && !isNum(s.displayId)) e.displayId = 'Invalid display.';
  if (!isBool(s.experimental) || !isBool(s.onboarded)) e.experimental = 'Invalid flag.';
  if (s.composerProjectId !== null && !isId(s.composerProjectId)) e.composerProjectId = 'Invalid project.';
  const m = s.mcp;
  if (!isObj(m) || !isBool(m.enabled) || !(Number.isInteger(m.port) && inRange(m.port, 0, 65535)) || !isStr(m.token) || m.token.length > 200) e.mcp = 'Invalid MCP settings.';
  const y = s.sync;
  if (!isObj(y) || !(y.uid === null || isStr(y.uid)) || !isObj(y.cursors) || !Object.values(y.cursors).every(isNum) || !(y.lastSyncAt === null || isNum(y.lastSyncAt))) e.sync = 'Invalid sync state.';
  const a = s.auth;
  if (!isObj(a) || ![a.refreshTokenEnc, a.email, a.uid].every((v) => v === null || (isStr(v) && v.length <= 8000))) e.auth = 'Invalid sign-in state.';
  return e;
}

// ---- Whole records (loader, sync pull, imports) ----
// Structural checks with generous bounds: they reject what would break the app
// (wrong types, unknown enums, missing fields), not what the editor would refuse.

type Check = (v: unknown) => boolean;
const nullable = (c: Check): Check => (v) => v === null || c(v);
const str = (max: number): Check => (v) => isStr(v) && v.length <= max;
const int = (min: number, max: number): Check => (v) => Number.isInteger(v) && inRange(v, min, max);
const anyNum: Check = isNum;
const oneOf = (xs: readonly unknown[]): Check => (v) => xs.includes(v);
const arrOf = (c: Check, max: number): Check => (v) => Array.isArray(v) && v.length <= max && v.every(c);
const idRef = nullable(isId);
const minute: Check = isMinute;
const DATE: Check = isDate;
const timerCfg: Check = (v) => Object.keys(validateTimer(v)).length === 0;
const runtime: Check = (v) =>
  isObj(v) && ['idle', 'running', 'paused', 'completed'].includes(v.status as string) && ['work', 'shortBreak', 'longBreak'].includes(v.phase as string) && isNum(v.phaseElapsedMs) && (v.sliceStartedAt === null || isNum(v.sliceStartedAt)) && isNum(v.cycleSessions) && isBool(v.expiredNotified);
const recur: Check = (v) =>
  isObj(v) && Array.isArray(v.weekdays) && v.weekdays.every((w) => Number.isInteger(w) && w >= 1 && w <= 7) && [1, 2, 3, 4].includes(v.everyNWeeks as number) && isDate(v.anchorDate) && (v.from === null || isDate(v.from)) && (v.until === null || isDate(v.until));
const columns: Check = arrOf((c) => isObj(c) && isStr(c.id) && c.id.length > 0 && c.id.length <= 60 && isStr(c.name) && c.name.length <= 60, 30);

const SHAPES: Record<Coll, Record<string, Check>> = {
  tasks: {
    kind: oneOf(['task', 'sprint']), title: str(500), finishCondition: str(2000), notes: str(100_000), tagId: idRef, priority: oneOf(PRIORITIES),
    estimateMin: nullable(int(1, 24 * 60)), dueDate: nullable(DATE), dueTime: nullable(int(0, 1439)), dueEventId: idRef, projectId: idRef, columnId: nullable(str(60)),
    recurrence: nullable(isTaskRecurrence), recurrenceParentId: idRef, source: oneOf(TASK_SOURCES), order: anyNum, sortKey: isSortKey,
    status: oneOf(TASK_STATUSES), outcome: nullable(oneOf(['finished', 'shipped', 'killed'])), dropCount: int(0, 1e6), parkedAt: nullable(anyNum),
    workMs: anyNum, breakMs: anyNum, pomodorosCompleted: int(0, 1e6), startedAt: nullable(anyNum), completedAt: nullable(anyNum), timer: timerCfg, runtime,
    checkpointEveryMin: nullable(int(1, 24 * 60)), nextCheckpointMs: nullable(anyNum),
  },
  events: { title: str(500), tagId: idRef, scope: oneOf(SCOPES), tz: isValidZone, startMin: nullable(minute), endMin: nullable(minute), durationMin: int(1, 1440), date: nullable(DATE), recur: nullable(recur), notes: str(100_000) },
  eventExceptions: { eventId: isId, date: DATE, kind: oneOf(['skip', 'edit']), title: nullable(str(500)), startMin: nullable(minute), endMin: nullable(minute), tagId: idRef },
  closures: { name: str(200), startDate: DATE, endDate: DATE, scopes: arrOf(oneOf(SCOPES), 4), source: oneOf(['holiday', 'break', 'custom']), confirmed: isBool },
  blocks: { taskId: idRef, tagId: idRef, title: str(500), date: DATE, startMin: minute, endMin: minute, tz: isValidZone, kind: oneOf(['work', 'sprint', 'break']), auto: isBool },
  sessions: { taskId: isId, blockId: idRef, startedAt: anyNum, endedAt: anyNum, phase: oneOf(['work', 'break']), overrunMs: anyNum },
  tags: { name: str(200), color: oneOf(TAG_COLORS), kind: oneOf(['class', 'project', 'general']) },
  ideas: { text: str(5000), body: str(100_000), taskId: idRef, projectId: idRef, reviewed: isBool, parsedTaskIds: arrOf(isId, 500) },
  activity: { type: oneOf(['started', 'finished', 'dropped', 'killed', 'claude']), taskId: (v) => v === '' || isId(v), at: anyNum, reason: str(5000) },
  timer: { taskId: idRef, ownerDeviceId: str(200), ownerName: str(200), takeoverAt: nullable(anyNum) },
  settings: {},
  projects: { name: str(200), color: oneOf(TAG_COLORS), columns, archived: isBool, sortKey: isSortKey },
  reviews: { date: DATE, outcomes: arrOf((o) => isObj(o) && isId(o.taskId) && ['tomorrow', 'unscheduled', 'dropped', 'done'].includes(o.action as string), 1000) },
};

const BASE: Record<string, Check> = {
  createdAt: anyNum,
  updatedAt: anyNum,
  deviceId: str(200),
  deletedAt: nullable(anyNum),
  v: (v) => Number.isInteger(v) && (v as number) >= 1,
  fv: (v) => isObj(v) && Object.values(v).every(isNum),
  fw: (v) => isObj(v) && Object.values(v).every(isStr),
};

/** Why this record cannot be loaded or merged, or null if it is fine. */
export function recordProblem(coll: string, rec: unknown): string | null {
  if (!COLLS.includes(coll as Coll)) return `unknown collection ${coll}`;
  if (!isObj(rec)) return 'not an object';
  if (!isId(rec.id)) return 'bad id';
  if (rec.purged === true) return isNum(rec.updatedAt) && isNum(rec.deletedAt) && isStr(rec.deviceId) && Number.isInteger(rec.v) ? null : 'bad purge stub';
  if (typeof rec.v === 'number' && rec.v > SCHEMA_V) return `schemaVersion ${rec.v} is newer than this app (${SCHEMA_V})`;
  for (const [k, c] of Object.entries(BASE)) if (!c(rec[k])) return `bad ${k}`;
  if (coll === 'settings') {
    if (rec.id !== 'main') return 'settings must be doc main';
    const e = validateSettings(rec as unknown as Settings);
    const k = Object.keys(e)[0];
    return k ? `bad ${k}` : null;
  }
  if (coll === 'timer' && rec.id !== 'current') return 'timer must be doc current';
  for (const [k, c] of Object.entries(SHAPES[coll as Coll])) if (!c(rec[k])) return `bad ${k}`;
  // An event is placed (both times) or unplaced (neither); a recurring one is always placed.
  if (coll === 'events' && ((rec.startMin === null) !== (rec.endMin === null) || (rec.startMin === null && rec.date === null))) return 'bad time';
  return null;
}


