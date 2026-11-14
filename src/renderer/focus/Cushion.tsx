// The buffer cushion (PHASE23 §5.5): a visible reserve that shrinks as the task overruns,
// then shows the overrun. Colour comes from theme tokens only; the fill is a transform.
import { formatHuman } from '../../core/format';
import type { Cushion as C } from './cushion';

export function Cushion({ c }: { c: C }) {
  const text =
    c.state === 'full' ? `Buffer ${formatHuman(c.leftMs)} kept free` : c.state === 'shrinking' ? `Buffer ${formatHuman(c.leftMs)} left. This task is running over.` : `Buffer used up. ${formatHuman(c.overMs)} over.`;
  return (
    <div className={`cushion cushion-${c.state}`} role="status" aria-label={text}>
      <span className="cushion-track" aria-hidden="true">
        <i style={{ transform: `scaleX(${c.frac})` }} />
      </span>
      <span className="cushion-text">{text}</span>
    </div>
  );
}
