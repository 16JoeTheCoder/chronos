// The palette's ">" commands as data (pure, unit-tested). Palette.tsx turns an action into effects.
import type { Data } from '../../core/model/types';
import { live } from '../../core/repo/repo';
import { activeTask } from '../../core/tasks/tasks';
import type { Screen } from '../components/Rail';

export type PalAction =
  | { kind: 'go'; to: Screen }
  | { kind: 'timer'; action: 'start' | 'pause' }
  | { kind: 'plan' }
  | { kind: 'replan' }
  | { kind: 'project'; id: string }
  | { kind: 'theme'; id: string }
  | { kind: 'misparse' }
  | { kind: 'ask'; text: string };

export interface PalCommand { key: string; label: string; hint?: string; action: PalAction }

const SCREENS: { to: Screen; label: string; hint: string }[] = [
  { to: 'home', label: 'Go to Home', hint: 'Esc' },
  { to: 'plan', label: 'Go to Plan', hint: 'P' },
  { to: 'focus', label: 'Go to Focus', hint: 'F' },
  { to: 'tasks', label: 'Go to Tasks', hint: 'G T' },
  { to: 'board', label: 'Go to Board', hint: '' },
  { to: 'log', label: 'Go to Log', hint: 'Ctrl L' },
  { to: 'cache', label: 'Go to Cache', hint: 'Ctrl Shift C' },
  { to: 'settings', label: 'Go to Settings', hint: '' },
];

/** Commands matching `needle` (the text after ">"), in display order. */
export function paletteCommands(d: Data, needle: string, themes: { id: string; name: string }[]): PalCommand[] {
  const n = needle.trim().toLowerCase();
  const running = activeTask(d)?.runtime.status === 'running';
  const all: PalCommand[] = [
    ...SCREENS.map((s) => ({ key: `go:${s.to}`, label: s.label, hint: s.hint || undefined, action: { kind: 'go', to: s.to } as PalAction })),
    { key: 'timer', label: running ? 'Pause timer' : 'Start timer', hint: 'Space in Focus', action: { kind: 'timer', action: running ? 'pause' : 'start' } },
    { key: 'plan', label: 'Plan the day', hint: 'fill free time', action: { kind: 'plan' } },
    { key: 'replan', label: 'Re-plan', hint: 'move missed blocks forward', action: { kind: 'replan' } },
    ...live(d, 'projects').filter((p) => !p.archived).sort((a, b) => (a.sortKey < b.sortKey ? -1 : 1)).map((p) => ({ key: `project:${p.id}`, label: `Switch project: ${p.name}`, hint: 'Board', action: { kind: 'project', id: p.id } as PalAction })),
    ...themes.map((t) => ({ key: `theme:${t.id}`, label: `Switch theme: ${t.name}`, action: { kind: 'theme', id: t.id } as PalAction })),
    { key: 'misparse', label: 'Report misparse', hint: 'the last thing you added', action: { kind: 'misparse' } },
  ];
  if (n.startsWith('ask')) return [{ key: 'ask', label: `Ask Claude: "${needle.trim().slice(3).trim().slice(0, 60)}"`, hint: 'Enter', action: { kind: 'ask', text: needle.trim().slice(3).trim() } }];
  if (!n) return all;
  const words = n.split(/\s+/);
  return all.filter((c) => { const l = c.label.toLowerCase(); return words.every((w) => l.includes(w)); });
}
