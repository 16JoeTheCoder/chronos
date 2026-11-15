// Schema 2 -> 3 migration against a realistic Phase 1 file, plus the version gate.
import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { defaultSettings } from '../../src/core/model/defaults';
import { COLLS, SCHEMA_V, type Coll, type Data } from '../../src/core/model/types';
import { migrate } from '../../src/core/repo/migrate';
import { mergeRemote } from '../../src/core/sync/merge';
import type { RemoteDoc } from '../../src/core/sync/provider';
import { recordProblem } from '../../src/core/validation';
import { ctx, TODAY } from '../helpers';

type Obj = Record<string, any>;
const v2: Obj = JSON.parse(fs.readFileSync(path.join(__dirname, '../fixtures/v2-josef.json'), 'utf8'));
const load = (): Obj => structuredClone(v2);
const mig = (): Data => migrate(load(), TODAY) as Data;
const recs = (d: Data, c: Coll) => Object.values(d[c] as Record<string, Obj>);
/** What a Phase 1 (schema 2) client does with a record: it accepts v <= 2 and goes read-only on anything newer. */
const PHASE1_SCHEMA = 2;

describe('migrate v2 -> v3 (Josef fixture)', () => {
  it('the fixture really is a schema 2 file', () => {
    expect(v2.schema).toBe(2);
    expect(Object.values<Obj>(v2.events).every((e) => !('durationMin' in e))).toBe(true);
    expect(Object.values<Obj>(v2.ideas).every((n) => !('projectId' in n))).toBe(true);
    expect(v2.settings.main.planning).toBeUndefined();
    expect(Object.keys(v2.projects)).toHaveLength(1);
    expect(Object.keys(v2.reviews)).toHaveLength(1);
    expect(v2.blocks['b-lab'].auto).toBe(true);
  });

  it('returns schema 3 and does not mutate its input', () => {
    const input = load();
    const d = migrate(input, TODAY) as Data;
    expect(d.schema).toBe(3);
    expect(SCHEMA_V).toBe(3);
    expect(input).toEqual(v2);
  });

  it('is lossless: every v2 value is still there, including sync metadata', () => {
    const d = mig();
    for (const c of COLLS) {
      const before = v2[c] as Obj;
      const after = d[c] as Record<string, Obj>;
      expect(Object.keys(after).sort(), c).toEqual(Object.keys(before).sort());
      for (const [id, rec] of Object.entries(before)) {
        for (const [k, val] of Object.entries(rec)) {
          if (k === 'v') continue;
          expect(after[id]?.[k], `${c}/${id}.${k}`).toEqual(val);
        }
      }
    }
    expect(d.tombs).toEqual(v2.tombs);
    expect(d.tasks['t-calc-hw']?.fv).toEqual({ title: 1700000000000100, status: 1700000000000200 });
    expect(d.blocks['b-lab']?.auto).toBe(true);
    expect(d.settings.main?.customTheme).toEqual({ '--accent': '#ff5b1f' });
    expect(d.settings.main?.snapMin).toBe(15);
    expect(d.settings.main?.parserRules).toEqual([{ keyword: 'lab', kind: 'fixed' }]);
  });

  it('adds the v3 fields with their defaults', () => {
    const d = mig();
    for (const e of recs(d, 'events')) {
      expect(e.startMin).toBe(v2.events[e.id].startMin);
      expect(e.durationMin).toBe(e.endMin - e.startMin);
    }
    expect(d.events['ev-dentist']?.durationMin).toBe(v2.events['ev-dentist'].endMin - v2.events['ev-dentist'].startMin);
    for (const n of recs(d, 'ideas')) expect(n.projectId).toBeNull();
    const def = defaultSettings();
    const s = d.settings.main!;
    expect(s.themeSchedule).toEqual([]);
    expect(s.weeklyFocusTargetH).toBe(20);
    expect(s.sound).toEqual({ enabled: true, volume: 0.35, muteInFocus: false });
    expect(s.energy).toEqual({ livingReactor: true, holographicDepth: true, reactiveData: true, motion: true });
    expect(s.widgets).toEqual({ day: true, momentum: true, notes: true, wellness: true });
    expect(s.parserReports).toEqual([]);
    expect(s.planning).toEqual({ defaultBlockMin: 30, learnEstimates: true, breakAfterMin: 75 });
    expect(s.planning).toEqual(def.planning);
  });

  it('every record is stamped v 3, so a Phase 1 client treats it as newer and goes read-only', () => {
    const d = mig();
    for (const c of COLLS) for (const r of recs(d, c)) expect(r.v, `${c}/${r.id}`).toBe(3);
    for (const c of COLLS) for (const r of recs(d, c)) expect(r.v > PHASE1_SCHEMA, `${c}/${r.id}`).toBe(true);
  });

  it('every migrated record passes recordProblem', () => {
    const d = mig();
    for (const c of COLLS) for (const r of recs(d, c)) expect(recordProblem(c, r), `${c}/${r.id}`).toBeNull();
  });

  it('is idempotent, also through a JSON round trip and from a v1 file', () => {
    const once = mig();
    expect(migrate(structuredClone(once), TODAY)).toEqual(once);
    expect(migrate(JSON.parse(JSON.stringify(once)), null)).toEqual(once);
    const v1 = JSON.parse(fs.readFileSync(path.join(__dirname, '../fixtures/v1-josef.json'), 'utf8'));
    const a = migrate(v1, TODAY) as Data;
    expect(migrate(structuredClone(a), TODAY)).toEqual(a);
    expect(a.schema).toBe(3);
    for (const e of recs(a, 'events')) expect(e.durationMin).toBeGreaterThan(0);
  });

  it('keeps stored v3 values and only fills what is missing', () => {
    const d = load();
    d.schema = 3;
    d.settings.main.planning = { defaultBlockMin: 45, learnEstimates: false, breakAfterMin: 90 };
    d.settings.main.sound = { enabled: false };
    d.events['ev-dentist'].durationMin = 25;
    const out = migrate(d, TODAY) as Data;
    expect(out.settings.main?.planning).toEqual({ defaultBlockMin: 45, learnEstimates: false, breakAfterMin: 90 });
    expect(out.settings.main?.sound).toEqual({ enabled: false, volume: 0.35, muteInFocus: false });
    expect(out.events['ev-dentist']?.durationMin).toBe(25);
  });

  it('caps stored parser reports at 200, newest kept', () => {
    const d = load();
    d.settings.main.parserReports = Array.from({ length: 230 }, (_, i) => ({ at: i, input: `l${i}`, expected: '', actual: '' }));
    const s = (migrate(d, TODAY) as Data).settings.main!;
    expect(s.parserReports).toHaveLength(200);
    expect(s.parserReports[0]?.input).toBe('l30');
    expect(recordProblem('settings', s)).toBeNull();
  });
});

describe('version gate', () => {
  it('refuses a file from a newer schema', () => {
    expect(migrate({ schema: SCHEMA_V + 1 })).toBeNull();
    expect(recordProblem('tasks', { ...Object.values<Obj>(mig().tasks)[0], v: SCHEMA_V + 1 })).toMatch(/newer than this app/);
  });

  it('a pulled doc from a newer app is not merged: it is reported so sync goes read-only', () => {
    const d = mig();
    const doc: RemoteDoc = { coll: 'tags', id: 'tag-math', data: { id: 'tag-math', v: SCHEMA_V + 1, name: 'Future' }, fv: {}, fw: {}, serverUpdatedAt: 5 };
    const r = mergeRemote(d, [doc], new Set(), ctx());
    expect(r.newer).toHaveLength(1);
    expect(r.d.tags['tag-math']?.name).not.toBe('Future');
  });

  it('a new record from a v2 device (no v3 fields) is upgraded, not quarantined', () => {
    const d = mig();
    const base = { id: 'ev-new', v: 2, createdAt: 1, updatedAt: 1, deviceId: 'old', deletedAt: null, title: 'Old client event', tagId: null, scope: 'other', tz: 'Asia/Jakarta', startMin: 600, endMin: 690, date: TODAY, recur: null, notes: '' };
    const note = { id: 'n-new', v: 2, createdAt: 1, updatedAt: 1, deviceId: 'old', deletedAt: null, text: 'hi', body: 'hi', taskId: null, reviewed: false, parsedTaskIds: [] };
    const docs: RemoteDoc[] = [
      { coll: 'events', id: 'ev-new', data: base, fv: {}, fw: {}, serverUpdatedAt: 5 },
      { coll: 'ideas', id: 'n-new', data: note, fv: {}, fw: {}, serverUpdatedAt: 6 },
    ];
    const r = mergeRemote(d, docs, new Set(), ctx());
    expect(r.quarantined).toEqual([]);
    expect(r.d.events['ev-new']).toMatchObject({ durationMin: 90, startMin: 600, endMin: 690 });
    expect(r.d.ideas['n-new']).toMatchObject({ projectId: null });
  });
});
