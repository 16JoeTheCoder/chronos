// G5: a quiet sync dot by the date. Shown only when something needs attention:
// amber (triangle) when changes have waited more than 10 s or the PC is offline,
// red (diamond) on an error or read-only. Shape and a hidden word carry the
// meaning as well as colour. Click for a one-line reason and Retry.

import { useEffect, useRef, useState } from 'react';
import type { SyncView } from '../../core/model/types';
import { run, useNow } from '../store';

const PENDING_GRACE_MS = 10_000;

export function syncLevel(s: SyncView, now: number): 'amber' | 'red' | null {
  if (s.state === 'error' || s.state === 'readOnly') return 'red';
  if (s.state === 'offline') return 'amber';
  if (s.state === 'pending' && s.pending > 0 && s.oldestPendingAt !== null && now - s.oldestPendingAt > PENDING_GRACE_MS) return 'amber';
  return null;
}

const WORD: Partial<Record<SyncView['state'], string>> = { pending: 'Sync is behind', offline: 'Offline, sync waiting', error: 'Sync error', readOnly: 'Sync is read-only' };

export function SyncDot({ sync }: { sync: SyncView }) {
  const now = useNow(5_000);
  const [open, setOpen] = useState(false);
  const btn = useRef<HTMLButtonElement>(null);
  const pop = useRef<HTMLDivElement>(null);
  const level = syncLevel(sync, now);

  useEffect(() => {
    if (!open) return;
    pop.current?.querySelector<HTMLElement>('button')?.focus();
    const away = (e: PointerEvent) => {
      if (!pop.current?.contains(e.target as Node) && !btn.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('pointerdown', away, true);
    return () => document.removeEventListener('pointerdown', away, true);
  }, [open]);
  useEffect(() => {
    if (!level) setOpen(false);
  }, [level]);

  if (!level) return null;
  const word = WORD[sync.state] ?? 'Sync needs attention';
  const line = sync.reason ?? (sync.pending > 0 ? `${sync.pending} change${sync.pending === 1 ? '' : 's'} waiting to sync` : word);

  return (
    <span className="sync-wrap">
      <button ref={btn} className={`sync-dot sync-${level}`} aria-label={`${word}. ${line}`} aria-expanded={open} aria-haspopup="dialog" onClick={() => setOpen((o) => !o)}>
        <span className="sync-shape" aria-hidden="true" />
        <span className="sr-only">{word}</span>
      </button>
      {open && (
        <div
          ref={pop}
          className="pop sync-pop"
          role="dialog"
          aria-label="Sync status"
          onKeyDown={(e) => {
            if (e.key === 'Escape') {
              e.preventDefault();
              e.stopPropagation();
              setOpen(false);
              btn.current?.focus();
            }
          }}
        >
          <p>{line}</p>
          <button
            className="btn btn-s btn-ghost"
            onClick={() => {
              void run({ type: 'sync.retry' });
              setOpen(false);
              btn.current?.focus();
            }}
          >
            Retry
          </button>
        </div>
      )}
    </span>
  );
}
