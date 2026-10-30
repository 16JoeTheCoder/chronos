// Loading untrusted JSON into Data: the schema migration entry point (fills any
// missing collection or setting with its default), and the one-off import of a
// Monolith data file. Import ids are deterministic ('mono-<id>'), so importing
// the same file twice changes nothing.

import { defaultActiveTimer, defaultSettings, defaultTimer, emptyData, idleRuntime } from '../model/defaults';
import { sessionId } from '../model/ids';
import { COLLS, type Data, type Priority, type Settings } from '../model/types';
import { isObj } from '../validation';
import { maxOrder } from '../tasks/tasks';
import { create, get, type Ctx } from './repo';

/** Deep-fill plain-object defaults (arrays and scalars are taken as stored). */
function fill<T>(def: T, raw: unknown): T {
  if (!isObj(def) || !isObj(raw)) return (raw === undefined || (isObj(def) && !isObj(raw)) ? def : raw) as T;
  const out: Record<string, unknown> = { ...raw };
  for (const [k, v] of Object.entries(def)) out[k] = fill(v, raw[k]);
  return out as T;
}

export function migrate(raw: unknown): Data | null {
  if (!isObj(raw) || raw.schema !== 1) return null;
  const d = emptyData();
  for (const c of COLLS) if (isObj(raw[c])) (d as Record<string, unknown>)[c] = raw[c];
  d.settings = { main: fill<Settings>(defaultSettings(), (raw.settings as Record<string, unknown> | undefined)?.main) };
  d.timer = { current: fill(defaultActiveTimer(), (raw.timer as Record<string, unknown> | undefined)?.current) };
  if (isObj(raw.tombs)) d.tombs = raw.tombs as Data['tombs'];
  return d;
}

const PRIORITY: Record<string, Priority> = { high: 'must', medium: 'should', low: 'nice', none: 'should' };
const num = (v: unknown, def = 0) => (typeof v === 'number' && Number.isFinite(v) ? v : def);
const str = (v: unknown, max: number) => (typeof v === 'string' ? v.slice(0, max) : '');

/** Map Monolith tasks (v1 or v2 file) into Chronos tasks and sessions. Returns the count imported. */
export function fromMonolith(d: Data, raw: unknown, ctx: Ctx): { d: Data; count: number } {
  if (!isObj(raw) || !Array.isArray(raw.tasks)) return { d, count: 0 };
  let out = d;
  let count = 0;
  let order = maxOrder(d);
  for (const t of raw.tasks) {
    if (!isObj(t) || typeof t.id !== 'string') continue;
    const id = `mono-${t.id.slice(0, 64)}`;
    if (get(out, 'tasks', id) || out.tombs.tasks?.[id]) continue;
    const done = t.status === 'completed';
    const est = num(t.estimateMs, 0);
    const deadline = typeof t.deadline === 'number' ? new Date(t.deadline).toISOString().slice(0, 10) : null;
    out = create(
      out,
      'tasks',
      {
        kind: 'task',
        title: str(t.name, 120) || 'Imported task',
        finishCondition: str(t.finishCondition, 500),
        notes: str(t.notes, 5000),
        tagId: null,
        priority: PRIORITY[String(t.priority)] ?? 'should',
        estimateMin: est > 0 ? Math.max(1, Math.round(est / 60_000)) : null,
        deadline,
        dueEventId: null,
        order: ++order,
        status: done ? 'done' : 'queued',
        outcome: done ? 'finished' : null,
        dropCount: num(t.droppedCount),
        parkedAt: null,
        workMs: num(t.workMs),
        breakMs: num(t.breakMs),
        pomodorosCompleted: num(t.pomodorosCompleted),
        startedAt: typeof t.startedAt === 'number' ? t.startedAt : null,
        completedAt: done ? num(t.completedAt, ctx.now) : null,
        timer: defaultTimer(),
        runtime: idleRuntime(),
        checkpointEveryMin: null,
        nextCheckpointMs: null,
      },
      ctx,
      id,
    ).d;
    for (const s of Array.isArray(t.sessions) ? t.sessions : []) {
      if (!isObj(s) || typeof s.startedAt !== 'number' || typeof s.endedAt !== 'number') continue;
      out = create(out, 'sessions', { taskId: id, blockId: null, startedAt: s.startedAt, endedAt: s.endedAt, phase: s.kind === 'break' ? 'break' : 'work', overrunMs: 0 }, ctx, sessionId(id, s.startedAt)).d;
    }
    count++;
  }
  return { d: out, count };
}
