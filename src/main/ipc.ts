// IPC handlers. Everything arriving from a renderer is untrusted: the sender must
// be one of our windows, and every payload is rebuilt field by field from known
// keys before it reaches the controller, which validates the values again with
// the same shared validators (core/validation via core/commands).

import { ipcMain, type IpcMainEvent, type IpcMainInvokeEvent } from 'electron';
import { RECYCLABLE, type ClosureInput, type Command, type EventInput, type Result, type SettingsPatch, type TaskInput, type TagInput } from '../core/commands';
import { COLLS, type Coll, type DeviceSettings, type ShelfItem, type Snapshot, type TimerConfig } from '../core/model/types';
import { CHANNELS } from '../preload/api';

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => typeof v === 'object' && v !== null && !Array.isArray(v);
const str = (v: unknown, max = 5000): string => (typeof v === 'string' ? v.slice(0, max) : '');
const id = (v: unknown): string | null => (typeof v === 'string' && /^[\w-]{1,100}$/.test(v) ? v : null);
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
  if ('deadline' in v) out.deadline = v.deadline === null ? null : str(v.deadline, 10);
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
    startMin: num(v.startMin),
    endMin: num(v.endMin),
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
  return p;
}

function pickDevice(v: Obj): Partial<DeviceSettings> {
  const p: Partial<DeviceSettings> = {};
  for (const k of ['launchAtLogin', 'skipLaunchScreen', 'sound', 'notifications'] as const) if (k in v) p[k] = v[k] as boolean;
  if ('widgetDock' in v) p.widgetDock = v.widgetDock as DeviceSettings['widgetDock'];
  if (isObj(v.shortcuts)) p.shortcuts = { toggle: str(v.shortcuts.toggle, 60), startPause: str(v.shortcuts.startPause, 60), capture: str(v.shortcuts.capture, 60) };
  if ('displayId' in v) p.displayId = v.displayId === null ? null : num(v.displayId);
  if ('stackFolder' in v) p.stackFolder = v.stackFolder === null ? null : str(v.stackFolder, 1000);
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
      return rid ? { type: 'task.finish', id: rid, phrase: str(raw.phrase, 200) } : null;
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
      return { type: 'idea.add', text: str(raw.text, 1000), taskId: nullableId(raw.taskId) };
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
    case 'timer.takeover':
    case 'data.export':
    case 'data.openFolder':
      return { type: raw.type };
    default:
      return null;
  }
}

export interface IpcDeps {
  isOurSender(e: IpcMainEvent | IpcMainInvokeEvent): boolean;
  snapshot(): Snapshot;
  command(cmd: Command): Result | Promise<Result>;
  hide(): void;
  widgetClick(): void;
  widgetMenu(): void;
  dragStart(): void;
  dragEnd(): boolean;
  closeCapture(): void;
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
    guard<[unknown], Result | Promise<Result>>(forbidden, (raw) => {
      const cmd = parseCommand(raw);
      return cmd ? deps.command(cmd) : { ok: false, error: 'Invalid command.' };
    }),
  );
  ipcMain.on(CHANNELS.hide, guard(undefined, () => deps.hide()));
  ipcMain.on(CHANNELS.widgetClick, guard(undefined, () => deps.widgetClick()));
  ipcMain.on(CHANNELS.widgetMenu, guard(undefined, () => deps.widgetMenu()));
  ipcMain.on(CHANNELS.dragStart, guard(undefined, () => deps.dragStart()));
  ipcMain.handle(CHANNELS.dragEnd, guard(false, () => deps.dragEnd()));
  ipcMain.on(CHANNELS.closeCapture, guard(undefined, () => deps.closeCapture()));
  ipcMain.on(CHANNELS.quit, guard(undefined, () => deps.quit()));
  ipcMain.on(CHANNELS.restart, guard<[unknown], void>(undefined, (reason) => deps.restart(str(reason, 2000))));
  ipcMain.on(CHANNELS.mark, guard<[unknown, unknown], void>(undefined, (name, ms) => {
    if (typeof name === 'string' && /^[\w.-]{1,40}$/.test(name) && Number.isFinite(ms)) deps.mark(name, ms as number);
  }));
  ipcMain.handle(CHANNELS.stackList, guard(Promise.resolve([] as ShelfItem[]), () => deps.stackList()));
  ipcMain.handle(CHANNELS.stackOpen, guard<[unknown], Promise<Result>>(Promise.resolve(forbidden), (p) => deps.stackOpen(str(p, 2000))));
  ipcMain.handle(CHANNELS.stackTrash, guard<[unknown], Promise<Result>>(Promise.resolve(forbidden), (p) => deps.stackTrash(str(p, 2000))));
}
