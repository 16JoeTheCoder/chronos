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

/** Resolve 'system' to light/dark (and follow OS changes) so tokens.css holds each palette once. */
export function useTheme(theme: 'dark' | 'light' | 'system'): void {
  useEffect(() => {
    const mq = window.matchMedia('(prefers-color-scheme: light)');
    const apply = () => (document.documentElement.dataset.theme = theme === 'system' ? (mq.matches ? 'light' : 'dark') : theme);
    apply();
    mq.addEventListener('change', apply);
    return () => mq.removeEventListener('change', apply);
  }, [theme]);
}

// ---- Toasts (bottom-centre, polite live region) ----
export interface Toast {
  id: number;
  text: string;
  undo?: () => void;
  error?: boolean;
}
let toasts: Toast[] = [];
const toastListeners = new Set<() => void>();
let seq = 0;

export function toast(text: string, opts: { undo?: () => void; error?: boolean } = {}): void {
  const t = { id: ++seq, text, ...opts };
  toasts = [...toasts.slice(-2), t];
  toastListeners.forEach((l) => l());
  setTimeout(() => dismissToast(t.id), 8000);
}

export function dismissToast(id: number): void {
  toasts = toasts.filter((t) => t.id !== id);
  toastListeners.forEach((l) => l());
}

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
  if (!r.ok && !quiet && r.error !== 'confirm-required') toast(r.error, { error: true });
  return r;
}
