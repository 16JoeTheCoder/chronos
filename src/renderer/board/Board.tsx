// Project board. Board and List views over project.columns. The column mapped to status "doing" is
// the focus slot: one card at most; dropping another card there swaps them (src/core/board).
// Drag and drop with the pointer, and the same moves from the keyboard (Space picks a card up, the
// arrow keys choose where, Space or Enter puts it down, Escape cancels). The List view moves cards
// with a plain select, for anyone who cannot or does not want to drag.

import { useEffect, useId, useMemo, useRef, useState, type DragEvent, type KeyboardEvent } from 'react';
import { boardCards, doingColumnId, focusSlotOverflow, neighbourColumn, planMove, summarize, type MovePlan } from '../../core/board';
import { dateLabel, formatHuman } from '../../core/format';
import type { Project, Snapshot, Task } from '../../core/model/types';
import { live, settingsOf } from '../../core/repo/repo';
import { todayOf } from '../../core/tasks/tasks';
import { Icon } from '../components/Icon';
import { run, toast, useSnap } from '../store';
import './board.css';

export interface BoardProps {
  /** Project to show first. Default: the first project. */
  projectId?: string | null;
  /** The header's "Project log" link. */
  onOpenLog?: (projectId: string) => void;
  /** The focus card's "Enter focus" button is shown when this is given. */
  onEnterFocus?: (taskId: string) => void;
  /** Click on a card opens it. */
  onOpenTask?: (taskId: string) => void;
}

/** Reads the store itself; renders nothing until the first snapshot. */
export function Board(props: BoardProps) {
  const snap = useSnap();
  return snap ? <BoardView snap={snap} {...props} /> : null;
}
export default Board;

type View = 'board' | 'list';
const VIEW_KEY = 'chronos.board.view';
const loadView = (): View => { try { return localStorage.getItem(VIEW_KEY) === 'list' ? 'list' : 'board'; } catch { return 'board'; } };

type Ok = Extract<MovePlan, { ok: true }>;
const runMoves = async (moves: Ok['moves']) => {
  for (const m of moves) {
    const r = await run({ type: 'task.moveCard', id: m.id, columnId: m.columnId, beforeId: m.beforeId });
    if (!r.ok) return false;
  }
  return true;
};

/** Runs a plan; the one Undo reverses every move of it. */
async function execute(plan: Ok, announce: (s: string) => void, label: string, withToast: boolean): Promise<boolean> {
  if (!(await runMoves(plan.moves))) return false;
  announce(label);
  if (withToast || plan.swapped) toast(label, { undo: () => void runMoves(plan.undo).then(() => announce('Undone.')) });
  return true;
}

export function BoardView({ snap, projectId, onOpenLog, onEnterFocus, onOpenTask }: BoardProps & { snap: Snapshot }) {
  const d = snap.data;
  const s = settingsOf(d);
  const projects = live(d, 'projects').filter((p) => !p.archived).sort((a, b) => (a.sortKey < b.sortKey ? -1 : 1));
  const [picked, setPicked] = useState<string | null>(projectId ?? null);
  useEffect(() => { if (projectId) setPicked(projectId); }, [projectId]);
  const project = projects.find((p) => p.id === picked) ?? projects[0];
  const [view, setViewState] = useState<View>(loadView);
  const setView = (v: View) => { setViewState(v); try { localStorage.setItem(VIEW_KEY, v); } catch { /* best effort */ } };
  const [said, setSaid] = useState('');

  return (
    <div className="bd-shell">
      <nav className="bd-nav" aria-label="Projects">
        <h1>Projects</h1>
        <ul>
          {projects.map((p) => {
            const sm = summarize(d, p, s.planning.defaultBlockMin);
            const n = sm.total - sm.done;
            return (
              <li key={p.id}>
                <button type="button" className="bd-proj" aria-current={project?.id === p.id ? 'page' : undefined} onClick={() => setPicked(p.id)}>
                  <span className="bd-dot" style={{ ['--sw' as string]: `var(--${p.color}, var(--c-accent))` }} aria-hidden="true" />
                  <span className="bd-proj-name">{p.name}</span>
                  <span className="bd-proj-n">{n} open</span>
                </button>
              </li>
            );
          })}
        </ul>
        <NewProject onCreated={setPicked} />
      </nav>
      <main className="bd-main">
        {project ? (
          <>
            <Header snap={snap} project={project} view={view} onView={setView} onOpenLog={onOpenLog} defaultBlockMin={s.planning.defaultBlockMin} />
            {view === 'board' ? (
              <Columns snap={snap} project={project} announce={setSaid} onEnterFocus={onEnterFocus} onOpenTask={onOpenTask} />
            ) : (
              <ListView snap={snap} project={project} announce={setSaid} onOpenTask={onOpenTask} />
            )}
          </>
        ) : (
          <div className="bd-empty">
            <h2>No projects yet</h2>
            <p>A project is a board of tasks that belong together. Make one on the left, then add tasks to it.</p>
          </div>
        )}
        <p className="bd-live" role="status" aria-live="polite">{said}</p>
      </main>
    </div>
  );
}

function NewProject({ onCreated }: { onCreated: (id: string) => void }) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState('');
  const id = useId();
  async function create() {
    if (!name.trim()) return;
    const r = await run({ type: 'project.create', name });
    if (r.ok && r.id) { toast(`Project ${name.trim()} created.`); setName(''); setOpen(false); onCreated(r.id); }
  }
  if (!open) return <button type="button" className="bd-ghost" onClick={() => setOpen(true)}>New project</button>;
  return (
    <form className="bd-new" onSubmit={(e) => { e.preventDefault(); void create(); }}>
      <label htmlFor={id} className="bd-sr">Project name</label>
      <input id={id} autoFocus className="bd-input" placeholder="Project name" maxLength={80} value={name} onChange={(e) => setName(e.target.value)} onKeyDown={(e) => e.key === 'Escape' && setOpen(false)} />
      <div className="bd-row">
        <button type="submit" className="bd-btn bd-btn-solid" disabled={!name.trim()}>Create</button>
        <button type="button" className="bd-btn" onClick={() => setOpen(false)}>Cancel</button>
      </div>
    </form>
  );
}

function Header({ snap, project, view, onView, onOpenLog, defaultBlockMin }: { snap: Snapshot; project: Project; view: View; onView: (v: View) => void; onOpenLog?: (id: string) => void; defaultBlockMin: number }) {
  const d = snap.data;
  const sum = summarize(d, project, defaultBlockMin);
  const today = todayOf(d, Date.now());
  const ids = new Set(Object.values(boardCards(d, project)).flat().map((t) => t.id));
  const plannedMin = live(d, 'blocks').filter((b) => b.date === today && b.taskId && ids.has(b.taskId) && b.kind !== 'break').reduce((m, b) => m + (b.endMin - b.startMin), 0);
  const parts = [`${sum.done} of ${sum.total} done`, sum.leftMin > 0 ? `${formatHuman(sum.leftMin * 60_000)} estimated left` : null, plannedMin > 0 ? `${formatHuman(plannedMin * 60_000)} planned today` : null].filter(Boolean);
  return (
    <header className="bd-head">
      <div className="bd-head-text">
        <h2>{project.name}</h2>
        <p>{sum.total === 0 ? 'No tasks yet' : parts.join(' · ')}</p>
      </div>
      <div className="bd-head-ctl">
        {onOpenLog && (
          <button type="button" className="bd-btn" onClick={() => onOpenLog(project.id)}>
            <Icon name="idea" size={16} /> Project log
          </button>
        )}
        <div className="bd-tabs" role="tablist" aria-label="View">
          {(['board', 'list'] as const).map((v) => (
            <button key={v} type="button" role="tab" aria-selected={view === v} tabIndex={view === v ? 0 : -1} onClick={() => onView(v)}
              onKeyDown={(e) => { if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') { e.preventDefault(); onView(v === 'board' ? 'list' : 'board'); } }}>
              {v === 'board' ? 'Board' : 'List'}
            </button>
          ))}
        </div>
      </div>
    </header>
  );
}

const dueText = (t: Task) => (t.dueDate ? dateLabel(t.dueDate) : null);

function Meta({ t }: { t: Task }) {
  const due = dueText(t);
  if (!t.estimateMin && !due) return null;
  return (
    <span className="bd-meta">
      {t.estimateMin ? <span>{formatHuman(t.estimateMin * 60_000)}</span> : null}
      {due && <span>{due}</span>}
    </span>
  );
}

interface Spot { col: string; index: number }

function Columns({ snap, project, announce, onEnterFocus, onOpenTask }: { snap: Snapshot; project: Project; announce: (s: string) => void; onEnterFocus?: (id: string) => void; onOpenTask?: (id: string) => void }) {
  const d = snap.data;
  const cards = useMemo(() => boardCards(d, project), [d, project]);
  const doing = doingColumnId(project.columns);
  const overflow = new Set(focusSlotOverflow(d, project).map((t) => t.id));
  const [dragId, setDragId] = useState<string | null>(null);
  const [over, setOver] = useState<Spot | null>(null);
  const [grab, setGrab] = useState<{ id: string; spot: Spot } | null>(null);
  const refs = useRef(new Map<string, HTMLElement>());
  const colName = (id: string) => project.columns.find((c) => c.id === id)?.name ?? id;
  const others = (col: string, skip: string) => (cards[col] ?? []).filter((t) => t.id !== skip);

  /** Where in `col` a pointer at `y` lands, ignoring the card being dragged. */
  const indexAt = (col: string, y: number, skip: string): number => {
    let i = 0;
    for (const t of others(col, skip)) {
      const r = refs.current.get(t.id)?.getBoundingClientRect();
      if (r && y > r.top + r.height / 2) i += 1;
    }
    return i;
  };

  const drop = async (id: string, spot: Spot) => {
    const beforeId = others(spot.col, id)[spot.index]?.id ?? null;
    const plan = planMove(d, id, spot.col, beforeId);
    if (!plan.ok) return false;
    const t = d.tasks[id];
    const label = plan.swapped ? `Swapped ${t?.title} with ${plan.swapped.title}.` : `Moved ${t?.title} to ${colName(spot.col)}.`;
    return execute(plan, announce, label, false);
  };

  const onKey = (e: KeyboardEvent<HTMLElement>, t: Task, col: string) => {
    if (grab?.id === t.id) {
      const cur = grab.spot;
      const len = others(cur.col, t.id).length;
      const say = (sp: Spot) => announce(`${colName(sp.col)}, position ${sp.index + 1}${doing === sp.col && others(sp.col, t.id).length > 0 ? ', swaps with the card in the focus slot' : ''}.`);
      let next: Spot | null = null;
      if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
        const c = neighbourColumn(project.columns, cur.col, e.key === 'ArrowLeft' ? -1 : 1);
        if (c) next = { col: c, index: others(c, t.id).length };
      } else if (e.key === 'ArrowUp') next = { col: cur.col, index: Math.max(0, cur.index - 1) };
      else if (e.key === 'ArrowDown') next = { col: cur.col, index: Math.min(len, cur.index + 1) };
      if (next) { e.preventDefault(); setGrab({ id: t.id, spot: next }); say(next); return; }
      if (e.key === ' ' || e.key === 'Enter') {
        e.preventDefault();
        const sp = cur;
        setGrab(null);
        void drop(t.id, sp).then((ok) => !ok && announce(`${t.title} stays where it was.`));
      } else if (e.key === 'Escape') {
        e.preventDefault();
        setGrab(null);
        announce('Move cancelled.');
      } else if (e.key === 'Tab') setGrab(null);
      return;
    }
    if (e.key === ' ') {
      e.preventDefault();
      setGrab({ id: t.id, spot: { col, index: (cards[col] ?? []).findIndex((x) => x.id === t.id) } });
      announce(`Picked up ${t.title}. Arrow keys choose a place, Space drops, Escape cancels.`);
    }
  };

  const moving = grab?.id ?? dragId;
  const indicator = grab?.spot ?? over;

  return (
    <div className="bd-cols" style={{ ['--n' as string]: project.columns.length }}>
      {project.columns.map((c) => {
        const list = cards[c.id] ?? [];
        const isDoing = c.id === doing;
        const sans = moving ? list.filter((t) => t.id !== moving) : list;
        const here = indicator?.col === c.id ? indicator.index : -1;
        const swapTarget = isDoing && here >= 0 && moving && sans.length > 0 ? sans[0]?.id : null;
        return (
          <section
            key={c.id}
            className={`bd-col${isDoing ? ' bd-col-slot' : ''}`}
            aria-label={c.name}
            data-over={here >= 0 ? 'true' : undefined}
            onDragOver={(e: DragEvent) => { if (!dragId) return; e.preventDefault(); e.dataTransfer.dropEffect = 'move'; const i = indexAt(c.id, e.clientY, dragId); setOver((o) => (o?.col === c.id && o.index === i ? o : { col: c.id, index: i })); }}
            onDragLeave={(e: DragEvent) => { if (!(e.currentTarget as HTMLElement).contains(e.relatedTarget as Node | null)) setOver((o) => (o?.col === c.id ? null : o)); }}
            onDrop={(e: DragEvent) => { e.preventDefault(); const id = dragId; const sp = over; setDragId(null); setOver(null); if (id && sp) void drop(id, sp); }}
          >
            <div className="bd-col-head">
              <h3>{c.name}</h3>
              <span>{isDoing ? `${list.length} of 1, the focus slot` : list.length}</span>
            </div>
            <ul className="bd-list">
              {list.map((t) => {
                const dragging = moving === t.id;
                const pos = sans.indexOf(t);
                const isSwap = swapTarget === t.id;
                return (
                  <li key={t.id} className="bd-slot">
                    {here >= 0 && pos === here && !isSwap && <div className="bd-line" aria-hidden="true" />}
                    <article
                      ref={(el) => { if (el) refs.current.set(t.id, el); else refs.current.delete(t.id); }}
                      className={`bd-card${isDoing ? ' bd-card-focus' : ''}${dragging ? ' is-drag' : ''}${isSwap ? ' is-swap' : ''}${t.status === 'done' || c.id === 'done' ? ' is-done' : ''}`}
                      draggable
                      data-overflow={overflow.has(t.id) ? 'true' : undefined}
                      onDragStart={(e) => { setDragId(t.id); e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData('text/plain', t.id); }}
                      onDragEnd={() => { setDragId(null); setOver(null); }}
                    >
                      <button
                        type="button"
                        className="bd-card-main"
                        aria-pressed={grab?.id === t.id}
                        aria-describedby="bd-kbd-hint"
                        onKeyDown={(e) => onKey(e, t, c.id)}
                        onClick={() => onOpenTask?.(t.id)}
                      >
                        <span className="bd-title">{t.title}</span>
                        <Meta t={t} />
                        {isSwap && <span className="bd-swap">Swaps with this card</span>}
                        {overflow.has(t.id) && <span className="bd-swap">Extra card in the focus slot. Move it out.</span>}
                      </button>
                      {isDoing && !overflow.has(t.id) && onEnterFocus && (
                        <button type="button" className="bd-btn bd-btn-solid bd-enter" onClick={() => onEnterFocus(t.id)}>Enter focus</button>
                      )}
                    </article>
                  </li>
                );
              })}
              {here >= 0 && here >= sans.length && !swapTarget && <li className="bd-slot" aria-hidden="true"><div className="bd-line" /></li>}
            </ul>
            {isDoing ? <p className="bd-slot-note">Dropping another card here swaps it with this one. One task at a time.</p> : <AddTask project={project} columnId={c.id} />}
          </section>
        );
      })}
      <span id="bd-kbd-hint" className="bd-sr">Space picks this card up, arrow keys move it, Space drops it.</span>
    </div>
  );
}

function AddTask({ project, columnId }: { project: Project; columnId: string }) {
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState('');
  const id = useId();
  async function add() {
    const t = title.trim();
    if (!t) return;
    const r = await run({ type: 'task.create', input: { title: t, projectId: project.id, columnId } });
    if (r.ok) setTitle('');
  }
  if (!open) return <button type="button" className="bd-ghost" onClick={() => setOpen(true)}>Add a task to this project</button>;
  return (
    <form className="bd-new" onSubmit={(e) => { e.preventDefault(); void add(); }}>
      <label htmlFor={id} className="bd-sr">Task title</label>
      <input id={id} autoFocus className="bd-input" placeholder="Task title" maxLength={200} value={title} onChange={(e) => setTitle(e.target.value)} onKeyDown={(e) => e.key === 'Escape' && (setOpen(false), setTitle(''))} />
      <div className="bd-row">
        <button type="submit" className="bd-btn bd-btn-solid" disabled={!title.trim()}>Add</button>
        <button type="button" className="bd-btn" onClick={() => { setOpen(false); setTitle(''); }}>Done</button>
      </div>
    </form>
  );
}

function ListView({ snap, project, announce, onOpenTask }: { snap: Snapshot; project: Project; announce: (s: string) => void; onOpenTask?: (id: string) => void }) {
  const d = snap.data;
  const cards = boardCards(d, project);
  const rows = project.columns.flatMap((c) => (cards[c.id] ?? []).map((t) => ({ t, col: c.id })));
  async function move(t: Task, columnId: string) {
    const plan = planMove(d, t.id, columnId, null);
    if (!plan.ok) return;
    const name = project.columns.find((c) => c.id === columnId)?.name ?? '';
    const label = plan.swapped ? `Swapped ${t.title} with ${plan.swapped.title}.` : `Moved ${t.title} to ${name}.`;
    await execute(plan, announce, label, true);
  }
  if (rows.length === 0) return <div className="bd-empty"><h2>Nothing here yet</h2><p>Switch to the board and add a task to the first column.</p></div>;
  return (
    <div className="bd-table" role="table" aria-label={`${project.name} tasks`}>
      <div className="bd-tr bd-th" role="row">
        <span role="columnheader">Task</span>
        <span role="columnheader">Column</span>
        <span role="columnheader">Estimate</span>
        <span role="columnheader">Due</span>
      </div>
      {rows.map(({ t, col }) => (
        <div className={`bd-tr${t.status === 'done' || col === 'done' ? ' is-done' : ''}`} role="row" key={t.id}>
          <span role="cell" className="bd-td-title">
            <button type="button" className="bd-link" onClick={() => onOpenTask?.(t.id)}>{t.title}</button>
          </span>
          <span role="cell">
            <select className="bd-select" aria-label={`Column of ${t.title}`} value={col} onChange={(e) => void move(t, e.target.value)}>
              {project.columns.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          </span>
          <span role="cell" className="bd-num">{t.estimateMin ? formatHuman(t.estimateMin * 60_000) : '–'}</span>
          <span role="cell" className="bd-num">{dueText(t) ?? '–'}</span>
        </div>
      ))}
    </div>
  );
}
