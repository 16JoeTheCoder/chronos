// Sprints (§6.7): open-ended tasks with a checkpoint every N minutes of tracked
// work. A checkpoint is a decision, never a stop: Continue, Ship (the finish
// ritual) or Kill (a typed reason, like Drop, but the sprint ends).

import type { Task } from '../model/types';
import { liveWorkMs } from './tasks';

const MIN = 60_000;

export function checkpointDue(t: Task, now: number): boolean {
  return t.kind === 'sprint' && t.status === 'active' && t.nextCheckpointMs !== null && liveWorkMs(t, now) >= t.nextCheckpointMs;
}

/** Continue: the next checkpoint is a full interval from now. */
export function nextCheckpoint(t: Task, now: number): number {
  return liveWorkMs(t, now) + (t.checkpointEveryMin ?? 120) * MIN;
}
