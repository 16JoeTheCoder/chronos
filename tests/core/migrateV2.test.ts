// Schema 1 -> 2 migration against a realistic data file shaped like the owner's.
import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { migrate } from '../../src/core/repo/migrate';
import { isSortKey } from '../../src/core/model/sortKey';
import { COLLS, type Coll, type Data } from '../../src/core/model/types';
import { recordProblem } from '../../src/core/validation';
import { TODAY } from '../helpers';

type Obj = Record<string, any>;
const v1: Obj = JSON.parse(fs.readFileSync(path.join(__dirname, '../fixtures/v1-josef.json'), 'utf8'));
const load = (): Obj => structuredClone(v1);
const mig = (): Data => migrate(load(), TODAY) as Data;
const recs = (d: Data, c: Coll) => Object.values(d[c] as Record<string, Obj>);

describe('migrate v1 -> current (Josef fixture)', () => {
  it('has the shape the fixture promises', () => {
    expect(v1.schema).toBe(1);
    expect(Object.keys(v1.tasks).length).toBeGreaterThanOrEqual(8);
    expect(v1.events['ev-math-a'].recur.everyNWeeks).toBe(2);
    expect(v1.closures['hol-2026-12-25']).toBeTruthy();
    expect(Object.keys(v1.tombs.tasks)).toHaveLength(1);
    expect(v1.tasks['t-calc-hw'].deadline).toBe('2026-10-30');
  });

  it('returns schema 3 with projects and reviews present and empty', () => {
    const d = mig();
    expect(d).not.toBeNull();
    expect(d.schema).toBe(3);
    expect(d.projects).toEqual({});
    expect(d.reviews).toEqual({});
    for (const c of COLLS) expect(d[c]).toBeTypeOf('object');
  });

  it('does not mutate its input', () => {
    const input = load();
    migrate(input, TODAY);
    expect(input).toEqual(v1);
  });

  it('is lossless: every v1 field value is still present', () => {
    const d = mig();
    const special: Partial<Record<Coll, string[]>> = { tasks: ['deadline', 'status'], eventExceptions: ['kind'], ideas: [] };
    for (const c of COLLS) {
      if (c === 'projects' || c === 'reviews') continue;
      const before = v1[c] as Obj;
      const after = d[c] as Record<string, Obj>;
      expect(Object.keys(after).sort(), c).toEqual(Object.keys(before).sort());
      for (const [id, rec] of Object.entries(before)) {
        for (const [k, val] of Object.entries(rec)) {
          if (k === 'v' || (special[c] ?? []).includes(k)) continue;
          expect(after[id]?.[k], `${c}/${id}.${k}`).toEqual(val);
        }
      }
    }
    expect(d.tombs).toEqual(v1.tombs);
  });

  it('moves deadline into dueDate', () => {
    const d = mig();
    expect(d.tasks['t-calc-hw']?.dueDate).toBe('2026-10-30');
    expect(d.tasks['t-lab-report']?.dueDate).toBe('2026-11-02');
    expect(d.tasks['t-read-ch4']?.dueDate).toBeNull();
    for (const t of recs(d, 'tasks')) expect('deadline' in t).toBe(false);
  });

  it('maps statuses: queued -> planned/inbox by future block, active -> doing, done stays with its outcome', () => {
    const d = mig();
    expect(d.tasks['t-calc-hw']?.status).toBe('planned'); // block today
    expect(d.tasks['t-lab-report']?.status).toBe('planned'); // block later this week
    expect(d.tasks['t-essay']?.status).toBe('inbox'); // only a past block
    expect(d.tasks['t-read-ch4']?.status).toBe('inbox');
    expect(d.tasks['mono-abc123']?.status).toBe('inbox');
    expect(d.tasks['t-sprint-app']?.status).toBe('doing');
    expect(d.tasks['t-done-quiz']).toMatchObject({ status: 'done', outcome: 'finished' });
    expect(d.tasks['t-killed-sprint']).toMatchObject({ status: 'done', outcome: 'killed' });
    expect(d.tasks['t-shipped-sprint']).toMatchObject({ status: 'done', outcome: 'shipped' });
  });

  it('a block dated yesterday does not count as planned, one dated today does', () => {
    const input = load();
    const d = migrate(input, '2026-10-21') as Data; // essay block is on 2026-10-20: past
    expect(d.tasks['t-essay']?.status).toBe('inbox');
    const e = migrate(load(), '2026-10-20') as Data;
    expect(e.tasks['t-essay']?.status).toBe('planned');
  });

  it('fills the new task fields with their defaults', () => {
    const d = mig();
    for (const t of recs(d, 'tasks')) {
      expect(t.dueTime).toBeNull();
      expect(t.projectId).toBeNull();
      expect(t.columnId).toBeNull();
      expect(t.recurrence).toBeNull();
      expect(t.recurrenceParentId).toBeNull();
      expect(isSortKey(t.sortKey)).toBe(true);
    }
    expect(d.tasks['mono-abc123']?.source).toBe('import');
    expect(d.tasks['t-calc-hw']?.source).toBe('typed');
  });

  it('turns exceptions into skip / edit with null overrides', () => {
    const d = mig();
    expect(d.eventExceptions['x-ev-math-a-2026-11-09']).toMatchObject({ kind: 'skip', title: null, startMin: null, endMin: null, tagId: null });
    expect(d.eventExceptions['x-ev-chem-2026-10-30']).toMatchObject({ kind: 'edit', startMin: 600, endMin: 690, title: null, tagId: null });
  });

  it('blocks get auto false, ideas get body = text and no parsed tasks', () => {
    const d = mig();
    for (const b of recs(d, 'blocks')) expect(b.auto).toBe(false);
    for (const [id, n] of Object.entries(d.ideas)) {
      expect(n.body).toBe(v1.ideas[id].text);
      expect(n.parsedTaskIds).toEqual([]);
    }
  });

  it('keeps recurring week A/B events and the holiday closure intact', () => {
    const d = mig();
    expect(d.events['ev-math-a']?.recur).toEqual(v1.events['ev-math-a'].recur);
    expect(d.events['ev-bio-b']?.recur?.everyNWeeks).toBe(2);
    expect(d.events['ev-dentist']?.date).toBe('2026-10-29');
    expect(d.closures['hol-2026-12-25']).toMatchObject({ source: 'holiday', confirmed: false, startDate: '2026-12-25' });
  });

  it('every record has v 3, fv {} and fw {}', () => {
    const d = mig();
    for (const c of COLLS) {
      for (const r of recs(d, c)) {
        expect(r.v, `${c}/${r.id}`).toBe(3);
        expect(r.fv).toEqual({});
        expect(r.fw).toEqual({});
      }
    }
  });

  it('fills the v2 settings defaults without touching stored settings', () => {
    const s = mig().settings.main!;
    expect(s.themeId).toBe('default');
    expect(s.customTheme).toBeNull();
    expect(s.snapMin).toBe(5);
    expect(s.parserRules).toEqual([]);
    expect(s.timeLeft).toEqual({ gapFilterMin: 15, transitionMin: 5, mealReserveMin: 45 });
    expect(s.onboarded).toBe(true);
  });

  it('every migrated record passes recordProblem', () => {
    const d = mig();
    for (const c of COLLS) {
      for (const r of recs(d, c)) expect(recordProblem(c, r), `${c}/${r.id}`).toBeNull();
    }
    for (const [c, stubs] of Object.entries(d.tombs)) for (const s of Object.values(stubs!)) expect(recordProblem(c, s)).toBeNull();
  });

  it('is idempotent: migrate(migrate(v1)) deep-equals migrate(v1)', () => {
    const once = mig();
    const twice = migrate(structuredClone(once), TODAY);
    expect(twice).toEqual(once);
    // also without a date
    const a = migrate(load(), null) as Data;
    expect(migrate(structuredClone(a), null)).toEqual(a);
  });

  it('sortKeys are strictly increasing in v1 order sequence', () => {
    const d = mig();
    const byOrder = Object.values(v1.tasks as Obj).sort((a, b) => a.order - b.order);
    const keys = byOrder.map((t) => d.tasks[t.id]!.sortKey);
    for (let i = 1; i < keys.length; i++) expect(keys[i - 1]! < keys[i]!, `${i}`).toBe(true);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it('returns null for a newer schema and for garbage', () => {
    expect(migrate({ schema: 4 })).toBeNull();
    expect(migrate(null)).toBeNull();
    expect(migrate(undefined)).toBeNull();
    expect(migrate('schema')).toBeNull();
    expect(migrate(42)).toBeNull();
    expect(migrate([])).toBeNull();
    expect(migrate({})).toBeNull();
    expect(migrate({ schema: '1' })).toBeNull();
  });
});
