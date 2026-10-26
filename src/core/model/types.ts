// The Chronos data model. Pure types shared by core, main, preload and renderer.
// Every synced entity extends Base and is written only through core/repo, which
// stamps updatedAt/deviceId/v. DeviceSettings is local to one machine and never synced.

export const SCHEMA_V = 1;

export interface Base {
  id: string;
  createdAt: number;
  /** ms UTC, set only by core/repo. */
  updatedAt: number;
  deviceId: string;
  /** Tombstone. Recycled records stay until purge (core/repo/recycle). */
  deletedAt: number | null;
  v: number;
}

/** What is left of a record 7 days after deletion; dropped after 60 days. */
export interface Stub {
  id: string;
  updatedAt: number;
  deletedAt: number;
  deviceId: string;
  v: number;
  purged: true;
}

export type Scope = 'school' | 'work' | 'uni' | 'other';
export const SCOPES: Scope[] = ['school', 'work', 'uni', 'other'];
export type TagColor = 'tag1' | 'tag2' | 'tag3' | 'tag4' | 'tag5' | 'tag6' | 'tag7' | 'tag8';
export const TAG_COLORS: TagColor[] = ['tag1', 'tag2', 'tag3', 'tag4', 'tag5', 'tag6', 'tag7', 'tag8'];
export type Priority = 'must' | 'should' | 'nice';
export const PRIORITIES: Priority[] = ['must', 'should', 'nice'];

// ---- Timer (ported from Monolith) ----
export type TimerMode = 'countdown' | 'pomodoro' | 'stopwatch';
export type Phase = 'work' | 'shortBreak' | 'longBreak';
export type RunStatus = 'idle' | 'running' | 'paused' | 'completed';

export interface CountdownConfig {
  durationMs: number;
  onExpire: 'stop' | 'continue';
}

export interface PomodoroConfig {
  workMs: number;
  shortBreakMs: number;
  longBreakMs: number;
  sessionsBeforeLongBreak: number;
  autoStartBreaks: boolean;
  autoStartWork: boolean;
}

export interface TimerConfig {
  mode: TimerMode;
  countdown: CountdownConfig;
  pomodoro: PomodoroConfig;
}

export interface Runtime {
  status: RunStatus;
  phase: Phase;
  /** Time accumulated in the current phase by slices already closed. */
  phaseElapsedMs: number;
  /** Epoch ms when the running slice began, or null when not running. */
  sliceStartedAt: number | null;
  cycleSessions: number;
  expiredNotified: boolean;
}

/** A closed running stretch, produced by the timer engine; the caller turns it into a Session record. */
export interface Slice {
  startedAt: number;
  endedAt: number;
  phase: 'work' | 'break';
}

export interface TimerEvent {
  kind: 'countdownExpired' | 'phaseEnded';
  taskId: string;
  from: Phase;
  to: Phase;
  autoStarted: boolean;
}

// ---- Entities ----
export interface Tag extends Base {
  name: string;
  color: TagColor;
  kind: 'class' | 'project' | 'general';
}

export type TaskStatus = 'queued' | 'active' | 'done';
export type Outcome = 'finished' | 'shipped' | 'killed';

export interface Task extends Base {
  kind: 'task' | 'sprint';
  title: string;
  /** Empty for an inbox task; needs >= 8 chars before it can become active. */
  finishCondition: string;
  notes: string;
  tagId: string | null;
  priority: Priority;
  estimateMin: number | null;
  deadline: string | null;
  dueEventId: string | null;
  /** Fractional queue order: a reorder is one record write. */
  order: number;
  status: TaskStatus;
  outcome: Outcome | null;
  dropCount: number;
  /** Set by Drop: parked tasks sort behind all others until started or reordered again. */
  parkedAt: number | null;
  workMs: number;
  breakMs: number;
  pomodorosCompleted: number;
  startedAt: number | null;
  completedAt: number | null;
  timer: TimerConfig;
  runtime: Runtime;
  /** Sprint only: minutes of tracked work between checkpoints. */
  checkpointEveryMin: number | null;
  /** Sprint only: the tracked-work total (ms) at which the next checkpoint is due. */
  nextCheckpointMs: number | null;
}

export interface Recurrence {
  /** 1 = Mon .. 7 = Sun */
  weekdays: number[];
  everyNWeeks: 1 | 2 | 3 | 4;
  anchorDate: string;
  from: string | null;
  until: string | null;
}

export interface CalEvent extends Base {
  title: string;
  tagId: string | null;
  scope: Scope;
  tz: string;
  /** Minutes from local midnight in tz. */
  startMin: number;
  endMin: number;
  /** One-off date, or null for a recurring event. */
  date: string | null;
  recur: Recurrence | null;
  notes: string;
}

export interface EventException extends Base {
  eventId: string;
  date: string;
  kind: 'skip' | 'move';
  startMin?: number;
  endMin?: number;
}

export interface Closure extends Base {
  name: string;
  startDate: string;
  endDate: string;
  /** The scopes that are off on these days. */
  scopes: Scope[];
  source: 'holiday' | 'break' | 'custom';
  confirmed: boolean;
}

export interface Block extends Base {
  taskId: string | null;
  tagId: string | null;
  title: string;
  date: string;
  startMin: number;
  endMin: number;
  tz: string;
  kind: 'work' | 'sprint' | 'break';
}

export interface Session extends Base {
  taskId: string;
  blockId: string | null;
  startedAt: number;
  endedAt: number;
  phase: 'work' | 'break';
  /** Part of the slice that ran past the end of its block. */
  overrunMs: number;
}

export interface Idea extends Base {
  text: string;
  taskId: string | null;
  reviewed: boolean;
}

/** Started / finished / dropped / killed log, for metrics. */
export interface Activity extends Base {
  type: 'started' | 'finished' | 'dropped' | 'killed';
  taskId: string;
  at: number;
  reason: string;
}

export interface ActiveTimer extends Base {
  taskId: string | null;
  ownerDeviceId: string;
  ownerName: string;
  takeoverAt: number | null;
}

export interface TimeLeftVariants {
  gapFilterMin: number;
  transitionMin: number;
  mealReserveMin: number;
}

export interface Settings extends Base {
  displayName: string;
  timezone: string;
  dayStartMin: number;
  dayEndMin: number;
  bufferMin: number;
  timeLeft: TimeLeftVariants;
  timetable: { enabled: boolean; scopes: Record<Scope, boolean> };
  timerDefaults: TimerConfig;
  /** Default focus mode when a task runs inside a block. */
  blockEnd: 'continue' | 'stop';
  prepLeadMin: number;
  checkpointEveryMin: number;
  holidaysEnabled: boolean;
  theme: 'dark' | 'light' | 'system';
  accent: string | null;
  runwayPosition: 'top' | 'bottom';
  reduceMotion: boolean | null;
  onboarded: boolean;
}

export interface DeviceSettings {
  deviceId: string;
  deviceName: string;
  launchAtLogin: boolean;
  skipLaunchScreen: boolean;
  widgetDock: 'taskbar-left' | 'taskbar-right' | 'free';
  widgetPos: { x: number; y: number } | null;
  shortcuts: { toggle: string; startPause: string; capture: string };
  displayId: number | null;
  stackFolder: string | null;
  sound: boolean;
  notifications: boolean;
  /** Sync bookkeeping (§10): last pushed updatedAt and per-collection pull cursors. */
  sync: { lastPushedAt: number; cursors: Partial<Record<Coll, number>> };
}

export interface Collections {
  tasks: Task;
  events: CalEvent;
  eventExceptions: EventException;
  closures: Closure;
  blocks: Block;
  sessions: Session;
  tags: Tag;
  ideas: Idea;
  activity: Activity;
  timer: ActiveTimer;
  settings: Settings;
}
export type Coll = keyof Collections;
export const COLLS: Coll[] = ['tasks', 'events', 'eventExceptions', 'closures', 'blocks', 'sessions', 'tags', 'ideas', 'activity', 'timer', 'settings'];
export type Rec<C extends Coll = Coll> = Collections[C];

/** All synced state. timer and settings each hold exactly one doc ('current', 'main'). */
export type Data = { schema: 1 } & { [C in Coll]: Record<string, Collections[C]> } & {
  /** Purge stubs, kept so an offline device cannot resurrect deleted records. */
  tombs: Partial<Record<Coll, Record<string, Stub>>>;
};

/** Time the app could not observe (PC off, asleep, crashed, clock jump). */
export interface Gap {
  from: number;
  to: number;
  reason: 'off' | 'sleep' | 'clock';
}

export interface ShelfItem {
  name: string;
  path: string;
  isDir: boolean;
  icon: string | null;
}

/** Everything the renderer needs; pushed on change, never per tick. */
export interface Snapshot {
  data: Data;
  device: DeviceSettings;
  pendingGap: Gap | null;
  shortcutError: string | null;
  isPackaged: boolean;
  version: string;
  platform: string;
  dataDir: string;
  perf: Record<string, number>;
  homeView: 'runway' | 'focus' | null;
}
