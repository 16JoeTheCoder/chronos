// Tasks (Phase 3.7 §3): the main task surface. Views Inbox / Today / Upcoming / All (G I, G T,
// G U, G A), a project switch in the header, List or Board. Every list comes from
// core/tasks/selectors and every change is a command, so Home, Focus, Plan and Board show it at once.
//
// Rows: click the title to rename, E opens the editor, Del deletes (Undo), Ctrl+Enter completes
// (Undo), S starts it, Up/Down move, Shift-click selects a range, Ctrl-click adds one. Drag a row
// to reorder: rows never move while dragging, a line shows where it lands (task.sort).

import { lazy, Suspense, useEffect, useMemo, useRef, useState, type CSSProperties, type KeyboardEvent, type ComponentType } from 'react';
import type { Data, Project, Task } from '../../core/model/types';
import { live } from '../../core/repo/repo';
import { all, byProject, done, inbox, today as todaySel, upcoming } from '../../core/tasks/selectors';
import { todayOf } from '../../core/tasks/tasks';
import { boardCards, doingColumnId, doneColumnId } from '../../core/board';
import { Icon } from '../components/Icon';
import { recycleWithUndo } from '../components/actions';
import { beginDrag, registerTarget, useDrag } from '../components/drag';
import { commandFromParse, chipsOf, parseLine } from '../palette/fromParse';
import { describeError, run, toast } from '../store';
import { DEFAULT_DUR } from '../runway/model';
import { dueLabel, PrioFlag, TaskMeta } from './bits';
import './tasks.css';

export type TaskView = 'inbox' | 'today' | 'upcoming' | 'all';
export const VIEWS: { id: TaskView; label: string; key: string; icon: 'inbox' | 'sun' | 'calendar' | 'layers' }[] = [
  { id: 'inbox', label: 'Inbox', key: 'I', icon: 'inbox' },
  { id: 'today', label: 'Today', key: 'T', icon: 'sun' },
  { id: 'upcoming', label: 'Upcoming', key: 'U', icon: 'calendar' },
  { id: 'all', label: 'All', key: 'A', icon: 'layers' },
];

const boards = import.meta.glob('../board/Board.tsx');
type BoardP = { projectId?: string | null; onOpenLog?: (projectId: string) => void; onEnterFocus?: (taskId: string) => void; onOpenTask?: (taskId: string) => void };
const LazyBoard = lazy(() => (boards['../board/Board.tsx'] ? (boards['../board/Board.tsx']() as Promise<{ Board: ComponentType<BoardP> }>).then((m) => ({ default: m.Board })) : Promise.resolve({ default: (_p: BoardP) => null })));

type Mode = 'list' | 'board';
const MODE_KEY = 'chronos.tasks.mode';
const loadMode = (): Mode => { try { return localStorage.getItem(MODE_KEY) === 'board' ? 'board' : 'list'; } catch { return 'list'; } };

interface Group { key: string; title: string | null; late?: boolean; tasks: Task[]; /** Drop into this group sets this (task.sort). */ into?: { dueDate?: string | null; columnId?: string } }

export interface TasksProps {
  d: Data;
  now: number;
  view: TaskView;
  onView: (v: TaskView) => void;
  projectId: string | null;
  onProject: (id: string | null) => void;
  onEdit: (t: Task | null) => void;
  onOpenLog?: (projectId: string) => void;
  onFocus?: () => void;
}

export function Tasks({ d, now, view, onView, projectId, onProject, onEdit, onOpenLog, onFocus }: TasksProps) {
  const today = todayOf(d, now);
  const projects = live(d, 'projects').filter((p) => !p.archived).sort((a, b) => (a.sortKey < b.sortKey ? -1 : 1));
  const project = projectId ? projects.find((p) => p.id === projectId) : undefined;
  const [mode, setModeState] = useState<Mode>(loadMode);
  const setMode = (m: Mode) => { setModeState(m); try { localStorage.setItem(MODE_KEY, m); } catch { /* per-viewer convenience */ } };
  const [showDone, setShowDone] = useState(false);

  const groups = useMemo<Group[]>(() => {
    if (project) {
      const list = byProject(d, project.id);
      const cards = boardCards(d, project);
      const doneCol = doneColumnId(project.columns);
      return project.columns
        .filter((c) => c.id !== doneCol)
        .map((c) => ({ key: c.id, title: c.name, tasks: (cards[c.id] ?? []).filter((t) => t.status !== 'done' && list.includes(t)), into: { columnId: c.id } }));
    }
    if (view === 'inbox') return [{ key: 'inbox', title: null, tasks: inbox(d, now), into: { dueDate: null } }];
    if (view === 'today') {
      const list = todaySel(d, now);
      const late = list.filter((t) => t.dueDate !== null && t.dueDate < today);
      const rest = list.filter((t) => !late.includes(t));
      return [...(late.length ? [{ key: 'late', title: 'Overdue', late: true, tasks: late }] : []), { key: 'today', title: late.length ? 'Today' : null, tasks: rest, into: { dueDate: today } }];
    }
    if (view === 'upcoming') return upcoming(d, now).map((g) => ({ key: g.overdue ? 'late' : g.date, title: g.overdue ? 'Overdue' : dueLabel(g.date, today), late: g.overdue, tasks: g.tasks, ...(g.overdue ? {} : { into: { dueDate: g.date } }) }));
    return [{ key: 'all', title: null, tasks: all(d) }];
  }, [d, now, view, project, today]);

  const doneList = useMemo(() => {
    const list = done(d);
    if (project) return list.filter((t) => t.projectId === project.id);
    if (view === 'today') return list.filter((t) => t.completedAt !== null && todayOf(d, t.completedAt) === today);
    if (view === 'inbox') return list.filter((t) => !t.projectId && !t.dueDate);
    return list;
  }, [d, view, project, today]);

  const title = project ? project.name : VIEWS.find((v) => v.id === view)!.label;
  const openCount = groups.reduce((n, g) => n + g.tasks.length, 0);
  const defaults: { projectId?: string; dueDate?: string } = project ? { projectId: project.id } : view === 'upcoming' ? {} : {};

  return (
    <div className="tk" data-view={project ? 'project' : view}>
      <header className="tk-head">
        <nav className="tk-views" aria-label="Task views">
          {VIEWS.map((v) => (
            <button key={v.id} type="button" className="tk-view" aria-current={!project && view === v.id ? 'page' : undefined} onClick={() => { onProject(null); onView(v.id); }} aria-keyshortcuts={`G ${v.key}`} title={`${v.label} (G then ${v.key})`}>
              <Icon name={v.icon} size={15} />
              <span>{v.label}</span>
            </button>
          ))}
          <span className="tk-views-gap" />
          <ProjectSwitch projects={projects} current={project ?? null} d={d} onPick={(id) => onProject(id)} />
        </nav>
        <div className="tk-title-row">
          <h1 className="tk-title">{title}</h1>
          <span className="tk-count">{openCount > 0 ? `${openCount} open` : ''}</span>
          <span className="tk-views-gap" />
          {project && onOpenLog && <button type="button" className="btn btn-ghost btn-s" onClick={() => onOpenLog(project.id)}><Icon name="log" size={14} /> Project log</button>}
          <div className="tk-mode" role="group" aria-label="Layout">
            <button type="button" aria-pressed={mode === 'list'} onClick={() => setMode('list')}><Icon name="list" size={14} /> List</button>
            <button type="button" aria-pressed={mode === 'board'} onClick={() => setMode('board')}><Icon name="board" size={14} /> Board</button>
          </div>
        </div>
      </header>

      {mode === 'board' && project ? (
        <Suspense fallback={null}>
          <div className="tk-board"><LazyBoard projectId={project.id} onOpenLog={onOpenLog} onEnterFocus={onFocus} onOpenTask={(id) => { const t = d.tasks[id]; if (t) onEdit(t); }} /></div>
        </Suspense>
      ) : mode === 'board' ? (
        <StatusBoard d={d} groups={groups} doneList={doneList} today={today} onEdit={onEdit} />
      ) : (
        <>
          <QuickAdd d={d} now={now} defaults={defaults} placeholder={project ? `Add a task to ${project.name}` : view === 'inbox' ? 'Add a task to the Inbox' : 'Add a task, like "essay draft fri 4pm !1 @school"'} />
          <TaskList d={d} groups={groups} today={today} project={project ?? null} onEdit={onEdit} empty={emptyText(view, project)} />
          {doneList.length > 0 && (
            <section className="tk-done" aria-label="Done">
              <button type="button" className="tk-done-toggle" aria-expanded={showDone} onClick={() => setShowDone((v) => !v)}>
                <Icon name="chevronDown" size={14} /> Done <span className="tk-count">{doneList.length}</span>
              </button>
              {showDone && (
                <ul className="tk-list">
                  {doneList.map((t) => <DoneRow key={t.id} d={d} t={t} today={today} />)}
                </ul>
              )}
            </section>
          )}
        </>
      )}
    </div>
  );
}

const emptyText = (view: TaskView, p: Project | undefined): { title: string; body: string } =>
  p
    ? { title: `Nothing open in ${p.name}`, body: 'Add a task above. Board shows the same tasks as columns.' }
    : view === 'inbox'
      ? { title: 'Inbox is clear', body: 'Tasks with no date and no project land here.' }
      : view === 'today'
        ? { title: 'Nothing due today', body: 'Add one above, or press Ctrl+K anywhere.' }
        : view === 'upcoming'
          ? { title: 'Nothing due in the next two weeks', body: 'Give a task a date, like "fri" or "next mon", and it shows here.' }
          : { title: 'No open tasks', body: 'Add one above, or press Ctrl+K anywhere.' };

/** The header's project switch: All tasks or one project, with search and New project. */
function ProjectSwitch({ projects, current, d, onPick }: { projects: Project[]; current: Project | null; d: Data; onPick: (id: string | null) => void }) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState('');
  const [name, setName] = useState<string | null>(null);
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    setQ('');
    const away = (e: PointerEvent) => { if (!box.current?.contains(e.target as Node)) setOpen(false); };
    window.addEventListener('pointerdown', away);
    return () => window.removeEventListener('pointerdown', away);
  }, [open]);
  const shown = projects.filter((p) => !q.trim() || p.name.toLowerCase().includes(q.trim().toLowerCase()));
  const count = (p: Project) => byProject(d, p.id).filter((t) => t.status !== 'done').length;
  const pick = (id: string | null) => { onPick(id); setOpen(false); };
  async function create() {
    const n = (name ?? '').trim();
    if (!n) return;
    const r = await run({ type: 'project.create', name: n });
    if (r.ok && r.id) { toast(`Project ${n} created.`); setName(null); pick(r.id); }
  }
  return (
    <div className="tk-switch" ref={box}>
      <button type="button" className="tk-switch-btn" aria-haspopup="dialog" aria-expanded={open} onClick={() => setOpen(!open)}>
        {current && <span className="tk-dot" style={{ '--sw': `var(--${current.color})` } as CSSProperties} aria-hidden="true" />}
        <span>{current ? current.name : 'Projects'}</span>
        <Icon name="chevronDown" size={14} />
      </button>
      {open && (
        <div className="tk-drop" role="dialog" aria-label="Switch project">
          <input autoFocus className="tk-input" placeholder="Find a project" aria-label="Find a project" value={q} onChange={(e) => setQ(e.target.value)} onKeyDown={(e) => {
            if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); setOpen(false); }
            else if (e.key === 'Enter' && shown[0]) { e.preventDefault(); pick(shown[0].id); }
          }} />
          <ul className="tk-drop-list">
            {current && <li><button type="button" onClick={() => pick(null)}>All tasks</button></li>}
            {shown.map((p) => (
              <li key={p.id}>
                <button type="button" aria-current={current?.id === p.id ? 'true' : undefined} onClick={() => pick(p.id)}>
                  <span className="tk-dot" style={{ '--sw': `var(--${p.color})` } as CSSProperties} aria-hidden="true" />
                  <span className="tk-drop-name">{p.name}</span>
                  <span className="tk-count">{count(p)}</span>
                </button>
              </li>
            ))}
            {!shown.length && <li className="tk-drop-empty">No project matches</li>}
          </ul>
          {name === null ? (
            <button type="button" className="tk-drop-new" onClick={() => setName(q)}><Icon name="plus" size={14} /> New project</button>
          ) : (
            <form className="tk-drop-form" onSubmit={(e) => { e.preventDefault(); void create(); }}>
              <input autoFocus className="tk-input" placeholder="Project name" aria-label="Project name" maxLength={80} value={name} onChange={(e) => setName(e.target.value)} onKeyDown={(e) => { if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); setName(null); } }} />
              <button type="submit" className="btn btn-s" disabled={!name.trim()}>Create</button>
            </form>
          )}
        </div>
      )}
    </div>
  );
}

/** One line in, one task out, with the parse shown as chips. The view's project applies when the text names none. */
function QuickAdd({ d, now, defaults, placeholder }: { d: Data; now: number; defaults: { projectId?: string; dueDate?: string }; placeholder: string }) {
  const [text, setText] = useState('');
  const t = text.trim();
  const parsed = t ? parseLine(t, d, now) : null;
  const chips = parsed ? chipsOf(parsed, d).filter((c) => c.key !== 'kind') : [];
  async function add() {
    if (!parsed) return;
    const cmd = commandFromParse({ ...parsed, kind: parsed.kind === 'fixed' ? 'task' : parsed.kind }, d, now, true, true);
    if (!cmd || cmd.type !== 'task.create') return;
    const input = { ...cmd.input, projectId: cmd.input.projectId ?? defaults.projectId ?? null, dueDate: cmd.input.dueDate ?? defaults.dueDate ?? null };
    const r = await run({ type: 'task.create', input });
    if (r.ok) {
      setText('');
      // Say where it went when the current view will not show it (e.g. a dated task added from Today).
      const today = todayOf(d, now);
      if (input.dueDate && input.dueDate > today) toast(`Added to Upcoming · ${dueLabel(input.dueDate, today)}`);
      else if (input.projectId && !defaults.projectId) toast(`Added to ${d.projects[input.projectId]?.name ?? 'the project'}`);
    }
    else toast(describeError(cmd, r.ok ? '' : r.error), { error: true });
  }
  return (
    <form className="tk-add" onSubmit={(e) => { e.preventDefault(); void add(); }}>
      <Icon name="plus" size={16} />
      <input className="tk-add-input" value={text} maxLength={300} placeholder={placeholder} aria-label="Add a task" onChange={(e) => setText(e.target.value)} onKeyDown={(e) => { if (e.key === 'Escape' && text) { e.preventDefault(); e.stopPropagation(); setText(''); } }} />
      {chips.length > 0 && <span className="tk-add-chips" aria-label="How Chronos reads it">{chips.map((c) => <b key={c.key}>{c.label}</b>)}</span>}
      {t && <button type="submit" className="btn btn-s">Add</button>}
    </form>
  );
}

interface Spot { group: string; afterId: string | null; beforeId: string | null; index: number }

function TaskList({ d, groups, today, project, onEdit, empty }: { d: Data; groups: Group[]; today: string; project: Project | null; onEdit: (t: Task) => void; empty: { title: string; body: string } }) {
  const box = useRef<HTMLDivElement>(null);
  const [sel, setSel] = useState<Set<string>>(new Set());
  const anchor = useRef<string | null>(null);
  const flat = groups.flatMap((g) => g.tasks);
  const drag = useDrag();
  const spot = drag?.target === 'tasklist' ? (drag.preview as Spot | null) : null;
  // Keep the selection to rows that still exist.
  useEffect(() => { setSel((s) => { const ids = new Set(flat.map((t) => t.id)); const n = new Set([...s].filter((x) => ids.has(x))); return n.size === s.size ? s : n; }); }, [d]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(
    () =>
      registerTarget('tasklist', {
        el: () => box.current,
        accepts: (it) => it.kind === 'task',
        over: (it, _x, y) => spotAt(box.current, groups, y, it.kind === 'task' ? it.taskId : ''),
        drop: (it, pv) => {
          const s = pv as Spot | null;
          if (it.kind !== 'task' || !s) return;
          const g = groups.find((x) => x.key === s.group);
          const t = d.tasks[it.taskId];
          if (!t || !g) return;
          const prev = { afterId: neighbourBefore(flat, t.id), beforeId: neighbourAfter(flat, t.id), dueDate: t.dueDate, columnId: t.columnId };
          if (s.afterId === prev.afterId && s.beforeId === prev.beforeId && !(g.into && ((g.into.dueDate !== undefined && g.into.dueDate !== t.dueDate) || (g.into.columnId !== undefined && g.into.columnId !== t.columnId)))) return;
          const into = g.into ?? {};
          void run({ type: 'task.sort', id: t.id, afterId: s.afterId, beforeId: s.beforeId, ...into }).then((r) => {
            if (r.ok) toast('Moved.', { undo: () => void run({ type: 'task.sort', id: t.id, afterId: prev.afterId, beforeId: prev.beforeId, ...(into.dueDate !== undefined ? { dueDate: prev.dueDate } : {}), ...(into.columnId !== undefined && prev.columnId ? { columnId: prev.columnId } : {}) }) });
          });
        },
      }),
    [d, groups, flat],
  );

  const selected = (id: string) => sel.has(id);
  const click = (t: Task, e: React.MouseEvent) => {
    if (e.shiftKey && anchor.current) {
      const a = flat.findIndex((x) => x.id === anchor.current);
      const b = flat.findIndex((x) => x.id === t.id);
      const [lo, hi] = a < b ? [a, b] : [b, a];
      setSel(new Set(flat.slice(lo, hi + 1).map((x) => x.id)));
      return true;
    }
    if (e.ctrlKey || e.metaKey) {
      setSel((s) => { const n = new Set(s); if (n.has(t.id)) n.delete(t.id); else n.add(t.id); return n; });
      anchor.current = t.id;
      return true;
    }
    anchor.current = t.id;
    if (sel.size) setSel(new Set());
    return false;
  };
  const targets = (t: Task): Task[] => (sel.has(t.id) && sel.size > 1 ? flat.filter((x) => sel.has(x.id)) : [t]);

  const complete = async (list: Task[]) => {
    const okIds: string[] = [];
    for (const t of list) { const r = await run({ type: 'task.finish', id: t.id }); if (r.ok) okIds.push(t.id); }
    if (okIds.length) toast(okIds.length === 1 ? `${list[0]!.title} done.` : `${okIds.length} tasks done.`, { undo: () => void Promise.all(okIds.map((id) => run({ type: 'task.reopen', id }))) });
    setSel(new Set());
  };
  const remove = async (list: Task[]) => {
    if (list.length === 1) { await recycleWithUndo('tasks', list[0]!.id, list[0]!.title); return; }
    const okIds: string[] = [];
    for (const t of list) { const r = await run({ type: 'recycle', coll: 'tasks', id: t.id, confirmed: true }); if (r.ok) okIds.push(t.id); }
    if (okIds.length) toast(`${okIds.length} tasks deleted.`, { undo: () => void Promise.all(okIds.map((id) => run({ type: 'restore', coll: 'tasks', id }))) });
    setSel(new Set());
  };
  const moveFocus = (id: string, dir: 1 | -1) => {
    const i = flat.findIndex((x) => x.id === id);
    const next = flat[i + dir];
    if (next) box.current?.querySelector<HTMLElement>(`[data-task="${next.id}"]`)?.focus();
  };

  if (!flat.length && groups.every((g) => !g.title)) {
    return (
      <div className="tk-empty">
        <h2>{empty.title}</h2>
        <p>{empty.body}</p>
      </div>
    );
  }

  let index = 0;
  return (
    <div className="tk-lists" ref={box}>
      {sel.size > 1 && (
        <div className="tk-selbar" role="toolbar" aria-label="Selected tasks">
          <span>{sel.size} selected</span>
          <button type="button" className="btn btn-s" onClick={() => void complete(flat.filter((x) => sel.has(x.id)))}><Icon name="check" size={14} /> Complete <kbd>Ctrl Enter</kbd></button>
          <button type="button" className="btn btn-ghost btn-s" onClick={() => void remove(flat.filter((x) => sel.has(x.id)))}><Icon name="trash" size={14} /> Delete <kbd>Del</kbd></button>
          <button type="button" className="btn btn-ghost btn-s" onClick={() => setSel(new Set())}>Clear</button>
        </div>
      )}
      {groups.map((g) => (
        <section key={g.key} className={`tk-group${g.late ? ' is-late' : ''}`} data-group={g.key} aria-label={g.title ?? undefined}>
          {g.title && <h2 className="tk-group-title">{g.title}{g.tasks.length > 0 && <span className="tk-count">{g.tasks.length}</span>}</h2>}
          <ul className="tk-list">
            {g.tasks.map((t) => {
              const i = index++;
              const line = spot && spot.group === g.key && spot.index === i;
              return (
                <Row key={t.id} d={d} t={t} today={today} project={project} selected={selected(t.id)} lineBefore={!!line} dragging={drag?.item.kind === 'task' && drag.item.taskId === t.id}
                  onClick={click} onEdit={onEdit} onComplete={() => void complete(targets(t))} onDelete={() => void remove(targets(t))} onMove={(dir) => moveFocus(t.id, dir)} />
              );
            })}
            {spot && spot.group === g.key && spot.index === index && <li className="tk-line" aria-hidden="true" />}
            {g.title && g.tasks.length === 0 && !(spot && spot.group === g.key) && <li className="tk-group-empty">{g.into?.dueDate ? 'Nothing due' : 'Empty'}</li>}
          </ul>
        </section>
      ))}
    </div>
  );
}

const neighbourBefore = (flat: Task[], id: string) => { const i = flat.findIndex((x) => x.id === id); return flat[i - 1]?.id ?? null; };
const neighbourAfter = (flat: Task[], id: string) => { const i = flat.findIndex((x) => x.id === id); return flat[i + 1]?.id ?? null; };

/** Where a drop at height y lands: the group under the pointer and the gap between two rows. */
function spotAt(root: HTMLElement | null, groups: Group[], y: number, dragId: string): Spot | null {
  if (!root) return null;
  let index = 0;
  let best: Spot | null = null;
  for (const g of groups) {
    const sec = root.querySelector<HTMLElement>(`[data-group="${g.key}"]`);
    const r = sec?.getBoundingClientRect();
    const start = index;
    index += g.tasks.length;
    if (!r || y < r.top - 4 || y > r.bottom + 4) continue;
    if (!g.into && g.key === 'late') return null; // nothing can be dropped into "overdue"
    const rows = g.tasks.map((t) => root.querySelector<HTMLElement>(`[data-task="${t.id}"]`)?.getBoundingClientRect());
    let k = rows.findIndex((rr) => rr && y < rr.top + rr.height / 2);
    if (k < 0) k = g.tasks.length;
    const others = g.tasks.filter((t) => t.id !== dragId);
    const before = g.tasks[k];
    const beforeOther = before && before.id === dragId ? g.tasks[k + 1] : before;
    const afterRaw = g.tasks[k - 1];
    const after = afterRaw && afterRaw.id === dragId ? g.tasks[k - 2] : afterRaw;
    best = { group: g.key, afterId: after?.id ?? null, beforeId: beforeOther?.id ?? (others.length ? null : null), index: start + k };
  }
  return best;
}

function Row({ d, t, today, project, selected, lineBefore, dragging, onClick, onEdit, onComplete, onDelete, onMove }: {
  d: Data; t: Task; today: string; project: Project | null; selected: boolean; lineBefore: boolean; dragging: boolean;
  onClick: (t: Task, e: React.MouseEvent) => boolean; onEdit: (t: Task) => void; onComplete: () => void; onDelete: () => void; onMove: (dir: 1 | -1) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [title, setTitle] = useState(t.title);
  useEffect(() => { if (!editing) setTitle(t.title); }, [t.title, editing]);
  const active = t.status === 'doing';
  const save = async () => {
    const v = title.trim();
    setEditing(false);
    if (v && v !== t.title) await run({ type: 'task.update', id: t.id, input: { title: v } });
  };
  const keys = (e: KeyboardEvent) => {
    if (editing || e.target !== e.currentTarget) return;
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') { e.preventDefault(); onMove(e.key === 'ArrowDown' ? 1 : -1); }
    else if (e.key === 'Enter' && e.ctrlKey) { e.preventDefault(); onComplete(); }
    else if (e.key === 'Enter') { e.preventDefault(); setEditing(true); }
    else if (e.key === 'e' || e.key === 'E') { e.preventDefault(); onEdit(t); }
    else if (e.key === 'Delete' || e.key === 'Backspace') { e.preventDefault(); onDelete(); }
    else if (e.key === 's' || e.key === 'S') { e.preventDefault(); void run({ type: 'task.start', id: t.id, run: true }); }
  };
  return (
    <>
      {lineBefore && <li className="tk-line" aria-hidden="true" />}
      <li
        className={`tk-row${selected ? ' is-sel' : ''}${active ? ' is-active' : ''}${dragging ? ' is-drag' : ''}`}
        data-task={t.id}
        tabIndex={0}
        aria-selected={selected}
        aria-label={`${t.title}${active ? ', in focus' : ''}. Enter renames, E edits, S starts, Ctrl Enter completes, Delete deletes.`}
        onKeyDown={keys}
        onPointerDown={(e) => {
          if (editing || (e.target as HTMLElement).closest('button, input')) return;
          if (e.shiftKey || e.ctrlKey || e.metaKey) return;
          beginDrag(e, { kind: 'task', taskId: t.id, title: t.title, dur: t.estimateMin ?? DEFAULT_DUR });
        }}
        onClick={(e) => { if (!(e.target as HTMLElement).closest('button, input')) onClick(t, e); }}
      >
        <button type="button" className={`tk-check prio-${t.priority}`} aria-label={`Complete ${t.title}`} onClick={onComplete}>
          <Icon name="check" size={12} />
        </button>
        <div className="tk-body">
          {editing ? (
            <input className="tk-edit" autoFocus value={title} maxLength={120} aria-label="Task title" onChange={(e) => setTitle(e.target.value)} onBlur={() => void save()} onKeyDown={(e) => {
              if (e.key === 'Enter') { e.preventDefault(); void save(); }
              else if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); setTitle(t.title); setEditing(false); }
            }} />
          ) : (
            <span className="tk-name" onClick={(e) => { if (!e.shiftKey && !e.ctrlKey && !e.metaKey) setEditing(true); }}>{t.title}</span>
          )}
          <TaskMeta d={d} t={t} today={today} hideProject={!!project} />
        </div>
        <PrioFlag p={t.priority} />
        {active && <span className="tk-badge">In focus</span>}
        <div className="tk-acts">
          {!active && <button type="button" className="tk-act" aria-label={`Start ${t.title}`} title="Start (S)" onClick={() => void run({ type: 'task.start', id: t.id, run: true })}><Icon name="play" size={14} /></button>}
          <button type="button" className="tk-act" aria-label={`Edit ${t.title}`} title="Edit (E)" onClick={() => onEdit(t)}><Icon name="log" size={14} /></button>
          <button type="button" className="tk-act" aria-label={`Delete ${t.title}`} title="Delete (Del)" onClick={onDelete}><Icon name="trash" size={14} /></button>
        </div>
      </li>
    </>
  );
}

function DoneRow({ d, t, today }: { d: Data; t: Task; today: string }) {
  return (
    <li className="tk-row is-done" data-task={t.id}>
      <button type="button" className="tk-check is-on" aria-label={`Mark ${t.title} not done`} onClick={() => void run({ type: 'task.reopen', id: t.id }).then((r) => r.ok && toast(`${t.title} is open again.`))}>
        <Icon name="check" size={12} />
      </button>
      <div className="tk-body">
        <span className="tk-name">{t.title}</span>
        <TaskMeta d={d} t={t} today={today} />
      </div>
    </li>
  );
}

/** Board for views with no project: To do, Doing, Done. Dragging sets the status (task.start / task.pause / task.finish / task.reopen). */
function StatusBoard({ d, groups, doneList, today, onEdit }: { d: Data; groups: Group[]; doneList: Task[]; today: string; onEdit: (t: Task) => void }) {
  const open = groups.flatMap((g) => g.tasks);
  const cols: { id: 'todo' | 'doing' | 'done'; name: string; tasks: Task[] }[] = [
    { id: 'todo', name: 'To do', tasks: open.filter((t) => t.status !== 'doing') },
    { id: 'doing', name: 'Doing', tasks: open.filter((t) => t.status === 'doing') },
    { id: 'done', name: 'Done', tasks: doneList },
  ];
  const [over, setOver] = useState<string | null>(null);
  const drop = async (col: 'todo' | 'doing' | 'done', id: string) => {
    const t = d.tasks[id];
    if (!t) return;
    const from = t.status === 'doing' ? 'doing' : t.status === 'done' ? 'done' : 'todo';
    if (from === col) return;
    if (col === 'doing') await run({ type: 'task.start', id });
    else if (col === 'done') { const r = await run({ type: 'task.finish', id }); if (r.ok) toast(`${t.title} done.`, { undo: () => void run({ type: 'task.reopen', id }) }); }
    else await run(from === 'done' ? { type: 'task.reopen', id } : { type: 'task.pause', id });
  };
  return (
    <div className="tk-sboard">
      {cols.map((c) => (
        <section key={c.id} className={`tk-scol${over === c.id ? ' drop-on' : ''}`} aria-label={c.name}
          onDragOver={(e) => { e.preventDefault(); setOver(c.id); }} onDragLeave={() => setOver(null)}
          onDrop={(e) => { e.preventDefault(); setOver(null); void drop(c.id, e.dataTransfer.getData('text/x-chronos-task')); }}>
          <h2 className="tk-group-title">{c.name}<span className="tk-count">{c.tasks.length}</span></h2>
          <ul className="tk-scards">
            {c.tasks.map((t) => (
              <li key={t.id} className={`tk-scard${t.status === 'done' ? ' is-done' : ''}`} draggable onDragStart={(e) => { e.dataTransfer.setData('text/x-chronos-task', t.id); e.dataTransfer.effectAllowed = 'move'; }} onDoubleClick={() => onEdit(t)}>
                <span className="tk-name">{t.title}</span>
                <span className="tk-scard-meta"><PrioFlag p={t.priority} /><TaskMeta d={d} t={t} today={today} /></span>
              </li>
            ))}
            {!c.tasks.length && <li className="tk-group-empty">{c.id === 'doing' ? 'Drag a task here to start it' : 'Empty'}</li>}
          </ul>
        </section>
      ))}
    </div>
  );
}

export { doingColumnId };
