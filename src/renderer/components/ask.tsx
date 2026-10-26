// One confirmation/choice dialog at a time, callable from anywhere (Trash drops,
// recycle with tracked time, file to Recycle Bin, occurrence vs series).
import { useSyncExternalStore } from 'react';
import { Dialog } from './ui';

export interface Ask {
  title: string;
  body: string;
  actions: { label: string; primary?: boolean; run: () => void }[];
}

let current: Ask | null = null;
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());

export function ask(a: Ask): void {
  current = a;
  emit();
}

export function closeAsk(): void {
  current = null;
  emit();
}

export const askOpen = () => current !== null;

export function AskHost() {
  const a = useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => current,
  );
  if (!a) return null;
  return (
    <Dialog title={a.title} onClose={closeAsk}>
      <p className="muted">{a.body}</p>
      <div className="row end gap">
        <button className="btn btn-ghost" onClick={closeAsk}>
          Cancel
        </button>
        {a.actions.map((x) => (
          <button
            key={x.label}
            className={x.primary ? 'btn' : 'btn btn-ghost'}
            onClick={() => {
              closeAsk();
              x.run();
            }}
          >
            {x.label}
          </button>
        ))}
      </div>
    </Dialog>
  );
}
