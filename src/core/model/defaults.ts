// Defaults and empty state. Every new install and every migrated file starts here.

import { SCHEMA_V, type ActiveTimer, type Data, type DeviceSettings, type Runtime, type Settings, type TimerConfig } from './types';

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

const base = (id: string) => ({ id, createdAt: 0, updatedAt: 0, deviceId: '', deletedAt: null, v: SCHEMA_V });

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
    accent: null,
    runwayPosition: 'top',
    reduceMotion: null,
    onboarded: false,
  };
}

export function defaultActiveTimer(): ActiveTimer {
  return { ...base('current'), taskId: null, ownerDeviceId: '', ownerName: '', takeoverAt: null };
}

export function emptyData(): Data {
  return {
    schema: 1,
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
    widgetPos: null,
    shortcuts: { toggle: 'Ctrl+Alt+Space', startPause: 'Ctrl+Alt+P', capture: 'Ctrl+Alt+N' },
    displayId: null,
    stackFolder: null,
    sound: true,
    notifications: true,
    sync: { lastPushedAt: 0, cursors: {} },
  };
}
