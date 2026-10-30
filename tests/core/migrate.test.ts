// Schema load (defaults filled) and the Monolith import (idempotent, never automatic).
import { describe, expect, it } from 'vitest';
import { emptyData } from '../../src/core/model/defaults';
import { newId } from '../../src/core/model/ids';
import { fromMonolith, migrate } from '../../src/core/repo/migrate';
import { live, settingsOf } from '../../src/core/repo/repo';
import { ctx } from '../helpers';

describe('migrate', () => {
  it('rejects unknown files and fills missing settings with defaults', () => {
    expect(migrate({ version: 2 })).toBeNull();
    const d = migrate({ schema: 1, settings: { main: { displayName: 'J', timeLeft: { gapFilterMin: 10 } } } })!;
    expect(settingsOf(d).displayName).toBe('J');
    expect(settingsOf(d).timeLeft).toEqual({ gapFilterMin: 10, transitionMin: 0, mealReserveMin: 0 });
    expect(settingsOf(d).timezone).toBe('Asia/Jakarta');
    expect(d.tasks).toEqual({});
    expect(newId()).toMatch(/^[0-9a-f-]{36}$/);
  });
});

describe('import from Monolith', () => {
  const file = {
    version: 2,
    tasks: [
      { id: 'a1', name: 'Write report', finishCondition: 'Report sent to the client', priority: 'high', estimateMs: 1_800_000, status: 'completed', workMs: 2_000_000, breakMs: 0, completedAt: 5, sessions: [{ startedAt: 1, endedAt: 2_000_001, ms: 2_000_000, kind: 'work' }] },
      { id: 'a2', name: 'Plan week', finishCondition: 'Plan written down', priority: 'none', status: 'queued', workMs: 0 },
      'junk',
    ],
  };

  it('maps tasks and history, and importing twice changes nothing', () => {
    const r = fromMonolith(emptyData(), file, ctx());
    expect(r.count).toBe(2);
    const done = r.d.tasks['mono-a1']!;
    expect(done).toMatchObject({ title: 'Write report', priority: 'must', estimateMin: 30, status: 'done', outcome: 'finished', workMs: 2_000_000 });
    expect(live(r.d, 'sessions')).toHaveLength(1);
    expect(r.d.tasks['mono-a2']?.priority).toBe('should');
    const again = fromMonolith(r.d, file, ctx());
    expect(again.count).toBe(0);
    expect(again.d).toBe(r.d);
  });
});
