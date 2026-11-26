// Small shared controls: dialog, field, switch, segmented control, toasts.
import type { ReactNode } from 'react';
import { dismissToast, useToasts } from '../store';
import { Icon } from './Icon';
import { Sheet } from './Sheet';

/** Modal dialog: a bottom sheet on phones (components/Sheet.tsx). Esc or a click outside closes it, unless it is `required`. */
export const Dialog = Sheet;

export function Field({ label, error, help, children }: { label: string; error?: string; help?: string; children: ReactNode }) {
  return (
    <label className={`field${error ? ' field-error' : ''}`}>
      <span className="eyebrow">{label}</span>
      {children}
      {(error || help) && <span className="field-help">{error ?? help}</span>}
    </label>
  );
}

export function Switch({ label, checked, onChange }: { label: string; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <label className="switch">
      <input type="checkbox" role="switch" checked={checked} onChange={(e) => onChange(e.target.checked)} />
      <span className="switch-track" aria-hidden="true" />
      <span>{label}</span>
    </label>
  );
}

export function Segmented<T extends string>({ label, value, options, onChange }: { label: string; value: T; options: [T, string][]; onChange: (v: T) => void }) {
  return (
    <div
      className="seg"
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
        <button key={v} role="radio" aria-checked={value === v} tabIndex={value === v ? 0 : -1} className={value === v ? 'on' : ''} onClick={() => onChange(v)}>
          {text}
        </button>
      ))}
    </div>
  );
}

export function Toasts() {
  const list = useToasts();
  return (
    <div className="toasts" role="status" aria-live="polite">
      {list.map((t) => (
        <div key={t.id} className={`toast${t.error ? ' toast-err' : ''}`}>
          <span>{t.text}</span>
          {(t.count ?? 1) > 1 && <span className="toast-count" aria-label={`${t.count} times`}>×{t.count}</span>}
          {t.undo && (
            <button
              className="btn btn-s btn-ghost"
              onClick={() => {
                t.undo?.();
                dismissToast(t.id);
              }}
            >
              <Icon name="undo" size={14} /> Undo
            </button>
          )}
        </div>
      ))}
    </div>
  );
}

/** Light numeral, bold unit: "4h 12m" as <b>4</b>h ... per the design system's stat form. */
export function Dur({ text }: { text: string }) {
  return (
    <span className="dur">
      {text.split(/(\d+)/).map((p, i) => (/^\d+$/.test(p) ? <span key={i}>{p}</span> : p ? <b key={i}>{p}</b> : null))}
    </span>
  );
}
