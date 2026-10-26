// Test fixtures: data and commands with a fixed clock. T0 = Mon 2026-10-26 09:00 WIB.
import { apply, type Command } from '../src/core/commands';
import { emptyData } from '../src/core/model/defaults';
import type { Data } from '../src/core/model/types';
import { zonedToUtc } from '../src/core/time/zone';

export const TZ = 'Asia/Jakarta';
export const TODAY = '2026-10-26';
export const at = (min: number, date = TODAY) => zonedToUtc(date, min, TZ);
export const T0 = at(9 * 60);
export const SEC = 1000;
export const MIN = 60_000;
export const HOUR = 60 * MIN;
export const ctx = (now = T0, deviceId = 'devA') => ({ now, deviceId, deviceName: deviceId });

/** Run commands in order, failing loudly; returns the data and the id of the last created record. */
export function run(d: Data, ...cmds: (Command | [Command, number])[]): { d: Data; id: string } {
  let out = d;
  let id = '';
  for (const c of cmds) {
    const [cmd, now] = Array.isArray(c) ? c : [c, T0];
    const r = apply(out, cmd, ctx(now));
    if (!r.ok) throw new Error(`${cmd.type}: ${r.error} ${JSON.stringify(r.fields ?? {})}`);
    out = r.d;
    if (r.id) id = r.id;
  }
  return { d: out, id };
}

export function addTask(d: Data, title: string, extra: Record<string, unknown> = {}): { d: Data; id: string } {
  return run(d, { type: 'task.create', input: { title, finishCondition: `Done when ${title} ships`, ...extra } });
}

export const fresh = (): Data => emptyData();
