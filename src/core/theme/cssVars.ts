import type { ChronosTheme, FontSpec, ResolvedTheme } from './types';
import { resolveVariant } from './variants';

const kebab = (s: string) => s.replace(/([a-z])([0-9])/g, '$1-$2').replace(/([A-Z])/g, (m) => '-' + m.toLowerCase());

function fontStack(f: FontSpec, isNum = false): string {
  const generic = f.generic ?? (isNum && /mono/i.test(f.family) ? 'monospace' : 'sans-serif');
  return `"${f.family}", ${generic === 'sans-serif' ? 'system-ui, sans-serif' : generic}`;
}

/**
 * Theme -> CSS custom properties (name -> value). Pass a variant name for themes with variants
 * (defaults to the theme's defaultVariant). Colour keys become --c-<kebab-key>.
 * Extras beyond the core set: --depth-raised, --depth-pressed, --sig-* (signature timings used by signature.css).
 */
export function themeToCssVars(theme: ChronosTheme | ResolvedTheme, variant?: string): Record<string, string> {
  const t = 'variants' in theme && theme.variants ? resolveVariant(theme, variant) : (theme as ResolvedTheme);
  const v: Record<string, string> = {};
  for (const [k, val] of Object.entries(t.color)) if (typeof val === 'string') v[`--c-${kebab(k)}`] = val;
  v['--r-sm'] = `${t.shape.radiusSm}px`;
  v['--r-md'] = `${t.shape.radiusMd}px`;
  v['--r-lg'] = `${t.shape.radiusLg}px`;
  v['--r-pill'] = `${t.shape.pill}px`;
  v['--depth-float'] = t.depth.float;
  if (t.depth.raised) v['--depth-raised'] = t.depth.raised;
  if (t.depth.pressed) v['--depth-pressed'] = t.depth.pressed;
  const num = t.fonts.numerals;
  v['--font-display'] = fontStack(t.fonts.display);
  v['--font-text'] = fontStack(t.fonts.text);
  v['--font-num'] = num === 'display' ? fontStack(t.fonts.display, true) : num === 'text' ? fontStack(t.fonts.text, true) : fontStack(num, true);
  v['--num-variant'] = t.fonts.tabularNumbers === false ? 'normal' : 'tabular-nums';
  v['--ease'] = t.motion.ease;
  v['--dur-fast'] = `${t.motion.fast}ms`;
  v['--dur-base'] = `${t.motion.base}ms`;
  v['--focus-widget-opacity'] = String(t.focus.widgetOpacity);
  v['--focus-widget-blur'] = `${t.focus.widgetBlurPx}px`;
  const s = t.motion.signature;
  v['--sig-charge-ms'] = `${s.chargeMs ?? 1400}ms`;
  v['--sig-tick-sec'] = `${s.tickRotationSec ?? 120}s`;
  v['--sig-band-sec'] = `${s.plasma?.bandRotationSec ?? 6}s`;
  v['--sig-breath-sec'] = `${s.plasma?.coreBreathSec ?? 3.2}s`;
  v['--sig-flare-ms'] = `${s.completionFlareMs ?? 900}ms`;
  v['--sig-disk-sec'] = `${s.diskTurnSec ?? 90}s`;
  v['--sig-tick-ms'] = `${s.tickMs ?? 160}ms`;
  v['--sig-lift'] = `${s.liftPx ?? 4}px`;
  return v;
}
