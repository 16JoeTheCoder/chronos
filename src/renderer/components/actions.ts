// UI actions shared by the Trash, the Delete key and menus: recycle with an
// 8-second Undo toast, and the per-kind rules for what a Trash drop means.
import type { Coll } from '../../core/model/types';
import { api } from '../api';
import { run, toast } from '../store';
import { ask } from './ask';
import type { DragItem } from './drag';

export async function recycleWithUndo(coll: Coll, id: string, label: string, confirmed = false): Promise<void> {
  const r = await run({ type: 'recycle', coll, id, confirmed });
  if (!r.ok && r.error === 'confirm-required') {
    ask({
      title: 'Delete this task?',
      body: `${label} has tracked time. It moves to Recently deleted for 7 days, then it is gone.`,
      actions: [{ label: 'Delete', primary: true, run: () => void recycleWithUndo(coll, id, label, true) }],
    });
    return;
  }
  if (r.ok) toast(`${label} deleted.`, { undo: () => void run({ type: 'restore', coll, id }) });
}

export function dropOnTrash(item: DragItem): void {
  switch (item.kind) {
    case 'task':
      void recycleWithUndo('tasks', item.taskId, item.title);
      return;
    case 'block':
      void recycleWithUndo('blocks', item.blockId, item.title);
      return;
    case 'event':
      if (!item.recurring) {
        void recycleWithUndo('events', item.eventId, item.title);
        return;
      }
      ask({
        title: `Delete ${item.title}?`,
        body: 'It repeats. Remove just this occurrence, or the whole series?',
        actions: [
          {
            label: 'This occurrence',
            run: async () => {
              const r = await run({ type: 'event.skip', id: item.eventId, date: item.date });
              if (r.ok && r.id) toast(`${item.title} skipped today.`, { undo: () => void run({ type: 'recycle', coll: 'eventExceptions', id: r.id as string, confirmed: true }) });
            },
          },
          { label: 'Whole series', primary: true, run: () => void recycleWithUndo('events', item.eventId, item.title) },
        ],
      });
      return;
    case 'file':
      ask({
        title: 'Move to the Recycle Bin?',
        body: `${item.title} goes to the Windows Recycle Bin. You can restore it from there.`,
        actions: [
          {
            label: 'Move to Recycle Bin',
            primary: true,
            run: async () => {
              const r = await api.shelf.trash(item.path);
              toast(r.ok ? `${item.title} is in the Recycle Bin.` : r.error, { error: !r.ok });
            },
          },
        ],
      });
  }
}
