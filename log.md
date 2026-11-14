# Chronos build log

A fresh session can resume from this file alone. Newest state first. Decisions: `decision.md` (D-001..D-157, unique and ascending). Spec for this build: `docs/PHASE23_PROMPT.md`. Evidence per requirement: `docs/SPEC_MATRIX.md`.

## State (2026-11-14, end of the Phase 2+3 build)

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
