// Hold Enter (or press and hold the pointer) for 2 s to complete. The ring around
// the check fills clockwise from two half-ring layers rotating (transform only);
// a numeric countdown replaces it under reduced motion. Space never completes.
// Timing lives in hold.ts; this file only wires keys, pointer and the visuals.

import { useEffect, useMemo, useRef, useState, type KeyboardEvent, type PointerEvent, type RefObject } from 'react';
import { Icon } from '../components/Icon';
import { createHold, HOLD_MS } from './hold';

export interface HoldControl {
  ring: RefObject<HTMLSpanElement>;
  holding: boolean;
  pulse: boolean;
  secs: number;
  /** Programmatic hold, for the Focus window-level key listener. */
  press: (src: 'enter' | 'pointer') => void;
  release: () => void;
  handlers: {
    onKeyDown: (e: KeyboardEvent) => void;
    onKeyUp: (e: KeyboardEvent) => void;
    onBlur: () => void;
    onPointerDown: (e: PointerEvent) => void;
    onPointerUp: () => void;
    onPointerCancel: () => void;
  };
}

const WHOLE = Math.ceil(HOLD_MS / 1000);

export function useHold(onComplete: () => void): HoldControl {
  const ring = useRef<HTMLSpanElement>(null);
  const [holding, setHolding] = useState(false);
  const [pulse, setPulse] = useState(false);
  const [secs, setSecs] = useState(WHOLE);
  const cb = useRef(onComplete);
  cb.current = onComplete;

  const hold = useMemo(
    () =>
      createHold({
        durationMs: HOLD_MS,
        onProgress: (p) => {
          ring.current?.style.setProperty('--p', String(p));
          ring.current?.parentElement?.style.setProperty('--p', String(p));
          setSecs(Math.max(1, Math.ceil((1 - p) * WHOLE)));
        },
        onComplete: () => {
          setPulse(true);
          setTimeout(() => setPulse(false), 500);
          cb.current();
        },
        onCancel: () => setHolding(false),
      }),
    [],
  );
  useEffect(() => () => hold.cancel(), [hold]);

  const press = (src: 'enter' | 'pointer') => {
    if (hold.press(src)) setHolding(true);
  };
  const release = () => {
    hold.release();
    if (hold.state === 'idle') setHolding(false);
  };

  return {
    ring,
    holding,
    pulse,
    secs,
    press,
    release,
    handlers: {
      onKeyDown: (e) => {
        if (e.key === 'Enter') {
          e.preventDefault(); // no native click, so Enter cannot complete instantly
          if (!e.repeat) press('enter');
        } else if (e.key === ' ') e.preventDefault(); // Space never completes
      },
      onKeyUp: (e) => {
        if (e.key === 'Enter' || e.key === ' ') e.preventDefault();
        if (e.key === 'Enter') release();
      },
      onBlur: release,
      onPointerDown: (e) => {
        if (e.button !== 0) return;
        try {
          (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
        } catch {
          /* capture is a nicety */
        }
        press('pointer');
      },
      onPointerUp: release,
      onPointerCancel: release,
    },
  };
}

export function HoldButton({ hold, reduce, label, hintId, className = '' }: { hold: HoldControl; reduce: boolean; label: string; hintId: string; className?: string }) {
  return (
    <button type="button" data-hold className={`btn hold${hold.holding ? ' holding' : ''} ${className}`} aria-describedby={hintId} {...hold.handlers}>
      <i className="hold-bar" aria-hidden="true" />
      <span ref={hold.ring} className={`hold-ring${hold.holding ? ' on' : ''}${hold.pulse ? ' pulse' : ''}`} aria-hidden="true">
        <i className="hold-track" />
        {!reduce && (
          <>
            <span className="hold-half hold-r">
              <i />
            </span>
            <span className="hold-half hold-l">
              <i />
            </span>
          </>
        )}
        {reduce && hold.holding ? <b className="hold-num">{hold.secs}</b> : <Icon name="check" size={14} />}
      </span>
      <span className="hold-label">{label}</span>
    </button>
  );
}
