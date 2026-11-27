// The phone's running task: a slim strip docked above the tab bar (<= 48 px). A mini timer
// and the title; tap opens Focus. Hidden when no task is active. It reuses TimerDigits, so the
// digits are never implemented twice.
import type { Data } from '../../core/model/types';
import { activeTask } from '../../core/tasks/tasks';
import { TimerDigits } from '../focus/TimerDigits';

export function RunningPill({ d, onFocus }: { d: Data; onFocus: () => void }) {
  const task = activeTask(d);
  if (!task) return null;
  const live = task.runtime.status === 'running';
  return (
    <button type="button" className={`runpill${live ? ' live' : ''}`} onClick={onFocus} aria-label={`${task.title}, open Focus`}>
      <span className="runpill-dot" aria-hidden="true" />
      <span className="runpill-title">{task.title}</span>
      <TimerDigits task={task} size="widget" />
    </button>
  );
}
