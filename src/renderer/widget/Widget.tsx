// Taskbar widget (§8.5): active task, its timer, time left today, and a dot for
// a prep nudge or an unanswered gap. Click toggles Home; right-click opens the
// menu; in free mode, press-and-drag moves it (main polls the cursor).
import type { CSSProperties } from 'react';
import { formatHuman } from '../../core/format';
import type { Snapshot } from '../../core/model/types';
import { activeTask } from '../../core/tasks/tasks';
import { prepNudges } from '../../core/time/prep';
import { api } from '../api';
import { TimerDigits } from '../focus/TimerDigits';
import { dayModel } from '../runway/model';
import { useNow } from '../store';

export function Widget({ snap }: { snap: Snapshot }) {
  const now = useNow(30_000);
  const d = snap.data;
  const task = activeTask(d);
  const left = dayModel(d, now, 'full').tl.workableMs;
  const dot = !!snap.pendingGap || prepNudges(d, now).length > 0;
  const tag = task?.tagId ? d.tags[task.tagId] : undefined;
  return (
    <div
      className={`widget${task?.runtime.status === 'running' ? ' running' : ''}`}
      style={{ '--c': `var(--${tag?.color ?? 'tag7'})` } as CSSProperties}
      onPointerDown={(e) => {
        if (e.button !== 0) return;
        api.win.dragStart();
        const up = () => {
          window.removeEventListener('pointerup', up);
          void api.win.dragEnd().then((moved) => !moved && api.win.widgetClick());
        };
        window.addEventListener('pointerup', up);
      }}
      onContextMenu={(e) => {
        e.preventDefault();
        api.win.widgetMenu();
      }}
      title={snap.pendingGap ? 'Chronos needs an answer about a time gap' : 'Click to open Chronos'}
    >
      <span className="w-title">{task ? task.title : 'Nothing in focus'}</span>
      {task && <TimerDigits task={task} size="widget" />}
      <span className="w-left">{formatHuman(left)} left</span>
      {dot && <span className="w-dot" aria-label="Needs attention" />}
    </div>
  );
}
