// Touch swipe on a task row: right = complete, left = open the date sheet. Vertical movement is the
// page scrolling (touch-action: pan-y lets the browser keep it), so the swipe only locks to x.
import { useRef, useState, type PointerEvent as RPointerEvent } from 'react';
import { dragging } from '../components/drag';
import { classifySwipe, lockAxis } from '../components/gesture';

export interface SwipeRow {
  /** -1..1: how far the swipe has gone, for the wash behind the row. */
  progress: number;
  down: (e: RPointerEvent) => void;
  move: (e: RPointerEvent) => void;
  up: (e: RPointerEvent) => void;
  cancel: () => void;
}

const FULL = 96;

export function useSwipeRow(onSwipe: (dir: 'left' | 'right') => void): SwipeRow {
  const [dx, setDx] = useState(0);
  const s = useRef<{ x: number; y: number; t: number; axis: 'x' | 'y' | null } | null>(null);
  const reset = () => { s.current = null; setDx(0); };
  return {
    progress: Math.max(-1, Math.min(1, dx / FULL)),
    down: (e) => {
      if (e.pointerType !== 'touch') return;
      s.current = { x: e.clientX, y: e.clientY, t: Date.now(), axis: null };
    },
    move: (e) => {
      const p = s.current;
      if (!p) return;
      if (dragging()) return reset();
      const x = e.clientX - p.x;
      p.axis ??= lockAxis(x, e.clientY - p.y);
      if (p.axis === 'x') setDx(x);
      else if (p.axis === 'y') reset();
    },
    up: (e) => {
      const p = s.current;
      const held = dragging(); // a picked-up row is a reorder, not a swipe
      reset();
      if (!p || p.axis !== 'x' || held) return;
      const dir = classifySwipe(e.clientX - p.x, e.clientY - p.y, Date.now() - p.t, { min: FULL * 0.7 });
      if (dir === 'left' || dir === 'right') onSwipe(dir);
    },
    cancel: reset,
  };
}
