// Estimates (PHASE23 §4): a task with no estimate gets planning.defaultBlockMin;
// with learnEstimates on, the median actual focus time of the last 5 finished
// tasks of the same project or tag, when at least 3 such tasks have a measured
// time. Pure.

import type { Data, Task } from '../model/types';
import { live, settingsOf } from '../repo/repo';

export const LEARN_WINDOW = 5;
export const LEARN_MIN_SAMPLES = 3;
const MIN = 60_000;

export interface Estimate {
  min: number;
  /** 'set' = the task's own estimate; 'learned' = median of recent similar tasks; 'default' = planning.defaultBlockMin. */
  source: 'set' | 'learned' | 'default';
  samples: number;
}

/** Focus minutes a finished task really took: the larger of its tracked total and its recorded work sessions. */
export function actualFocusMin(d: Data, t: Task): number {
  let ms = 0;
  for (const s of live(d, 'sessions')) if (s.taskId === t.id && s.phase === 'work') ms += Math.max(0, s.endedAt - s.startedAt);
  return Math.max(ms, t.workMs) / MIN;
}

const median = (xs: number[]): number => {
  const s = [...xs].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? (s[m] as number) : ((s[m - 1] as number) + (s[m] as number)) / 2;
};

/** Finished tasks like `t` (same project or same tag), newest first, with a measured time. */
export function similarFinished(d: Data, t: Task): Task[] {
  return live(d, 'tasks')
    .filter((x) => x.id !== t.id && x.status === 'done' && x.outcome !== 'killed' && x.completedAt !== null)
    .filter((x) => (t.projectId !== null && x.projectId === t.projectId) || (t.tagId !== null && x.tagId === t.tagId))
    .filter((x) => actualFocusMin(d, x) > 0)
    .sort((a, b) => (b.completedAt as number) - (a.completedAt as number) || (a.id < b.id ? -1 : 1))
    .slice(0, LEARN_WINDOW);
}

/** Minutes to plan for a task, rounded to 5 and kept within 5-480. */
export function estimateFor(d: Data, t: Task): Estimate {
  const p = settingsOf(d).planning;
  if (t.estimateMin !== null) return { min: t.estimateMin, source: 'set', samples: 0 };
  if (p.learnEstimates) {
    const sample = similarFinished(d, t);
    if (sample.length >= LEARN_MIN_SAMPLES) {
      const min = Math.min(480, Math.max(5, Math.round(median(sample.map((x) => actualFocusMin(d, x))) / 5) * 5));
      return { min, source: 'learned', samples: sample.length };
    }
  }
  return { min: p.defaultBlockMin, source: 'default', samples: 0 };
}

export const estimateMin = (d: Data, t: Task): number => estimateFor(d, t).min;
