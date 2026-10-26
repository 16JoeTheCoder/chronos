// Desktop shelf (§8.7, §9.8): the real Desktop folder, read-only, sliding up from
// the bottom-left. Trash sits beside it: a drop target for cards, blocks, events
// and files, and a button that opens Recently deleted (7-day recycle bin).
import { useEffect, useRef, useState } from 'react';
import { RECYCLABLE } from '../../core/commands';
import type { Coll, Data, Rec, ShelfItem } from '../../core/model/types';
import { recycled, RECYCLE_DAYS } from '../../core/repo/recycle';
import { Icon } from '../components/Icon';
import { dropOnTrash } from '../components/actions';
import { beginDrag, registerTarget, useDrag } from '../components/drag';
import { Dialog } from '../components/ui';
import { api } from '../api';
import { run, toast } from '../store';

export function ShelfPanel({ onClose }: { onClose: () => void }) {
  const [items, setItems] = useState<ShelfItem[] | null>(null);
  useEffect(() => {
    const load = () => void api.shelf.list().then(setItems);
    load();
    return api.shelf.onChange(load);
  }, []);
  return (
    <>
      <div className="scrim scrim-clear" onPointerDown={onClose} />
      <section className="shelf" role="dialog" aria-modal="true" aria-label="Desktop">
        <header className="dlg-head">
          <h2>Desktop</h2>
          <button className="icon-btn" onClick={onClose} aria-label="Close">
            <Icon name="x" />
          </button>
        </header>
        {items === null ? (
          <p className="muted">Loading…</p>
        ) : items.length === 0 ? (
          <p className="muted">The Desktop is empty, or Chronos cannot read it. Choose another folder in Settings → General.</p>
        ) : (
          <ul className="shelf-grid">
            {items.map((f) => (
              <li key={f.path}>
                <button
                  className="file"
                  title={f.name}
                  onPointerDown={(e) => beginDrag(e, { kind: 'file', path: f.path, title: f.name }, () => void api.shelf.open(f.path).then((r) => !r.ok && toast(r.error, { error: true })))}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === ' ') {
                      e.preventDefault();
                      void api.shelf.open(f.path);
                    } else if (e.key === 'Delete') dropOnTrash({ kind: 'file', path: f.path, title: f.name });
                  }}
                  aria-label={`${f.name}${f.isDir ? ', folder' : ''}. Enter opens, Delete moves to the Recycle Bin.`}
                >
                  {f.icon ? <img src={f.icon} alt="" /> : <Icon name="folder" size={32} />}
                  <span>{f.name}</span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>
    </>
  );
}

export function TrashButton({ onOpen }: { onOpen: () => void }) {
  const ref = useRef<HTMLButtonElement>(null);
  const drag = useDrag();
  useEffect(() => registerTarget('trash', { el: () => ref.current, accepts: () => true, drop: (it) => dropOnTrash(it) }), []);
  const near = drag !== null;
  const over = drag?.target === 'trash';
  return (
    <button ref={ref} className={`trash${near ? ' near' : ''}${over ? ' over' : ''}`} onClick={onOpen} aria-label="Trash: drop items here, or open Recently deleted">
      <Icon name="trash" /> Trash
    </button>
  );
}

const SHOWN: Coll[] = RECYCLABLE.filter((c) => c !== 'eventExceptions');
const label = (coll: Coll, r: Rec) => ('title' in r ? r.title : 'name' in r ? r.name : 'text' in r ? r.text : coll);
const KIND: Partial<Record<Coll, string>> = { tasks: 'Task', events: 'Event', blocks: 'Block', tags: 'Tag', ideas: 'Idea', closures: 'Closure' };

export function RecentlyDeleted({ d, onClose }: { d: Data; onClose: () => void }) {
  const items = recycled(d).filter((x) => SHOWN.includes(x.coll));
  return (
    <Dialog title="Recently deleted" onClose={onClose} wide>
      <p className="muted">Deleted items stay here for {RECYCLE_DAYS} days, then they are purged for good. Files go to the Windows Recycle Bin instead.</p>
      {items.length === 0 ? (
        <p className="muted">Nothing deleted.</p>
      ) : (
        <ul className="list">
          {items.map(({ coll, rec }) => (
            <li key={`${coll}${rec.id}`}>
              <span>
                <span className="badge">{KIND[coll]}</span> {String(label(coll, rec))}
              </span>
              <button className="btn btn-s btn-ghost" onClick={() => void run({ type: 'restore', coll, id: rec.id })}>
                <Icon name="restore" size={14} /> Restore
              </button>
            </li>
          ))}
        </ul>
      )}
    </Dialog>
  );
}
