// Cross-screen consistency (Phase 3.7 §1, required by the build brief): a change made on ANY screen,
// with the command that screen issues, must show on EVERY screen model.
//
// Screens: Home (homeModel), Tasks (today/inbox/all/done selectors), Board (boardCards), Focus (focusModel),
// Plan (planQueue + forDay), Overlay pill (pillModel), Palette (SearchIndex), MCP (list_tasks / get_task).
import { describe, expect, it } from 'vitest';
import { apply, type Command } from '../../src/core/commands';
import { boardCards } from '../../src/core/board';
import { Mcp, type StorePort } from '../../src/core/mcp/handlers';
import type { Data } from '../../src/core/model/types';
import { SearchIndex } from '../../src/core/search';
import { all, done, forDay, inbox, today } from '../../src/core/tasks/selectors';
import { focusModel, homeModel, pillModel, planQueue } from '../../src/core/tasks/screens';
import { todayOf } from '../../src/core/tasks/tasks';
import { commandFromParse, parseLine } from '../../src/renderer/palette/fromParse';
import { at, ctx, fresh, MIN, T0, TODAY } from '../helpers';

type Any = Record<string, any>;

/** One store the screens share: commands from any screen and from MCP land in the same Data. */
class World {
  d: Data = fresh();
  now = T0;
  readonly index = new SearchIndex();
  readonly mcp: Mcp;
  constructor() {
    const port: StorePort = {
      data: () => this.d,
      now: () => this.now,
      run: (cmd) => {
        const r = apply(this.d, cmd, ctx(this.now, 'mcp'));
        if (!r.ok) return { ok: false, error: r.error, fields: r.fields };
        this.d = r.d;
        return { ok: true, id: r.id };
      },
    };
    this.mcp = new Mcp(port);
  }
  /** Run a command as a screen would; `after` minutes move the clock first. */
  go(cmd: Command, after = 0): string | undefined {
    this.now += after * MIN;
    const r = apply(this.d, cmd, ctx(this.now));
    if (!r.ok) throw new Error(`${cmd.type}: ${r.error}`);
    this.d = r.d;
    return r.id;
  }
  call(name: string, args: unknown = {}, after = 0): Any {
    this.now += after * MIN;
    const r = this.mcp.call(name, args);
    if (!r.ok) throw new Error(`${name}: ${r.error}`);
    return r.result as Any;
  }
  create(title: string, extra: Record<string, unknown> = {}): string {
    return this.go({ type: 'task.create', input: { title, ...extra } })!;
  }
  views(id: string, projectId: string | null = null) {
    return views(this, id, projectId);
  }
}

/** Every screen's view of one task id, as plain data. */
function views(w: World, id: string, projectId: string | null) {
  const { d, now } = w;
  const t = d.tasks[id]!;
  const has = (list: { id: string }[]) => list.some((x) => x.id === id);
  const home = homeModel(d, now);
  const proj = projectId ? d.projects[projectId] : undefined;
  const cards = proj ? Object.entries(boardCards(d, proj)).find(([, list]) => has(list)) : undefined;
  w.index.update(d);
  const listed = (w.call('list_tasks', { limit: 200 }).tasks as Any[]).find((x) => x.id === id);
  const got = w.call('get_task', { id });
  return {
    record: { status: t.status, completedAt: t.completedAt, outcome: t.outcome, runtime: t.runtime.status },
    home: { active: home.active?.id === id, shelf: has(home.shelf), paused: home.pausedIds.has(id) },
    tasks: { today: has(today(d, now)), inbox: has(inbox(d, now)), all: has(all(d)), done: has(done(d)) },
    board: proj ? { column: cards?.[0] ?? null, status: cards ? t.status : null } : null,
    focus: focusModel(d)?.id === id,
    plan: { queue: has(planQueue(d, now)), day: has(forDay(d, todayOf(d, now))) },
    pill: pillModel(d, now).task?.id === id,
    palette: w.index.search(t.title, { types: ['task'] }).some((h) => h.id === id),
    mcp: { listed: listed?.status ?? null, got: got.status as string, completedAt: got.completedAt as string | null },
  };
}

const OPEN = expect.stringMatching(/^(inbox|planned)$/);

/** What every screen shows for a task in focus. */
const inFocus = (extra: Any = {}): Any => ({
  record: { status: 'doing', completedAt: null, outcome: null },
  home: { active: true, shelf: false },
  tasks: { all: true, done: false },
  focus: true,
  pill: true,
  plan: { queue: true },
  palette: true,
  mcp: { listed: 'doing', got: 'doing', completedAt: null },
  ...extra,
});

/** What every screen shows for an open task that is not in focus. */
const onShelf = (extra: Any = {}): Any => ({
  record: { status: OPEN, completedAt: null, outcome: null },
  home: { active: false, shelf: true },
  tasks: { all: true, done: false },
  focus: false,
  pill: false,
  plan: { queue: true },
  palette: true,
  mcp: { listed: OPEN, got: OPEN, completedAt: null },
  ...extra,
});

/** What every screen shows for a finished task. */
const finished = (extra: Any = {}): Any => ({
  record: { status: 'done', completedAt: expect.any(Number), outcome: 'finished' },
  home: { active: false, shelf: false, paused: false },
  tasks: { today: false, inbox: false, all: false, done: true },
  focus: false,
  pill: false,
  plan: { queue: false, day: false },
  palette: true,
  mcp: { listed: 'done', got: 'done', completedAt: expect.any(String) },
  ...extra,
});

function withProject() {
  const w = new World();
  const projectId = w.go({ type: 'project.create', name: 'Thesis' })!;
  const card = w.create('Write chapter', { projectId, columnId: 'todo' });
  const plain = w.create('Buy stamps');
  return { w, projectId, card, plain };
}

describe('Home', () => {
  it('start (task.start run:true) puts the task in focus everywhere and shelves the one it replaces', () => {
    const { w, projectId, card, plain } = withProject();
    w.go({ type: 'task.start', id: plain, run: true });
    expect(w.views(plain)).toMatchObject(inFocus());
    w.go({ type: 'task.start', id: card, run: true }, 10);
    expect(w.views(card, projectId)).toMatchObject(inFocus({ board: { column: 'doing', status: 'doing' } }));
    expect(w.views(plain)).toMatchObject(onShelf({ home: { paused: true }, record: { runtime: 'paused' } }));
  });

  it('drag to the shelf (task.pause) takes it out of focus everywhere but keeps it as a paused card', () => {
    const { w, projectId, card } = withProject();
    w.go({ type: 'task.start', id: card, run: true });
    w.go({ type: 'task.pause', id: card }, 12);
    expect(w.views(card, projectId)).toMatchObject(onShelf({ home: { paused: true }, board: { column: 'todo' }, record: { runtime: 'paused' } }));
    expect(w.d.tasks[card]!.workMs).toBe(12 * MIN);
  });
});

describe('Tasks', () => {
  it('complete (task.finish) shows done everywhere, clears every list, and the board column follows', () => {
    const { w, projectId, card, plain } = withProject();
    w.go({ type: 'task.finish', id: plain });
    expect(w.views(plain)).toMatchObject(finished());
    w.go({ type: 'task.start', id: card, run: true });
    w.go({ type: 'task.finish', id: card }, 5);
    expect(w.views(card, projectId)).toMatchObject(finished({ board: { column: 'done', status: 'done' } }));
    expect(w.d.tasks[card]!.workMs).toBe(5 * MIN);
  });

  it('quick add (task.create, no date) appears in Tasks today, the Home shelf, palette search and MCP list_tasks', () => {
    const w = new World();
    const id = w.create('Order servos');
    const v = w.views(id);
    expect(v).toMatchObject(onShelf({ tasks: { today: true, inbox: true } }));
    expect(v.mcp.listed).toBe('inbox');
    expect(w.d.tasks[id]!.dueDate).toBeNull();
  });
});

describe('Board', () => {
  it('moveCard into doing puts it in focus everywhere', () => {
    const { w, projectId, card } = withProject();
    w.go({ type: 'task.moveCard', id: card, columnId: 'doing', beforeId: null });
    expect(w.views(card, projectId)).toMatchObject(inFocus({ board: { column: 'doing', status: 'doing' } }));
  });

  it('moveCard into done finishes it everywhere', () => {
    const { w, projectId, card } = withProject();
    w.go({ type: 'task.moveCard', id: card, columnId: 'done', beforeId: null });
    expect(w.views(card, projectId)).toMatchObject(finished({ board: { column: 'done', status: 'done' } }));
  });

  it('Done -> Doing -> To do leaves no stale done state anywhere', () => {
    const { w, projectId, card } = withProject();
    w.go({ type: 'task.moveCard', id: card, columnId: 'done', beforeId: null });
    expect(w.views(card, projectId).tasks.done).toBe(true);

    w.go({ type: 'task.moveCard', id: card, columnId: 'doing', beforeId: null }, 1);
    const doing = w.views(card, projectId);
    expect(doing).toMatchObject(inFocus({ board: { column: 'doing', status: 'doing' } }));
    expect(doing.tasks.done).toBe(false);
    expect(w.d.tasks[card]).toMatchObject({ completedAt: null, outcome: null });

    w.go({ type: 'task.moveCard', id: card, columnId: 'todo', beforeId: null }, 1);
    const back = w.views(card, projectId);
    expect(back).toMatchObject(onShelf({ board: { column: 'todo' } }));
    expect(back.tasks.done).toBe(false);
    expect(back.tasks.all).toBe(true);
    expect(back.record.completedAt).toBeNull();
    expect(back.record.outcome).toBeNull();
    expect(back.mcp.completedAt).toBeNull();
    expect(back.focus).toBe(false);
    expect(back.pill).toBe(false);
    expect(done(w.d)).toEqual([]);
    expect(all(w.d).map((t) => t.id)).toContain(card);
  });
});

describe('Focus', () => {
  it('finish (task.finish) shows done everywhere and nothing is promoted into focus', () => {
    const { w, projectId, card, plain } = withProject();
    w.go({ type: 'task.start', id: card, run: true });
    w.go({ type: 'task.finish', id: card }, 3);
    expect(w.views(card, projectId)).toMatchObject(finished({ board: { column: 'done' } }));
    expect(focusModel(w.d)).toBeUndefined();
    expect(w.views(plain).focus).toBe(false);
    expect(w.views(plain).home.shelf).toBe(true);
  });

  it('drop (task.drop with a reason) parks the task: out of focus, still open and listed everywhere', () => {
    const { w, projectId, card } = withProject();
    w.go({ type: 'task.start', id: card, run: true });
    w.go({ type: 'task.drop', id: card, reason: 'not today' }, 4);
    const v = w.views(card, projectId);
    expect(v).toMatchObject(onShelf({ board: { column: 'todo' }, home: { paused: true } }));
    expect(w.d.tasks[card]!.parkedAt).not.toBeNull();
    expect(w.d.tasks[card]!.workMs).toBe(4 * MIN);
  });
});

describe('Plan', () => {
  it('block.create for a task today lists it in forDay and the Tasks today selector', () => {
    const w = new World();
    // created yesterday with a later due date, so only the block puts it on today
    w.now = at(9 * 60, '2026-10-25');
    const id = w.create('Read paper', { dueDate: '2026-11-05' });
    w.now = T0;
    expect(w.views(id).tasks.today).toBe(false);
    expect(w.views(id).plan.day).toBe(false);
    w.go({ type: 'block.create', taskId: id, date: TODAY, startMin: 600, endMin: 660 });
    const v = w.views(id);
    expect(v.plan).toEqual({ queue: true, day: true });
    expect(v.tasks.today).toBe(true);
    expect(v.tasks.inbox).toBe(false);
    expect(v.record.status).toBe('planned');
    expect(v.mcp.listed).toBe('planned');
    expect(v.palette).toBe(true);
    expect((w.call('get_task', { id }).blocks as Any[])).toHaveLength(1);
  });
});

describe('Overlay pill', () => {
  it('toggling the timer (pause / resume) keeps the task active on every screen', () => {
    const { w, projectId, card } = withProject();
    w.go({ type: 'task.start', id: card, run: true });
    w.go({ type: 'timer', action: 'pause' }, 6);
    expect(w.views(card, projectId)).toMatchObject(inFocus({ record: { runtime: 'paused' }, board: { column: 'doing' } }));
    w.go({ type: 'timer', action: 'resume' }, 2);
    expect(w.views(card, projectId)).toMatchObject(inFocus({ record: { runtime: 'running' }, board: { column: 'doing' } }));
    expect(w.d.tasks[card]!.workMs).toBe(6 * MIN);
  });
});

describe('Palette', () => {
  it('add "essay draft !1 @school" (quick) makes a must-priority task with the school label, visible everywhere', () => {
    const w = new World();
    const r = parseLine('essay draft !1 @school', w.d, w.now, 'user', 'quick');
    const cmd = commandFromParse(r, w.d, w.now, false, true)!;
    expect(cmd.type).toBe('task.create');
    const id = w.go(cmd)!;
    expect(w.d.tasks[id]).toMatchObject({ priority: 'must', labels: ['school'] });
    expect(w.d.tasks[id]!.title).toBe('essay draft');
    expect(w.views(id)).toMatchObject(onShelf());
    expect(w.call('get_task', { id }).labels).toEqual(['school']);
  });
});

describe('MCP', () => {
  it('start_task / pause_task / complete_task show on every screen', () => {
    const { w, projectId, card, plain } = withProject();
    w.call('start_task', { id: card, run: true });
    expect(w.views(card, projectId)).toMatchObject(inFocus({ board: { column: 'doing', status: 'doing' } }));

    w.call('start_task', { id: plain }, 5);
    expect(w.views(plain)).toMatchObject(inFocus());
    expect(w.views(card, projectId)).toMatchObject(onShelf({ board: { column: 'todo' }, home: { paused: true } }));

    w.call('pause_task', { id: plain }, 1);
    expect(w.views(plain)).toMatchObject(onShelf());
    expect(focusModel(w.d)).toBeUndefined();

    w.call('complete_task', { id: card }, 1);
    expect(w.views(card, projectId)).toMatchObject(finished({ board: { column: 'done', status: 'done' } }));
  });
});
