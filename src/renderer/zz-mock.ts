import { apply } from '../core/commands';
import { defaultDevice, emptyData } from '../core/model/defaults';
import type { Snapshot } from '../core/model/types';
import { zonedToUtc } from '../core/time/zone';

const TZ = 'Asia/Jakarta';
let now = Date.now();
const ctx = () => ({ now: (now += 5), deviceId: 'devA', deviceName: 'PC' });
let data = emptyData();
let device = defaultDevice('devA', 'Josef PC');
const run = (...cmds: any[]) => { for (const c of cmds) { const r = apply(data, c, ctx()); if (!r.ok) throw new Error(r.error); data = r.d; } };
const qs = new URLSearchParams(location.search);
if (qs.get('theme')) run({ type: 'settings.update', patch: { themeId: qs.get('theme') } });
run({ type: 'project.create', name: 'Wind farm simulator' }, { type: 'project.create', name: 'Coding club' });
const pid = Object.values(data.projects)[0]!.id;
const mk = (title: string, col: string, est: number | null, due: string | null) => {
  const r = apply(data, { type: 'task.create', input: { title, finishCondition: 'x'.repeat(10), projectId: pid, columnId: col, estimateMin: est, dueDate: due } } as any, ctx());
  if (!r.ok) throw new Error(r.error); data = r.d;
};
mk('Find NREL 5 MW power curve data', 'todo', 45, '2026-11-15');
mk('Tip-speed ratio clamp at cut-in', 'todo', 30, null);
mk('Write validation section', 'todo', 90, '2026-11-14');
mk('Blade pitch model', 'doing', 90, '2026-11-14');
mk('Rotor geometry import', 'done', 60, null);
mk('Wind speed distribution (Weibull)', 'done', 120, null);
if (qs.get('timetable') !== 'seeded') { /* leave empty to show the seed prompt */ }
void zonedToUtc; void TZ;
const subs = new Set<(s: Snapshot) => void>();
const snapshot = (): Snapshot => ({ data, device: { ...device, experimental: qs.get('exp') === '1' }, pendingGap: null, shortcutError: null, isPackaged: false, version: '3.0.0', platform: 'win32', dataDir: 'C:\\Users\\josef\\AppData\\Roaming\\Chronos', perf: {}, homeView: null,
  sync: { state: 'synced', reason: null, pending: 0, oldestPendingAt: null, lastSyncAt: Date.now() - 60000, email: 'josef@example.com', configured: true },
  diag: { cursors: { tasks: 1731000000000 }, conflicts: [], quarantine: [], snapshots: ['2026-11-13-pre-migrate'], mcp: { enabled: true, running: true, port: 4817, token: 'abcd1234', error: null, bridgePath: '', config: '' } } });
const push = () => subs.forEach((f) => f(snapshot()));
(window as any).chronos = {
  getSnapshot: async () => snapshot(),
  onSnapshot: (cb: any) => { subs.add(cb); return () => subs.delete(cb); },
  onBeep: () => () => {}, onShow: () => () => {}, onNotice: () => () => {},
  command: async (cmd: any) => {
    if (cmd.type === 'device.update') { device = { ...device, ...cmd.patch }; push(); return { ok: true }; }
    try { const r = apply(data, cmd, ctx()); if (!r.ok) return r; data = r.d; push(); return { ok: true, id: r.id }; } catch (e) { return { ok: false, error: String(e) }; }
  },
  win: { mark() {}, restart() {} }, shelf: { list: async () => [], onChange: () => () => {} },
};
