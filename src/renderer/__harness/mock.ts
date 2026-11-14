import { apply, type Command } from '../../core/commands';
import { emptyData } from '../../core/model/defaults';
import type { Data, Snapshot } from '../../core/model/types';
import { themeToCssVars } from '../../core/theme';
import { findTheme } from '../themes';
import '../themes/fonts';
export const params = new URLSearchParams(location.search);
const themeId = params.get('theme') ?? 'tactile-instrument';
const N = Number(params.get('n') ?? 0);
const th = findTheme(themeId);
for (const [k, v] of Object.entries(themeToCssVars(th))) document.documentElement.style.setProperty(k, v);
document.documentElement.dataset.mode = th.mode;
document.documentElement.style.colorScheme = th.mode;
document.body.style.color = 'var(--c-text)';

const TZ = 'Asia/Jakarta';
const NOW = Date.now();
let d: Data = emptyData();
const ctx = (now: number) => ({ now, deviceId: 'h', deviceName: 'h' });
const run = (c: Command, now = NOW) => { const r = apply(d, c, ctx(now)); if (r.ok) d = r.d; return r; };
export const pr = ['Robotics club', 'Physics', 'Chronos'].map((name) => run({ type: 'project.create', name }).id!);
const samples: [string, number, number | null][] = [
  ['Check-in: slept badly, but the servo tuning finally clicked.\nTomorrow: finish the gearbox drawings.', 0, 0],
  ['Plan for the afternoon\n- finish the report\n- call mom tomorrow 5pm\nemail Sarah\nmath hw', 0, 1],
  ['Servo noise is back. Probably the "quick brown" ground loop again; need a scope.', 1, 0],
  ['- order new servos\n- [] book the lab slot\nThinking about whether to rebuild the arm in aluminium.', 2, 0],
  ['Lunch with the team went long, good talk about the competition scope.', 3, null],
  ['Physics: pendulum demo works with a second line about springs.\n- write up results', 5, 1],
  ['Short one.', 6, null],
];
for (let i = 0; i < Math.max(N, 14); i++) {
  const s = samples[i % samples.length]!;
  const t = NOW - (i < 14 ? s[1] * 86_400_000 + i * 3_600_000 : i * 1_800_000 * 3);
  const text = i < 14 ? s[0] : `${s[0].split('\n')[0]} #${i}`;
  const r = run({ type: 'idea.add', text, taskId: null, projectId: s[2] === null ? null : pr[s[2]!]! }, t);
  const tasks = text.split('\n').filter((l) => l.startsWith('- ')).slice(0, 2);
  if (i < 6) {
    const links: string[] = [];
    tasks.forEach((l) => { const li = text.split('\n').indexOf(l); const tr = run({ type: 'task.create', input: { title: l.slice(2), source: 'parsed' } }, t); links.push(`L${li}:${tr.id}`); if (links.length === 2) run({ type: 'task.finish', id: tr.id }, t); });
    if (links.length) run({ type: 'idea.edit', id: r.id!, parsedTaskIds: links }, t + (i === 1 ? 300_000 : 0));
  }
}
const s0 = d.settings.main!; d = { ...d, settings: { ...d.settings, main: { ...s0, timezone: TZ } } };
let device = { composerProjectId: pr[0] } as unknown as Snapshot['device'];
const listeners = new Set<(s: Snapshot) => void>();
const snap = (): Snapshot => ({ data: d, device, sync: null } as unknown as Snapshot);
(window as unknown as { chronos: unknown }).chronos = {
  getSnapshot: async () => snap(),
  onSnapshot: (cb: (s: Snapshot) => void) => { listeners.add(cb); return () => listeners.delete(cb); },
  command: async (c: Command) => {
    if (c.type === 'device.update') { device = { ...device, ...(c.patch as object) } as Snapshot['device']; listeners.forEach((l) => l(snap())); return { ok: true }; }
    const r = run(c, Date.now()); listeners.forEach((l) => l(snap())); return r.ok ? { ok: true, id: r.id } : r;
  },
  win: { mark() {} },
};
