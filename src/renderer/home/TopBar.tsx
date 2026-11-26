// The slim top bar (Phase 3.5 §3): clock left, a search-looking button centred that opens
// the one palette (it is not a second search), the running task and its timer right.
// Shown on every screen except Focus.
import { api } from '../api';
import type { ReactNode } from 'react';
import { dateLabel, formatHM } from '../../core/format';
import type { Data } from '../../core/model/types';
import { settingsOf } from '../../core/repo/repo';
import { activeTask, todayOf } from '../../core/tasks/tasks';
import { localParts } from '../../core/time/zone';
import { Icon } from '../components/Icon';
import { TimerDigits } from '../focus/TimerDigits';
import { useViewport } from '../shell/viewport';

export function TopBar({ d, now, onPalette, onFocus, onHelp, sync, title }: { d: Data; now: number; onPalette: () => void; onFocus: () => void; onHelp?: () => void; sync?: ReactNode; title?: string }) {
  const phone = useViewport() === 'phone';
  const s = settingsOf(d);
  const task = activeTask(d);
  const lp = localParts(now, s.timezone);
  const state = task?.runtime.status;
  if (phone) {
    // One row, 52 px: the screen's name and the one action. Clock, task and chips live elsewhere.
    return (
      <header className="topbar topbar-phone">
        <p className="tb-title">{title ?? 'Chronos'}</p>
        <button type="button" className="tb-icon" onClick={onPalette} aria-haspopup="dialog" aria-label="Search or add">
          <Icon name="search" size={22} />
        </button>
      </header>
    );
  }
  return (
    <header className="topbar">
      <p className="tb-clock">
        <span className="tb-time">{formatHM(lp.minutes)}</span>
        <span className="tb-date">{dateLabel(todayOf(d, now))}</span>
      </p>
      <button type="button" className="tb-search" onClick={onPalette} aria-haspopup="dialog" aria-keyshortcuts="Control+K">
        <Icon name="search" size={16} />
        <span className="tb-search-text">{api.can.askClaude ? 'Add, search or ask' : 'Add or search'}</span>
        <kbd>{/Mac|iPhone|iPad/.test(navigator.platform) ? '⌘K' : 'Ctrl K'}</kbd>
      </button>
      <div className="tb-right">
        {sync}
        {task ? (
          <button type="button" className={`tb-task${state === 'running' ? ' live' : ''}`} onClick={onFocus} title="Open Focus (F)">
            <span className="tb-dot" aria-hidden="true" />
            <span className="tb-task-title">{task.title}</span>
            <TimerDigits task={task} size="widget" />
          </button>
        ) : (
          <span className="tb-idle">No task in focus</span>
        )}
        {onHelp && (
          <button type="button" className="tb-help" onClick={onHelp} aria-label="Shortcuts and help" title="Shortcuts and help (?)" aria-keyshortcuts="Shift+Slash">?</button>
        )}
      </div>
    </header>
  );
}
