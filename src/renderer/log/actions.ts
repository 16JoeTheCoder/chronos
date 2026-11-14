// Log writes that touch tasks: queue lines as tasks, with one Undo.
import type { LineInfo } from '../../core/log';
import { decodeLinks, encodeLinks } from '../../core/log';
import type { Idea } from '../../core/model/types';
import { run, toast } from '../store';

/** Create a task per line, link each to its line, and offer one Undo. Returns the number queued. */
export async function queueLines(note: Pick<Idea, 'id' | 'parsedTaskIds'>, lines: LineInfo[], opts: { toastText?: (n: number) => string } = {}): Promise<number> {
  const links = decodeLinks(note.parsedTaskIds);
  const made: string[] = [];
  for (const l of lines) {
    if (!l.input) continue;
    const r = await run({ type: 'task.create', input: l.input }, true);
    if (r.ok && r.id) {
      links.set(l.index, r.id);
      made.push(r.id);
    }
  }
  if (!made.length) return 0;
  await run({ type: 'idea.edit', id: note.id, parsedTaskIds: encodeLinks(links, note.parsedTaskIds) }, true);
  toast(opts.toastText?.(made.length) ?? (made.length === 1 ? 'Added to your queue' : `Added ${made.length} tasks to your queue`), {
    undo: () => {
      void (async () => {
        for (const id of made) await run({ type: 'recycle', coll: 'tasks', id, confirmed: true }, true);
        await run({ type: 'idea.edit', id: note.id, parsedTaskIds: note.parsedTaskIds }, true);
      })();
    },
  });
  return made.length;
}
