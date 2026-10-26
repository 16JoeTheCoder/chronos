// Field validators used by the renderer (inline errors) and main (the authority:
// every IPC payload is re-checked here after being rebuilt). Pure.

import { isValidZone } from './time/zone';
import { PRIORITIES, SCOPES, TAG_COLORS, type DeviceSettings, type Settings } from './model/types';

export const FINISH_PHRASE = 'I have finished this task';
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

/** Case-insensitive, trimmed, whitespace collapsed, one trailing period ignored. */
export function normalizePhrase(s: string): string {
  return s.trim().replace(/\s+/g, ' ').replace(/\.$/, '').trim().toLowerCase();
}

export function isFinishPhrase(s: unknown): boolean {
  return isStr(s) && normalizePhrase(s) === normalizePhrase(FINISH_PHRASE);
}

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
  deadline?: unknown;
  checkpointEveryMin?: unknown;
  timer?: unknown;
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
  if (t.deadline !== undefined && t.deadline !== null && !isDate(t.deadline)) e.deadline = 'Use a date like 2026-10-26.';
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
  if (!isMinute(ev.startMin) || !isMinute(ev.endMin) || (ev.endMin as number) <= (ev.startMin as number)) e.time = 'End must be after start.';
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

export function validateDevice(s: DeviceSettings): Errors {
  const e: Errors = {};
  for (const k of ['launchAtLogin', 'skipLaunchScreen', 'sound', 'notifications'] as const) if (!isBool(s[k])) e[k] = 'Invalid flag.';
  if (!['taskbar-left', 'taskbar-right', 'free'].includes(s.widgetDock)) e.widgetDock = 'Invalid dock.';
  const sc = s.shortcuts;
  const keys = ['toggle', 'startPause', 'capture'] as const;
  for (const k of keys) if (!isValidAccelerator(sc[k])) e[`shortcuts.${k}`] = 'Use a format like Ctrl+Alt+Space.';
  if (new Set(keys.map((k) => sc[k].toLowerCase())).size !== keys.length) e.shortcuts = 'Shortcuts must differ.';
  if (s.stackFolder !== null && (!isStr(s.stackFolder) || s.stackFolder.length > 1000)) e.stackFolder = 'Invalid folder.';
  if (s.displayId !== null && !isNum(s.displayId)) e.displayId = 'Invalid display.';
  return e;
}

