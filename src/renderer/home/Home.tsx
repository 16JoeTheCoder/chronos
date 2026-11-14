// Chronos Home (§9.2): header with the Plan │ Focus toggle, the Runway view or
// Focus Core, the Desktop shelf and Trash, and the layers above them. Esc closes
// the topmost layer; at the root it hides Home. F toggles Plan/Focus, N adds a task.

import { lazy, Suspense, useEffect, useState, type ComponentType } from 'react';
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
import { run, undoLast, useAlignedNow } from '../store';
import { DoneDrawer } from './DoneDrawer';
import { BeforeClass, HeadsUp } from './Strips';
import { SyncDot } from './SyncDot';

type Layer = 'drawer' | 'shelf' | 'trash' | 'schedule' | 'editor' | 'palette';

// Screens built by other parts of the app are mounted by glob so a missing file is a placeholder, not a build break.
const boards = import.meta.glob('../board/Board.tsx');
const palettes = import.meta.glob('../palette/Palette.tsx');
const logs = import.meta.glob('../log/Log.tsx');
type BoardP = { onOpenLog?: (projectId: string) => void; onEnterFocus?: (taskId: string) => void };
const LazyBoard = lazy(() => (boards['../board/Board.tsx'] ? (boards['../board/Board.tsx']() as Promise<{ Board: ComponentType<BoardP> }>).then((m) => ({ default: m.Board })) : Promise.resolve({ default: (_p: BoardP) => <Placeholder name="Board" /> })));
const LazyLog = lazy(() => (logs['../log/Log.tsx'] ? (logs['../log/Log.tsx']() as Promise<{ Log: ComponentType<{ projectId?: string | null }> }>).then((m) => ({ default: m.Log })) : Promise.resolve({ default: (_p: { projectId?: string | null }) => <Placeholder name="Log" /> })));
const LazyPalette = lazy(() => (palettes['../palette/Palette.tsx'] ? (palettes['../palette/Palette.tsx']() as Promise<{ Palette: ComponentType<{ open: boolean; onClose: () => void }> }>).then((m) => ({ default: m.Palette })) : Promise.resolve({ default: () => null })));

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
  const [screen, setScreen] = useState<Screen>(() => (activeTask(d)?.runtime.status === 'running' ? 'focus' : 'home'));
  const [layers, setLayers] = useState<Layer[]>([]);
  const [editing, setEditing] = useState<Task | null>(null);
  const [guided, setGuided] = useState(false);
  const [editEventId, setEditEventId] = useState<string | null>(null);
  const [range, setRange] = useState<'full' | 'next6'>('full');
  const [logProject, setLogProject] = useState<string | null>(null);
  const m = dayModel(d, now, range);
  const top = layers.at(-1);
  const open = (l: Layer) => setLayers((x) => [...x.filter((y) => y !== l), l]);
  const close = (l: Layer) => setLayers((x) => x.filter((y) => y !== l));
  const editTask = (t: Task | null) => {
    setEditing(t);
    open('editor');
  };
  const toggleScreen = (to: Screen) => setScreen((v) => (v === to ? 'home' : to));

  useEffect(() => api.onShow((v) => setScreen(v === 'focus' ? 'focus' : v === 'runway' ? 'plan' : 'home')), []);

  useEffect(() => {
    const root = document.documentElement;
    root.classList.toggle('reduce', s.reduceMotion === true);
    root.classList.toggle('full-motion', s.reduceMotion === false);
  }, [s.reduceMotion]);

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
        setLayers((x) => (x.includes('palette') ? x.filter((y) => y !== 'palette') : [...x, 'palette']));
        return;
      }
      if (e.ctrlKey && !e.altKey && e.key.toLowerCase() === 'l') {
        e.preventDefault();
        setLogProject(null);
        setScreen('log');
        return;
      }
      if (e.key === 'Escape') {
        if (askOpen()) closeAsk();
        else if (top) setLayers((x) => x.slice(0, -1));
        else if (screen !== 'home') setScreen('home');
        else if (!snap.pendingGap) api.win.hide();
        return;
      }
      if (typing || e.ctrlKey || e.altKey || e.metaKey || top || document.querySelector('[aria-modal="true"]')) return;
      if (e.key === 'f' || e.key === 'F') toggleScreen('focus');
      else if (e.key === 'p' || e.key === 'P') toggleScreen('plan');
      else if (e.key === 'n' || e.key === 'N') {
        e.preventDefault();
        editTask(null);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [top, snap.pendingGap, screen]);

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
    <Settings snap={snap} onSchedule={() => open('schedule')} onClose={() => setScreen('home')} />
  ) : screen === 'board' ? (
    <Suspense fallback={null}>
      <LazyBoard
        onOpenLog={(id) => {
          setLogProject(id);
          setScreen('log');
        }}
        onEnterFocus={() => setScreen('focus')}
      />
    </Suspense>
  ) : screen === 'log' ? (
    <Suspense fallback={null}><LazyLog projectId={logProject} /></Suspense>
  ) : screen === 'focus' ? (
    <FocusCore d={d} m={m} now={now} deviceId={snap.device.deviceId} onPlan={() => setScreen('plan')} />
  ) : screen === 'plan' ? (
    <main className="plan">
      <div className="plan-back"><button className="link" onClick={() => setScreen('home')}>Back to Home <kbd>P</kbd></button></div>
      {planSections}
    </main>
  ) : (
    <>
      <MorningStart d={d} now={now} active deviceId={snap.device.deviceId} />
      <NowScreen d={d} m={m} now={now} deviceId={snap.device.deviceId} onFocus={() => setScreen('focus')} onPlan={() => setScreen('plan')} />
    </>
  );

  return (
    <div className={`home${revealed ? ' revealed' : ''}`} data-screen={screen}>
      <Rail screen={screen} onGo={(x) => (x === 'log' && setLogProject(null), setScreen(x))} />
      <div className="home-main">
        <header className="top">
          <div className="brand-row">
            <p className="brand">
              <span className="wordmark">CHRONOS</span>
            </p>
            <SyncDot sync={snap.sync} />
          </div>
          <nav className="top-nav" aria-label="Home">
            <button className="btn btn-ghost btn-s" onClick={() => toggleScreen('plan')} aria-pressed={screen === 'plan'}>
              <Icon name="calendar" size={14} /> Plan <kbd>P</kbd>
            </button>
            <button className="btn btn-ghost btn-s" onClick={() => toggleScreen('focus')} aria-pressed={screen === 'focus'}>
              <Icon name="bolt" size={14} /> Focus <kbd>F</kbd>
            </button>
            <button className="btn btn-ghost btn-s" onClick={() => open('drawer')}>
              <Icon name="list" size={14} /> Done
            </button>
            <button className="btn btn-ghost btn-s" onClick={() => open('schedule')}>
              <Icon name="calendar" size={14} /> Schedule
            </button>
          </nav>
        </header>

        {body}

        {!full && screen === 'plan' && (
          <footer className="foot">
            <button className="btn btn-ghost btn-s" onClick={() => open('shelf')} aria-expanded={top === 'shelf'}>
              <Icon name="chevronUp" size={14} /> Desktop
            </button>
            <TrashButton onOpen={() => open('trash')} />
          </footer>
        )}
        {!full && screen !== 'plan' && (
          <footer className="foot foot-quiet">
            <button className="link" onClick={() => open('palette')}>Ctrl K to add, search or ask</button>
          </footer>
        )}
      </div>

      {layers.includes('drawer') && <DoneDrawer d={d} now={now} onClose={() => close('drawer')} />}
      {top === 'shelf' && <ShelfPanel onClose={() => close('shelf')} />}
      {top === 'trash' && <RecentlyDeleted d={d} onClose={() => close('trash')} />}
      {top === 'editor' && <TaskEditor d={d} task={editing} now={now} onClose={() => close('editor')} />}
      <Suspense fallback={null}>
        <LazyPalette open={layers.includes('palette')} onClose={() => close('palette')} />
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
