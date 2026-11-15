// A tiny snapshot store over useSyncExternalStore. Main pushes a snapshot only
// when state changes; the display is recomputed from snapshot + Date.now().
// Clocks tick only while the document is visible (no work while Home is hidden).

import { useEffect, useState, useSyncExternalStore } from 'react';
import type { Command, Result } from '../core/commands';
import type { Snapshot } from '../core/model/types';
import { api } from './api';

let snap: Snapshot | null = null;
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());

export function initStore(onFirst?: (s: Snapshot) => void): void {
  const set = (s: Snapshot) => {
    const first = snap === null;
    snap = s;
    emit();
    if (first) onFirst?.(s);
  };
  api.onSnapshot(set);
  void api.getSnapshot().then((s) => snap === null && s && set(s));
}

const subscribe = (l: () => void) => {
  listeners.add(l);
  return () => listeners.delete(l);
};

export function useSnap(): Snapshot | null {
  return useSyncExternalStore(subscribe, () => snap);
}

/** Date.now(), refreshed every `ms` while the page is visible. */
export function useNow(ms: number): number {
  const [now, setNow] = useState(Date.now);
  useEffect(() => {
    let id: ReturnType<typeof setInterval> | null = null;
    const sync = () => {
      if (id) clearInterval(id);
      id = null;
      if (document.hidden) return;
      setNow(Date.now());
      id = setInterval(() => setNow(Date.now()), ms);
    };
    sync();
    document.addEventListener('visibilitychange', sync);
    return () => {
      if (id) clearInterval(id);
      document.removeEventListener('visibilitychange', sync);
    };
  }, [ms]);
  return now;
}

/**
 * Date.now(), refreshed on every `ms` boundary of the wall clock (so a 15 s tick lands
 * on :00, :15, :30, :45 and the minute label flips exactly at the start of a minute).
 * Stops while the page is hidden and catches up when it shows again.
 */
export function useAlignedNow(ms: number): number {
  const [now, setNow] = useState(Date.now);
  useEffect(() => {
    let id: ReturnType<typeof setTimeout> | null = null;
    const arm = () => {
      // +10 ms so the timer never fires just before the boundary.
      id = setTimeout(() => {
        setNow(Date.now());
        arm();
      }, ms - (Date.now() % ms) + 10);
    };
    const sync = () => {
      if (id) clearTimeout(id);
      id = null;
      if (document.hidden) return;
      setNow(Date.now());
      arm();
    };
    sync();
    document.addEventListener('visibilitychange', sync);
    return () => {
      if (id) clearTimeout(id);
      document.removeEventListener('visibilitychange', sync);
    };
  }, [ms]);
  return now;
}

// ---- Toasts (bottom-centre, polite live region) ----
export interface Toast {
  id: number;
  text: string;
  undo?: () => void;
  error?: boolean;
  /** How many identical toasts collapsed into this one. */
  count?: number;
}
let toasts: Toast[] = [];
const toastListeners = new Set<() => void>();
let seq = 0;

const toastTimers = new Map<number, ReturnType<typeof setTimeout>>();
/** Info toasts leave after 5 s, errors and toasts with Undo after 8 s. */
function armDismiss(id: number): void {
  const old = toastTimers.get(id);
  if (old) clearTimeout(old);
  const t = toasts.find((x) => x.id === id);
  toastTimers.set(id, setTimeout(() => dismissToast(id), t?.error || t?.undo ? 8000 : 5000));
}

/** Navigation clears plain info toasts (errors and Undo offers stay until they time out). */
export function clearInfoToasts(): void {
  const keep = toasts.filter((t) => t.error || t.undo);
  if (keep.length === toasts.length) return;
  toasts = keep;
  toastListeners.forEach((l) => l());
}

export function toast(text: string, opts: { undo?: () => void; error?: boolean } = {}): void {
  // Repeated identical toasts (no undo) collapse into one with a count.
  const same = !opts.undo ? toasts.find((x) => x.text === text && !x.undo && !!x.error === !!opts.error) : undefined;
  if (same) {
    toasts = toasts.map((x) => (x === same ? { ...x, count: (x.count ?? 1) + 1 } : x));
    toastListeners.forEach((l) => l());
    armDismiss(same.id);
    return;
  }
  const t = { id: ++seq, text, ...opts };
  toasts = [...toasts.slice(-1), t];
  toastListeners.forEach((l) => l());
  if (opts.undo) pushUndo(opts.undo);
  armDismiss(t.id);
}

/** What a failed command was trying to do, in plain words ("create the project"). */
const WHAT: Partial<Record<Command['type'], string>> = {
  'task.create': 'add the task', 'task.update': 'save the task', 'task.reorder': 'move the task', 'task.finish': 'finish the task',
  'task.drop': 'drop the task', 'task.close': 'close the task', 'task.reopen': 'reopen the task', 'task.moveCard': 'move the card',
  timer: 'control the timer', 'block.create': 'plan the block', 'block.move': 'move the block', 'event.create': 'add the event',
  'event.update': 'save the event', 'event.place': 'place the event', 'event.skip': 'skip the event', 'event.editOn': 'change the event',
  'project.create': 'create the project', 'tag.create': 'add the tag', 'tag.update': 'save the tag', 'idea.add': 'post to the Log',
  'idea.edit': 'save the post', 'plan.auto': 'plan the day', 'plan.replan': 're-plan the day', 'review.submit': 'save the review',
  recycle: 'move it to the bin', restore: 'restore it', 'settings.update': 'save the setting', 'device.update': 'save the setting',
};
/** "Couldn't create the project: name the project (1-80 characters)." */
export function describeError(cmd: Command, error: string): string {
  const what = WHAT[cmd.type];
  if (!what) return error;
  const reason = error === 'Invalid command.' ? 'the app sent something it should not have; please report this' : error.replace(/\.$/, '');
  return `Couldn't ${what}: ${reason.charAt(0).toLowerCase()}${reason.slice(1)}.`;
}

// ---- Undo: every automatic action offers it on its toast, and Ctrl+Z runs the latest ----
const undoStack: { fn: () => void; at: number }[] = [];
const UNDO_WINDOW_MS = 60_000;
function pushUndo(fn: () => void): void {
  undoStack.push({ fn, at: Date.now() });
  if (undoStack.length > 10) undoStack.shift();
}
/** Run the most recent undo that is still fresh. Returns false when there is nothing to undo. */
export function undoLast(): boolean {
  while (undoStack.length) {
    const u = undoStack.pop() as { fn: () => void; at: number };
    if (Date.now() - u.at > UNDO_WINDOW_MS) continue;
    u.fn();
    return true;
  }
  return false;
}
/** Make an undo callback from a command result: an undo token (main) or the revert ops it returned. */
export function undoFor(r: Result): (() => void) | undefined {
  if (!r.ok) return undefined;
  const token = (r as { undoToken?: string }).undoToken;
  const chronos = api as unknown as { undo?: (t: string) => Promise<unknown> };
  if (token && chronos.undo) return () => void chronos.undo?.(token);
  if (r.undo?.length) return () => void api.command({ type: 'records.revert', ops: r.undo ?? [] });
  return undefined;
}
/** Run a command and tell the user, with Undo, what it did. Returns the result. */
export async function runWithToast(cmd: Command, text: (r: Result & { ok: true }) => string): Promise<Result> {
  const r = await run(cmd);
  if (r.ok) toast(text(r), { undo: undoFor(r) });
  return r;
}

export function dismissToast(id: number): void {
  toastTimers.delete(id);
  toasts = toasts.filter((t) => t.id !== id);
  toastListeners.forEach((l) => l());
}

/** Current toasts (tests and non-React callers). */
export const getToasts = (): Toast[] => toasts;

export function useToasts(): Toast[] {
  return useSyncExternalStore(
    (l) => {
      toastListeners.add(l);
      return () => toastListeners.delete(l);
    },
    () => toasts,
  );
}

/** Send a command; errors become a toast unless the caller handles fields. */
export async function run(cmd: Command, quiet = false): Promise<Result> {
  const r = await api.command(cmd);
  if (!r.ok && !quiet && r.error !== 'confirm-required') toast(describeError(cmd, r.error), { error: true });
  return r;
}
