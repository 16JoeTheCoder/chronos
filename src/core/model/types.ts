// The Chronos data model (schema v2). Pure types shared by core, main, preload and renderer.
// Every synced entity extends Base and is written only through core/repo, which
// stamps updatedAt/deviceId/v. DeviceSettings is local to one machine and never synced.

/** The schema this build reads and writes. A pulled record with a higher `v` puts sync in read-only mode (D-104). */
export const SCHEMA_V = 2;

export interface Base {
  id: string;
  createdAt: number;
  /** ms UTC, set only by core/repo. */
  updatedAt: number;
  deviceId: string;
  /** Tombstone. Recycled records stay until purge (core/repo/recycle). */
  deletedAt: number | null;
  /** The record's schemaVersion: the schema of the app that last wrote it (D-104). */
  v: number;
  /**
   * Per-field versions (D-105). A field's entry is the server commit time (µs) of the
   * last write to it that this device has seen; absent = never synced. Written only by sync.
   */
  fv: Record<string, number>;
  /** Per-field last writer (deviceId), beside fv; used to tell real conflicts from our own echoes. */
  fw: Record<string, string>;
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

/** inbox: open, nothing planned · planned: has a block today or later · doing: the one task in focus · done · dropped: closed without finishing. */
export type TaskStatus = 'inbox' | 'planned' | 'doing' | 'done' | 'dropped';
export const TASK_STATUSES: TaskStatus[] = ['inbox', 'planned', 'doing', 'done', 'dropped'];
export type Outcome = 'finished' | 'shipped' | 'killed';
export type TaskSource = 'typed' | 'parsed' | 'claude' | 'import';
export const TASK_SOURCES: TaskSource[] = ['typed', 'parsed', 'claude', 'import'];

export interface TaskRecurrence {
  freq: 'daily' | 'weekly';
  /** Every n days / weeks, 1-52. */
  interval: number;
  /** Weekly only: 1 = Mon .. 7 = Sun. Empty or absent = the weekday of the due date. */
  weekdays?: number[];
}

export interface Task extends Base {
  kind: 'task' | 'sprint';
  title: string;
  /** Empty for an inbox task; needs >= 8 chars before it can become active. */
  finishCondition: string;
  notes: string;
  tagId: string | null;
  priority: Priority;
  estimateMin: number | null;
  /** YYYY-MM-DD (v1 `deadline`). */
  dueDate: string | null;
  /** Minutes from local midnight, or null. */
  dueTime: number | null;
  dueEventId: string | null;
  projectId: string | null;
  /** Kanban column inside the project (Phase 3). */
  columnId: string | null;
  recurrence: TaskRecurrence | null;
  /** The first task of a recurring series; instances get id `<parentId>:<date>`. */
  recurrenceParentId: string | null;
  source: TaskSource;
  /** Fractional queue order (v1 semantics): a reorder is one record write. */
  order: number;
  /** Fractional index string for manual list/board ordering (core/model/sortKey). */
  sortKey: string;
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

/** One occurrence of a repeating event, changed. Id `x-<eventId>-<date>`. Override fields are null when unchanged. */
export interface EventException extends Base {
  eventId: string;
  date: string;
  kind: 'skip' | 'edit';
  title: string | null;
  startMin: number | null;
  endMin: number | null;
  tagId: string | null;
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
  /** Placed by auto-plan (Phase 3). Manual blocks are never moved by it. */
  auto: boolean;
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

/** A note (the collection keeps its v1 name, D-109). `body` is the content; `text` is its first 1000 characters for v1 views. */
export interface Idea extends Base {
  text: string;
  body: string;
  taskId: string | null;
  reviewed: boolean;
  /** Tasks the Phase 2 parser made from this note. */
  parsedTaskIds: string[];
}

export interface ProjectColumn {
  id: string;
  name: string;
}

export interface Project extends Base {
  name: string;
  color: TagColor;
  columns: ProjectColumn[];
  archived: boolean;
  sortKey: string;
}

export type ReviewAction = 'tomorrow' | 'unscheduled' | 'dropped' | 'done';
/** End-of-day review. Id `review-<date>`: its existence means that day was reviewed (on any device). */
export interface Review extends Base {
  date: string;
  outcomes: { taskId: string; action: ReviewAction }[];
}

/** Started / finished / dropped / killed log, for metrics. */
export interface Activity extends Base {
  /** 'claude': a change made through the MCP server; reason holds what was done. */
  type: 'started' | 'finished' | 'dropped' | 'killed' | 'claude';
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
  /** Phase 3 themes; unused by the UI yet. */
  themeId: string;
  customTheme: Record<string, string> | null;
  /** Drag snap in minutes (5/10/15/30); unused by the UI yet. */
  snapMin: number;
  /** Phase 2 parser keywords; empty now. */
  parserRules: { keyword: string; kind: 'fixed' | 'task' }[];
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
  /** Show the Diagnostics section (per device). */
  experimental: boolean;
  /** Local MCP endpoint for Claude Desktop (127.0.0.1 only). */
  mcp: { enabled: boolean; port: number; token: string };
  /** Sync bookkeeping: whose data this is, per-collection pull cursors (server µs) and the last good sync. */
  sync: { uid: string | null; cursors: Partial<Record<Coll, number>>; lastSyncAt: number | null };
  /** Google sign-in: the refresh token encrypted with safeStorage (base64), and who it is. */
  auth: { refreshTokenEnc: string | null; email: string | null; uid: string | null };
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
  projects: Project;
  reviews: Review;
}
export type Coll = keyof Collections;
export const COLLS: Coll[] = ['tasks', 'events', 'eventExceptions', 'closures', 'blocks', 'sessions', 'tags', 'ideas', 'activity', 'timer', 'settings', 'projects', 'reviews'];
export type Rec<C extends Coll = Coll> = Collections[C];

/** All synced state. timer and settings each hold exactly one doc ('current', 'main'). */
export type Data = { schema: 2 } & { [C in Coll]: Record<string, Collections[C]> } & {
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
  sync: SyncView;
  /** Only while Experimental is on (per device). */
  diag: Diagnostics | null;
}

// ---- Sync (docs/SYNC.md) ----
export type SyncStateKind = 'off' | 'signedOut' | 'syncing' | 'synced' | 'pending' | 'offline' | 'error' | 'readOnly';

export interface SyncView {
  state: SyncStateKind;
  /** One line for the dot's popover (error / readOnly / offline). */
  reason: string | null;
  /** Outbox entries waiting to be acknowledged. */
  pending: number;
  oldestPendingAt: number | null;
  lastSyncAt: number | null;
  email: string | null;
  /** firebase.config.json present and complete. */
  configured: boolean;
}

/** Same field edited on two devices: the local pending edit won, this is what it overwrote. */
export interface Conflict {
  at: number;
  coll: Coll;
  id: string;
  field: string;
  overwrittenValue: unknown;
  newValue: unknown;
  otherDeviceId: string;
}

/** A pulled (or loaded) document that failed validation: never merged or rendered. */
export interface QuarantineItem {
  at: number;
  coll: string;
  id: string;
  reason: string;
  doc: unknown;
}

export interface Diagnostics {
  cursors: Partial<Record<Coll, number>>;
  conflicts: Conflict[];
  quarantine: QuarantineItem[];
  snapshots: string[];
  mcp: { enabled: boolean; running: boolean; port: number; token: string; error: string | null; bridgePath: string; config: string };
}
