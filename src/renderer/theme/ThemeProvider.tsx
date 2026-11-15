import { createContext, useContext, useEffect, useLayoutEffect, useMemo, useState, type ReactNode } from 'react';
import { minutesOfDay, resolveActiveTheme, themeToCssVars, type ChronosTheme, type ResolvedTheme, type ScheduleEntry } from '../../core/theme';
import { findTheme } from '../themes';
import '../themes/fonts';

export interface ThemeEnergy {
  /** Master motion switch (Settings). false = data-motion="off". Default true. */
  motion?: boolean;
  livingReactor?: boolean;
  holographicDepth?: boolean;
  reactiveData?: boolean;
}

export interface ActiveTheme {
  /** Flattened theme (variant applied). */
  theme: ResolvedTheme;
  /** Effective id incl. variant suffix, e.g. "tars-gargantua/night". */
  id: string;
  variant?: string;
  /** True when motion is disabled by the switch or prefers-reduced-motion. */
  motionOff: boolean;
  energy: ThemeEnergy;
}

const Ctx = createContext<ActiveTheme | null>(null);

/** The resolved theme. Throws outside <ThemeProvider>. */
export function useTheme(): ActiveTheme {
  const v = useContext(Ctx);
  if (!v) throw new Error('useTheme must be used inside <ThemeProvider>');
  return v;
}
/** Same, but null outside a provider (used by presentational components). */
export const useOptionalTheme = () => useContext(Ctx);

const REDUCED = '(prefers-reduced-motion: reduce)';
const NO_ENERGY: ThemeEnergy = {};

export interface ThemeProviderProps {
  themeId: string;
  themeSchedule: ScheduleEntry[];
  customThemes: ChronosTheme[];
  energy?: ThemeEnergy;
  children: ReactNode;
}

export function ThemeProvider({ themeId, themeSchedule, customThemes, energy = NO_ENERGY, children }: ThemeProviderProps) {
  const [now, setNow] = useState(() => minutesOfDay(new Date()));
  const [reduced, setReduced] = useState(() => !!window.matchMedia?.(REDUCED).matches);

  // Re-resolve the schedule every minute, on focus and on visibility change (resume from sleep).
  useEffect(() => {
    const tick = () => setNow(minutesOfDay(new Date()));
    const id = window.setInterval(tick, 60_000);
    const onVis = () => { if (!document.hidden) tick(); };
    window.addEventListener('focus', tick);
    document.addEventListener('visibilitychange', onVis);
    tick();
    return () => {
      window.clearInterval(id);
      window.removeEventListener('focus', tick);
      document.removeEventListener('visibilitychange', onVis);
    };
  }, []);

  useEffect(() => {
    const mq = window.matchMedia?.(REDUCED);
    if (!mq) return;
    const on = () => setReduced(mq.matches);
    mq.addEventListener('change', on);
    return () => mq.removeEventListener('change', on);
  }, []);

  const activeId = resolveActiveTheme(themeId, themeSchedule, now);
  const active = useMemo<ActiveTheme>(() => {
    const t = findTheme(activeId, customThemes);
    const motionOff = energy.motion === false || reduced;
    return { theme: t, id: t.variant ? `${t.id}/${t.variant}` : t.id, variant: t.variant, motionOff, energy };
  }, [activeId, customThemes, energy, reduced]);

  useLayoutEffect(() => {
    const root = document.documentElement;
    const vars = themeToCssVars(active.theme);
    for (const [k, v] of Object.entries(vars)) root.style.setProperty(k, v);
    root.style.colorScheme = active.theme.mode;
    root.dataset.themeId = active.id;
    root.dataset.mode = active.theme.mode;
    root.dataset.signature = active.theme.motion.signature.kind;
    if (active.motionOff) root.dataset.motion = 'off'; else delete root.dataset.motion;
    const flag = (name: string, on?: boolean) => { if (on) root.dataset[name] = 'on'; else delete root.dataset[name]; };
    flag('livingReactor', active.energy.livingReactor);
    flag('holographicDepth', active.energy.holographicDepth);
    flag('reactiveData', active.energy.reactiveData);
    return () => { for (const k of Object.keys(vars)) root.style.removeProperty(k); };
  }, [active]);

  return <Ctx.Provider value={active}>{children}</Ctx.Provider>;
}
