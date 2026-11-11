// Loading untrusted JSON into Data: the schema migration entry point and the
// one-off import of a Monolith data file. migrate() is pure, lossless and
// idempotent: a v1 file becomes v2 (fields renamed are moved, never dropped), a
// v2 file only gets missing defaults filled. Monolith import ids are
// deterministic ('mono-<id>'), so importing the same file twice changes nothing.

import { defaultActiveTimer, defaultSettings, defaultTimer, emptyData, idleRuntime } from '../model/defaults';
import { sessionId } from '../model/ids';
import { keysFor } from '../model/sortKey';
import { COLLS, SCHEMA_V, type Data, type Priority, type Settings, type TaskStatus } from '../model/types';
import { isObj } from '../validation';
import { maxOrder } from '../tasks/tasks';
import { create, get, type Ctx } from './repo';

type Obj = Record<string, unknown>;

/** Deep-fill plain-object defaults (arrays and scalars are taken as stored). */
function fill<T>(def: T, raw: unknown): T {
  if (!isObj(def) || !isObj(raw)) return (raw === undefined || (isObj(def) && !isObj(raw)) ? def : raw) as T;
  const out: Record<string, unknown> = { ...raw };
  for (const [k, v] of Object.entries(def)) out[k] = fill(v, raw[k]);
  // A default of null (e.g. customTheme) keeps whatever was stored.
  return out as T;
}

const records = (raw: Obj, c: string): Obj[] => (isObj(raw[c]) ? Object.values(raw[c] as Obj).filter(isObj) : []);

/** v1 -> v2, one record at a time. Unknown v1 fields are kept as they are. */
function upgradeV1(raw: Obj, today: string | null): Obj {
  const out: Obj = { ...raw, schema: 2 };
  const liveBlocks = records(raw, 'blocks').filter((b) => b.deletedAt === null || b.deletedAt === undefined);
  const hasFutureBlock = (taskId: string) => liveBlocks.some((b) => b.taskId === taskId && (today === null || (typeof b.date === 'string' && b.date >= today)));
  const tasks = records(raw, 'tasks').sort((a, b) => Number(a.order ?? 0) - Number(b.order ?? 0));
  const keys = keysFor(tasks.length);
  const nextTasks: Obj = {};
  tasks.forEach((t, i) => {
    const { deadline, ...rest } = t;
    const status: TaskStatus = t.status === 'active' ? 'doing' : t.status === 'done' ? 'done' : hasFutureBlock(String(t.id)) ? 'planned' : 'inbox';
    nextTasks[String(t.id)] = {
      ...rest,
      status,
      dueDate: typeof deadline === 'string' ? deadline : null,
      dueTime: null,
      projectId: null,
      columnId: null,
      recurrence: null,
      recurrenceParentId: null,
      source: String(t.id).startsWith('mono-') ? 'import' : 'typed',
      sortKey: keys[i],
    };
  });
  out.tasks = nextTasks;
  out.eventExceptions = Object.fromEntries(
    records(raw, 'eventExceptions').map((x) => {
      const move = x.kind === 'move';
      return [String(x.id), { ...x, kind: move ? 'edit' : 'skip', title: null, startMin: move && typeof x.startMin === 'number' ? x.startMin : null, endMin: move && typeof x.endMin === 'number' ? x.endMin : null, tagId: null }];
    }),
  );
  out.blocks = Object.fromEntries(records(raw, 'blocks').map((b) => [String(b.id), { ...b, auto: false }]));
  out.ideas = Object.fromEntries(records(raw, 'ideas').map((n) => [String(n.id), { ...n, body: typeof n.text === 'string' ? n.text : '', parsedTaskIds: [] }]));
  return out;
}

/** Every record gets the v2 base fields (per-field version maps) and the current schema version. */
function withBase(rec: Obj): Obj {
  return { ...rec, v: typeof rec.v === 'number' && rec.v > SCHEMA_V ? rec.v : SCHEMA_V, fv: isObj(rec.fv) ? rec.fv : {}, fw: isObj(rec.fw) ? rec.fw : {} };
}

/**
 * Untrusted file -> Data (v2), or null if it is not a Chronos file. `today` (local
 * date) decides inbox vs planned for v1 tasks; normalize() keeps it right afterwards.
 */
export function migrate(input: unknown, today: string | null = null): Data | null {
  if (!isObj(input) || (input.schema !== 1 && input.schema !== 2)) return null;
  const raw = input.schema === 1 ? upgradeV1(input, today) : input;
  const d = emptyData();
  for (const c of COLLS) {
    if (!isObj(raw[c])) continue;
    const recs: Obj = {};
    for (const [id, r] of Object.entries(raw[c] as Obj)) if (isObj(r)) recs[id] = withBase(r);
    (d as Record<string, unknown>)[c] = recs;
  }
  d.settings = { main: withBase(fill<Settings>(defaultSettings(), (raw.settings as Obj | undefined)?.main) as unknown as Obj) as unknown as Settings };
  d.timer = { current: withBase(fill(defaultActiveTimer(), (raw.timer as Obj | undefined)?.current) as unknown as Obj) as unknown as Data['timer'][string] };
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
  const keys = keysFor(raw.tasks.length).map((k) => `z${k}`);
  for (const [i, t] of raw.tasks.entries()) {
    if (!isObj(t) || typeof t.id !== 'string') continue;
    const id = `mono-${t.id.slice(0, 64)}`;
    if (get(out, 'tasks', id) || out.tombs.tasks?.[id]) continue;
    const done = t.status === 'completed';
    const est = num(t.estimateMs, 0);
    const dueDate = typeof t.deadline === 'number' ? new Date(t.deadline).toISOString().slice(0, 10) : null;
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
        estimateMin: est > 0 ? Math.min(1440, Math.max(1, Math.round(est / 60_000))) : null,
        dueDate,
        dueTime: null,
        dueEventId: null,
        projectId: null,
        columnId: null,
        recurrence: null,
        recurrenceParentId: null,
        source: 'import',
        order: ++order,
        sortKey: keys[i] as string,
        status: done ? 'done' : 'inbox',
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
