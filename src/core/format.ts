// Formatting shared by the renderer and main (notifications, tray, widget). Pure.

import { localParts, parseDate, weekdayOf } from './time/zone';

/** 1:05:09 or 25:00. The large timer digits. */
export function formatClock(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const mm = String(m).padStart(2, '0');
  const ss = String(s).padStart(2, '0');
  return h > 0 ? `${h}:${mm}:${ss}` : `${mm}:${ss}`;
}

/** 2h 05m, 14m, 0m. Durations in prose. */
export function formatHuman(ms: number): string {
  const totalMin = Math.max(0, Math.floor(ms / 60_000));
  const h = Math.floor(totalMin / 60);
  const m = totalMin % 60;
  return h > 0 ? `${h}h ${String(m).padStart(2, '0')}m` : `${m}m`;
}

/** Minutes from midnight to 08:05. */
export function formatHM(minutes: number): string {
  const m = ((Math.round(minutes) % 1440) + 1440) % 1440;
  return `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
}

/** Wall-clock HH:MM of an instant in tz. */
export function clockOf(ts: number, tz: string): string {
  return formatHM(localParts(ts, tz).minutes);
}

/** Parse 'HH:MM' to minutes, or null. */
export function parseHM(s: string): number | null {
  const m = /^(\d{1,2}):(\d{2})$/.exec(s.trim());
  if (!m) return null;
  const h = Number(m[1]), min = Number(m[2]);
  return h <= 24 && min < 60 && h * 60 + min <= 1440 ? h * 60 + min : null;
}

export const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** 'Mon 26 Oct' */
export function dateLabel(date: string): string {
  const { m, d } = parseDate(date);
  return `${WEEKDAYS[weekdayOf(date) - 1]} ${d} ${MONTHS[m - 1]}`;
}

export function greeting(minutes: number, name: string): string {
  const part = minutes < 300 ? 'Late night' : minutes < 720 ? 'Good morning' : minutes < 1080 ? 'Good afternoon' : 'Good evening';
  return name ? `${part}, ${name}` : part;
}

export function phaseLabel(phase: string): string {
  return phase === 'work' ? 'Work' : phase === 'shortBreak' ? 'Short break' : 'Long break';
}

export function modeLabel(mode: string): string {
  return mode === 'countdown' ? 'Countdown' : mode === 'pomodoro' ? 'Pomodoro' : 'Stopwatch';
}
