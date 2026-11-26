// The one modal. A centred dialog on tablet and desktop; a bottom sheet on phones (< 640 px):
// slides up, grabber handle, swipe down on the handle or header to dismiss, and it lifts above
// the on-screen keyboard (visualViewport). Esc or a tap outside closes it unless `required`.
// ui.tsx exports it as `Dialog`, so every dialog in the app is a sheet on a phone.
import { useEffect, useRef, useState, type KeyboardEvent, type ReactNode, type PointerEvent as RPointerEvent } from 'react';
import { Icon } from './Icon';
import { classifySwipe } from './gesture';
import './sheet.css';

export interface SheetProps {
  title: string;
  onClose: () => void;
  children: ReactNode;
  wide?: boolean;
  /** An answer is needed: no close button, no Esc, no swipe. */
  required?: boolean;
}

/** Pixels the on-screen keyboard covers. 0 where visualViewport is missing (older WebViews) or the keyboard is closed. */
export function useKeyboardInset(): number {
  const [inset, setInset] = useState(0);
  useEffect(() => {
    const vv = typeof window !== 'undefined' ? window.visualViewport : null;
    if (!vv) return undefined;
    const on = () => setInset(Math.max(0, Math.round(window.innerHeight - vv.height - vv.offsetTop)));
    vv.addEventListener('resize', on);
    vv.addEventListener('scroll', on);
    on();
    return () => { vv.removeEventListener('resize', on); vv.removeEventListener('scroll', on); };
  }, []);
  return inset;
}

export function Sheet({ title, onClose, children, wide, required }: SheetProps) {
  const ref = useRef<HTMLDivElement>(null);
  const kb = useKeyboardInset();
  const [drag, setDrag] = useState(0);
  const start = useRef<{ x: number; y: number; t: number } | null>(null);
  useEffect(() => {
    const prev = document.activeElement as HTMLElement | null;
    // On touch devices focusing an input pops the keyboard; only autofocus where a keyboard is physical.
    const phone = typeof window.matchMedia === 'function' && window.matchMedia('(pointer: coarse)').matches;
    ref.current?.querySelector<HTMLElement>(phone ? '[data-autofocus]' : '[data-autofocus], input, textarea, select, button:not(.dlg-x)')?.focus();
    return () => prev?.focus?.();
  }, []);

  const press = (e: RPointerEvent) => {
    if (required || e.pointerType === 'mouse') return;
    start.current = { x: e.clientX, y: e.clientY, t: Date.now() };
    (e.currentTarget as HTMLElement).setPointerCapture?.(e.pointerId);
  };
  const move = (e: RPointerEvent) => {
    const s = start.current;
    if (s) setDrag(Math.max(0, e.clientY - s.y));
  };
  const release = (e: RPointerEvent) => {
    const s = start.current;
    start.current = null;
    if (!s) return;
    const swipe = classifySwipe(e.clientX - s.x, e.clientY - s.y, Date.now() - s.t);
    setDrag(0);
    if (swipe === 'down') onClose();
  };

  return (
    <div className="scrim sheet-scrim" style={kb ? { paddingBottom: kb } : undefined} onPointerDown={(e) => !required && e.target === e.currentTarget && onClose()}>
      <div
        ref={ref}
        className={`dlg sheet${wide ? ' dlg-wide' : ''}`}
        style={drag ? { transform: `translateY(${drag}px)`, transition: 'none' } : undefined}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        onKeyDown={(e) => {
          if (e.key === 'Tab') trapFocus(e, ref.current);
          if (e.key !== 'Escape') return;
          e.preventDefault();
          e.stopPropagation();
          if (!required) onClose();
        }}
      >
        <div className="sheet-top" onPointerDown={press} onPointerMove={move} onPointerUp={release} onPointerCancel={() => { start.current = null; setDrag(0); }}>
          <span className="sheet-grab" aria-hidden="true" />
          <header className="dlg-head">
            <h2>{title}</h2>
            {!required && (
              <button className="icon-btn dlg-x" onClick={onClose} aria-label="Close">
                <Icon name="x" />
              </button>
            )}
          </header>
        </div>
        {children}
      </div>
    </div>
  );
}

/** Keep Tab inside an open dialog. */
function trapFocus(e: KeyboardEvent<HTMLElement>, root: HTMLElement | null): void {
  const items = [...(root?.querySelectorAll<HTMLElement>('button:not([disabled]), input:not([disabled]), select, textarea, [tabindex="0"]') ?? [])];
  const first = items[0];
  const last = items.at(-1);
  if (!first || !last) return;
  if (e.shiftKey && document.activeElement === first) {
    e.preventDefault();
    last.focus();
  } else if (!e.shiftKey && document.activeElement === last) {
    e.preventDefault();
    first.focus();
  }
}
