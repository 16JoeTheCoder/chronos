// Drag-and-drop model for the runway, with no DOM and no React: snapping, previews and
// the intent a drop produces. Lanes: 'plan' (blocks), 'fixed' (events), 'cards' (the
// unscheduled list), 'tray' (unplaced events waiting for a time). The runway turns an
// intent into commands (dropActions.ts); everything decided here is unit-tested.

import type { DragItem } from '../components/drag';

export type Lane = 'plan' | 'fixed' | 'cards';

/** Snap a minute to the grid. Alt (free) snaps to whole minutes only. */
export const effectiveSnap = (snapMin: number, free: boolean): number => (free ? 1 : Math.max(1, snapMin));
export const snapMinute = (min: number, snapMin: number, free = false): number => {
  const g = effectiveSnap(snapMin, free);
  return Math.round(min / g) * g;
};

export const overlaps = (a0: number, a1: number, b0: number, b1: number): boolean => a0 < b1 && b0 < a1;

export interface Range {
  startMin: number;
  endMin: number;
}

/** Keep a range of `dur` minutes starting near `startMin` inside the day. */
export function clampToDay(startMin: number, dur: number, dayStartMin: number, dayEndMin: number): Range {
  const start = Math.min(Math.max(startMin, dayStartMin), Math.max(dayStartMin, dayEndMin - dur));
  return { startMin: start, endMin: Math.min(start + dur, dayEndMin) };
}

export interface FixedEnv {
  snapMin: number;
  free: boolean;
  dayStartMin: number;
  dayEndMin: number;
  /** Planned blocks today, minus the one being dragged. A fixed event may not sit on a block. */
  blocks: [number, number][];
}

export interface Preview extends Range {
  valid: boolean;
}

/** Where a fixed event lands when the pointer is at `pointerMin` (the drag grabbed it `offsetMin` from its start). */
export function fixedPreview(pointerMin: number, durMin: number, offsetMin: number, env: FixedEnv): Preview {
  const raw = snapMinute(pointerMin - offsetMin, env.snapMin, env.free);
  const r = clampToDay(raw, durMin, env.dayStartMin, env.dayEndMin);
  const valid = r.endMin - r.startMin >= Math.min(durMin, 5) && !env.blocks.some(([a, b]) => overlaps(r.startMin, r.endMin, a, b));
  return { ...r, valid };
}

/** What a finished drag means. The runway maps each to commands. */
export type Intent =
  | { op: 'block.create'; taskId: string; startMin: number; endMin: number }
  | { op: 'block.move'; blockId: string; startMin: number; endMin: number }
  | { op: 'event.place'; eventId: string; startMin: number }
  | { op: 'event.move'; eventId: string; date: string; recurring: boolean; startMin: number; endMin: number }
  | { op: 'task.toEvent'; taskId: string; startMin: number; endMin: number }
  | { op: 'block.toEvent'; blockId: string; startMin: number; endMin: number }
  | { op: 'event.toBlock'; eventId: string; date: string; recurring: boolean; startMin: number; endMin: number; title: string }
  | { op: 'block.unplan'; blockId: string }
  | { op: 'event.toCard'; eventId: string; date: string; recurring: boolean; title: string; durMin: number };

/** Intent for dropping `item` on `lane` with a valid preview, or null when the drop means nothing. */
export function intentFor(item: DragItem, lane: Lane, pv: Preview | null): Intent | null {
  if (lane === 'cards') {
    if (item.kind === 'block') return { op: 'block.unplan', blockId: item.blockId };
    if (item.kind === 'event' && !item.unplaced) return { op: 'event.toCard', eventId: item.eventId, date: item.date, recurring: item.recurring, title: item.title, durMin: item.durMin ?? 30 };
    return null;
  }
  if (!pv?.valid) return null;
  const { startMin, endMin } = pv;
  if (lane === 'plan') {
    if (item.kind === 'task') return { op: 'block.create', taskId: item.taskId, startMin, endMin };
    if (item.kind === 'block') return { op: 'block.move', blockId: item.blockId, startMin, endMin };
    if (item.kind === 'event' && !item.unplaced) return { op: 'event.toBlock', eventId: item.eventId, date: item.date, recurring: item.recurring, startMin, endMin, title: item.title };
    return null;
  }
  // fixed lane
  if (item.kind === 'event') return item.unplaced ? { op: 'event.place', eventId: item.eventId, startMin } : { op: 'event.move', eventId: item.eventId, date: item.date, recurring: item.recurring, startMin, endMin };
  if (item.kind === 'task') return { op: 'task.toEvent', taskId: item.taskId, startMin, endMin };
  if (item.kind === 'block') return { op: 'block.toEvent', blockId: item.blockId, startMin, endMin };
  return null;
}

/** Which kinds of item each lane takes. */
export function laneAccepts(lane: Lane, item: DragItem): boolean {
  if (lane === 'plan') return item.kind === 'task' || item.kind === 'block' || (item.kind === 'event' && !item.unplaced);
  if (lane === 'fixed') return item.kind === 'task' || item.kind === 'block' || item.kind === 'event';
  return item.kind === 'block' || (item.kind === 'event' && !item.unplaced);
}

/** Keyboard path for a fixed event or an unplaced one: arrow steps. Returns the new range, or null if it would leave the day. */
export function nudge(r: Range, dir: -1 | 1, snapMin: number, big: boolean, dayStartMin: number, dayEndMin: number): Range | null {
  const step = snapMin * (big ? 3 : 1);
  const startMin = r.startMin + dir * step;
  const endMin = r.endMin + dir * step;
  return startMin < dayStartMin || endMin > dayEndMin ? null : { startMin, endMin };
}
