// The timer readout, shared by Focus Core and the taskbar widget so digits are
// never implemented twice. Recomputed every 250 ms from the snapshot + Date.now().
import type { Task } from '../../core/model/types';
import { display } from '../../core/timer/timer';
import { formatClock, phaseLabel } from '../../core/format';
import { useNow } from '../store';

export function useTimer(task: Task | undefined) {
  const now = useNow(task?.runtime.status === 'running' ? 250 : 30_000);
  return task ? display(task, now) : null;
}

export function TimerDigits({ task, size }: { task: Task; size: 'hero' | 'widget' }) {
  const t = useTimer(task);
  if (!t) return null;
  const over = t.overtime > 0;
  const main = t.remaining !== null ? (over ? t.overtime : t.remaining) : t.elapsed;
  const label = `${task.timer.mode === 'pomodoro' ? `${phaseLabel(t.phase)}, ` : ''}${over ? 'overtime ' : t.remaining !== null ? 'remaining ' : 'elapsed '}${formatClock(main)}`;
  return (
    <span className={`digits digits-${size}${over ? ' over' : ''}${t.status === 'running' ? ' live' : ''}`} role="timer" aria-label={label}>
      {over && '+'}
      {formatClock(main)}
    </span>
  );
}
