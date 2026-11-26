// Cache: a short-lived shelf for things you want on your other device (a command, a path, a link,
// a screenshot). Same sync as the Log, but nothing here is kept: items clear themselves after 3 days.
import { memo, useEffect, useRef, useState, type ClipboardEvent, type DragEvent } from 'react';
import { live } from '../../core/repo/repo';
import type { CacheItem } from '../../core/model/types';
import { run, toast, useNow, useSnap } from '../store';
import { Icon } from '../components/Icon';
import { AttachButton, AttachList, AttachPending } from '../files/Attachments';
import { filesOf, useAttachments } from '../files/attach';
import { Boundary } from '../components/Boundary';
import './cache.css';

const HOUR = 3_600_000;

/** "2 d left", "5 h left", "under 1 h left". */
export function leftLabel(expiresAt: number, now: number): string {
  const ms = expiresAt - now;
  if (ms >= 24 * HOUR) return `${Math.floor(ms / (24 * HOUR))} d left`;
  if (ms >= HOUR) return `${Math.floor(ms / HOUR)} h left`;
  return 'under 1 h left';
}

export function Cache() {
  const snap = useSnap();
  if (!snap) return <section className="cache" aria-busy="true" aria-label="Cache"><p className="cache-empty">Loading…</p></section>;
  return <CacheView data={snap.data} cloud={snap.sync.files} />;
}

function CacheView({ data, cloud }: { data: NonNullable<ReturnType<typeof useSnap>>['data']; cloud: boolean }) {
  const now = useNow(60_000);
  const items = live(data, 'cache').filter((i) => i.expiresAt > now).sort((a, b) => b.createdAt - a.createdAt);
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [over, setOver] = useState(false);
  const att = useAttachments('cache', cloud);
  const box = useRef<HTMLTextAreaElement>(null);
  useEffect(() => box.current?.focus(), []);
  useEffect(() => {
    const el = box.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${Math.min(el.scrollHeight + 2, 260)}px`;
  }, [text]);

  const canAdd = (text.trim() || att.files.length) && !busy && !att.busy;
  const add = async () => {
    if (!canAdd) return;
    setBusy(true);
    const r = await run({ type: 'cache.add', body: text, ...(att.files.length ? { files: att.files } : {}) });
    setBusy(false);
    if (!r.ok) return;
    setText('');
    att.clear();
    box.current?.focus();
  };
  const onPaste = (e: ClipboardEvent) => {
    const fs = filesOf(e.clipboardData);
    if (fs.length) {
      e.preventDefault();
      void att.add(fs);
    }
  };
  const onDrop = (e: DragEvent) => {
    e.preventDefault();
    setOver(false);
    void att.add(filesOf(e.dataTransfer));
  };

  return (
    <section className="cache" aria-label="Cache">
      <header className="cache-head">
        <h1>Cache</h1>
        <p className="cache-sub">Carry things to your other devices. Items clear themselves after 3 days.</p>
        {items.length > 0 && (
          <button type="button" className="log-btn log-btn-quiet cache-clear" onClick={() => { void run({ type: 'cache.clear' }).then((r) => r.ok && toast('Cache cleared.')); }}>
            Clear all
          </button>
        )}
      </header>

      <div
        className={`cache-add${over ? ' drop-over' : ''}`}
        onDragOver={(e) => { e.preventDefault(); setOver(true); }}
        onDragLeave={() => setOver(false)}
        onDrop={onDrop}
      >
        <textarea
          ref={box}
          className="cache-input"
          rows={2}
          value={text}
          placeholder="Paste a command, path or link. Drop or paste files and images too."
          aria-label="Add to Cache"
          onChange={(e) => setText(e.target.value)}
          onPaste={onPaste}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
              e.preventDefault();
              void add();
            }
          }}
        />
        <AttachPending files={att.files} busy={att.busy} error={att.error} onRemove={att.remove} />
        <div className="cache-bar">
          <AttachButton onPick={(f) => void att.add(f)} />
          <span className="cache-hint">{cloud ? 'Enter to add · Shift+Enter for a new line' : 'Enter to add · files over about 500 KB need file storage'}</span>
          <button type="button" className="log-btn log-btn-primary" onClick={() => void add()} disabled={!canAdd}>Add</button>
        </div>
      </div>

      <Boundary what="the cache">
        {items.length === 0 ? (
          <p className="cache-empty">Nothing in the Cache. Add something here and it appears on your other devices.</p>
        ) : (
          <ul className="cache-list" aria-label="Cache items, newest first">
            {items.map((i) => <Item key={i.id} item={i} now={now} />)}
          </ul>
        )}
      </Boundary>
    </section>
  );
}

const Item = memo(function Item({ item, now }: { item: CacheItem; now: number }) {
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(item.body);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      toast('Could not copy. Select the text and press Ctrl C.', { error: true });
    }
  };
  return (
    <li className="cache-item">
      <div className="cache-main">
        {item.body && <pre className="cache-body" tabIndex={0} aria-label="Cache text">{item.body}</pre>}
        <AttachList files={item.files} area="cache" />
      </div>
      <div className="cache-side">
        <span className="cache-left">{leftLabel(item.expiresAt, now)}</span>
        {item.body && (
          <button type="button" className="log-btn cache-copy" onClick={() => void copy()} aria-live="polite">
            <Icon name={copied ? 'check' : 'copy'} size={14} /> {copied ? 'Copied' : 'Copy'}
          </button>
        )}
        <button type="button" className="log-btn log-btn-quiet cache-x" onClick={() => void run({ type: 'cache.remove', id: item.id })} aria-label="Remove from Cache" title="Remove">
          <Icon name="x" size={16} />
        </button>
      </div>
    </li>
  );
});
