// The gap prompt (ported from Monolith): time passed while Chronos could not see it.
import { clockOf, formatHuman } from '../../core/format';
import type { Gap } from '../../core/model/types';
import { Dialog } from '../components/ui';
import { run } from '../store';

export function GapPrompt({ gap, tz }: { gap: Gap; tz: string }) {
  const why = gap.reason === 'sleep' ? 'The PC was asleep' : gap.reason === 'clock' ? 'The clock jumped' : 'Chronos was not running';
  return (
    <Dialog title="Time you were away" onClose={() => undefined} required>
      <p>
        {why} from {clockOf(gap.from, tz)} to {clockOf(gap.to, tz)} ({formatHuman(gap.to - gap.from)}). Count that time, or go back to the last recorded time?
      </p>
      <p className="muted">The timer stays paused until you press Resume.</p>
      <div className="row end gap">
        <button className="btn btn-ghost" onClick={() => void run({ type: 'gap.answer', count: false })}>
          Go back to {clockOf(gap.from, tz)}
        </button>
        <button className="btn" onClick={() => void run({ type: 'gap.answer', count: true })}>
          Count it
        </button>
      </div>
    </Dialog>
  );
}
