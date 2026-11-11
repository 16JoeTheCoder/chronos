// SearchIndex: ranking, fuzzy and prefix matching, filters, incremental updates, speed.
import { describe, expect, it } from 'vitest';
import type { Data } from '../../src/core/model/types';
import { SearchIndex } from '../../src/core/search/index';
import { addTask, fresh, run } from '../helpers';

const ids = (idx: SearchIndex, q: string, opts?: Parameters<SearchIndex['search']>[1]) => idx.search(q, opts).map((h) => h.id);
const build = (d: Data) => {
  const idx = new SearchIndex();
  idx.update(d);
  return idx;
};

function world() {
  let d = fresh();
  const title = addTask(d, 'Physics homework', { finishCondition: 'All problems solved', notes: 'chapter 3' });
  d = title.d;
  const body = addTask(d, 'Weekly chores', { finishCondition: 'House is tidy', notes: 'after the physics exam, clean the desk' });
  d = body.d;
  const note = run(d, { type: 'idea.add', text: 'Physics idea: pendulum demo\nwith a second line about springs', taskId: null });
  d = note.d;
  const proj = run(d, { type: 'project.create', name: 'Robotics club' });
  d = proj.d;
  const ev = run(d, { type: 'event.create', input: { title: 'Chemistry lab', tagId: null, scope: 'school', tz: 'Asia/Jakarta', startMin: 540, endMin: 600, date: '2026-10-27', recur: null, notes: 'bring goggles' } });
  d = ev.d;
  return { d, title: title.id, body: body.id, note: note.id, proj: proj.id, ev: ev.id };
}

describe('ranking and matching', () => {
  it('a title match ranks above a body-only match', () => {
    const w = world();
    const hits = build(w.d).search('physics', { types: ['task'] });
    expect(hits.map((h) => h.id)).toEqual([w.title, w.body]);
    expect(hits[0]!.score).toBeGreaterThan(hits[1]!.score);
  });

  it('finds across tasks, notes, projects and events', () => {
    const w = world();
    const idx = build(w.d);
    expect(ids(idx, 'physics')).toEqual(expect.arrayContaining([w.title, w.body, w.note]));
    expect(ids(idx, 'robotics')).toEqual([w.proj]);
    expect(ids(idx, 'goggles')).toEqual([w.ev]);
    expect(idx.search('chemistry')[0]).toMatchObject({ type: 'event', id: w.ev, title: 'Chemistry lab' });
  });

  it('is fuzzy: "physcs" finds Physics', () => {
    const w = world();
    expect(ids(build(w.d), 'physcs')).toContain(w.title);
  });

  it('is prefix: "phy" finds Physics', () => {
    const w = world();
    const r = ids(build(w.d), 'phy');
    expect(r).toContain(w.title);
    expect(r).toContain(w.note);
  });

  it('matches a note by its body, not only the first line', () => {
    const w = world();
    expect(ids(build(w.d), 'springs')).toEqual([w.note]);
  });

  it('every word must match (AND)', () => {
    const w = world();
    const idx = build(w.d);
    expect(ids(idx, 'physics homework')).toEqual([w.title]);
    expect(ids(idx, 'physics zebra')).toEqual([]);
  });

  it('empty and blank queries return nothing; limit is honoured', () => {
    const w = world();
    const idx = build(w.d);
    expect(idx.search('')).toEqual([]);
    expect(idx.search('   ')).toEqual([]);
    expect(idx.search('physics', { limit: 1 })).toHaveLength(1);
    expect(idx.search('physics', { limit: 0 })).toHaveLength(1); // clamped to at least 1
  });

  it('hits carry type, id, title and a numeric score', () => {
    const w = world();
    const h = build(w.d).search('robotics')[0]!;
    expect(h).toEqual({ type: 'project', id: w.proj, title: 'Robotics club', score: expect.any(Number), deleted: false });
  });
});

describe('types filter', () => {
  it('limits results to the given types', () => {
    const w = world();
    const idx = build(w.d);
    expect(ids(idx, 'physics', { types: ['note'] })).toEqual([w.note]);
    expect(ids(idx, 'physics', { types: ['task'] }).sort()).toEqual([w.title, w.body].sort());
    expect(ids(idx, 'physics', { types: ['project', 'event'] })).toEqual([]);
    expect(ids(idx, 'club', { types: ['project'] })).toEqual([w.proj]);
    expect(ids(idx, 'lab', { types: ['event'] })).toEqual([w.ev]);
  });
  it('an empty types array means all types', () => {
    const w = world();
    expect(build(w.d).search('physics', { types: [] }).length).toBeGreaterThanOrEqual(3);
  });
});

describe('deleted records', () => {
  it('recycled records are excluded unless includeDeleted', () => {
    const w = world();
    const d = run(w.d, { type: 'recycle', coll: 'tasks', id: w.title, confirmed: true }, { type: 'recycle', coll: 'ideas', id: w.note, confirmed: true }).d;
    const idx = build(d);
    expect(ids(idx, 'physics')).toEqual([w.body]);
    const all = idx.search('physics', { includeDeleted: true });
    expect(all.map((h) => h.id).sort()).toEqual([w.title, w.body, w.note].sort());
    expect(all.find((h) => h.id === w.title)!.deleted).toBe(true);
    expect(all.find((h) => h.id === w.body)!.deleted).toBe(false);
  });
});

describe('incremental updates', () => {
  it('renaming a task updates results', () => {
    const w = world();
    const idx = build(w.d);
    expect(ids(idx, 'homework')).toEqual([w.title]);
    const d2 = run(w.d, { type: 'task.update', id: w.title, input: { title: 'Chemistry revision' } }).d;
    idx.update(d2);
    expect(ids(idx, 'homework')).toEqual([]);
    expect(ids(idx, 'revision', { types: ['task'] })).toEqual([w.title]);
    expect(ids(idx, 'physics', { types: ['task'] })).toEqual([w.body]);
  });

  it('recycling removes, restoring brings back', () => {
    const w = world();
    const idx = build(w.d);
    const d2 = run(w.d, { type: 'recycle', coll: 'tasks', id: w.title, confirmed: true }).d;
    idx.update(d2);
    expect(ids(idx, 'homework')).toEqual([]);
    const d3 = run(d2, { type: 'restore', coll: 'tasks', id: w.title }).d;
    idx.update(d3);
    expect(ids(idx, 'homework')).toEqual([w.title]);
  });

  it('new records are picked up; the index size tracks the data', () => {
    const w = world();
    const idx = build(w.d);
    const before = idx.size;
    expect(before).toBe(5);
    const d2 = addTask(w.d, 'Brand new zebra task').d;
    idx.update(d2);
    expect(idx.size).toBe(before + 1);
    expect(ids(idx, 'zebra')).toHaveLength(1);
  });

  it('a record dropped from the data (purged) leaves the index', () => {
    const w = world();
    const idx = build(w.d);
    const { [w.title]: _gone, ...rest } = w.d.tasks;
    idx.update({ ...w.d, tasks: rest });
    expect(ids(idx, 'homework')).toEqual([]);
    expect(idx.size).toBe(4);
  });

  it('renaming a tag makes its tasks findable by the new name (and not the old)', () => {
    let w = world();
    const tag = run(w.d, { type: 'tag.create', input: { name: 'Algebra', color: 'tag2', kind: 'class' } });
    const d1 = run(tag.d, { type: 'task.update', id: w.title, input: { tagId: tag.id } }).d;
    const idx = build(d1);
    expect(ids(idx, 'algebra')).toEqual([w.title]);
    const d2 = run(d1, { type: 'tag.update', id: tag.id, input: { name: 'Geometry', color: 'tag2', kind: 'class' } }).d;
    idx.update(d2);
    expect(ids(idx, 'geometry')).toEqual([w.title]);
    expect(ids(idx, 'algebra')).toEqual([]);
    w = { ...w, d: d2 };
  });

  it('renaming a project makes its tasks findable by the new project name', () => {
    const w = world();
    const d1 = run(w.d, { type: 'task.update', id: w.body, input: { projectId: w.proj } }).d;
    const idx = build(d1);
    expect(ids(idx, 'robotics', { types: ['task'] })).toEqual([w.body]);
    // no rename command exists for projects yet: write the record the way core/repo would
    const p = d1.projects[w.proj]!;
    const d2: Data = { ...d1, projects: { ...d1.projects, [w.proj]: { ...p, name: 'Chess society', updatedAt: p.updatedAt + 1 } } };
    idx.update(d2);
    expect(ids(idx, 'chess', { types: ['task'] })).toEqual([w.body]);
    expect(ids(idx, 'robotics', { types: ['task'] })).toEqual([]);
  });

  it('update with unchanged data is a no-op', () => {
    const w = world();
    const idx = build(w.d);
    const before = JSON.stringify(idx.search('physics'));
    idx.update(w.d);
    idx.update(w.d);
    expect(JSON.stringify(idx.search('physics'))).toBe(before);
  });
});

// ---- speed ----
const SYL = ['ba', 'ke', 'li', 'mo', 'nu', 'ra', 'si', 'to', 'vu', 'za', 'phy', 'chem', 'mat', 'his', 'lab', 'ex', 'pro', 'ject', 'read', 'write'];
function words(n: number, seed: number): string[] {
  let s = seed;
  const r = () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296);
  return Array.from({ length: n }, () => Array.from({ length: 2 + Math.floor(r() * 2) }, () => SYL[Math.floor(r() * SYL.length)]).join(''));
}

describe('performance', () => {
  it('5,000 tasks and notes: a query averages under 50 ms (target 10 ms)', () => {
    const proto = addTask(fresh(), 'proto');
    const task = proto.d.tasks[proto.id]!;
    const note = run(fresh(), { type: 'idea.add', text: 'proto', taskId: null });
    const idea = Object.values(note.d.ideas)[0]!;
    const vocab = words(400, 7);
    let s = 99;
    const pick = () => vocab[Math.floor(((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296) * vocab.length)] as string;
    const tasks: Data['tasks'] = {};
    const ideas: Data['ideas'] = {};
    for (let i = 0; i < 2500; i++) {
      const id = `t${i}`;
      tasks[id] = { ...task, id, title: `${pick()} ${pick()} ${pick()}`, finishCondition: `${pick()} ${pick()} done`, notes: Array.from({ length: 12 }, pick).join(' ') };
    }
    for (let i = 0; i < 2500; i++) {
      const id = `n${i}`;
      const body = `${pick()} ${pick()}\n${Array.from({ length: 30 }, pick).join(' ')}`;
      ideas[id] = { ...idea, id, body, text: body.slice(0, 1000) };
    }
    const d: Data = { ...fresh(), tasks, ideas };
    expect(Object.keys(d.tasks).length + Object.keys(d.ideas).length).toBe(5000);

    const idx = new SearchIndex();
    const t0 = performance.now();
    idx.update(d);
    const buildMs = performance.now() - t0;
    expect(idx.size).toBe(5000);

    const queries = Array.from({ length: 50 }, (_, i) => {
      const w = pick();
      return i % 5 === 0 ? w.slice(0, 3) : i % 5 === 1 ? `${w.slice(0, -1)}x` : i % 5 === 2 ? `${w} ${pick()}` : w;
    });
    idx.search(queries[0] as string); // warm up
    const q0 = performance.now();
    let found = 0;
    for (const q of queries) found += idx.search(q, { limit: 20 }).length;
    const avg = (performance.now() - q0) / queries.length;
    console.log(`search: build ${buildMs.toFixed(0)} ms for 5000 docs, ${queries.length} queries averaged ${avg.toFixed(2)} ms (${found} hits)`);
    expect(found).toBeGreaterThan(0);
    expect(avg).toBeLessThan(50);

    // an incremental rename on a big index is cheap
    const t1 = performance.now();
    const t = d.tasks.t42!;
    idx.update({ ...d, tasks: { ...d.tasks, t42: { ...t, title: 'unmistakableword' } } });
    const incMs = performance.now() - t1;
    console.log(`search: incremental rename took ${incMs.toFixed(2)} ms`);
    expect(idx.search('unmistakableword').map((h) => h.id)).toEqual(['t42']);
    expect(incMs).toBeLessThan(100);
  });
});

