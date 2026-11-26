# Chronos build log

A fresh session can resume from this file alone. Newest state first. Decisions: `decision.md` (D-001..D-183, unique and ascending). Spec for Phase 3.5: the prompt in the PR description (sections 0-15); Phase 2+3 spec: `docs/PHASE23_PROMPT.md`.

## State (2026-11-26, Phase 4 web app, checkpoints A–C done, D in progress)

Branch `claude/gallant-euler-xrzpkf` (prompt said `phase-4-web`; the session's branch rule wins). Swarm: lead + Bridge-Web, Web-Infra, Renderer-Port, Mobile-Layout, Log, QA (`docs/swarm/BOARD.md`). Checks at checkpoint C: typecheck clean, 1056 tests, audit green, `npm run build:web` OK (initial JS ~184 KB gz; Firebase lazy). Nothing deployed (the deployment agent does that, `SETUP.md`).

- A: bridge interface frozen (`src/platform/types.ts`), Electron adapter, web bridge (Controller in the page over IndexedDB, leader tab via Web Locks, followers over BroadcastChannel, Firestore persistent cache), both compile.
- B: web build runs locally in local-only mode (no Firebase config here). Real sign-in and Firestore sync are untested until the web config exists (deployment agent registers the Web app).
- C: phone shell (52 px top bar, running pill, 5-item tab bar, More sheet, pull to refresh), bottom sheets, full-screen palette, swipeable Board, Tasks swipe gestures, Log Read/Write with drafts, sign-in screen, install-desktop button, usage meter.
- D: QA (viewports, sync tests, critique) running.

## Previous: State (2026-11-19, end of Phase 3.7)

Branch `claude/phase-3-7-refinements-iwku6e` (the prompt said `phase-3-7`; the session's branch rule wins). Checks: `npm run typecheck` clean; `npm test` 957 passed (72 files); `npm run audit` passed; smoke passed (Xvfb). Deploy: Firestore rules changed (schema v4); see `SETUP.md`.

### Done in Phase 3.7 (by prompt section)

- 1 One task model: `core/tasks/selectors.ts`, `core/tasks/screens.ts`, `core/tasks/transition.ts`; no automatic focus; `task.start`, `task.pause`, `task.sort`; Board column = status; done retention (D-173, D-177). Cross-screen test: `tests/core/crossScreen.test.ts`.
- 2 Finish conditions removed everywhere (D-172).
- 3 Tasks screen (rail, Inbox/Today/Upcoming/All, G I/T/U/A, project switch, List/Board, quick add with chips, P1-P4, @labels, sections = columns, inline rename, E, Del, Ctrl+Enter, S, Shift/Ctrl-click, drag reorder with an insertion line, Done list, empty states) (D-175, D-176, D-182).
- 4 Home shelf, drag to pause, drop to start, empty drop target; Esc cancels any drag (D-178).
- 5 Plan time grid at 2 px/min, minute-aligned now-line, plans over classes, class in the pill, planned task in the pill when nothing is in focus (D-179).
- 6 Notepad: hotkey (bare Insert/F-keys allowed), position, recent notes, grows downward, Ctrl+Enter push (D-181).
- 7 TASK markers (live in notepad and Focus, at post time in the Log); "- " is a bullet (D-180).
- 8 Log: task offer in the post header, calendar drawer (closed, remembered), reading view R. Focus thinking-space list.
- 9 Premium pass: sentence-case section headings and palette labels, narrow top bar, Home toolbar trimmed to Plan and Focus, ellipsis and full-title tooltips on grid blocks, buffer label clear of the now-line, help sheet updated.
- 10 `SETUP.md` (Firebase deploy with rollback, Cloudflare placeholder for Phase 4); rules updated and statically tested.

### Deferred (with reason)

- Firestore emulator: still not runnable here (D-124); rules are guarded by a static test and need the Rules Playground checks in `SETUP.md`.
- Windows-only behaviour (notepad hotkey with Insert, window growth, focus return, pill second line in the taskbar band): `docs/WINDOWS_CHECKLIST.md` 51-58.
- The full 1366/1920 × four sizes × five themes visual matrix was checked by the smoke script's overflow matrix (D-170) and spot screenshots, not by eye on every combination.
- `PRODUCT.md` still does not exist; not invented.

## Previous: State (2026-11-15, end of the Phase 3.5 fix pass)

Branch `claude/chronos-phase-3-5-build-ya77ix` (the prompt said `phase-3-5`; the session's branch rule wins). Checks: `npm run typecheck` clean; `npm test` 860 passed (63 files); `npm run audit` passed; `npm run smoke` passed (Xvfb). Impeccable detector (live app over CDP, 36 scans): all findings fixed except 12 kept by decision (Stark plasma, TARS cream ground). Critique 30/40 (27/36 excluding Help): target ≥30/36 **not met**; details and open issues in `docs/BUILD_REPORT.md`.

### Done in Phase 3.5 (by prompt section)

- 2.1 IPC allow-list: `project.create`, `task.moveCard`; type-enforced test over every Command (D-158). Plain-words error toasts that collapse with ×N.
- 2.2 One `navigate()` in `renderer/home/nav.ts` (D-159).
- 2.3 Zoom locked on every window, Settings → Look → Size and layout presets 90-125 % per device (D-160).
- 3 One palette: centred, dim + blur (measured once, D-162), top-bar field is a button, `>` commands, focus trap and return (D-161).
- 4 Silent Focus (D-165). 5 Log: composer, chips, calendar + "This month", states (D-166). 6 Projects: header switcher, optional pinned list (D-167).
- 7 Overlay in the taskbar band, hover → Pause, hold icon 2 s → finish, hidden while Home is in front, pill colours + contrast check (D-163, D-164).
- 8 Tilt max 3° (was 9°, only while over a panel, unchanged rule) and no inner scroll on Home (D-170). 9 Smoke bug: blocks ≥ 28 px wide (D-170).
- 10 Desktop layer trace, status in Settings → Experimental, Win+1 tip (D-169). 11 Flight plan and Pit wall (D-168). 12 Rail labels 12 px, no-overshoot ease, control states, no Settings jump.
- After the critiques: CSS ordering fix (shell.css loads first, overrides need higher specificity), Esc leaves a text field before navigating, Ctrl+L ignored while editing a task, Pit wall gap labelled ahead/behind.
- After the first critique: toasts 5 s (errors/Undo 8 s), cleared on navigation, at most 2; morning plan is a one-line strip; ? help sheet (keys and words).

### Deferred (with reason)

- Handoff mockups `TopSearch.dc.html`, `Log.dc.html`, `Board.dc.html` and `josef-feedback/*.png` were not in the repo or anywhere on disk; built from the prompt text and the existing mockups.
- `PRODUCT.md` does not exist at the repo root (the prompt said Impeccable wrote it); not invented.
- Overlay free position: no drag-to-place yet (uses the stored position, default 24,24).
- Pit wall "stints today" bars, Flight plan's left flight-plan column and debrief list: the themes use the shared Home layout with their own tokens, timer, moments, laps widget and copy.
- Lively's extra 24H2 z-order step: cannot be verified off Windows (D-169).
- `/impeccable polish` as a separate pass was folded into the critique fixes. No third critique run after the banner fix (brief allows one re-run).
- Windows-only behaviour (taskbar band maths, z-order, desktop layer, zoom accelerators in packaged Electron) is unverified: `docs/WINDOWS_CHECKLIST.md` 43-50.

## Previous state

### State (2026-11-14, end of the Phase 2+3 build)

Branch `claude/sweet-maxwell-h63n40` (the prompt said `phase-2-3`; the hub commits and opens the PR). Electron 33 + Vite + React 18 + TS. Checks: `npm run typecheck` clean; `npm test` 779 passed (55 files); `npm run audit` passed; smoke run passed.

**The desktop layer ships OFF with the fallback active, and is unverified on Windows.** So are the overlay, notepad and palette windows (focus return, z-order, full-screen hiding), sound, DPI and two monitors. Run `docs/WINDOWS_CHECKLIST.md` items 24-26 and 33-42 on Windows, then flip the `liveOnDesktop` default in `src/core/model/defaults.ts` only if they pass.

## Done

- Phase 1 (sync with outbox, Google sign-in, local Claude MCP, diagnostics): see `docs/SYNC.md`, `docs/MCP.md`. Real Firestore and rules never run (D-124).
- Checkpoint A: schema v3 and migration, planning (estimates, auto-plan, re-plan, review, wellness), parser (corpus 100 %, learning, packs, misparse loop), MCP additions.
- Checkpoint B: undo tokens in main, overlay / notepad / palette windows (`windows.html`, hash routed), desktop layer (koffi, off), `add_task text`, lazy `dist/parser.js`.
- Checkpoint C: theme engine and four launch themes, signature timers, rail + Home (Now) + Focus + Plan, runway drag and drop, planning UI, widgets, moments, energy layers, sound, Settings (six sections + Experimental), School timetable, project Board.
- Checkpoint D: Log feed (composer, auto-add vs chip, ticks, edited flag, search filters, calendar, project view), `idea.edit`.
- Integration pass (this session): audit green (rAF in Log replaced by timeouts, `audit-allow` on one computed colour string, barrel-aware "every core module has a test" plus `tests/parser/calendarLexicon.test.ts`); one shared Focus grid and container-sized timers (D-157) fixing the Stark hero overflow, the Gargantua Focus and Home clipping, the Home side column (themed scrollbar), the Tactile dead space and the 390 px tab-bar active state; `useCustomThemes()` into ThemeProvider; Settings switches for Live on the desktop (experimental) and overlay hide-in-full-screen; shortcut relabelled Notepad; taskbar-widget row removed; dead files removed (`styles/widget.css`, legacy `useTheme` in `store.ts`); smoke rewritten for overlay / notepad / palette, Ctrl+K in Home, Log edit through `idea.edit`, and Board / Log / Settings screenshots in tactile and stark at 1440; docs updated.

## Doing

Nothing in flight. The tree is uncommitted at the time of writing (the hub commits).

## Next

1. Hub: commit, open the PR (include the "desktop layer OFF, unverified on Windows" sentence).
2. Josef: `docs/SETUP_FIREBASE.md`, then `docs/WINDOWS_CHECKLIST.md` 13-23 and 24-42 on Windows. Report results; flip `liveOnDesktop` default only after 24-26 and 33-34 pass.
3. Main-side gaps (D-151): make `pickSettings`/`validateSettings` in `src/main/ipc.ts` and `src/core/validation.ts` accept `snapMin`, the parser's `ParserRule` shape and `parserReports`, so the snap control, rule delete/import and "Clear reports" take effect.
4. Optional: a `task.swapCard` command so a Board swap is one commit (D-150); a cross-midnight flag (D-127); timetable for MCP `add_task text` (D-145).
5. Phase 4 (out of scope here): web app, phone app, remote MCP, Pit wall and Flight plan themes, WebGL, PDF timetable importer.

## Known failures and unverified

- Windows-only behaviour is unverified (above). Firestore rules `shape()` and the real provider were not run on the emulator (D-124, D-138). Google sign-in and Claude Desktop via `ELECTRON_RUN_AS_NODE` are unverified.
- Snap setting, parser rule edits and "Clear reports" are refused or ignored by main until D-151 is done.
- Ctrl+Z undoes only toast-backed actions. Plan-style heading lines in the Log can show an "Add as task?" chip (the parser reads "Plan" as a verb).
- Visual: Gargantua Focus ring is modest at 900 px height; TARS Home leaves a gap between criterion and slabs; Focus at 390 px scrolls; Tactile Focus has empty space below the mode controls.
- Smoke only runs on Linux/Xvfb: `npm run build` then `xvfb-run -a node scripts/smoke.mjs`. It sets `CHRONOS_SMOKE=1` so main exposes `openNotepad`/`openPalette` (global shortcuts cannot be pressed under Xvfb).
- No cross-midnight flag exists (D-127).

## How to resume

1. Read this file, `decision.md` (tail), `docs/ARCHITECTURE.md`.
2. `npm ci`, `npm run typecheck`, `npm test`, `npm run audit` (VS Code terminal at the repo root). All three must be green before and after any change.
3. UI changes: `npm run build`, run the smoke script, open `docs/screens/theme-*` and look. Only theme tokens colour components; never change a theme palette to fix layout.
