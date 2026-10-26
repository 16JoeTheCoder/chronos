// Pointer-based drag and drop (no library). A press becomes a drag after 4 px;
// targets register themselves and get over/drop callbacks. A press that never
// moves is a click. Every drag here also has a keyboard path (see Home/Runway).

import { useSyncExternalStore, type PointerEvent as RPointerEvent } from 'react';

export type DragItem =
  | { kind: 'task'; taskId: string; title: string; dur: number }
  | { kind: 'block'; blockId: string; title: string; mode: 'move' | 'start' | 'end'; offsetMin: number }
  | { kind: 'event'; eventId: string; title: string; date: string; recurring: boolean }
  | { kind: 'file'; path: string; title: string };

export interface Target {
  el(): HTMLElement | null;
  accepts(item: DragItem): boolean;
  over?(item: DragItem, x: number, y: number): unknown;
  drop(item: DragItem, preview: unknown): void;
}

export interface DragState {
  item: DragItem;
  x: number;
  y: number;
  target: string | null;
  preview: unknown;
}

const targets = new Map<string, Target>();
let state: DragState | null = null;
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());

export function registerTarget(id: string, t: Target): () => void {
  targets.set(id, t);
  return () => targets.delete(id);
}

export function useDrag(): DragState | null {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => state,
  );
}

function hit(item: DragItem, x: number, y: number): [string | null, unknown] {
  for (const [id, t] of targets) {
    const r = t.el()?.getBoundingClientRect();
    if (r && x >= r.left && x <= r.right && y >= r.top && y <= r.bottom && t.accepts(item)) return [id, t.over?.(item, x, y)];
  }
  return [null, null];
}

/** Start tracking a press. `onClick` runs if the pointer never travelled 4 px. */
export function beginDrag(e: RPointerEvent, item: DragItem | (() => DragItem), onClick?: () => void): void {
  if (e.button !== 0) return;
  e.stopPropagation();
  const x0 = e.clientX;
  const y0 = e.clientY;
  let active = false;
  const move = (ev: PointerEvent) => {
    if (!active && Math.hypot(ev.clientX - x0, ev.clientY - y0) < 4) return;
    if (!active) {
      active = true;
      document.documentElement.classList.add('dragging');
    }
    const it = state?.item ?? (typeof item === 'function' ? item() : item);
    const [target, preview] = hit(it, ev.clientX, ev.clientY);
    state = { item: it, x: ev.clientX, y: ev.clientY, target, preview };
    emit();
  };
  const up = () => {
    window.removeEventListener('pointermove', move);
    window.removeEventListener('pointerup', up);
    window.removeEventListener('pointercancel', cancel);
    document.documentElement.classList.remove('dragging');
    const s = state;
    state = null;
    emit();
    if (!active) onClick?.();
    else if (s?.target) targets.get(s.target)?.drop(s.item, s.preview);
  };
  const cancel = () => {
    active = false;
    onClick = undefined;
    up();
  };
  window.addEventListener('pointermove', move);
  window.addEventListener('pointerup', up);
  window.addEventListener('pointercancel', cancel);
}
