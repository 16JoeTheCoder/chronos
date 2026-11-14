import type { ChronosTheme, ResolvedTheme, ThemeOverride } from './types';

/** 'tars-gargantua/night' -> { base: 'tars-gargantua', variant: 'night' }. */
export function parseThemeId(id: string): { base: string; variant?: string } {
  const i = id.indexOf('/');
  return i < 0 ? { base: id } : { base: id.slice(0, i), variant: id.slice(i + 1) };
}

function isObj(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function merge(base: unknown, over: unknown): unknown {
  if (!isObj(base) || !isObj(over)) return over === undefined ? base : over;
  const out: Record<string, unknown> = { ...base };
  for (const k of Object.keys(over)) out[k] = merge(base[k], over[k]);
  return out;
}

/** Names of a theme's variants (empty when it has none). */
export function variantNames(theme: ChronosTheme): string[] {
  return Object.keys(theme.variants ?? {});
}

/** Flatten a theme to one variant. Unknown/absent variant -> defaultVariant -> first variant -> base. */
export function resolveVariant(theme: ChronosTheme, variant?: string): ResolvedTheme & { variant?: string } {
  const { variants, defaultVariant, ...base } = theme;
  const names = Object.keys(variants ?? {});
  const pick = variant && names.includes(variant) ? variant : defaultVariant && names.includes(defaultVariant) ? defaultVariant : names[0];
  if (!variants || !pick) return base;
  const over: ThemeOverride | undefined = variants[pick];
  return { ...(merge(base, over) as ResolvedTheme), variant: pick };
}
