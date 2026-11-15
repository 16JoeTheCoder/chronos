// Turns a drop Intent (dnd.ts) into commands, with a toast and one Undo for the whole
// thing. Compound moves (event to block, block to event, ...) undo as a unit.

import type { Command, EventInput, Result } from '../../core/commands';
import type { CalEvent, Coll, Data } from '../../core/model/types';
import { settingsOf } from '../../core/repo/repo';
import { api } from '../api';
import { run, toast } from '../store';
import type { Intent } from './dnd';

type Undo = () => Promise<unknown>;
const cmd = (c: Command) => api.command(c);
const recycleUndo = (coll: Coll, id: string): Undo => () => cmd({ type: 'recycle', coll, id, confirmed: true });
const restoreUndo = (coll: Coll, id: string): Undo => () => cmd({ type: 'restore', coll, id });

/** Full input of an event, to write it back with a change. */
export function eventInput(ev: CalEvent, patch: Partial<EventInput> = {}): EventInput {
  return { title: ev.title, tagId: ev.tagId, scope: ev.scope, tz: ev.tz, startMin: ev.startMin, endMin: ev.endMin, date: ev.date, recur: ev.recur, notes: ev.notes, durationMin: ev.durationMin, ...patch };
}

async function step(c: Command, undo: Undo[], inverse: (r: Result & { ok: true }) => Undo | null): Promise<Result> {
  const r = await run(c);
  if (r.ok) {
    const u = inverse(r);
    if (u) undo.push(u);
  }
  return r;
}

/** Perform an intent. `recurScope` decides a moved recurring event: just today (exception) or every week. */
export async function perform(i: Intent, d: Data, date: string, recurScope: 'today' | 'week' = 'today'): Promise<boolean> {
  const undo: Undo[] = [];
  let text = '';
  let ok = true;
  switch (i.op) {
    case 'block.create': {
      const r = await step({ type: 'block.create', taskId: i.taskId, date, startMin: i.startMin, endMin: i.endMin }, undo, (x) => (x.id ? recycleUndo('blocks', x.id) : null));
      ok = r.ok;
      text = 'Planned.';
      break;
    }
    case 'block.move': {
      const b = d.blocks[i.blockId];
      if (!b) return false;
      const r = await step({ type: 'block.move', id: b.id, date, startMin: i.startMin, endMin: i.endMin }, undo, () => () => cmd({ type: 'block.move', id: b.id, date: b.date, startMin: b.startMin, endMin: b.endMin }));
      ok = r.ok;
      text = 'Moved.';
      break;
    }
    case 'event.place': {
      const r = await step({ type: 'event.place', id: i.eventId, startMin: i.startMin }, undo, () => () => unplace(d, i.eventId));
      ok = r.ok;
      text = 'Placed.';
      break;
    }
    case 'event.move': {
      const ev = d.events[i.eventId];
      if (!ev) return false;
      if (ev.recur && recurScope === 'today') {
        const r = await step({ type: 'event.editOn', id: ev.id, date: i.date, patch: { startMin: i.startMin, endMin: i.endMin } }, undo, (x) => (x.id ? recycleUndo('eventExceptions', x.id) : null));
        ok = r.ok;
        text = `${ev.title} moved, just today.`;
      } else {
        const r = await step({ type: 'event.update', id: ev.id, input: eventInput(ev, { startMin: i.startMin, endMin: i.endMin }) }, undo, () => () => cmd({ type: 'event.update', id: ev.id, input: eventInput(ev) }));
        ok = r.ok;
        text = ev.recur ? `${ev.title} moved, every week.` : `${ev.title} moved.`;
      }
      break;
    }
    case 'task.toEvent': {
      const t = d.tasks[i.taskId];
      if (!t) return false;
      const tz = settingsOf(d).timezone;
      const r = await step({ type: 'event.create', input: { title: t.title, tagId: t.tagId, scope: 'other', tz, startMin: i.startMin, endMin: i.endMin, date, recur: null, notes: '' } }, undo, (x) => (x.id ? recycleUndo('events', x.id) : null));
      ok = r.ok;
      if (ok) await step({ type: 'recycle', coll: 'tasks', id: t.id, confirmed: true }, undo, () => restoreUndo('tasks', t.id));
      text = `${t.title} is now fixed.`;
      break;
    }
    case 'block.toEvent': {
      const b = d.blocks[i.blockId];
      if (!b) return false;
      const tz = b.tz;
      const r = await step({ type: 'event.create', input: { title: b.title, tagId: b.tagId, scope: 'other', tz, startMin: i.startMin, endMin: i.endMin, date, recur: null, notes: '' } }, undo, (x) => (x.id ? recycleUndo('events', x.id) : null));
      ok = r.ok;
      if (ok) await step({ type: 'recycle', coll: 'blocks', id: b.id, confirmed: true }, undo, () => restoreUndo('blocks', b.id));
      text = `${b.title} is now fixed.`;
      break;
    }
    case 'event.toBlock': {
      const ev = d.events[i.eventId];
      if (!ev) return false;
      const dur = i.endMin - i.startMin;
      const t = await step({ type: 'task.create', input: { title: ev.title, tagId: ev.tagId, estimateMin: dur } }, undo, (x) => (x.id ? recycleUndo('tasks', x.id) : null));
      ok = t.ok && !!t.id;
      if (t.ok && t.id) {
        const b = await step({ type: 'block.create', taskId: t.id, date, startMin: i.startMin, endMin: i.endMin }, undo, (x) => (x.id ? recycleUndo('blocks', x.id) : null));
        ok = b.ok;
        if (ok) await dropEvent(ev, i.date, undo);
      }
      text = `${ev.title} is now a task.`;
      break;
    }
    case 'block.unplan': {
      const b = d.blocks[i.blockId];
      if (!b) return false;
      const r = await step({ type: 'recycle', coll: 'blocks', id: b.id, confirmed: true }, undo, () => restoreUndo('blocks', b.id));
      ok = r.ok;
      text = b.taskId ? `${b.title} is unscheduled.` : `${b.title} removed from the plan.`;
      break;
    }
    case 'event.toCard': {
      const ev = d.events[i.eventId];
      if (!ev) return false;
      const t = await step({ type: 'task.create', input: { title: ev.title, tagId: ev.tagId, estimateMin: i.durMin } }, undo, (x) => (x.id ? recycleUndo('tasks', x.id) : null));
      ok = t.ok;
      if (ok) await dropEvent(ev, i.date, undo);
      text = `${ev.title} is now a task.`;
      break;
    }
  }
  if (ok && text) {
    toast(text, {
      undo: () => {
        for (const u of [...undo].reverse()) void u();
      },
    });
  }
  return ok;
}

/** Remove an event from the day: one-off = recycle it; recurring = skip just this date. */
async function dropEvent(ev: CalEvent, date: string, undo: Undo[]): Promise<void> {
  if (ev.recur) await step({ type: 'event.skip', id: ev.id, date }, undo, (x) => (x.id ? recycleUndo('eventExceptions', x.id) : null));
  else await step({ type: 'recycle', coll: 'events', id: ev.id, confirmed: true }, undo, () => restoreUndo('events', ev.id));
}

function unplace(d: Data, id: string): Promise<unknown> {
  const ev = d.events[id];
  return ev ? cmd({ type: 'event.update', id, input: eventInput(ev, { startMin: null, endMin: null }) }) : Promise.resolve();
}
