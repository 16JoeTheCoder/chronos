// Chronos Home (§9.2, Phase 3.5): rail + slim top bar over one screen (Home, Plan, Focus,
// Board, Log, Settings) and at most one layer. Every navigation goes through go() (nav.ts),
// which closes the open layer first. Esc closes the layer, then leaves the screen, then hides.
// Focus is silent: no rail, no top bar.

import { lazy, Suspense, useEffect, useRef, useState, type ComponentType } from 'react';
import type { Snapshot, Task } from '../../core/model/types';
import { settingsOf } from '../../core/repo/repo';
import { activeTask } from '../../core/tasks/tasks';
import { api } from '../api';
import { AskHost, askOpen, closeAsk } from '../components/ask';
import { useDrag } from '../components/drag';
import { Icon } from '../components/Icon';
import { Rail, type Screen } from '../components/Rail';
import { Toasts } from '../components/ui';
import { Moments } from '../moments/Moments';
import { BreakCard, MorningStart, ReviewHost } from '../planning/Planning';
import { NowScreen } from './NowScreen';
import { TaskEditor } from '../cards/TaskEditor';
import { Unscheduled } from '../cards/Cards';
import { FocusCore } from '../focus/FocusCore';
import { GapPrompt } from '../focus/GapPrompt';
import { Onboarding } from '../onboarding/Onboarding';
import { dayModel } from '../runway/model';
import { Runway } from '../runway/Runway';
import { TimeLeft } from '../runway/TimeLeft';
import { ScheduleEditor } from '../schedule/ScheduleEditor';
import { Settings } from '../settings/Settings';
import { RecentlyDeleted, ShelfPanel, TrashButton } from '../shelf/Shelf';
import { clearInfoToasts, run, undoLast, useAlignedNow } from '../store';
import { DoneDrawer } from './DoneDrawer';
import { closeLayer, escape, navigate, openLayer, toggle, toggleLayer, type Layer, type NavState } from './nav';
import { TopBar } from './TopBar';
import { Help } from './Help';
import { measureBlurOnce } from '../palette/blurCheck';
import { BeforeClass, HeadsUp } from './Strips';
import { SyncDot } from './SyncDot';
import { Tasks, type TaskView } from '../tasks/Tasks';

// Screens built by other parts of the app are mounted by glob so a missing file is a placeholder, not a build break.
const boards = import.meta.glob('../board/Board.tsx');
const palettes = import.meta.glob('../palette/Palette.tsx');
const logs = import.meta.glob('../log/Log.tsx');
type BoardP = { projectId?: string | null; onOpenLog?: (projectId: string) => void; onEnterFocus?: (taskId: string) => void };
const LazyBoard = lazy(() => (boards['../board/Board.tsx'] ? (boards['../board/Board.tsx']() as Promise<{ Board: ComponentType<BoardP> }>).then((m) => ({ default: m.Board })) : Promise.resolve({ default: (_p: BoardP) => <Placeholder name="Board" /> })));
const LazyLog = lazy(() => (logs['../log/Log.tsx'] ? (logs['../log/Log.tsx']() as Promise<{ Log: ComponentType<{ projectId?: string | null }> }>).then((m) => ({ default: m.Log })) : Promise.resolve({ default: (_p: { projectId?: string | null }) => <Placeholder name="Log" /> })));
type PalP = { open: boolean; onClose: () => void; onNavigate?: (to: Screen, opts?: { projectId?: string; logProject?: string | null }) => void };
const LazyPalette = lazy(() => (palettes['../palette/Palette.tsx'] ? (palettes['../palette/Palette.tsx']() as Promise<{ Palette: ComponentType<PalP> }>).then((m) => ({ default: m.Palette })) : Promise.resolve({ default: (_p: PalP) => null })));

function Placeholder({ name }: { name: string }) {
  return (
    <main className="placeholder">
      <h1 className="now-title"><span className="strong">{name}</span></h1>
      <p className="muted">{name === 'Log' ? 'The Log arrives with the next build. Ctrl L will open it.' : `${name} is not built yet.`}</p>
    </main>
  );
}

export function Home({ snap, revealed }: { snap: Snapshot; revealed: boolean }) {
  const d = snap.data;
  const s = settingsOf(d);
  const now = useAlignedNow(15_000);
  const [nav, setNav] = useState<NavState>(() => ({ screen: activeTask(d)?.runtime.status === 'running' ? 'focus' : 'home', layer: null }));
  const { screen } = nav;
  const top = nav.layer ?? undefined;
  const [editing, setEditing] = useState<Task | null>(null);
  const [guided, setGuided] = useState(false);
  const [editEventId, setEditEventId] = useState<string | null>(null);
  const [range, setRange] = useState<'full' | 'next6'>('full');
  const [logProject, setLogProject] = useState<string | null>(null);
  const [boardProject, setBoardProject] = useState<string | null>(null);
  const [taskView, setTaskView] = useState<TaskView>('today');
  const [taskProject, setTaskProject] = useState<string | null>(null);
  const gPending = useRef(0);
  const m = dayModel(d, now, range);
  /** Every navigation (rail, top bar, keys, palette commands) goes through here: it closes the open layer first. */
  const go = (to: Screen, opts: { logProject?: string | null; projectId?: string } = {}) => {
    if (to === 'log') setLogProject(opts.logProject ?? null);
    if (to === 'board' && opts.projectId) setBoardProject(opts.projectId);
    clearInfoToasts();
    setNav((x) => navigate(x, to));
  };
  const open = (l: Layer) => setNav((x) => openLayer(x, l));
  const close = (l: Layer) => setNav((x) => closeLayer(x, l));
  const editTask = (t: Task | null) => {
    setEditing(t);
    open('editor');
  };
  const toggleScreen = (to: Screen) => setNav((x) => toggle(x, to));

  useEffect(() => api.onShow((v) => setNav((x) => navigate(x, v === 'focus' ? 'focus' : v === 'runway' ? 'plan' : x.screen))), []);

  useEffect(() => {
    const root = document.documentElement;
    root.classList.toggle('reduce', s.reduceMotion === true);
    root.classList.toggle('full-motion', s.reduceMotion === false);
  }, [s.reduceMotion]);

  // Palette blur: measured once per device; dim-only when it would drop frames.
  useEffect(() => {
    if (snap.device.paletteBlur === null && revealed) measureBlurOnce();
    document.documentElement.dataset.blur = snap.device.paletteBlur === false ? 'off' : 'on';
  }, [snap.device.paletteBlur, revealed]);

  // A device that never saw onboarding but whose account has (another PC) is marked silently.
  useEffect(() => {
    if (!snap.device.onboarded && s.onboarded) void run({ type: 'device.update', patch: { onboarded: true } }, true);
  }, [snap.device.onboarded, s.onboarded]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.defaultPrevented) return;
      const typing = (e.target as HTMLElement).closest('input, textarea, select, [contenteditable]');
      if (e.ctrlKey && !e.altKey && !e.shiftKey && e.key.toLowerCase() === 'z' && !typing) {
        if (undoLast()) e.preventDefault();
        return;
      }
      if (e.ctrlKey && !e.altKey && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setNav((x) => toggleLayer(x, 'palette'));
        return;
      }
      if (e.ctrlKey && !e.altKey && e.key.toLowerCase() === 'l') {
        e.preventDefault();
        if (nav.layer === 'editor') return; // never drop a task being edited
        go('log');
        return;
      }
      if (e.key === 'Escape') {
        // Esc in a text field leaves the field first (a draft is never lost to a stray Esc); the next Esc navigates.
        if (typing && !askOpen() && !document.querySelector('[aria-modal="true"]')) {
          (e.target as HTMLElement).blur();
          return;
        }
        if (askOpen()) closeAsk();
        else {
          const next = escape(nav);
          if (next !== 'hide') setNav(next);
          else if (!snap.pendingGap) api.win.hide();
        }
        return;
      }
      if (typing || e.ctrlKey || e.altKey || e.metaKey || top || document.querySelector('[aria-modal="true"]')) return;
      // G then I / T / U / A: the Tasks views (a second key within 1.2 s).
      if (Date.now() - gPending.current < 1200) {
        const v = ({ i: 'inbox', t: 'today', u: 'upcoming', a: 'all' } as const)[e.key.toLowerCase() as 'i'];
        gPending.current = 0;
        if (v) {
          e.preventDefault();
          setTaskView(v);
          setTaskProject(null);
          go('tasks');
          return;
        }
      }
      if (e.key === 'g' || e.key === 'G') {
        gPending.current = Date.now();
        return;
      }
      if (e.key === '?') {
        e.preventDefault();
        open('help');
      } else if (e.key === 'f' || e.key === 'F') toggleScreen('focus');
      else if (e.key === 'p' || e.key === 'P') toggleScreen('plan');
      else if (e.key === 'n' || e.key === 'N') {
        e.preventDefault();
        editTask(null);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [nav, snap.pendingGap]);

  const planSections = [
    <TimeLeft key="tl" tl={m.tl} />,
    <Runway
      key="rw"
      d={d}
      m={m}
      now={now}
      range={range}
      setRange={setRange}
      onEditEvent={(id) => {
        setEditEventId(id);
        open('schedule');
      }}
    />,
    <HeadsUp key="hu" d={d} now={now} />,
    <BeforeClass key="bc" d={d} now={now} />,
    <Unscheduled key="un" d={d} m={m} now={now} onEdit={editTask} onNew={() => editTask(null)} />,
  ];
  if (s.runwayPosition === 'bottom') planSections.reverse();

  const full = top === 'schedule';
  const body = top === 'schedule' ? (
    <ScheduleEditor
      d={d}
      now={now}
      guided={guided}
      editEventId={editEventId}
      onClose={() => {
        setGuided(false);
        setEditEventId(null);
        close('schedule');
      }}
    />
  ) : screen === 'settings' ? (
    <Settings snap={snap} onSchedule={() => open('schedule')} onClose={() => go('home')} />
  ) : screen === 'tasks' ? (
    <Tasks
      d={d}
      now={now}
      view={taskView}
      onView={setTaskView}
      projectId={taskProject}
      onProject={setTaskProject}
      onEdit={editTask}
      onOpenLog={(id) => go('log', { logProject: id })}
      onFocus={() => go('focus')}
    />
  ) : screen === 'board' ? (
    <Suspense fallback={null}>
      <LazyBoard
        projectId={boardProject}
        onOpenLog={(id) => go('log', { logProject: id })}
        onEnterFocus={() => go('focus')}
      />
    </Suspense>
  ) : screen === 'log' ? (
    <Suspense fallback={null}><LazyLog projectId={logProject} /></Suspense>
  ) : screen === 'focus' ? (
    <FocusCore d={d} m={m} now={now} deviceId={snap.device.deviceId} onPlan={() => go('plan')} />
  ) : screen === 'plan' ? (
    <main className="plan">
      <div className="plan-back">
        <button className="link" onClick={() => go('home')}>Back to Home <kbd>P</kbd></button>
        <span className="plan-back-gap" />
        <button className="btn btn-ghost btn-s" onClick={() => open('drawer')}><Icon name="list" size={14} /> Done today</button>
        <button className="btn btn-ghost btn-s" onClick={() => open('schedule')}><Icon name="calendar" size={14} /> Schedule</button>
      </div>
      {planSections}
    </main>
  ) : (
    <>
      <MorningStart d={d} now={now} active deviceId={snap.device.deviceId} />
      <NowScreen d={d} m={m} now={now} deviceId={snap.device.deviceId} onFocus={() => go('focus')} onPlan={() => go('plan')} />
    </>
  );

  return (
    <div className={`home${revealed ? ' revealed' : ''}`} data-screen={screen}>
      {screen !== 'focus' && <Rail screen={screen} onGo={(x) => go(x)} />}
      <div className="home-main">
        {screen !== 'focus' && <TopBar d={d} now={now} onPalette={() => open('palette')} onFocus={() => go('focus')} onHelp={() => open('help')} sync={<SyncDot sync={snap.sync} />} />}

        <div className="screen">{body}</div>

        {!full && screen === 'plan' && (
          <footer className="foot">
            <button className="btn btn-ghost btn-s" onClick={() => open('shelf')} aria-expanded={top === 'shelf'}>
              <Icon name="chevronUp" size={14} /> Desktop
            </button>
            <TrashButton onOpen={() => open('trash')} />
          </footer>
        )}
      </div>

      {top === 'drawer' && <DoneDrawer d={d} now={now} onClose={() => close('drawer')} />}
      {top === 'shelf' && <ShelfPanel onClose={() => close('shelf')} />}
      {top === 'trash' && <RecentlyDeleted d={d} onClose={() => close('trash')} />}
      {top === 'help' && <Help onClose={() => close('help')} />}
      {top === 'editor' && <TaskEditor d={d} task={editing} now={now} onClose={() => close('editor')} />}
      <Suspense fallback={null}>
        <LazyPalette open={top === 'palette'} onClose={() => close('palette')} onNavigate={(to, opts) => go(to, opts)} />
      </Suspense>
      {revealed && !s.onboarded && !snap.device.onboarded && (
        <Onboarding
          s={s}
          onDone={() => undefined}
          onTimetable={() => {
            setGuided(true);
            open('schedule');
          }}
        />
      )}
      {revealed && s.onboarded && <ReviewHost d={d} now={now} />}
      {revealed && s.onboarded && <BreakCard d={d} now={now} />}
      {snap.pendingGap && <GapPrompt gap={snap.pendingGap} tz={s.timezone} />}
      <Moments snap={snap} inFocus={screen === 'focus'} />
      <DragChip />
      <AskHost />
      <Toasts />
    </div>
  );
}

/** The floating label that follows the pointer while dragging outside the runway. */
function DragChip() {
  const drag = useDrag();
  if (!drag || drag.target === 'plan') return null;
  return (
    <div className="drag-chip" style={{ transform: `translate(${drag.x + 12}px, ${drag.y + 12}px)` }} aria-hidden="true">
      {drag.item.title}
    </div>
  );
}
