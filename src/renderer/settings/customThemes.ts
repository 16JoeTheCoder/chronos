// Custom themes imported in Settings. The synced model has no field that can hold a theme
// (settings.customTheme is a flat string map, 64 entries of 64 characters), so they live in this
// device's localStorage. The app mounts them with <ThemeProvider customThemes={useCustomThemes()}>.

import { useSyncExternalStore } from 'react';
import { validateTheme, type ChronosTheme } from '../../core/theme';
import { BUNDLED_FONT_FAMILIES, builtInThemes } from '../themes';

const KEY = 'chronos.customThemes.v1';
const subs = new Set<() => void>();
let cache: { raw: string | null; themes: ChronosTheme[] } | null = null;
const EMPTY: ChronosTheme[] = [];

function read(): ChronosTheme[] {
  let raw: string | null = null;
  try { raw = localStorage.getItem(KEY); } catch { /* storage blocked */ }
  if (cache && cache.raw === raw) return cache.themes;
  let themes = EMPTY;
  try {
    const j: unknown = raw ? JSON.parse(raw) : [];
    // Re-validate on load: a hand-edited or older entry never reaches the theme engine.
    if (Array.isArray(j)) themes = j.filter((t) => validateTheme(t, { bundledFamilies: BUNDLED_FONT_FAMILIES }).ok) as ChronosTheme[];
  } catch { /* corrupt: none */ }
  cache = { raw, themes };
  return themes;
}

export const loadCustomThemes = (): ChronosTheme[] => read();

function write(themes: ChronosTheme[]): boolean {
  try { localStorage.setItem(KEY, JSON.stringify(themes)); } catch { return false; }
  cache = null;
  subs.forEach((f) => f());
  return true;
}

/** Add or replace (same id) a validated theme. Built-in ids are refused. */
export function saveCustomTheme(theme: ChronosTheme): { ok: true } | { ok: false; error: string } {
  if (builtInThemes.some((t) => t.id === theme.id)) return { ok: false, error: `"${theme.id}" is a built-in theme id. Change the "id" in the file and import again.` };
  const rest = read().filter((t) => t.id !== theme.id);
  return write([...rest, theme]) ? { ok: true } : { ok: false, error: 'This device would not store the theme (storage is blocked).' };
}

export function removeCustomTheme(id: string): void {
  write(read().filter((t) => t.id !== id));
}

export function useCustomThemes(): ChronosTheme[] {
  return useSyncExternalStore((f) => { subs.add(f); return () => subs.delete(f); }, read, () => EMPTY);
}
