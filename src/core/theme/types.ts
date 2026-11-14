/** chronos-theme/1 types. Pure data, no DOM. */

export const THEME_SCHEMA = 'chronos-theme/1';

export type ThemeMode = 'light' | 'dark';
export type SignatureKind = 'reactor-ring' | 'slab-monolith' | 'accretion-ring' | 'ticking-digits';

export interface FontSpec {
  family: string;
  weights: number[];
  /** 'fontsource' = bundled @fontsource package (the only way to ship a web font); 'system' = installed font. */
  source: 'fontsource' | 'system';
  /** CSS generic fallback, default sans-serif (monospace for numerals whose family contains "Mono"). */
  generic?: 'sans-serif' | 'serif' | 'monospace';
}

/** Required colour keys. Any CSS colour: #rgb, #rrggbb, #rrggbbaa, rgb(), rgba(). `ground` must be opaque. */
export const REQUIRED_COLORS = [
  'ground', 'panel', 'panelHero', 'line', 'lineStrong', 'text', 'text2', 'text3', 'muted',
  'accent', 'accentHover', 'onAccent', 'now', 'wellness', 'ok', 'warn', 'danger', 'fixedBlock', 'selection',
] as const;

/**
 * Optional colour keys:
 *  groundLight  ambient glow painted over the ground
 *  raised/edge  raised button surface and its hard under-edge (tactile)
 *  ink/onInk    inverted surface (dark card/slab on a light theme) and the text on it
 *  ring/ringBright/disk  accretion-ring palette: faint ring, bright progress ring, turning disk
 */
export const OPTIONAL_COLORS = ['groundLight', 'raised', 'edge', 'ink', 'onInk', 'ring', 'ringBright', 'disk'] as const;

export type RequiredColor = (typeof REQUIRED_COLORS)[number];
export type OptionalColor = (typeof OPTIONAL_COLORS)[number];
export type ThemeColors = Record<RequiredColor, string> & Partial<Record<OptionalColor, string>>;

export interface SignatureConfig {
  kind: SignatureKind;
  respectReducedMotion?: boolean;
  /** reactor-ring */
  segments?: number;
  chargeMs?: number;
  tickRotationSec?: number;
  plasma?: { bandRotationSec?: number; coreBreathSec?: number; brightnessFollowsProgress?: boolean };
  completionFlareMs?: number;
  /** accretion-ring */
  diskTurnSec?: number;
  /** ticking-digits */
  tickMs?: number;
  liftPx?: number;
}

export interface ChronosTheme {
  $schema: typeof THEME_SCHEMA;
  id: string;
  name: string;
  mode: ThemeMode;
  fonts: { display: FontSpec; text: FontSpec; numerals: 'display' | 'text' | FontSpec; tabularNumbers?: boolean };
  color: ThemeColors;
  shape: { radiusSm: number; radiusMd: number; radiusLg: number; pill: number };
  /** float = floating panels; raised/pressed = tactile button states (optional). */
  depth: { float: string; raised?: string; pressed?: string };
  motion: { ease: string; fast: number; base: number; signature: SignatureConfig };
  focus: { widgetOpacity: number; widgetBlurPx: number };
  widgets?: Record<string, Record<string, unknown>>;
  energy?: {
    livingReactor?: boolean;
    holographicDepth?: { enabled?: boolean; maxTiltDeg?: number; assembleOnOpen?: boolean };
    reactiveData?: { momentumCell?: boolean; dayDialFill?: boolean; streakIgnitionDays?: number };
  };
  sound?: { enabled?: boolean; volume?: number; muteInFocus?: boolean; cues?: { blockStart?: string; blockFinish?: string } };
  /** Variants (e.g. day/night): deep-partial overrides merged over the base. */
  variants?: Record<string, ThemeOverride>;
  defaultVariant?: string;
}

type DeepPartial<T> = { [K in keyof T]?: T[K] extends object ? DeepPartial<T[K]> : T[K] };
export type ThemeOverride = DeepPartial<Omit<ChronosTheme, '$schema' | 'id' | 'variants' | 'defaultVariant'>>;

/** A theme with variants flattened away. */
export type ResolvedTheme = Omit<ChronosTheme, 'variants' | 'defaultVariant'>;

export interface ThemeCheck {
  ok: boolean;
  theme?: ChronosTheme;
  errors: string[];
  warnings: string[];
}

export interface ScheduleEntry { from: string; themeId: string }
