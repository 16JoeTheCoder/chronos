import { composite, contrast, parseColor, type RGBA } from './color';
import { OPTIONAL_COLORS, REQUIRED_COLORS, THEME_SCHEMA, type ChronosTheme, type ResolvedTheme, type ThemeCheck } from './types';
import { resolveVariant } from './variants';

const KINDS = ['reactor-ring', 'slab-monolith', 'accretion-ring', 'ticking-digits'];
const ID_RE = /^[a-z0-9][a-z0-9-]{0,63}$/;
const BODY = ['text', 'text2', 'text3', 'muted'] as const;
const STATUS = ['now', 'wellness', 'ok', 'warn', 'danger'] as const;

export interface ValidateOptions {
  /** Font families the app bundles. When given, other fontsource families produce a warning (they would fall back). */
  bundledFamilies?: string[];
}

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => typeof v === 'object' && v !== null && !Array.isArray(v);
const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);

class Ctx {
  errors: string[] = [];
  warnings: string[] = [];
  constructor(public prefix = '') {}
  err(m: string) { this.errors.push(this.prefix + m); }
  warn(m: string) { this.warnings.push(this.prefix + m); }
  obj(parent: Obj, key: string, path: string): Obj | null {
    const v = parent[key];
    if (!isObj(v)) { this.err(`"${path}" must be an object`); return null; }
    return v;
  }
  num(o: Obj, key: string, path: string, min: number, max: number, required = true) {
    const v = o[key];
    if (v === undefined && !required) return;
    if (!isNum(v) || v < min || v > max) this.err(`"${path}.${key}" must be a number between ${min} and ${max}`);
  }
  str(o: Obj, key: string, path: string, required = true) {
    const v = o[key];
    if (v === undefined && !required) return;
    if (typeof v !== 'string' || !v.trim() || v.length > 200) this.err(`"${path}.${key}" must be a non-empty string`);
  }
}

function checkFont(c: Ctx, f: unknown, path: string, bundled?: string[]) {
  if (!isObj(f)) return c.err(`"${path}" must be an object {family, weights, source}`);
  c.str(f, 'family', path);
  if (!Array.isArray(f.weights) || !f.weights.length || !f.weights.every((w) => isNum(w) && w >= 100 && w <= 900 && w % 100 === 0))
    c.err(`"${path}.weights" must be a non-empty array of 100..900 in steps of 100`);
  if (f.source === 'google' || f.source === 'cdn') c.err(`"${path}.source" "${String(f.source)}": web fonts must be bundled; use "fontsource" or "system"`);
  else if (f.source !== 'fontsource' && f.source !== 'system') c.err(`"${path}.source" must be "fontsource" or "system"`);
  if (f.generic !== undefined && !['sans-serif', 'serif', 'monospace'].includes(f.generic as string)) c.err(`"${path}.generic" must be sans-serif, serif or monospace`);
  if (f.source === 'fontsource' && bundled && typeof f.family === 'string' && !bundled.includes(f.family))
    c.warn(`font "${f.family}" is not bundled with this app and will fall back to a system font`);
}

function structure(c: Ctx, t: Obj, opts: ValidateOptions) {
  if (t.mode !== 'light' && t.mode !== 'dark') c.err('"mode" must be "light" or "dark"');
  c.str(t, 'name', '');
  const fonts = c.obj(t, 'fonts', 'fonts');
  if (fonts) {
    checkFont(c, fonts.display, 'fonts.display', opts.bundledFamilies);
    checkFont(c, fonts.text, 'fonts.text', opts.bundledFamilies);
    if (fonts.numerals !== 'display' && fonts.numerals !== 'text') checkFont(c, fonts.numerals, 'fonts.numerals', opts.bundledFamilies);
  }
  const color = c.obj(t, 'color', 'color');
  if (color) {
    for (const k of REQUIRED_COLORS) if (!(k in color)) c.err(`"color.${k}" is missing`);
    for (const [k, v] of Object.entries(color)) {
      const known = (REQUIRED_COLORS as readonly string[]).includes(k) || (OPTIONAL_COLORS as readonly string[]).includes(k);
      if (!known) c.warn(`unknown colour "color.${k}" is ignored`);
      else if (!parseColor(v)) c.err(`"color.${k}" is not a valid colour (use #rrggbb, #rrggbbaa, rgb() or rgba()): ${JSON.stringify(v)}`);
    }
    const g = parseColor(color.ground);
    if (g && g[3] < 1) c.err('"color.ground" must be opaque');
  }
  const shape = c.obj(t, 'shape', 'shape');
  if (shape) for (const k of ['radiusSm', 'radiusMd', 'radiusLg', 'pill']) c.num(shape, k, 'shape', 0, 9999);
  const depth = c.obj(t, 'depth', 'depth');
  if (depth) { c.str(depth, 'float', 'depth'); c.str(depth, 'raised', 'depth', false); c.str(depth, 'pressed', 'depth', false); }
  const motion = c.obj(t, 'motion', 'motion');
  if (motion) {
    c.str(motion, 'ease', 'motion');
    c.num(motion, 'fast', 'motion', 0, 5000);
    c.num(motion, 'base', 'motion', 0, 5000);
    const sig = c.obj(motion, 'signature', 'motion.signature');
    if (sig) {
      if (!KINDS.includes(sig.kind as string)) c.err(`"motion.signature.kind" must be one of ${KINDS.join(', ')}`);
      c.num(sig, 'segments', 'motion.signature', 8, 120, false);
      for (const k of ['chargeMs', 'completionFlareMs', 'tickMs']) c.num(sig, k, 'motion.signature', 0, 20000, false);
      for (const k of ['tickRotationSec', 'diskTurnSec']) c.num(sig, k, 'motion.signature', 1, 3600, false);
      c.num(sig, 'liftPx', 'motion.signature', 0, 20, false);
      if (sig.plasma !== undefined) {
        const p = c.obj(sig, 'plasma', 'motion.signature.plasma');
        if (p) { c.num(p, 'bandRotationSec', 'motion.signature.plasma', 1, 3600, false); c.num(p, 'coreBreathSec', 'motion.signature.plasma', 0.5, 3600, false); }
      }
    }
  }
  const focus = c.obj(t, 'focus', 'focus');
  if (focus) { c.num(focus, 'widgetOpacity', 'focus', 0, 1); c.num(focus, 'widgetBlurPx', 'focus', 0, 20); }
  if (t.sound !== undefined) {
    if (isObj(t.sound)) c.num(t.sound, 'volume', 'sound', 0, 1, false); else c.err('"sound" must be an object');
  }
  for (const k of ['widgets', 'energy']) if (t[k] !== undefined && !isObj(t[k])) c.err(`"${k}" must be an object`);
}

/** Contrast rules. Body text < 4.5 = error. Accent < 3 = error. Status/fixed colours < 3 = warning. */
function contrastCheck(c: Ctx, t: ResolvedTheme) {
  const col = t.color as Record<string, string | undefined>;
  const ground = parseColor(col.ground);
  const panelRaw = parseColor(col.panel);
  const heroRaw = parseColor(col.panelHero);
  if (!ground || !panelRaw) return;
  const grounds: [string, RGBA][] = [['ground', ground], ['panel', composite(panelRaw, ground)]];
  if (heroRaw && heroRaw[3] < 1) grounds.push(['panelHero', composite(heroRaw, ground)]);
  const ratio = (key: string, over: RGBA): number | null => {
    const fg = parseColor(col[key]);
    return fg ? contrast(composite(fg, over), over) : null;
  };
  for (const key of BODY) for (const [gn, g] of grounds) {
    const r = ratio(key, g);
    if (r !== null && r < 4.5) c.err(`contrast: "color.${key}" on ${gn} is ${r.toFixed(2)}:1, body text needs at least 4.5:1`);
  }
  for (const [gn, g] of grounds) {
    const r = ratio('accent', g);
    if (r !== null && r < 3) c.err(`contrast: "color.accent" on ${gn} is ${r.toFixed(2)}:1, large text and controls need at least 3:1`);
  }
  const acc = parseColor(col.accent);
  const onAcc = parseColor(col.onAccent);
  if (acc && onAcc) {
    const a = composite(acc, ground);
    const r = contrast(composite(onAcc, a), a);
    if (r < 4.5) c.err(`contrast: "color.onAccent" on accent is ${r.toFixed(2)}:1, needs at least 4.5:1`);
  }
  const ink = parseColor(col.ink);
  const onInk = parseColor(col.onInk);
  if (ink && onInk) {
    const r = contrast(composite(onInk, ink), ink);
    if (r < 4.5) c.err(`contrast: "color.onInk" on ink is ${r.toFixed(2)}:1, needs at least 4.5:1`);
  }
  for (const key of [...STATUS, 'fixedBlock']) for (const [gn, g] of grounds.slice(0, 2)) {
    const r = ratio(key, g);
    if (r !== null && r < 3) c.warn(`contrast: "color.${key}" on ${gn} is ${r.toFixed(2)}:1, below 3:1 (fine only if decorative)`);
  }
}

function checkResolved(c: Ctx, t: Obj, opts: ValidateOptions) {
  structure(c, t, opts);
  if (!c.errors.length) contrastCheck(c, t as unknown as ResolvedTheme);
}

export function validateTheme(json: unknown, opts: ValidateOptions = {}): ThemeCheck {
  const top = new Ctx();
  if (!isObj(json)) return { ok: false, errors: ['theme must be a JSON object'], warnings: [] };
  if (json.$schema !== THEME_SCHEMA) top.err(`"$schema" must be "${THEME_SCHEMA}"`);
  if (typeof json.id !== 'string' || !ID_RE.test(json.id)) top.err('"id" must be lowercase letters, digits and hyphens (no "/"), e.g. "my-theme"');
  const hasVariants = json.variants !== undefined;
  if (hasVariants) {
    const v = json.variants;
    if (!isObj(v) || !Object.keys(v).length) top.err('"variants" must be an object with at least one variant');
    else {
      for (const [k, o] of Object.entries(v)) {
        if (!ID_RE.test(k)) top.err(`variant name "${k}" must be lowercase letters, digits and hyphens`);
        if (!isObj(o)) top.err(`"variants.${k}" must be an object of overrides`);
      }
      if (json.defaultVariant !== undefined && !(json.defaultVariant as string in v)) top.err(`"defaultVariant" "${String(json.defaultVariant)}" is not one of the variants`);
    }
  }
  if (top.errors.length) return { ok: false, errors: top.errors, warnings: top.warnings };

  const errors: string[] = [];
  const warnings: string[] = [];
  const run = (label: string, t: Obj) => {
    const c = new Ctx(label ? `[${label}] ` : '');
    checkResolved(c, t, opts);
    errors.push(...c.errors);
    warnings.push(...c.warnings);
  };
  if (hasVariants) {
    for (const name of Object.keys(json.variants as Obj)) run(name, resolveVariant(json as unknown as ChronosTheme, name) as unknown as Obj);
  } else run('', json);
  return errors.length ? { ok: false, errors, warnings } : { ok: true, theme: json as unknown as ChronosTheme, errors, warnings };
}
