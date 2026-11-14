// IPC handlers. Everything arriving from a renderer is untrusted: the sender must
// be one of our windows, and every payload is rebuilt field by field from known
// keys before it reaches the controller, which validates the values again with
// the same shared validators (core/validation via core/commands).

import { ipcMain, type IpcMainEvent, type IpcMainInvokeEvent } from 'electron';
import { RECYCLABLE, type ClosureInput, type Command, type EventInput, type OccurrencePatch, type Result, type SettingsPatch, type TaskInput, type TagInput } from '../core/commands';
import { isId } from '../core/model/ids';
import { COLLS, type Coll, type DeviceSettings, type ShelfItem, type Snapshot, type TimerConfig } from '../core/model/types';
import { CHANNELS, type NotepadCreated } from '../preload/api';
import { isObj } from '../core/validation';
import { TOKEN_RE } from './undoTokens';

type Obj = Record<string, unknown>;
const str = (v: unknown, max = 5000): string => (typeof v === 'string' ? v.slice(0, max) : '');
const id = (v: unknown): string | null => (isId(v) ? v : null);
const num = (v: unknown): number => (typeof v === 'number' && Number.isFinite(v) ? v : NaN);
const optNum = (v: unknown): number | null | undefined => (v === undefined ? undefined : v === null ? null : num(v));
const optStr = (v: unknown, max: number): string | undefined => (v === undefined ? undefined : str(v, max));
const nullableId = (v: unknown): string | null => (v === null ? null : id(v));
const oneOf = <T extends string>(v: unknown, opts: readonly T[]): T | undefined => (opts.includes(v as T) ? (v as T) : undefined);
const bool = (v: unknown): boolean | undefined => (typeof v === 'boolean' ? v : undefined);

function pickTimer(v: unknown): TimerConfig {
  // Shape is checked by validateTimer later; here we only copy known keys.
  const t = isObj(v) ? v : {};
  const c = isObj(t.countdown) ? t.countdown : {};
  const p = isObj(t.pomodoro) ? t.pomodoro : {};
  return {
    mode: t.mode as TimerConfig['mode'],
    countdown: { durationMs: num(c.durationMs), onExpire: c.onExpire as 'stop' | 'continue' },
    pomodoro: {
      workMs: num(p.workMs),
      shortBreakMs: num(p.shortBreakMs),
      longBreakMs: num(p.longBreakMs),
      sessionsBeforeLongBreak: num(p.sessionsBeforeLongBreak),
      autoStartBreaks: p.autoStartBreaks as boolean,
      autoStartWork: p.autoStartWork as boolean,
    },
  };
}

/** Rebuild a TaskInput keeping only the keys the sender actually set. */
function pickTask(v: Obj): Partial<TaskInput> {
  const out: Partial<TaskInput> = {};
  if ('kind' in v) out.kind = oneOf(v.kind, ['task', 'sprint'] as const);
  if ('title' in v) out.title = str(v.title, 200);
  if ('finishCondition' in v) out.finishCondition = str(v.finishCondition, 600);
  if ('notes' in v) out.notes = str(v.notes, 5000);
  if ('tagId' in v) out.tagId = nullableId(v.tagId);
  if ('priority' in v) out.priority = v.priority as TaskInput['priority'];
  if ('estimateMin' in v) out.estimateMin = optNum(v.estimateMin);
  if ('dueDate' in v) out.dueDate = v.dueDate === null ? null : str(v.dueDate, 10);
  if ('dueTime' in v) out.dueTime = optNum(v.dueTime);
  if ('projectId' in v) out.projectId = nullableId(v.projectId);
  if ('columnId' in v) out.columnId = v.columnId === null ? null : str(v.columnId, 60);
  if ('recurrence' in v) {
    const r = isObj(v.recurrence) ? v.recurrence : null;
    out.recurrence = r ? { freq: r.freq as 'daily', interval: num(r.interval), ...(Array.isArray(r.weekdays) ? { weekdays: r.weekdays.slice(0, 7).map(num) } : {}) } : null;
  }
  if ('dueEventId' in v) out.dueEventId = nullableId(v.dueEventId);
  if ('checkpointEveryMin' in v) out.checkpointEveryMin = optNum(v.checkpointEveryMin);
  if ('timer' in v) out.timer = pickTimer(v.timer);
  return out;
}

function pickEvent(v: unknown): EventInput | null {
  if (!isObj(v)) return null;
  const r = isObj(v.recur) ? v.recur : null;
  return {
    title: str(v.title, 200),
    tagId: nullableId(v.tagId),
    scope: v.scope as EventInput['scope'],
    tz: str(v.tz, 64),
    startMin: v.startMin === null ? null : num(v.startMin),
    endMin: v.endMin === null ? null : num(v.endMin),
    ...(v.durationMin !== undefined ? { durationMin: num(v.durationMin) } : {}),
    date: v.date === null ? null : str(v.date, 10),
    recur: r
      ? {
          weekdays: Array.isArray(r.weekdays) ? r.weekdays.slice(0, 7).map(num) : [],
          everyNWeeks: num(r.everyNWeeks) as 1,
          anchorDate: str(r.anchorDate, 10),
          from: r.from === null ? null : str(r.from, 10),
          until: r.until === null ? null : str(r.until, 10),
        }
      : null,
    notes: str(v.notes, 5000),
  };
}

function pickClosure(v: unknown): ClosureInput | null {
  if (!isObj(v)) return null;
  return {
    name: str(v.name, 100),
    startDate: str(v.startDate, 10),
    endDate: str(v.endDate, 10),
    scopes: Array.isArray(v.scopes) ? v.scopes.slice(0, 4).map((s) => str(s, 10)) as ClosureInput['scopes'] : [],
    confirmed: v.confirmed === true,
  };
}

function pickTag(v: unknown): TagInput | null {
  return isObj(v) ? { name: str(v.name, 60), color: v.color as TagInput['color'], kind: v.kind as TagInput['kind'] } : null;
}

function pickSettings(v: Obj): SettingsPatch {
  const p: SettingsPatch = {};
  if ('displayName' in v) p.displayName = str(v.displayName, 60);
  if ('timezone' in v) p.timezone = str(v.timezone, 64);
  for (const k of ['dayStartMin', 'dayEndMin', 'bufferMin', 'prepLeadMin', 'checkpointEveryMin'] as const) if (k in v) p[k] = num(v[k]);
  if (isObj(v.timeLeft)) p.timeLeft = { gapFilterMin: num(v.timeLeft.gapFilterMin), transitionMin: num(v.timeLeft.transitionMin), mealReserveMin: num(v.timeLeft.mealReserveMin) };
  if (isObj(v.timetable)) {
    const sc = isObj(v.timetable.scopes) ? v.timetable.scopes : {};
    p.timetable = { enabled: v.timetable.enabled as boolean, scopes: { school: sc.school as boolean, work: sc.work as boolean, uni: sc.uni as boolean, other: sc.other as boolean } };
  }
  if ('timerDefaults' in v) p.timerDefaults = pickTimer(v.timerDefaults);
  if ('blockEnd' in v) p.blockEnd = v.blockEnd as SettingsPatch['blockEnd'];
  if ('holidaysEnabled' in v) p.holidaysEnabled = v.holidaysEnabled as boolean;
  if ('theme' in v) p.theme = v.theme as SettingsPatch['theme'];
  if ('accent' in v) p.accent = v.accent === null ? null : str(v.accent, 7);
  if ('runwayPosition' in v) p.runwayPosition = v.runwayPosition as SettingsPatch['runwayPosition'];
  if ('reduceMotion' in v) p.reduceMotion = v.reduceMotion as boolean | null;
  if ('onboarded' in v) p.onboarded = v.onboarded as boolean;
  if ('themeId' in v) p.themeId = str(v.themeId, 40);
  if (Array.isArray(v.themeSchedule)) p.themeSchedule = v.themeSchedule.slice(0, 24).map((x) => ({ from: str(isObj(x) ? x.from : '', 5), themeId: str(isObj(x) ? x.themeId : '', 40) }));
  if ('weeklyFocusTargetH' in v) p.weeklyFocusTargetH = num(v.weeklyFocusTargetH);
  if (isObj(v.sound)) p.sound = { enabled: v.sound.enabled as boolean, volume: num(v.sound.volume), muteInFocus: v.sound.muteInFocus as boolean };
  const flags = <K extends string>(o: unknown, keys: readonly K[]) => Object.fromEntries(keys.map((k) => [k, (isObj(o) ? o[k] : undefined) as boolean])) as Record<K, boolean>;
  if (isObj(v.energy)) p.energy = flags(v.energy, ['livingReactor', 'holographicDepth', 'reactiveData', 'motion'] as const);
  if (isObj(v.widgets)) p.widgets = flags(v.widgets, ['day', 'momentum', 'notes', 'wellness'] as const);
  if (isObj(v.planning)) p.planning = { defaultBlockMin: num(v.planning.defaultBlockMin), learnEstimates: v.planning.learnEstimates as boolean, breakAfterMin: num(v.planning.breakAfterMin) };
  return p;
}

function pickDevice(v: Obj): Extract<Command, { type: 'device.update' }>['patch'] {
  const p: Extract<Command, { type: 'device.update' }>['patch'] = {};
  for (const k of ['launchAtLogin', 'skipLaunchScreen', 'sound', 'notifications', 'experimental', 'liveOnDesktop', 'overlayHideInFullscreen'] as const) if (k in v) p[k] = v[k] as boolean;
  if (isObj(v.mcp) && typeof v.mcp.enabled === 'boolean') p.mcp = { enabled: v.mcp.enabled };
  if ('widgetDock' in v) p.widgetDock = v.widgetDock as DeviceSettings['widgetDock'];
  if (isObj(v.shortcuts)) p.shortcuts = { toggle: str(v.shortcuts.toggle, 60), startPause: str(v.shortcuts.startPause, 60), capture: str(v.shortcuts.capture, 60) };
  if ('displayId' in v) p.displayId = v.displayId === null ? null : num(v.displayId);
  if ('stackFolder' in v) p.stackFolder = v.stackFolder === null ? null : str(v.stackFolder, 1000);
  if ('composerProjectId' in v) p.composerProjectId = nullableId(v.composerProjectId);
  if ('onboarded' in v) p.onboarded = v.onboarded as boolean;
  return p;
}

const coll = (v: unknown): Coll | null => (COLLS.includes(v as Coll) && RECYCLABLE.includes(v as Coll) ? (v as Coll) : null);

/** Turn an untrusted payload into a well-typed Command, or null. Values are validated again in core. */
export function parseCommand(raw: unknown): Command | null {
  if (!isObj(raw)) return null;
  const rid = id(raw.id);
  switch (raw.type) {
    case 'task.create': {
      const input = isObj(raw.input) ? pickTask(raw.input) : null;
      return input && typeof input.title === 'string' ? { type: 'task.create', input: input as TaskInput } : null;
    }
    case 'task.update':
      return rid && isObj(raw.input) ? { type: 'task.update', id: rid, input: pickTask(raw.input) } : null;
    case 'task.reorder': {
      const direction = oneOf(raw.direction, ['up', 'down'] as const);
      return rid && direction ? { type: 'task.reorder', id: rid, direction } : null;
    }
    case 'task.finish':
      return rid ? { type: 'task.finish', id: rid } : null;
    case 'task.close':
      return rid ? { type: 'task.close', id: rid, reason: str(raw.reason, 500) } : null;
    case 'task.drop':
      return rid ? { type: 'task.drop', id: rid, reason: str(raw.reason, 500) } : null;
    case 'task.reopen':
      return rid ? { type: 'task.reopen', id: rid } : null;
    case 'timer': {
      const action = oneOf(raw.action, ['start', 'pause', 'resume', 'reset', 'skipPhase'] as const);
      return action ? { type: 'timer', action } : null;
    }
    case 'sprint.checkpoint': {
      const choice = oneOf(raw.choice, ['continue', 'kill'] as const);
      return rid && choice ? { type: 'sprint.checkpoint', id: rid, choice, reason: str(raw.reason, 500) } : null;
    }
    case 'block.create': {
      const kind = raw.kind === undefined ? undefined : oneOf(raw.kind, ['work', 'sprint', 'break'] as const);
      return { type: 'block.create', taskId: nullableId(raw.taskId), date: str(raw.date, 10), startMin: num(raw.startMin), endMin: num(raw.endMin), title: optStr(raw.title, 200), kind };
    }
    case 'block.move':
      return rid ? { type: 'block.move', id: rid, date: str(raw.date, 10), startMin: num(raw.startMin), endMin: num(raw.endMin) } : null;
    case 'event.create':
    case 'event.update': {
      const input = pickEvent(raw.input);
      if (!input) return null;
      if (raw.type === 'event.create') return { type: 'event.create', input };
      return rid ? { type: 'event.update', id: rid, input } : null;
    }
    case 'event.skip':
      return rid ? { type: 'event.skip', id: rid, date: str(raw.date, 10) } : null;
    case 'event.editOn': {
      if (!rid || !isObj(raw.patch)) return null;
      const p = raw.patch;
      const patch: OccurrencePatch = {};
      if ('title' in p) patch.title = p.title === null ? null : str(p.title, 200);
      if ('startMin' in p) patch.startMin = optNum(p.startMin);
      if ('endMin' in p) patch.endMin = optNum(p.endMin);
      if ('tagId' in p) patch.tagId = nullableId(p.tagId);
      return { type: 'event.editOn', id: rid, date: str(raw.date, 10), patch };
    }
    case 'closure.create':
    case 'closure.update': {
      const input = pickClosure(raw.input);
      if (!input) return null;
      if (raw.type === 'closure.create') return { type: 'closure.create', input };
      return rid ? { type: 'closure.update', id: rid, input } : null;
    }
    case 'tag.create':
    case 'tag.update': {
      const input = pickTag(raw.input);
      if (!input) return null;
      if (raw.type === 'tag.create') return { type: 'tag.create', input };
      return rid ? { type: 'tag.update', id: rid, input } : null;
    }
    case 'idea.add':
      return { type: 'idea.add', text: str(raw.text, 20_000), taskId: nullableId(raw.taskId), projectId: nullableId(raw.projectId) };
    case 'event.place':
      return rid ? { type: 'event.place', id: rid, startMin: num(raw.startMin) } : null;
    case 'plan.auto':
    case 'plan.replan':
      return { type: raw.type, ...(typeof raw.date === 'string' ? { date: str(raw.date, 10) } : {}) };
    case 'review.submit': {
      const outcomes = Array.isArray(raw.outcomes) ? raw.outcomes.slice(0, 1000).map((o) => (isObj(o) ? { taskId: id(o.taskId) ?? '', action: o.action as 'done' } : { taskId: '', action: 'done' as const })) : [];
      return { type: 'review.submit', date: str(raw.date, 10), outcomes };
    }
    case 'parser.report':
      return { type: 'parser.report', input: str(raw.input, 300), expected: str(raw.expected, 500), actual: str(raw.actual, 500) };
    case 'idea.edit': {
      if (!rid) return null;
      const ids = Array.isArray(raw.parsedTaskIds) ? raw.parsedTaskIds.slice(0, 500) : undefined;
      if (ids && !ids.every((x) => typeof x === 'string' && x.length <= 200)) return null;
      return {
        type: 'idea.edit',
        id: rid,
        ...('body' in raw ? { body: str(raw.body, 20_000) } : {}),
        ...('projectId' in raw ? { projectId: nullableId(raw.projectId) } : {}),
        ...(ids ? { parsedTaskIds: ids as string[] } : {}),
      };
    }
    case 'idea.review':
      return rid && typeof raw.reviewed === 'boolean' ? { type: 'idea.review', id: rid, reviewed: raw.reviewed } : null;
    case 'idea.toTask':
      return rid ? { type: 'idea.toTask', id: rid } : null;
    case 'recycle':
    case 'restore': {
      const c = coll(raw.coll);
      if (!rid || !c) return null;
      return raw.type === 'recycle' ? { type: 'recycle', coll: c, id: rid, confirmed: raw.confirmed === true } : { type: 'restore', coll: c, id: rid };
    }
    case 'settings.update':
      return isObj(raw.patch) ? { type: 'settings.update', patch: pickSettings(raw.patch) } : null;
    case 'device.update':
      return isObj(raw.patch) ? { type: 'device.update', patch: pickDevice(raw.patch) } : null;
    case 'gap.answer':
      return bool(raw.count) !== undefined ? { type: 'gap.answer', count: raw.count as boolean } : null;
    case 'data.import':
      return raw.source === 'monolith' ? { type: 'data.import', source: 'monolith' } : null;
    case 'diag.clear': {
      const what = oneOf(raw.what, ['conflicts', 'quarantine'] as const);
      return what ? { type: 'diag.clear', what } : null;
    }
    case 'snapshot.restore':
      return typeof raw.name === 'string' && /^chronos-[\w-]{1,80}\.json$/.test(raw.name) ? { type: 'snapshot.restore', name: raw.name } : null;
    case 'mcp.undo':
      return typeof raw.token === 'string' && /^[\w-]{1,80}$/.test(raw.token) ? { type: 'mcp.undo', token: raw.token } : null;
    case 'timer.takeover':
    case 'data.export':
    case 'data.openFolder':
    case 'sync.signIn':
    case 'sync.signOut':
    case 'sync.retry':
    case 'sync.forceResync':
    case 'diag.exportLog':
    case 'mcp.regenerateToken':
    case 'mcp.copyConfig':
      return { type: raw.type };
    default:
      return null;
  }
}

/** The notepad's close summary: at most 100 known records, short text; anything else is dropped. */
export function pickCreated(v: unknown): NotepadCreated | null {
  if (!isObj(v) || !Array.isArray(v.records)) return null;
  const records = v.records.slice(0, 100).flatMap((r) => (isObj(r) && ['tasks', 'events', 'ideas'].includes(r.coll as string) && isId(r.id) ? [{ coll: r.coll as 'tasks', id: r.id as string }] : []));
  return records.length ? { text: str(v.text, 120), records } : null;
}

export interface IpcDeps {
  isOurSender(e: IpcMainEvent | IpcMainInvokeEvent): boolean;
  snapshot(): Snapshot;
  command(cmd: Command): Result | Promise<Result>;
  /** Raw undo ops from a command result go behind a token (D-143). */
  seal(res: Result): Result;
  redeemUndo(token: unknown): Extract<Command, { type: 'records.revert' }> | null;
  hide(): void;
  showHome(view: 'runway' | 'focus' | null): void;
  overlayClick(): void;
  overlayExpand(expanded: boolean): void;
  closeNotepad(created: NotepadCreated | null): void;
  closePalette(): void;
  notify(text: string, undoToken: string | undefined): void;
  askClaude(text: string): Promise<Result>;
  quit(): void;
  restart(reason: string): void;
  mark(name: string, ms: number): void;
  stackList(): Promise<ShelfItem[]>;
  stackOpen(path: string): Promise<Result>;
  stackTrash(path: string): Promise<Result>;
}

export function registerIpc(deps: IpcDeps): void {
  const guard = <A extends unknown[], R>(fallback: R, fn: (...a: A) => R) =>
    (e: IpcMainEvent | IpcMainInvokeEvent, ...a: A): R => (deps.isOurSender(e) ? fn(...a) : fallback);
  const forbidden: Result = { ok: false, error: 'Forbidden' };

  ipcMain.handle(CHANNELS.getSnapshot, guard(null, () => deps.snapshot()));
  ipcMain.handle(
    CHANNELS.command,
    guard<[unknown], Promise<Result>>(Promise.resolve(forbidden), async (raw) => {
      const cmd = parseCommand(raw);
      return cmd ? deps.seal(await deps.command(cmd)) : { ok: false, error: 'Invalid command.' };
    }),
  );
  ipcMain.handle(
    CHANNELS.undo,
    guard<[unknown], Promise<Result>>(Promise.resolve(forbidden), async (token) => {
      const cmd = deps.redeemUndo(token);
      return cmd ? deps.seal(await deps.command(cmd)) : { ok: false, error: 'That change can no longer be undone.' };
    }),
  );
  ipcMain.handle(CHANNELS.askClaude, guard<[unknown], Promise<Result>>(Promise.resolve(forbidden), (text) => {
    const t = str(text, 20_000).trim();
    return t ? deps.askClaude(t) : Promise.resolve({ ok: false, error: 'Nothing to send.' });
  }));
  ipcMain.on(CHANNELS.hide, guard(undefined, () => deps.hide()));
  ipcMain.on(CHANNELS.showHome, guard<[unknown], void>(undefined, (v) => deps.showHome(oneOf(v, ['runway', 'focus'] as const) ?? null)));
  ipcMain.on(CHANNELS.overlayClick, guard(undefined, () => deps.overlayClick()));
  ipcMain.on(CHANNELS.overlayExpand, guard<[unknown], void>(undefined, (v) => deps.overlayExpand(v === true)));
  ipcMain.on(CHANNELS.closeNotepad, guard<[unknown], void>(undefined, (v) => deps.closeNotepad(pickCreated(v))));
  ipcMain.on(CHANNELS.closePalette, guard(undefined, () => deps.closePalette()));
  ipcMain.on(CHANNELS.notify, guard<[unknown, unknown], void>(undefined, (text, token) => {
    const t = str(text, 120).trim();
    if (t) deps.notify(t, typeof token === 'string' && TOKEN_RE.test(token) ? token : undefined);
  }));
  ipcMain.on(CHANNELS.quit, guard(undefined, () => deps.quit()));
  ipcMain.on(CHANNELS.restart, guard<[unknown], void>(undefined, (reason) => deps.restart(str(reason, 2000))));
  ipcMain.on(CHANNELS.mark, guard<[unknown, unknown], void>(undefined, (name, ms) => {
    if (typeof name === 'string' && /^[\w.-]{1,40}$/.test(name) && Number.isFinite(ms)) deps.mark(name, ms as number);
  }));
  ipcMain.handle(CHANNELS.stackList, guard(Promise.resolve([] as ShelfItem[]), () => deps.stackList()));
  ipcMain.handle(CHANNELS.stackOpen, guard<[unknown], Promise<Result>>(Promise.resolve(forbidden), (p) => deps.stackOpen(str(p, 2000))));
  ipcMain.handle(CHANNELS.stackTrash, guard<[unknown], Promise<Result>>(Promise.resolve(forbidden), (p) => deps.stackTrash(str(p, 2000))));
}
