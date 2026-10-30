// Startup timing marks (ms since process start), logged and shown in About →
// Copy diagnostics. Targets: app.ready -> home.shown <= 600 ms; launch paint <= 400 ms after show.

import { log } from './log';

const marks: Record<string, number> = {};

export function mark(name: string, ms = performance.now()): void {
  if (name in marks) return;
  marks[name] = Math.round(ms);
  log(`perf ${name} ${marks[name]} ms`);
}

export const perfMarks = (): Record<string, number> => ({ ...marks });
