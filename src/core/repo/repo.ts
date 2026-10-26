// The only write path for synced entities. Every create/update/recycle/restore
// stamps updatedAt (strictly increasing per record, so a local edit always beats
// its own previous version even if the clock stepped back), deviceId and v.

import { newId } from '../model/ids';
import { SCHEMA_V, type ActiveTimer, type Base, type Coll, type Data, type Rec, type Settings } from '../model/types';

export interface Ctx {
  now: number;
  deviceId: string;
}

export type Fields<C extends Coll> = Omit<Rec<C>, keyof Base>;

function stamp<T extends Base>(rec: T, prev: Base | undefined, ctx: Ctx): T {
  return { ...rec, updatedAt: prev ? Math.max(ctx.now, prev.updatedAt + 1) : ctx.now, deviceId: ctx.deviceId, v: SCHEMA_V };
}

function store<C extends Coll>(d: Data, coll: C, rec: Rec<C>): Data {
  return { ...d, [coll]: { ...d[coll], [rec.id]: rec } };
}

export function get<C extends Coll>(d: Data, coll: C, id: string | null | undefined): Rec<C> | undefined {
  return id ? (d[coll] as Record<string, Rec<C>>)[id] : undefined;
}

/** Records that are not in the recycle bin. */
export function live<C extends Coll>(d: Data, coll: C): Rec<C>[] {
  return Object.values(d[coll] as Record<string, Rec<C>>).filter((r) => r.deletedAt === null);
}

export function create<C extends Coll>(d: Data, coll: C, fields: Fields<C>, ctx: Ctx, id: string = newId()): { d: Data; rec: Rec<C> } {
  const existing = get(d, coll, id);
  const rec = stamp({ ...fields, id, createdAt: existing?.createdAt ?? ctx.now, updatedAt: 0, deviceId: '', deletedAt: null, v: SCHEMA_V } as Rec<C>, existing, ctx);
  return { d: store(d, coll, rec), rec };
}

/** Patch a record. Unknown ids are a no-op, so callers never write a phantom record. */
export function update<C extends Coll>(d: Data, coll: C, id: string, patch: Partial<Fields<C>>, ctx: Ctx): Data {
  const prev = get(d, coll, id);
  return prev ? store(d, coll, stamp({ ...prev, ...patch }, prev, ctx)) : d;
}

export function recycle(d: Data, coll: Coll, id: string, ctx: Ctx): Data {
  const prev = get(d, coll, id);
  return prev && prev.deletedAt === null ? store(d, coll, stamp({ ...prev, deletedAt: ctx.now }, prev, ctx)) : d;
}

export function restore(d: Data, coll: Coll, id: string, ctx: Ctx): Data {
  const prev = get(d, coll, id);
  return prev && prev.deletedAt !== null ? store(d, coll, stamp({ ...prev, deletedAt: null }, prev, ctx)) : d;
}

/** Store a record exactly as received (sync merge only: keeps the remote stamp). */
export function putRaw<C extends Coll>(d: Data, coll: C, rec: Rec<C>): Data {
  return store(d, coll, rec);
}

export const settingsOf = (d: Data): Settings => d.settings.main as Settings;
export const timerOf = (d: Data): ActiveTimer => d.timer.current as ActiveTimer;

export function updateSettings(d: Data, patch: Partial<Fields<'settings'>>, ctx: Ctx): Data {
  return update(d, 'settings', 'main', patch, ctx);
}
