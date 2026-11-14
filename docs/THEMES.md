# Chronos themes (`chronos-theme/1`)

A theme is one JSON file. Components use only the CSS variables a theme produces, so a theme can change
colour, type, shape, depth, motion and the timer's signature animation, never layout.

Launch themes (`src/renderer/themes/`): `tactile-instrument` (default, light), `stark-workshop` (dark),
`tars-gargantua` (one theme, two variants: `tars-gargantua/day` = TARS, `tars-gargantua/night` = Gargantua).
Machine-readable schema: `src/renderer/themes/schema.json`. Code: `src/core/theme/`.

## Schema

```jsonc
{
  "$schema": "chronos-theme/1",          // required, exact
  "id": "my-theme",                      // a-z 0-9 -, no "/"
  "name": "My theme",
  "mode": "light",                       // "light" | "dark" (sets data-mode, color-scheme)
  "fonts": {
    "display": { "family": "Sora", "weights": [500, 600], "source": "fontsource" },
    "text":    { "family": "Sora", "weights": [400, 500], "source": "fontsource" },
    "numerals": "display",               // "display" | "text" | a font object
    "tabularNumbers": true
  },
  "color": { /* see below */ },
  "shape": { "radiusSm": 10, "radiusMd": 14, "radiusLg": 18, "pill": 999 },   // px
  "depth": { "float": "0 18px 40px rgba(0,0,0,.45)", "raised": "...", "pressed": "..." },  // raised/pressed optional
  "motion": {
    "ease": "cubic-bezier(.16,1,.3,1)", "fast": 160, "base": 420,           // ms
    "signature": { "kind": "reactor-ring" }
  },
  "focus": { "widgetOpacity": 0.18, "widgetBlurPx": 1.5 },   // widgets dim to this in Focus
  "widgets": {}, "energy": {}, "sound": { "enabled": true, "volume": 0.35 },   // optional
  "variants": { "day": { /* overrides */ }, "night": { /* overrides */ } },   // optional
  "defaultVariant": "day"
}
```

**Fonts.** `source` is `"fontsource"` (a bundled `@fontsource/*` package) or `"system"`. CDN/Google fonts are
rejected. A fontsource family the app does not bundle falls back to the system font (validator warns). To add a
bundled font: `npm i @fontsource/<name>`, import its `latin-<weight>.css` files in `src/renderer/themes/fonts.ts`
and add the family to `BUNDLED_FONT_FAMILIES` in `src/renderer/themes/index.ts`. Weights are 100..900 in steps of 100.

**Colours** (any of `#rgb #rrggbb #rrggbbaa rgb() rgba()`; `ground` must be opaque). Required:
`ground panel panelHero line lineStrong text text2 text3 muted accent accentHover onAccent now wellness ok warn danger fixedBlock selection`.
Optional: `groundLight` (ambient glow), `raised`/`edge` (raised button face and hard under-edge), `ink`/`onInk`
(inverted surface such as a dark slab or card, and its text), `ring`/`ringBright`/`disk` (accretion-ring palette).
Each becomes `--c-<kebab-key>` (`panelHero` -> `--c-panel-hero`, `text2` -> `--c-text-2`).
`panel`/`panelHero` may be translucent: they are composited over `ground` for contrast.

**Signature** (`motion.signature.kind`), with optional tuning:

| kind | tuning keys |
| --- | --- |
| `reactor-ring` | `segments` (8-120), `chargeMs`, `tickRotationSec`, `plasma.{bandRotationSec,coreBreathSec,brightnessFollowsProgress}`, `completionFlareMs` |
| `slab-monolith` | none (four slabs, one per quarter; uses `ink`/`onInk`) |
| `accretion-ring` | `diskTurnSec`, `completionFlareMs`, `chargeMs` (uses `ring`/`ringBright`/`disk`) |
| `ticking-digits` | `tickMs`, `liftPx` (no other motion) |

**Variants.** `variants.<name>` is a deep-partial override merged over the top-level theme (objects merge, arrays
and primitives replace). The top level must itself be complete; each variant is validated after merging. Select with
`"<id>/<variant>"` (`tars-gargantua/night`); a bare id uses `defaultVariant`, else the first variant.

## CSS variables

`--c-*` (every colour key), `--r-sm --r-md --r-lg --r-pill`, `--depth-float` (`--depth-raised`, `--depth-pressed` if set),
`--font-display --font-text --font-num --num-variant`, `--ease --dur-fast --dur-base`,
`--focus-widget-opacity --focus-widget-blur`, and signature timings `--sig-charge-ms --sig-tick-sec --sig-band-sec
--sig-breath-sec --sig-flare-ms --sig-disk-sec --sig-tick-ms --sig-lift`. `ThemeProvider` also sets `data-theme-id`,
`data-mode`, `data-signature` and `data-motion="off"` (motion switch or `prefers-reduced-motion`) on `<html>`.

## Contrast rules

Measured as WCAG ratios; translucent colours are composited over the ground first.

| Check | Rule | Result |
| --- | --- | --- |
| `text text2 text3 muted` on `ground` and `panel` (and a translucent `panelHero`) | 4.5:1 | error, theme rejected |
| `accent` on `ground`/`panel` (large text, controls) | 3:1 | error |
| `onAccent` on `accent`; `onInk` on `ink` | 4.5:1 | error |
| `now wellness ok warn danger fixedBlock` on `ground`/`panel` | 3:1 | warning (decorative use is fine) |

Errors are human-readable, e.g. `contrast: "color.muted" on ground is 3.10:1, body text needs at least 4.5:1`.

## Import and export

`exportTheme(theme)` returns pretty JSON; `importTheme(text)` parses and validates, never throws, and returns
`{ ok, theme?, errors, warnings }`. Only `ok: true` themes may be stored. Settings should show `errors` verbatim
and offer to keep a theme that only has warnings.

## Author a theme with an AI

Copy this prompt, fill the brief, paste the result into Settings > Import theme:

```text
You are writing a Chronos theme file. Output ONLY one JSON object, no prose, no code fence.
It must follow schema "chronos-theme/1" exactly: "$schema":"chronos-theme/1", id (lowercase, hyphens),
name, mode ("light"|"dark"), fonts {display,text,numerals,tabularNumbers}, color, shape, depth, motion, focus.
Fonts: source must be "fontsource"; use only these families: Hanken Grotesk, Martian Mono, Chakra Petch, Sora,
Red Hat Display, Red Hat Mono, Michroma, Red Hat Text. weights are multiples of 100.
color needs: ground (opaque), panel, panelHero, line, lineStrong, text, text2, text3, muted, accent, accentHover,
onAccent, now, wellness, ok, warn, danger, fixedBlock, selection. Optional: groundLight, raised, edge, ink, onInk,
ring, ringBright, disk. Use #rrggbb or rgba(r,g,b,a).
Contrast (hard rules, measured against ground and panel after compositing): text, text2, text3 and muted at least 4.5:1;
accent at least 3:1; onAccent on accent at least 4.5:1; status colours at least 3:1.
shape: radiusSm, radiusMd, radiusLg, pill (px numbers). depth.float: a CSS box-shadow string.
motion: ease (cubic-bezier string), fast and base in ms, signature.kind one of
reactor-ring | slab-monolith | accretion-ring | ticking-digits.
focus: widgetOpacity 0..1, widgetBlurPx 0..20.
Brief: <describe the mood, light or dark, accent colour, shapes, motion level>.
After writing it, check every text colour against ground and panel and fix any that fall below 4.5:1.
```

If import rejects the file, paste the error list back to the AI and ask it to fix only those tokens.
