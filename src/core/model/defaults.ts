// Defaults and empty state. Every new install and every migrated file starts here.

import { SCHEMA_V, type ActiveTimer, type Data, type DeviceSettings, type ProjectColumn, type Runtime, type Settings, type TimerConfig } from './types';

const MIN = 60_000;

export function defaultTimer(): TimerConfig {
  return {
    mode: 'countdown',
    countdown: { durationMs: 25 * MIN, onExpire: 'continue' },
    pomodoro: { workMs: 25 * MIN, shortBreakMs: 5 * MIN, longBreakMs: 15 * MIN, sessionsBeforeLongBreak: 4, autoStartBreaks: false, autoStartWork: false },
  };
}

export function idleRuntime(): Runtime {
  return { status: 'idle', phase: 'work', phaseElapsedMs: 0, sliceStartedAt: null, cycleSessions: 0, expiredNotified: false };
}

const base = (id: string) => ({ id, createdAt: 0, updatedAt: 0, deviceId: '', deletedAt: null, v: SCHEMA_V, fv: {}, fw: {} });

export const SNAP_OPTIONS = [5, 10, 15, 30];
/** Settings → Tasks → Keep done tasks (hours; 0 = forever). */
export const RETENTION_OPTIONS = [24, 72, 168, 0];

export function defaultColumns(): ProjectColumn[] {
  return [
    { id: 'todo', name: 'To do' },
    { id: 'doing', name: 'Doing' },
    { id: 'done', name: 'Done' },
  ];
}

export function defaultSettings(): Settings {
  return {
    ...base('main'),
    displayName: 'Josef',
    timezone: 'Asia/Jakarta',
    dayStartMin: 360,
    dayEndMin: 1320,
    bufferMin: 30,
    timeLeft: { gapFilterMin: 0, transitionMin: 0, mealReserveMin: 0 },
    timetable: { enabled: true, scopes: { school: true, work: true, uni: true, other: true } },
    timerDefaults: defaultTimer(),
    blockEnd: 'continue',
    prepLeadMin: 60,
    checkpointEveryMin: 120,
    holidaysEnabled: true,
    theme: 'dark',
    themeId: 'default',
    themeSchedule: [],
    weeklyFocusTargetH: 20,
    sound: { enabled: true, volume: 0.35, muteInFocus: false },
    energy: { livingReactor: true, holographicDepth: true, reactiveData: true, motion: true },
    widgets: { day: true, momentum: true, notes: true, wellness: true },
    parserReports: [],
    planning: { defaultBlockMin: 30, learnEstimates: true, breakAfterMin: 75 },
    customTheme: null,
    snapMin: 5,
    parserRules: [],
    accent: null,
    runwayPosition: 'top',
    reduceMotion: null,
    onboarded: false,
    tasks: { doneRetentionHours: 24 },
    pillShowsClass: false,
  };
}

/** Phase 3.7 settings with their defaults (a settings doc from an older build may lack them). */
export const taskPrefs = (s: Settings): { doneRetentionHours: number; pillShowsClass: boolean } => ({
  doneRetentionHours: s.tasks?.doneRetentionHours ?? 24,
  pillShowsClass: s.pillShowsClass ?? false,
});

export function defaultActiveTimer(): ActiveTimer {
  return { ...base('current'), taskId: null, ownerDeviceId: '', ownerName: '', takeoverAt: null };
}

export function emptyData(): Data {
  return {
    schema: 3,
    tasks: {},
    events: {},
    eventExceptions: {},
    closures: {},
    blocks: {},
    sessions: {},
    tags: {},
    ideas: {},
    activity: {},
    timer: { current: defaultActiveTimer() },
    settings: { main: defaultSettings() },
    projects: {},
    reviews: {},
    tombs: {},
  };
}

export function defaultDevice(deviceId: string, deviceName: string): DeviceSettings {
  return {
    deviceId,
    deviceName,
    launchAtLogin: false,
    skipLaunchScreen: false,
    widgetDock: 'taskbar-left',
    uiScale: 100,
    paletteBlur: null,
    projectList: 'hidden',
    desktopTipSeen: false,
    liveOnDesktop: false,
    overlayHideInFullscreen: true,
    widgetPos: null,
    shortcuts: { toggle: 'Ctrl+Alt+Space', startPause: 'Ctrl+Alt+P', capture: 'Ctrl+Alt+N' },
    notepad: { position: 'top-right', recent: 3 },
    displayId: null,
    stackFolder: null,
    sound: true,
    notifications: true,
    composerProjectId: null,
    onboarded: false,
    experimental: false,
    mcp: { enabled: false, port: 0, token: '' },
    sync: { uid: null, cursors: {}, lastSyncAt: null },
    auth: { refreshTokenEnc: null, email: null, uid: null },
  };
}
