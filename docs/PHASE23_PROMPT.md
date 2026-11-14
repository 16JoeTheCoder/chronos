# Chronos — Phase 2+3 Build Prompt (parser, UI rebuild, theme engine, Log feed)

You are the lead engineer and design implementer on **Chronos** (github.com/16JoeTheCoder/chronos), Josef Yang's Windows 11 time-and-focus app: Electron 33 + Vite + React 18 + TypeScript, pure logic in `src/core`, main process in `src/main`, UI in `src/renderer`, vitest in `tests/`. Phase 1 (data model v2, Firestore sync with outbox, local Claude MCP server, Experimental diagnostics) is merged and working on Josef's two PCs. This run builds everything the user touches. Use Sonnet subagents for grunt work (tests, fixtures, docs, theme data); you own architecture, the parser core, the schema migration and the theme engine.

This handoff ships with files to copy into the repo before you start:

| From the handoff | Into the repo | What |
| --- | --- | --- |
| `parser/CHRONOS_PARSER_REQUIREMENTS.md`, `parser/PARSER_HANDOFF.md`, `parser/decision.md` | `docs/parser/` | Parser spec, handoff, decisions D1–D17 (D13 revised, D16–D17 new) |
| `parser/tests/parser/*` | `tests/parser/` | Corpus (definition of done), fixture, known gaps |
| `parser/src/core/parser/*.json` | `src/core/parser/` | Built-in rule pack and English lexicon |
| `themes/*.chronos-theme.json` | `src/renderer/themes/` | Stark workshop theme file (template for the others) |
| `design/*.dc.html` | `docs/design/` | Approved screen designs (static HTML; open in a browser to view; `support.js` is not needed to read them) |

Merge the parser's `decision.md` into the root `decision.md` under a "Parser" heading and keep one `log.md` at the root.

---

## 0. Ground rules

1. **Read first:** root `decision.md`, `log.md`, `docs/ARCHITECTURE.md`, `docs/SYNC.md`, `src/core/model/types.ts`, `validation.ts`, `commands.ts`, `src/core/search/*`, `src/core/mcp/*`, and every file under `docs/parser/` and `docs/design/`.
2. **Lean code.** No dependency unless named here or justified in `decision.md`. Skip anything costly that does not materially improve the experience. Know when to stop.
3. **Living files:** update `decision.md` (numbered decisions) and `log.md` (done / doing / next / known failures) after every work step, so a fresh session can resume from `log.md` alone.
4. **Every command you give Josef says where to run it** (VS Code terminal at repo root, Windows PowerShell, browser, Firebase console).
5. **Nothing ships red:** `npm run typecheck`, `npm test`, `npm run audit` green at the end. Windows-only checks go in `docs/WINDOWS_CHECKLIST.md`.
6. Branch `phase-2-3`, commit in logical steps, open one PR at the end.
7. **Checkpoints** (commit and update `log.md` at each): **A** parser + schema v3 + planning logic (no UI), **B** desktop layer + overlay windows, **C** UI rebuild + themes, **D** Log feed + polish.

## 1. Product rules every screen is judged against

- **One task owns the screen.** Nothing encourages switching tasks. Josef rejected "park/waiting" features: switching drains him, and deep single-task thinking is where his engineering ideas come from.
- **The opposite of information overload.** Default views show Now, Next and time left; everything else is one key away. No badges, red counters or "14 overdue" banners. Overdue items fold quietly into the end-of-day review.
- **5 % of his brain to manage, 95 % on the work.** Every action has a default that is right ~80 % of the time; he confirms or nudges. Every automatic action is undoable (toast or Ctrl+Z) and nothing asks "are you sure".
- **Only three things interrupt:** an upcoming fixed event, the end-of-day review, and break prompts at the end of a long block.
- **Hold Enter 2 s to finish** (ring or bar fills; early release drains; Space taps start/pause and never finishes). The typed "I have finished this task" phrase is already gone; keep it gone.

## 2. Schema v3 (one migration, then frozen again)

Bump the schema to 3 with a lossless, idempotent migration in `src/core/repo/migrate.ts`, reusing Phase 1's version gate (an older client goes read-only). Changes:

1. **CalEvent:** `startMin` and `endMin` become `number | null`; add `durationMin: number` (default 60). An event with null times on a date is **unplaced** ("to place"): shown on that day's runway in a "to place" tray and dragged onto the timeline, which sets the times. Validation: both times null or both set; `endMin > startMin` unless the cross-midnight flag is set. Expansion code (`expandEvents`, gaps, time left) must skip unplaced events.
2. **Idea (notes):** add `projectId: string | null`.
3. **Settings (synced):** add
   - `themeSchedule: { from: 'HH:MM'; themeId: string }[]` (empty = manual) and keep `themeId`;
   - `weeklyFocusTargetH: number` (default 20);
   - `sound: { enabled: boolean; volume: number; muteInFocus: boolean }` (default on, 0.35, false);
   - `energy: { livingReactor: boolean; holographicDepth: boolean; reactiveData: boolean; motion: boolean }` (all true; `motion` false forces all off);
   - `widgets: { day: boolean; momentum: boolean; notes: boolean; wellness: boolean }` (all true);
   - `parserReports: { at: number; input: string; expected: string; actual: string }[]` (the misparse loop, capped at 200, oldest dropped);
   - `planning: { defaultBlockMin: 30; learnEstimates: true; breakAfterMin: 75 }`.
   Keep `parserRules` (already exists) for learned and user rules.
4. **Device settings (not synced):** `composerProjectId`, `onboarded`.

Update `validation.ts`, the MCP handlers and the Firestore rules for every new field. Test the migration on a realistic v2 fixture.

## 3. Parser (Checkpoint A)

Build exactly what `docs/parser/CHRONOS_PARSER_REQUIREMENTS.md` describes, with `docs/parser/decision.md` overriding it. Key points (the files are authoritative):

- Pure TypeScript in `src/core/parser/`, on `chrono-node` (pinned). Deterministic, offline, never throws, under 5 ms per parse. No AI in the parse path.
- Everything tunable is data: `builtin.chronos-parser.json` (rules), `lexicon.en.json` (words, shorthand, thresholds, fuzzy targets, never-correct list), and the timetable and bell grid passed in through `ParseContext.bells` and `ParseContext.timetable`.
- **D13 revised:** any project word sets the project and stays in the title; only `#name` is removed.
- **D16:** `<subject> test|exam <date>` takes that day's matching timetable period; with no match it is an unplaced 60 min fixed event on that date.
- **D17:** a fixed event typed with a start and no end gets 1 h (call = 30 min; classes and timetable matches use the period).
- **D6:** a bare number is never a time without am/pm, a colon, a time preposition or a valid clock range next to a time or fixed word.
- Notepad mode (`- `, `[] `, `task `, `event `, `@`) and the Log feed use the same parser.
- **Definition of done:** a corpus runner (`tests/parser/corpus.test.ts`) passes **100 %** of `corpus.txt` with `fixture.json`, or each failure moves to `corpus.known-gaps.txt` with a reason. Add property tests (never throws on random input up to 500 chars, spans never overlap, pure) and a benchmark.
- Learning: `applyCorrection` adds a learned rule after two identical corrections; user rules beat learned rules beat built-in. Packs import/export as `*.chronos-parser.json` with a `version` and migration.
- Misparse loop: a "Report misparse" action in the palette stores `{input, expected, actual}` in `settings.parserReports`.
- **Where the timetable comes from:** Josef has no calendar file. Build a small Settings screen "School timetable" that edits the weekly recurring CalEvents and a bell grid (period starts/ends), seeded from `tests/parser/fixture.json` on first run if empty (ask before seeding). The parser receives that day's expanded version (with exceptions applied).

## 4. Planning logic (Checkpoint A, in `src/core`, unit-tested)

- **Estimates:** a task with no estimate uses `planning.defaultBlockMin` (30). With `learnEstimates` on, use the median actual focus time of the last 5 finished tasks with the same project or tag (min 3 samples), else the default.
- **Auto-plan:** one command fills today's free gaps (after fixed events, prep, buffer) with planned/inbox tasks ordered by priority, due date, then `sortKey`. It creates blocks with `auto: true`, never moves manual blocks, and is undoable as one action. It runs on first open of the day (morning start: Enter accepts) and on demand.
- **Re-plan:** moves only unfinished auto blocks forward into the remaining gaps.
- **End-of-day review:** at `dayEndMin` minus buffer (or on demand), every unfinished planned task asks once: tomorrow / unscheduled / drop / done. Writes `reviews/review-<date>`. Never prompts twice across devices.
- **Wellness:** the break prompt appears when a block ends after `breakAfterMin` of continuous focus, never mid-block.

## 5. Desktop layer and windows (Checkpoint B)

1. **Desktop layer (WorkerW).** Attach the home window behind the desktop icons so Win+D shows Chronos. Study how Lively Wallpaper (open source) and the `electron-as-wallpaper` package do it, and handle the **Windows 11 24H2** WorkerW structure change. Use `koffi` for the native calls if no maintained package fits. Mouse input reaches the layer by forwarding; keyboard work opens the interactive home window (or the palette). **Fallback:** if attaching fails, log it and run as the current normal window, never a black screen or crash. Setting: "Live on the desktop" (on by default). This cannot be tested in the cloud: add precise steps to `docs/WINDOWS_CHECKLIST.md`.
2. **Overlay** (bottom-left, always on top): collapsed is a pill with the theme's mini timer, task title and time; expanded on hover shows title, timer, Hold to finish. It never takes keyboard focus unless clicked. It hides in full-screen apps (setting).
3. **Notepad** (top-right, global shortcut Ctrl+Alt+N, keep the existing one if set): opens on the focused task's notes, otherwise a general note; autosaves; Esc closes and returns focus to the previous app and cursor. Lines become tasks via the parser on close (Undo toast).
4. **Palette** (Ctrl+K in-app, global shortcut too): one box to add (live parse chips), search (MiniSearch), run commands (`>`), and "Ask Claude" (opens Claude Desktop with the text copied, or uses MCP if a direct path exists; document which).
5. **Bug fixes from Phase 1 testing:** Space and hold-Enter must work on the Focus screen without clicking first (window-level key listener that ignores text inputs). The buffer is a visible cushion that shrinks as a task overruns, then shows overrun.

## 6. UI rebuild and theme engine (Checkpoint C)

Build to the designs in `docs/design/`. Map them:

| Screen | Tactile (default) | Stark | TARS / Gargantua |
| --- | --- | --- | --- |
| Home / desktop | `Tactile.dc.html` | `Stark.dc.html` | `TarsDay.dc.html`, `Gargantua.dc.html` |
| Overlay + notepad | derive from Stark/Flight layouts | `StarkOverlay.dc.html` | derive |
| Palette | derive | `StarkPalette.dc.html` | derive |
| Settings (theme schedule, widgets, motion, sound) | derive from `FlightSettings.dc.html` | `StarkSettings.dc.html` | derive |
| Project board | derive | `StarkBoard.dc.html` | derive |
| Big moments (block start, finish, review) | micro-interactions only | `StarkMoments.dc.html` + `OverReactor`, `OverHolo`, `OverReactive` | derive from `FlightMoments.dc.html` |
| Phone (reference only, Phase 4) | `Phones.dc.html` | | |

"Derive" means apply that theme's tokens and signature to the shared layout; do not invent new layouts.

**Theme engine.**
- A theme is a JSON file (`$schema: "chronos-theme/1"`; see `stark-workshop.chronos-theme.json`): fonts, colour tokens, shape, depth, motion, focus dimming, widget styles, and `motion.signature.kind`. Write the JSON schema (`docs/THEMES.md` + `src/renderer/themes/schema.json`) so an AI can author a new theme from it. Import/export in Settings, validated, contrast-checked (text 4.5:1, large text 3:1; reject or warn).
- Tokens become CSS custom properties on `:root`; components use only tokens.
- **Signature timers are components selected by `signature.kind`:** `reactor-ring` (Stark: segmented charging ring, turning ticks, plasma band and breathing core whose brightness follows progress, completion flare), `slab-monolith` (TARS: four slabs, one per quarter), `accretion-ring` (Gargantua: thin bright ring and slowly turning disk), `ticking-digits` (Tactile: digit-by-digit tick, no other motion). Each has a mini variant for the overlay pill and the notepad header.
- **Launch themes:** Tactile instrument (**default on first launch**), Stark workshop, TARS (day) and Gargantua (night) as one theme with two variants. Write their JSON files. Pit wall and Flight plan are **not built**; keep their design files in `docs/design/` as future themes.
- **Theme schedule:** Settings rows "from HH:MM use theme X"; the active theme switches at those times (check each minute and on resume).
- **Energy layers (Stark only, each its own switch):** living reactor, holographic depth (mouse tilt up to 9°, scan-line assembly on open), reactive data (momentum cell charges toward `weeklyFocusTargetH`, day dial fills per completed block, streak ignition at 5 days). All respect `prefers-reduced-motion` and the `motion` switch. CSS and SVG only; no WebGL in this phase.
- **Sound:** Web Audio, synthesised (no audio files): soft rising tone on block start, short chord on finish, at `sound.volume`; mute in Settings and optionally in Focus.
- **Widgets** (home, each toggleable): Day (dial + free time after buffer), Momentum (7-day focus hours, streak, estimate drift), Notes (current task's latest notes), Wellness (break prompt). In Focus they dim to the theme's `focus.widgetOpacity`.
- **Project board:** columns from `project.columns`; the column mapped to status `doing` holds **one card max** ("the focus slot"); dropping another card there swaps them. Board and List views only.
- **Drag and drop everywhere on the runway:** between unscheduled, Plan and Fixed and back, snapping to `settings.snapMin` (5/10/15/30), Alt for free drag; dragging a fixed recurring event offers "just today" (event exception) or "every week". Unplaced events drag from the "to place" tray.
- **Settings:** six sections (Look and widgets, Day and planning, Focus, Parser rules, School timetable, Account and sync), plain toggles, plus Experimental at the bottom (Phase 1 diagnostics, redesigned to be as clear as Claude's own settings). Every button gives instant feedback.
- Accessibility floor: real buttons and inputs, visible focus rings, keyboard reachable, 44 px targets where touch-like, reduced motion honoured, contrast as above.

## 7. Log feed (Checkpoint D)

A **Log** screen (rail item and `Ctrl+L`): a Zuckerberg-style chronological feed of notes, newest first, one stream for check-ins and task notes.

- **Composer** at the top: Enter posts (one write, immediately; no write while typing). `/project` or `/p` opens a project dropdown (arrow keys, Enter); `Ctrl+Shift+P` does the same. The composer remembers `composerProjectId` and follows the focused task's project in Focus.
- **Sticky-note cards:** a post with task lines shows them as checkbox lines on a sticky-note card. Clear task lines (`- `, `[] `, `task `, or task keyword + date/time) are **added to the queue automatically** with an Undo toast; uncertain lines show a faint "Add as task?" chip (one tap). Ticking a line ticks the task and the reverse.
- **Edited:** posts are editable; show "edited" when `updatedAt` is well after `createdAt`. Edits save shortly after typing stops.
- **Search:** MiniSearch over all notes with exact phrases in quotes and filters `project:`, `before:`, `after:`, `is:task`; matches highlighted; Enter jumps to the post in the feed.
- **Mini calendar:** a month view; days with posts get a dot, days with posts in the current project a second mark; selecting a day scrolls the feed there.
- **Project view:** filter the feed to one project (from the board's header too).
- Sync is Phase 1's path: a post appears on Josef's other PC within about 2 s when both are online.

## 8. Claude MCP updates

- `add_task` gains an optional `text` argument parsed by the parser (`source: 'claude'`); if confidence is not high, return the parse for Claude to confirm.
- Add `post_log({ body, projectId? })`, `search_log({ query })`, `list_unplaced({ date? })`, `place_event({ eventId, startMin })`.
- Keep the Phase 1 safety rules (no hard deletes, rate limit, undo tokens).

## 9. Tests and checks

- Parser corpus at 100 % (or justified gaps), property tests, benchmark.
- Migration v2→v3 lossless and idempotent; old-client read-only gate.
- Planning: estimates, auto-plan (never moves manual blocks; undo as one action), re-plan, review (once across devices), wellness timing.
- Theme engine: every launch theme validates against the schema and passes contrast; schedule switching; import of a bad theme is rejected with a reason.
- Log: auto-add vs chip thresholds, tick sync between card and task, search filters, edited flag.
- Board: one-card Doing rule and swap.
- `npm run audit` additions: no Electron/Node imports in `src/core/parser`; no hard-coded colours outside theme files (allow a short list).
- `docs/WINDOWS_CHECKLIST.md` additions: Win+D shows Chronos; fallback when WorkerW fails; overlay over Chrome/Canva without stealing focus; notepad returns focus on Esc; Space/hold-Enter on Focus without clicking; theme switches at the scheduled minute; sound plays and mutes; post on PC A shows on PC B within ~2 s.

## 10. Docs to leave behind

`decision.md`, `log.md`, `docs/ARCHITECTURE.md` (updated), `docs/THEMES.md` (schema and how to write a theme with an AI), `docs/parser/` (as copied, plus `PARSER.md` on how to fix a misparse: add the corpus line first), `docs/WINDOWS_CHECKLIST.md`, `docs/BUILD_REPORT.md` (done, unverified, sizes).

## 11. If you run low on budget

Priority: schema v3 > parser to 100 % corpus > planning logic > Focus key-listener fix > UI rebuild in Tactile > theme engine + Stark > TARS/Gargantua > Log feed > desktop layer > energy layers > sound > board polish. Never leave the desktop layer half-wired: if it is not finished, ship it switched off with the fallback active, and say so in `log.md` and the PR.

## 12. Out of scope (Phase 4)

Web app (4a), phone app and remote MCP (4b), Pit wall and Flight plan themes, WebGL effects, the timetable importer from PDF/images, languages other than English.
