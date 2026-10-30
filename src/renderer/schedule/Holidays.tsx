// Holidays and breaks (§6.3, §9.5): the closures list behind the schedule editor's
// Holidays button. Add, edit, confirm and delete; a closure turns off the ticked scopes.
import { useState } from 'react';
import { dateLabel } from '../../core/format';
import { SCOPES, type Closure, type Data } from '../../core/model/types';
import { live } from '../../core/repo/repo';
import { Icon } from '../components/Icon';
import { recycleWithUndo } from '../components/actions';
import { Dialog, Field, Switch } from '../components/ui';
import { run } from '../store';

export function Holidays({ d, today, onClose }: { d: Data; today: string; onClose: () => void }) {
  const list = live(d, 'closures').sort((a, b) => a.startDate.localeCompare(b.startDate));
  const [edit, setEdit] = useState<(Omit<Closure, 'id'> & { id: string | null }) | null>(null);
  const save = async () => {
    if (!edit) return;
    const input = { name: edit.name, startDate: edit.startDate, endDate: edit.endDate, scopes: edit.scopes, confirmed: edit.confirmed };
    const r = edit.id ? await run({ type: 'closure.update', id: edit.id, input }) : await run({ type: 'closure.create', input });
    if (r.ok) setEdit(null);
  };
  return (
    <Dialog title="Holidays and breaks" onClose={onClose} wide>
      <p className="muted">Fixed national holidays are pre-filled; add the movable ones (Eid, Nyepi, Vesak, Chinese New Year, joint leave) and school breaks yourself. A closure turns off the scopes you tick.</p>
      {edit ? (
        <div className="form">
          <Field label="Name">
            <input autoFocus value={edit.name} onChange={(e) => setEdit({ ...edit, name: e.target.value })} />
          </Field>
          <div className="grid2">
            <Field label="From">
              <input type="date" value={edit.startDate} onChange={(e) => setEdit({ ...edit, startDate: e.target.value })} />
            </Field>
            <Field label="To">
              <input type="date" value={edit.endDate} onChange={(e) => setEdit({ ...edit, endDate: e.target.value })} />
            </Field>
          </div>
          <div className="row gap wrap" role="group" aria-label="Off for">
            {SCOPES.map((sc) => (
              <button key={sc} className={`chip${edit.scopes.includes(sc) ? ' on' : ''}`} aria-pressed={edit.scopes.includes(sc)} onClick={() => setEdit({ ...edit, scopes: edit.scopes.includes(sc) ? edit.scopes.filter((x) => x !== sc) : [...edit.scopes, sc] })}>
                {sc} off
              </button>
            ))}
          </div>
          <Switch label="Confirmed" checked={edit.confirmed} onChange={(confirmed) => setEdit({ ...edit, confirmed })} />
          <div className="row gap">
            <button className="btn" onClick={() => void save()}>
              Save
            </button>
            <button className="btn btn-ghost" onClick={() => setEdit(null)}>
              Cancel
            </button>
          </div>
        </div>
      ) : (
        <>
          <button className="btn btn-s" onClick={() => setEdit({ id: null, name: '', startDate: today, endDate: today, scopes: ['school'], source: 'custom', confirmed: true, createdAt: 0, updatedAt: 0, deviceId: '', deletedAt: null, v: 1 })}>
            <Icon name="plus" size={14} /> Add holiday or break
          </button>
          <ul className="list">
            {list.map((c) => (
              <li key={c.id}>
                <span>
                  {c.confirmed ? <span className="badge badge-ok">{c.scopes.length ? `${c.scopes.join(', ')} off` : 'Not off'}</span> : <span className="badge badge-warn">Unconfirmed</span>} {c.name} · {dateLabel(c.startDate)}
                  {c.endDate !== c.startDate && ` – ${dateLabel(c.endDate)}`}
                </span>
                <span className="row gap">
                  <button className="btn btn-s btn-ghost" onClick={() => setEdit({ ...c })}>
                    Edit
                  </button>
                  <button className="icon-btn" aria-label={`Delete ${c.name}`} onClick={() => void recycleWithUndo('closures', c.id, c.name)}>
                    <Icon name="trash" size={16} />
                  </button>
                </span>
              </li>
            ))}
          </ul>
        </>
      )}
    </Dialog>
  );
}
