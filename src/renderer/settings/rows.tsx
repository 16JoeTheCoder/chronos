// Small building blocks for Settings. Real buttons and inputs, 44 px hit areas, theme tokens only
// (styles in settings.css). Every control answers at once: pressed state, a "Saved" tick or a toast.

import { useEffect, useId, useRef, useState, type ReactNode } from 'react';
import { run } from '../store';
import type { SettingsPatch } from '../../core/commands';

/** settings.update, resolving true when main accepted it. Errors toast (store.run). */
export const saveSettings = (patch: SettingsPatch): Promise<boolean> => run({ type: 'settings.update', patch }).then((r) => r.ok);

export function Group({ title, note, children }: { title: string; note?: ReactNode; children: ReactNode }) {
  const id = useId();
  return (
    <section className="st-group" aria-labelledby={id}>
      <h3 id={id}>{title}</h3>
      {note && <p className="st-note">{note}</p>}
      <div className="st-rows">{children}</div>
    </section>
  );
}

export function Row({ label, hint, children, htmlFor }: { label: string; hint?: ReactNode; children?: ReactNode; htmlFor?: string }) {
  return (
    <div className="st-row">
      <div className="st-row-text">
        <label className="st-label" htmlFor={htmlFor}>{label}</label>
        {hint && <span className="st-hint" id={htmlFor ? `${htmlFor}-hint` : undefined}>{hint}</span>}
      </div>
      {children && <div className="st-row-ctl">{children}</div>}
    </div>
  );
}

export function Toggle({ label, hint, checked, onChange, disabled }: { label: string; hint?: ReactNode; checked: boolean; onChange: (v: boolean) => void | Promise<unknown>; disabled?: boolean }) {
  const id = useId();
  return (
    <div className="st-row">
      <div className="st-row-text">
        <span className="st-label" id={`${id}-l`}>{label}</span>
        {hint && <span className="st-hint" id={`${id}-h`}>{hint}</span>}
      </div>
      <button type="button" role="switch" className="st-tog" aria-checked={checked} aria-labelledby={`${id}-l`} aria-describedby={hint ? `${id}-h` : undefined} disabled={disabled} onClick={() => void onChange(!checked)}>
        <span className="st-tog-track" aria-hidden="true"><span className="st-tog-knob" /></span>
      </button>
    </div>
  );
}

type ActionResult = void | boolean | Promise<void | boolean>;

/** A button that shows it was pressed: busy while its promise runs, then a short "done" tick. */
export function Btn({ children, onClick, variant = 'ghost', disabled, done, label }: { children: ReactNode; onClick: () => ActionResult; variant?: 'ghost' | 'solid' | 'danger'; disabled?: boolean; done?: string; label?: string }) {
  const [state, setState] = useState<'idle' | 'busy' | 'done'>('idle');
  const timer = useRef<number | undefined>(undefined);
  useEffect(() => () => window.clearTimeout(timer.current), []);
  async function click() {
    if (state === 'busy') return;
    setState('busy');
    let ok: void | boolean = true;
    try { ok = await onClick(); } catch { ok = false; }
    if (ok === false || !done) return setState('idle');
    setState('done');
    timer.current = window.setTimeout(() => setState('idle'), 1400);
  }
  return (
    <button type="button" className={`st-btn st-btn-${variant}`} data-state={state} aria-busy={state === 'busy'} aria-label={label} disabled={disabled} onClick={() => void click()}>
      {state === 'done' && done ? done : children}
    </button>
  );
}

export function Seg<T extends string>({ label, value, options, onChange }: { label: string; value: T; options: [T, string][]; onChange: (v: T) => void }) {
  return (
    <div
      className="st-seg"
      role="radiogroup"
      aria-label={label}
      onKeyDown={(e) => {
        const dir = e.key === 'ArrowRight' || e.key === 'ArrowDown' ? 1 : e.key === 'ArrowLeft' || e.key === 'ArrowUp' ? -1 : 0;
        if (!dir) return;
        e.preventDefault();
        const i = (options.findIndex(([v]) => v === value) + dir + options.length) % options.length;
        onChange(options[i]![0]);
        (e.currentTarget.children[i] as HTMLElement | undefined)?.focus();
      }}
    >
      {options.map(([v, text]) => (
        <button key={v} type="button" role="radio" aria-checked={value === v} tabIndex={value === v ? 0 : -1} onClick={() => onChange(v)}>
          {text}
        </button>
      ))}
    </div>
  );
}

interface FieldProps {
  label: string;
  hint?: ReactNode;
  value: string;
  /** Returns an error text, or null when the text is acceptable. */
  check?: (v: string) => string | null;
  /** false = refused; the text goes back to the saved value. */
  onCommit: (v: string) => void | boolean | Promise<void | boolean>;
  suffix?: string;
  mono?: boolean;
  wide?: boolean;
  placeholder?: string;
  inputMode?: 'numeric' | 'text';
}

/** Text input that commits on Enter or blur, reverts on Escape, and says "Saved". */
export function TextField({ label, hint, value, check, onCommit, suffix, mono, wide, placeholder, inputMode }: FieldProps) {
  const id = useId();
  const [text, setText] = useState(value);
  const [saved, setSaved] = useState(false);
  const timer = useRef<number | undefined>(undefined);
  useEffect(() => setText(value), [value]);
  useEffect(() => () => window.clearTimeout(timer.current), []);
  const error = check ? check(text) : null;
  async function commit() {
    if (text === value || error) return;
    const ok = await onCommit(text);
    if (ok === false) return setText(value);
    setSaved(true);
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => setSaved(false), 1200);
  }
  return (
    <div className="st-row">
      <div className="st-row-text">
        <label className="st-label" htmlFor={id}>{label}</label>
        {(error || hint) && <span className={`st-hint${error ? ' st-err' : ''}`} id={`${id}-h`}>{error ?? hint}</span>}
      </div>
      <div className="st-row-ctl">
        <span className="st-saved" role="status">{saved ? 'Saved' : ''}</span>
        <input
          id={id}
          className={`st-input${mono ? ' st-mono' : ''}${wide ? ' st-wide' : ''}`}
          value={text}
          placeholder={placeholder}
          inputMode={inputMode}
          aria-invalid={!!error}
          aria-describedby={error || hint ? `${id}-h` : undefined}
          onChange={(e) => setText(e.target.value)}
          onBlur={() => void commit()}
          onKeyDown={(e) => {
            if (e.key === 'Enter') void commit();
            if (e.key === 'Escape') setText(value);
          }}
        />
        {suffix && <span className="st-suffix">{suffix}</span>}
      </div>
    </div>
  );
}

/** A whole number field with a range. */
export function NumField({ label, hint, value, min, max, suffix, onCommit }: { label: string; hint?: ReactNode; value: number; min: number; max: number; suffix?: string; onCommit: (n: number) => void | boolean | Promise<void | boolean> }) {
  return (
    <TextField
      label={label}
      hint={hint}
      value={String(value)}
      suffix={suffix}
      mono
      inputMode="numeric"
      check={(v) => (/^\d+$/.test(v.trim()) && Number(v) >= min && Number(v) <= max ? null : `Use a whole number from ${min} to ${max}.`)}
      onCommit={(v) => onCommit(Number(v))}
    />
  );
}
