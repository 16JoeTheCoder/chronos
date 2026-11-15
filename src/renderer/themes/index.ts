import { parseThemeId, resolveVariant, variantNames, type ChronosTheme, type ResolvedTheme } from '../../core/theme';
import tactile from './tactile-instrument.chronos-theme.json';
import stark from './stark-workshop.chronos-theme.json';
import tarsGargantua from './tars-gargantua.chronos-theme.json';

export const builtInThemes = [tactile, stark, tarsGargantua] as unknown as ChronosTheme[];
export const DEFAULT_THEME_ID = 'tactile-instrument';

/** Font families bundled via ./fonts.ts, for validateTheme's `bundledFamilies` option. */
export const BUNDLED_FONT_FAMILIES = [
  'Hanken Grotesk', 'Martian Mono', 'Chakra Petch', 'Sora', 'Red Hat Display', 'Red Hat Mono', 'Michroma', 'Red Hat Text',
];

/** Selectable ids: one per theme, or one per variant ("tars-gargantua/night"). */
export function listThemeChoices(custom: ChronosTheme[] = []): { id: string; name: string; mode: 'light' | 'dark' }[] {
  return [...builtInThemes, ...custom].flatMap((t) => {
    const names = variantNames(t);
    if (!names.length) return [{ id: t.id, name: t.name, mode: t.mode }];
    return names.map((v) => {
      const r = resolveVariant(t, v);
      return { id: `${t.id}/${v}`, name: r.name, mode: r.mode };
    });
  });
}

/** Resolve an id (bare or "base/variant") to a flattened theme. Unknown ids fall back to the default theme. */
export function findTheme(themeId: string, custom: ChronosTheme[] = []): ResolvedTheme & { variant?: string } {
  const { base, variant } = parseThemeId(themeId);
  const all = [...custom, ...builtInThemes];
  const t = all.find((x) => x.id === base) ?? builtInThemes.find((x) => x.id === DEFAULT_THEME_ID)!;
  return resolveVariant(t, variant);
}
