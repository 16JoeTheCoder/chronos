// Pull to refresh for the phone page container (web only: api.web is null on Electron).
// Touch events plus CSS transitions and setTimeout; no animation frames. The page keeps its own
// scroll (overscroll-behavior in responsive.css stops the browser's own refresh); we never
// preventDefault, so scrolling is never blocked.
import { useEffect, useRef, useState, type RefObject } from 'react';
import { api } from '../api';
import { PULL_DONE_MS, PULL_HOLD, PULL_TEXT, canStartPull, phaseFor, pullOffset, shouldRefresh, type PullPhase } from './pull';

/** Gestures that start inside these belong to the screen (drag, text, horizontal scrollers). */
const OWN_GESTURE = 'input, textarea, select, [contenteditable], .runway, .cards, .board, .drag-handle';

export function usePullToRefresh(ref: RefObject<HTMLElement | null>, enabled: boolean) {
  const [phase, setPhase] = useState<PullPhase>('idle');
  const [offset, setOffset] = useState(0);
  const busy = useRef(false);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  useEffect(() => {
    const el = ref.current;
    if (!enabled || !el) return;
    let startY: number | null = null;
    let dy = 0;
    const reset = () => {
      startY = null;
      dy = 0;
    };
    const down = (e: TouchEvent) => {
      if (busy.current || !canStartPull(el.scrollTop, e.touches.length) || (e.target as HTMLElement).closest(OWN_GESTURE)) return;
      startY = e.touches[0]!.clientY;
      dy = 0;
    };
    const move = (e: TouchEvent) => {
      if (startY === null) return;
      if (el.scrollTop > 0) {
        reset();
        setPhase('idle');
        setOffset(0);
        return;
      }
      dy = e.touches[0]!.clientY - startY;
      setPhase(phaseFor(dy));
      setOffset(pullOffset(dy));
    };
    const up = () => {
      if (startY === null) return;
      const go = shouldRefresh(dy);
      reset();
      if (!go) {
        setPhase('idle');
        setOffset(0);
        return;
      }
      busy.current = true;
      setPhase('refreshing');
      setOffset(PULL_HOLD); // hold the line at full height while syncing
      const finish = () => {
        busy.current = false;
        setPhase('done');
        timer.current = setTimeout(() => {
          setPhase('idle');
          setOffset(0);
        }, PULL_DONE_MS);
      };
      Promise.resolve(api.web?.catchUp()).then(finish, finish);
    };
    el.addEventListener('touchstart', down, { passive: true });
    el.addEventListener('touchmove', move, { passive: true });
    el.addEventListener('touchend', up, { passive: true });
    el.addEventListener('touchcancel', up, { passive: true });
    return () => {
      el.removeEventListener('touchstart', down);
      el.removeEventListener('touchmove', move);
      el.removeEventListener('touchend', up);
      el.removeEventListener('touchcancel', up);
      clearTimeout(timer.current);
    };
  }, [ref, enabled]);

  return { phase, offset };
}

/** A slim line above the page: grows with the pull, reads the state, never covers content. */
export function PullIndicator({ phase, offset }: { phase: PullPhase; offset: number }) {
  const live = phase === 'pulling' || phase === 'ready';
  return (
    <div className={`pull pull-${phase}`} style={{ height: offset }} role="status" aria-live="polite">
      {phase !== 'idle' && <span className="pull-text">{PULL_TEXT[phase]}</span>}
      <span className={`pull-line${live ? ' live' : ''}`} aria-hidden="true" />
    </div>
  );
}
