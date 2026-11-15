import { describe, expect, it } from 'vitest';
import { clampToDay, effectiveSnap, fixedPreview, intentFor, laneAccepts, nudge, snapMinute } from '../../src/renderer/runway/dnd';
import type { DragItem } from '../../src/renderer/components/drag';

const env = { snapMin: 15, free: false, dayStartMin: 480, dayEndMin: 1380, blocks: [[600, 660]] as [number, number][] };

describe('snapping', () => {
  it('snaps to settings.snapMin and Alt frees it', () => {
    expect(snapMinute(607, 15)).toBe(600);
    expect(snapMinute(608, 15)).toBe(615);
    expect(snapMinute(607, 15, true)).toBe(607);
    expect(effectiveSnap(30, true)).toBe(1);
    expect(snapMinute(619, 30)).toBe(630);
    expect(snapMinute(612, 10)).toBe(610);
    expect(snapMinute(612, 5)).toBe(610);
  });
  it('keeps a range inside the day', () => {
    expect(clampToDay(470, 60, 480, 1380)).toEqual({ startMin: 480, endMin: 540 });
    expect(clampToDay(1370, 60, 480, 1380)).toEqual({ startMin: 1320, endMin: 1380 });
  });
});

describe('fixed lane preview', () => {
  it('uses the grab offset, snaps, and rejects a block overlap', () => {
    const ok = fixedPreview(725, 60, 20, env);
    expect(ok).toEqual({ startMin: 705, endMin: 765, valid: true });
    const bad = fixedPreview(630, 60, 0, env);
    expect(bad.valid).toBe(false);
  });
  it('Alt gives whole-minute starts', () => {
    expect(fixedPreview(707, 30, 0, { ...env, free: true }).startMin).toBe(707);
  });
});

describe('drop intents', () => {
  const pv = { startMin: 700, endMin: 760, valid: true };
  const task: DragItem = { kind: 'task', taskId: 't1', title: 'T', dur: 60 };
  const block: DragItem = { kind: 'block', blockId: 'b1', title: 'B', mode: 'move', offsetMin: 0 };
  const ev: DragItem = { kind: 'event', eventId: 'e1', title: 'E', date: '2026-11-14', recurring: true, durMin: 60 };
  const tray: DragItem = { kind: 'event', eventId: 'e2', title: 'U', date: '2026-11-14', recurring: false, unplaced: true, durMin: 45 };

  it('maps lane x item to an operation', () => {
    expect(intentFor(task, 'plan', pv)?.op).toBe('block.create');
    expect(intentFor(task, 'fixed', pv)?.op).toBe('task.toEvent');
    expect(intentFor(block, 'plan', pv)?.op).toBe('block.move');
    expect(intentFor(block, 'fixed', pv)?.op).toBe('block.toEvent');
    expect(intentFor(block, 'cards', null)?.op).toBe('block.unplan');
    expect(intentFor(ev, 'fixed', pv)?.op).toBe('event.move');
    expect(intentFor(ev, 'plan', pv)?.op).toBe('event.toBlock');
    expect(intentFor(ev, 'cards', null)?.op).toBe('event.toCard');
    expect(intentFor(tray, 'fixed', pv)).toEqual({ op: 'event.place', eventId: 'e2', startMin: 700 });
  });
  it('an invalid preview or an unplaced event in the wrong lane does nothing', () => {
    expect(intentFor(task, 'plan', { ...pv, valid: false })).toBeNull();
    expect(intentFor(tray, 'plan', pv)).toBeNull();
    expect(intentFor(tray, 'cards', null)).toBeNull();
    expect(laneAccepts('plan', tray)).toBe(false);
    expect(laneAccepts('fixed', tray)).toBe(true);
    expect(laneAccepts('cards', task)).toBe(false);
  });
});

describe('keyboard nudge', () => {
  it('moves by one grid step, three with Shift, and refuses to leave the day', () => {
    expect(nudge({ startMin: 600, endMin: 660 }, 1, 15, false, 480, 1380)).toEqual({ startMin: 615, endMin: 675 });
    expect(nudge({ startMin: 600, endMin: 660 }, -1, 15, true, 480, 1380)).toEqual({ startMin: 555, endMin: 615 });
    expect(nudge({ startMin: 480, endMin: 540 }, -1, 15, false, 480, 1380)).toBeNull();
  });
});
