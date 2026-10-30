// Create or edit a task (or sprint). The finish condition may stay empty (an
// inbox task) until the task needs to start (D-007). Choosing a tag offers
// "Do before" with the next occurrences of events carrying that tag (§6.5).

import { useState } from 'react';
import type { TaskInput } from '../../core/commands';
import { clockOf, dateLabel } from '../../core/format';
import { TAG_COLORS, type Data, type Priority, type TagColor, type Task } from '../../core/model/types';
import { isLocked, todayOf } from '../../core/tasks/tasks';
import { upcoming } from '../../core/time/schedule';
import { settingsOf } from '../../core/repo/repo';
import { Dialog, Field, Segmented } from '../components/ui';
import { run } from '../store';

export function TaskEditor({ d, task, now, onClose }: { d: Data; task: Task | null; now: number; onClose: () => void }) {
  const [f, setF] = useState<TaskInput>(() => ({
    kind: task?.kind ?? 'task',
    title: task?.title ?? '',
    finishCondition: task?.finishCondition ?? '',
    notes: task?.notes ?? '',
    tagId: task?.tagId ?? null,
    priority: task?.priority ?? 'should',
    estimateMin: task?.estimateMin ?? null,
    deadline: task?.deadline ?? null,
    dueEventId: task?.dueEventId ?? null,
    checkpointEveryMin: task?.checkpointEveryMin ?? settingsOf(d).checkpointEveryMin,
  }));
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [newTag, setNewTag] = useState<{ name: string; color: TagColor } | null>(null);
  const set = (patch: Partial<TaskInput>) => setF((x) => ({ ...x, ...patch }));
  const locked = task ? isLocked(task) : false;
  const tags = Object.values(d.tags).filter((t) => t.deletedAt === null);
  const before = f.tagId ? upcoming(d, now, todayOf(d, now), 24 * 14).filter((i) => i.event.tagId === f.tagId).slice(0, 5) : [];

  async function save() {
    let tagId = f.tagId;
    if (newTag?.name.trim()) {
      const r = await run({ type: 'tag.create', input: { name: newTag.name, color: newTag.color, kind: 'general' } });
      if (!r.ok) return;
      tagId = r.id ?? null;
    }
    const input: TaskInput = { ...f, tagId, checkpointEveryMin: f.kind === 'sprint' ? f.checkpointEveryMin : null };
    const r = task ? await run({ type: 'task.update', id: task.id, input: locked ? { ...input, finishCondition: undefined, kind: undefined } : { ...input, kind: undefined } }, true) : await run({ type: 'task.create', input }, true);
    if (r.ok) onClose();
    else setErrors(r.fields ?? { title: r.error });
  }

  return (
    <Dialog title={task ? 'Edit task' : 'New task'} onClose={onClose} wide>
      <form
        className="form"
        onSubmit={(e) => {
          e.preventDefault();
          void save();
        }}
      >
        {!task && <Segmented label="Kind" value={f.kind ?? 'task'} options={[['task', 'Task'], ['sprint', 'Sprint']]} onChange={(kind) => set({ kind })} />}
        <Field label="Title" error={errors.title}>
          <input value={f.title} maxLength={120} onChange={(e) => set({ title: e.target.value })} placeholder="Finish kinematics worksheet" />
        </Field>
        <Field label="Finish condition" error={errors.finishCondition} help={locked ? 'Locked once the timer has started.' : 'What does finished look like? At least 8 characters. Can wait until you start.'}>
          <input value={f.finishCondition} disabled={locked} maxLength={500} onChange={(e) => set({ finishCondition: e.target.value })} placeholder="All 12 questions answered and checked" />
        </Field>
        <div className="grid2">
          <Field label="Tag">
            <select
              value={newTag ? '__new' : (f.tagId ?? '')}
              onChange={(e) => {
                if (e.target.value === '__new') setNewTag({ name: '', color: 'tag1' });
                else {
                  setNewTag(null);
                  set({ tagId: e.target.value || null, dueEventId: null });
                }
              }}
            >
              <option value="">No tag</option>
              {tags.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name}
                </option>
              ))}
              <option value="__new">New tag…</option>
            </select>
          </Field>
          <Field label="Priority">
            <Segmented<Priority> label="Priority" value={f.priority ?? 'should'} options={[['must', 'Must'], ['should', 'Should'], ['nice', 'Nice']]} onChange={(priority) => set({ priority })} />
          </Field>
        </div>
        {newTag && (
          <div className="grid2">
            <Field label="New tag name" error={errors.name}>
              <input value={newTag.name} maxLength={40} onChange={(e) => setNewTag({ ...newTag, name: e.target.value })} placeholder="Physics" />
            </Field>
            <Field label="Colour">
              <div className="swatches" role="radiogroup" aria-label="Tag colour">
                {TAG_COLORS.map((c) => (
                  <button type="button" key={c} role="radio" aria-checked={newTag.color === c} aria-label={c} className="swatch" style={{ background: `var(--${c})` }} onClick={() => setNewTag({ ...newTag, color: c })} />
                ))}
              </div>
            </Field>
          </div>
        )}
        {before.length > 0 && (
          <Field label="Do before">
            <select value={f.dueEventId ?? ''} onChange={(e) => set({ dueEventId: e.target.value || null })}>
              <option value="">Any time</option>
              {before.map((i) => (
                <option key={`${i.event.id}${i.date}`} value={i.event.id}>
                  {i.event.title} · {dateLabel(i.date)} {clockOf(i.start, i.event.tz)}
                </option>
              ))}
            </select>
          </Field>
        )}
        <div className="grid2">
          <Field label="Estimate (minutes)" error={errors.estimateMin}>
            <input type="number" min={1} max={1440} value={f.estimateMin ?? ''} onChange={(e) => set({ estimateMin: e.target.value ? Number(e.target.value) : null })} />
          </Field>
          <Field label="Deadline" error={errors.deadline}>
            <input type="date" value={f.deadline ?? ''} onChange={(e) => set({ deadline: e.target.value || null })} />
          </Field>
        </div>
        {f.kind === 'sprint' && (
          <Field label="Checkpoint every (minutes of work)" error={errors.checkpointEveryMin}>
            <input type="number" min={15} max={600} value={f.checkpointEveryMin ?? ''} onChange={(e) => set({ checkpointEveryMin: Number(e.target.value) })} />
          </Field>
        )}
        <Field label="Notes">
          <textarea rows={3} value={f.notes} onChange={(e) => set({ notes: e.target.value })} />
        </Field>
        <div className="row end gap">
          <button type="button" className="btn btn-ghost" onClick={onClose}>
            Cancel
          </button>
          <button type="submit" className="btn">
            {task ? 'Save task' : 'Add task'}
          </button>
        </div>
      </form>
    </Dialog>
  );
}
