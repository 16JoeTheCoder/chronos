// Chronos Home (§9.2): header with the Plan │ Focus toggle, the Runway view or
// Focus Core, the Desktop shelf and Trash, and the layers above them. Esc closes
// the topmost layer; at the root it hides Home. F toggles Plan/Focus, N adds a task.

import { useEffect, useState } from 'react';
import { dateLabel } from '../../core/format';
import type { Snapshot, Task } from '../../core/model/types';
import { settingsOf } from '../../core/repo/repo';
import { activeTask, todayOf } from '../../core/tasks/tasks';
import { api } from '../api';
import { AskHost, askOpen, closeAsk } from '../components/ask';
import { useDrag } from '../components/drag';
import { Icon } from '../components/Icon';
import { Segmented, Toasts } from '../components/ui';
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
import { useNow, useTheme } from '../store';
import { DoneDrawer } from './DoneDrawer';
import { BeforeClass, HeadsUp } from './Strips';

type Layer = 'drawer' | 'shelf' | 'trash' | 'settings' | 'schedule' | 'editor';

export function Home({ snap, revealed }: { snap: Snapshot; revealed: boolean }) {
  const d = snap.data;
  const s = settingsOf(d);
  const now = useNow(30_000);
  const [view, setView] = useState<'runway' | 'focus'>(() => (activeTask(d)?.runtime.status === 'running' ? 'focus' : 'runway'));
  const [layers, setLayers] = useState<Layer[]>([]);
  const [editing, setEditing] = useState<Task | null>(null);
  const [guided, setGuided] = useState(false);
  const [range, setRange] = useState<'full' | 'next6'>('full');
  const m = dayModel(d, now, range);
  const top = layers.at(-1);
  const open = (l: Layer) => setLayers((x) => [...x.filter((y) => y !== l), l]);
  const close = (l: Layer) => setLayers((x) => x.filter((y) => y !== l));
  const editTask = (t: Task | null) => {
    setEditing(t);
    open('editor');
  };

  useEffect(() => api.onShow((v) => v && setView(v)), []);

  useTheme(s.theme);
  useEffect(() => {
    const root = document.documentElement;
    root.classList.toggle('reduce', s.reduceMotion === true);
    root.classList.toggle('full-motion', s.reduceMotion === false);
  }, [s.reduceMotion]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.defaultPrevented) return;
      const typing = (e.target as HTMLElement).closest('input, textarea, select, [contenteditable]');
      if (e.key === 'Escape') {
        if (askOpen()) closeAsk();
        else if (top) setLayers((x) => x.slice(0, -1));
        else if (!snap.pendingGap) api.win.hide();
        return;
      }
      if (typing || e.ctrlKey || e.altKey || e.metaKey || top || document.querySelector('[aria-modal="true"]')) return;
      if (e.key === 'f' || e.key === 'F') setView((v) => (v === 'focus' ? 'runway' : 'focus'));
      else if (e.key === 'n' || e.key === 'N') {
        e.preventDefault();
        editTask(null);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [top, snap.pendingGap]);

  const full = top === 'settings' || top === 'schedule';
  const planSections = [
    <TimeLeft key="tl" tl={m.tl} />,
    <Runway key="rw" d={d} m={m} now={now} range={range} setRange={setRange} />,
    <HeadsUp key="hu" d={d} now={now} />,
    <BeforeClass key="bc" d={d} now={now} />,
    <Unscheduled key="un" d={d} m={m} now={now} onEdit={editTask} onNew={() => editTask(null)} />,
  ];
  if (s.runwayPosition === 'bottom') planSections.reverse();

  return (
    <div className={`home${revealed ? ' revealed' : ''}`}>
      <header className="top">
        <p className="brand">
          <span className="wordmark">CHRONOS</span> · {dateLabel(todayOf(d, now))}
        </p>
        <Segmented label="View (F)" value={view} options={[['runway', 'Plan'], ['focus', 'Focus']]} onChange={setView} />
        <nav className="top-nav" aria-label="Home">
          <button className="btn btn-ghost btn-s" onClick={() => open('drawer')}>
            <Icon name="list" size={14} /> Done
          </button>
          <button className="btn btn-ghost btn-s" onClick={() => open('schedule')}>
            <Icon name="calendar" size={14} /> Schedule
          </button>
          <button className="icon-btn" onClick={() => open('settings')} aria-label="Settings">
            <Icon name="gear" />
          </button>
        </nav>
      </header>

      {top === 'settings' ? (
        <Settings snap={snap} onSchedule={() => open('schedule')} onClose={() => close('settings')} />
      ) : top === 'schedule' ? (
        <ScheduleEditor
          d={d}
          now={now}
          guided={guided}
          onClose={() => {
            setGuided(false);
            close('schedule');
          }}
        />
      ) : view === 'focus' ? (
        <FocusCore d={d} m={m} now={now} deviceId={snap.device.deviceId} onPlan={() => setView('runway')} />
      ) : (
        <main className="plan">{planSections}</main>
      )}

      {!full && (
        <footer className="foot">
          <button className="btn btn-ghost btn-s" onClick={() => open('shelf')} aria-expanded={top === 'shelf'}>
            <Icon name="chevronUp" size={14} /> Desktop
          </button>
          <TrashButton onOpen={() => open('trash')} />
        </footer>
      )}

      {layers.includes('drawer') && <DoneDrawer d={d} now={now} onClose={() => close('drawer')} />}
      {top === 'shelf' && <ShelfPanel onClose={() => close('shelf')} />}
      {top === 'trash' && <RecentlyDeleted d={d} onClose={() => close('trash')} />}
      {top === 'editor' && <TaskEditor d={d} task={editing} now={now} onClose={() => close('editor')} />}
      {revealed && !s.onboarded && (
        <Onboarding
          s={s}
          onDone={() => undefined}
          onTimetable={() => {
            setGuided(true);
            open('schedule');
          }}
        />
      )}
      {snap.pendingGap && <GapPrompt gap={snap.pendingGap} tz={s.timezone} />}
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
