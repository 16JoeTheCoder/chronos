# Build report: Chronos (Phase 3.7: one task model, Tasks, polish)

## Status (2026-11-19)

`npm run typecheck` clean · `npm test` 957 passed (72 files) · `npm run audit` passed · smoke passed (Xvfb; adds Tasks quick add and complete, Home drag-to-pause / drag-to-start / Esc-cancel, Plan now-line, notepad push). Cross-screen test: `tests/core/crossScreen.test.ts`.

**Deploy needed:** Firestore rules changed (schema v4). See `SETUP.md`. Both PCs must take the new build (an old build goes read-only on v4 records, by design).

Windows-only behaviour is unverified: `docs/WINDOWS_CHECKLIST.md` 51-58.

## Impeccable

### Detector (Assessment B, isolated sub-agent)

- Source scan of `src/renderer`: 0 (regex-only, HTML shells; low coverage).
- Live app over CDP: Home, Tasks, Board, Plan, Focus, Log, Settings, overlay in Tactile; Home, Tasks, Log in Stark. Findings: 1 `repeating-stripes-gradient` on Plan (the hatch on fixed events and the buffer encodes meaning: false positive), 2 `ai-color-palette` on Stark's reactor plasma (theme identity, kept by decision since Phase 2+3). Nothing else.

### Critique (Assessment A, isolated sub-agents, desktop single-window order: A, then B, then A again after fixes)

| Run | Total /40 | Excl. heuristic 10 (/36) | Lowest |
| --- | --- | --- | --- |
| Phase 3.5 run 2 | 30/40 | 27/36 | H8 2 |
| 3.7 run 1 | 28/40 | 26/36 | H4 2, H8 2, H10 2 |
| 3.7 run 2 (after round-1 fixes) | 29/40 | 26/36 | H4 2, H9 2 |

**Target (≥ 32/36, none below 3) is not met.** Run 2 lifted H8 to 3 and H10 to 3; Consistency (H4) stays at 2, and Error recovery (H9) scored 2 because the reviewer could not exercise error states without changing data. Fixed after run 1: the pill's clipped time, Plan spacing and the now label touching the hour labels, the Tasks page frame and flag column, repeated day labels, the time-left formula copy, a visible shortcut line on Tasks, Home's empty band in text-timer themes. Fixed after run 2 (not re-scored): the Desktop/Trash bar no longer sits over the Plan cards (moved into the Plan header), "Then: Physics at 10:00" now says "tomorrow", List/Board toggles share one order, empty Upcoming days collapse into one line, "2 s" spelled out.

Open from run 2: shared page container and one segmented control for Tasks and Board (H4); Focus left column composition; a stray outline in Stark's "Focus this week" widget (not traced); Board embedded in Tasks still shows its own project switcher and tabs; the Home banner and side card state free time twice.


---

# Previous: Build report: Chronos (Phase 3.5 fix pass)

## Status (2026-11-15)

`npm run typecheck` clean · `npm test` 860 passed (63 files) · `npm run audit` passed · `npm run smoke` passed (Xvfb; now also checks silent Focus, palette centring and focus return, `>` commands, navigation after Schedule, project create/switch/pin, help sheet, and no horizontal overflow at 90/100/110/125 % × 1366×768 / 1920×1080).

Windows-only behaviour (taskbar band, z-order, desktop layer, zoom accelerators in the packaged app) is **unverified**: `docs/WINDOWS_CHECKLIST.md` 43-50.

## Impeccable

### Detector (`impeccable detect`)

- Source scan of `src/renderer`: 0 findings (regex-only; it cannot read `tokens.css`/`launch.css`, so it undercounts).
- Live app over CDP (`--cdp 9222 --target index.html`), Home / Board / Log / Settings / palette / Focus in all six theme variants (36 scans). First real pass found: nested cards (Board columns), low contrast (Log "Add as task?" chip, out-of-month calendar days, placeholders, segmented options, key hints on filled buttons, a TARS Log note), stragglers, an unbalanced heading. All fixed. Left by decision: `ai-color-palette` on Stark's reactor plasma (6) and `cream-palette` on TARS day's ground (6): those are the themes' identities, not defaults.
- Note: an earlier run of my CDP driver silently failed (two windows open, no `--target`) and recorded "0 findings"; Assessment B caught it. The numbers above are from the corrected driver, which records detector errors as errors.

### Critique (two isolated sub-agents, A then B, desktop single-window order)

| Run | Total /40 | Excl. heuristic 10 (/36) | Notes |
| --- | --- | --- | --- |
| Previous build (Josef's run) | n/a | 18/36 | |
| Run 1 | 29/40 | 27/36 | H8 Minimalism 2, H10 Help 2 |
| Run 2 (after fixes) | 30/40 | 27/36 | H8 Minimalism 2; H10 Help 3 |

**Target (≥ 30/36, no heuristic below 3) is not met**: Aesthetic and minimalist design scores 2. Both runs reviewed screenshots in which the morning "Plan your day" strip was stretched to ~500 px by a CSS ordering bug (Vite loads `shell.css` before `screens.css`); that was the reviewers' top issue in both runs and is fixed after run 2 (`docs/screens/2-home.png`), but no third run was made (the brief allows one re-run). Other fixes after run 2: Esc in a text field leaves the field before it navigates; Ctrl+L is ignored while a task is being edited; the overlay time no longer truncates; Pit wall labels the gap "ahead"/"behind" (not colour alone); the Focus placeholder fits.

Open issues from run 2, not fixed: Home still shows four toolbar buttons plus the widget stack (density); Undo toasts can sit over dialog bottoms for 8 s; the help sheet is static and can overflow at small sizes; Flight plan's "Step 1 of 12" reads as decoration before start; jargon ("Runway", "Parser rules").


---

# Previous: Phase 2+3

## Status (2026-11-14)

Checks at the end of this build: `npm run typecheck` clean, `npm test` 779 passed in 55 files, `npm run audit` passed (every check ok), smoke run (`npm run build` then `xvfb-run -a node scripts/smoke.mjs`) passed.

**Read this first: the desktop layer ships OFF.** "Live on the desktop" (Home behind the icons, Win+D) is implemented with koffi and a WorkerW attach, but it has never run on Windows. Its Settings switch is labelled experimental and defaults to off; the fallback (a normal window) is the active path and any attach failure returns to it. Everything in `docs/WINDOWS_CHECKLIST.md` (24-26 and 33-42) is unverified on Windows.

| Area | Status |
| --- | --- |
| Schema v3 and migration | Done, tested on a realistic v2 fixture (lossless, idempotent); Firestore rules for v3 **not run on the emulator** |
| Parser | Done: corpus at 100 % (known gaps listed in `tests/parser/corpus.known-gaps.txt`), property tests, benchmark |
| Planning (estimates, auto-plan, re-plan, review, wellness) | Done, unit-tested |
| Desktop layer | Built, **OFF by default, unverified on Windows** |
| Overlay, notepad, palette windows | Built; smoke screenshots on Xvfb; focus, z-order and full-screen hiding **unverified on Windows** |
| Theme engine and four launch themes | Done; contrast and schema tested; checked visually at 1440 and 390 px |
| Focus, Home, Board, Log, Settings | Done; smoke-driven (Space, hold-Enter, Ctrl+K, Log edit through `idea.edit`) |
| Sound | Synthesised; **audio never heard in this build** (checklist 39) |
| Claude MCP additions | Done, unit-tested; Claude Desktop path unverified (checklist 19) |
| Sync of Log posts between two PCs | Uses the Phase 1 path (fake-Firestore tested); the real ~2 s figure is unverified (checklist 40) |

## Unverified

- Everything Windows-specific above, plus DPI 125/150 % and two monitors for the new windows (checklist 42).
- Real Firestore provider and rules (D-124, D-138); Google sign-in; MCP through Claude Desktop with `ELECTRON_RUN_AS_NODE`.
- Not finished (D-151): `pickSettings` in `main/ipc.ts` does not yet accept `snapMin`, the parser rule shape or `parserReports`, so the snap control, rule delete/import and "Clear reports" are wired but refused or ignored.
- Ctrl+Z undoes only toast-backed actions.
- Cross-midnight flag from the spec is not implemented (D-127).

## Visual state (docs/screens, 1440x900 and 390 wide, four themes)

Fixed this pass: Stark hero no longer overflows; one shared Focus layout (grid areas, ring sized from its container); Gargantua Focus and Home no longer clip; Home side column fits and scrolls with a themed scrollbar when needed; Tactile hero sizes to content; the 390 px tab bar has a quiet active state. Remaining: Gargantua Focus ring is modest in size at 900 px height (the layout gives room to the title, actions and thinking space first); TARS Home leaves a gap between the criterion and the slabs; at 390 px the active tab keeps a thin focus outline after keyboard use (intended, focus-visible); the Focus screen at 390 px scrolls.

## Numbers (from `npm run audit`)

| Item | Size | Budget |
| --- | --- | --- |
| Renderer JS (gzip) | 154.8 KB | 220 KB |
| Renderer CSS (gzip) | 21.5 KB | 30 KB |
| `dist/main.js` | 174.1 KB | 180 KB (D-147) |
| `dist/parser.js` (lazy, chrono-node) | 77.9 KB | n/a |
| `dist/sync.js` (lazy) | 1012 KB | 1.6 MB |
| `dist/chronos-mcp.js` (bridge) | 383 KB | 700 KB |
| `launch.css` | 2.8 KB | 8 KB |

New dependency this phase: `koffi@3.3.8` (pinned, D-144); `chrono-node` for the parser; `@fontsource/*` for fonts (no CDNs).

Manual steps for Josef: `docs/SETUP_FIREBASE.md`, then `docs/WINDOWS_CHECKLIST.md` (13-23 for sync and Claude, 24-42 for Phase 2+3).

---

# Phase 1 report (historical)

## Phase 1 status (2026-11-11)

| Area | Status |
| --- | --- |
| A Data model v2 + migration | Done, tested (lossless, idempotent, realistic v1 fixture) |
| B Sync (outbox, per-field merge, tombstones, version gate, reconnect, quarantine, snapshots) | Done; engine tested against a fake Firestore (scenarios a-h). **Real Firestore provider and rules never run** (emulator blocked, D-124) |
| C Google sign-in | Built; **unverified** (needs the real OAuth client, Windows checklist 17) |
| D Experimental mode / sync dot | Done; smoke-tested; diagnostics need a signed-in PC |
| E Search | Done; 1.4 ms per query at 5,000 records (target 10 ms) |
| F Local MCP | Done; handlers, endpoint, bridge tested; bridge verified over stdio by hand; **Claude Desktop + ELECTRON_RUN_AS_NODE unverified on Windows** |
| G Visible fixes | Done; smoke-tested with screenshots (now label, buffer, event menu, hold ring) |
| H Tests / docs | 447 vitest tests in 33 files, audit green, smoke green |

Numbers (from `npm run audit`): renderer JS 76.7 KB gz (budget 220), CSS 8.4 KB gz (30), main 138.3 KB (150), `dist/sync.js` 1012 KB loaded on demand (1.6 MB), MCP bridge 382 KB (700), launch.css 2.8 KB (8).

Manual steps for Josef: `docs/SETUP_FIREBASE.md`, the Rules Playground checks in `docs/SYNC.md`, then `docs/WINDOWS_CHECKLIST.md` 13-23.

---

# v1.0.0 report (historical)

Built on Linux in one session, 2026-10-26. Nothing below has run on Windows.

## Status by tier

| Tier | Status |
| --- | --- |
| P0 | Shipped: core (zones/DST, recurrence, time-left, queue rules, timer, repo, recycle/purge), persistence and recovery, IPC, Home with launch screen and draw-in, taskbar widget, tray, shortcuts, runway with drag and keyboard paths, Trash with Undo, Focus Core, schedule editor, tags, onboarding, Desktop shelf, settings, About, sync engine + tests, firebase stubs, CI, smoke test |
| P1 | Shipped: holidays (seed, Heads-up, banner), prep nudges, sprints and checkpoints, stray thoughts / Ideas, Done drawer metrics, quick capture, Monolith import, time-left variants |
| P2 | Shipped: light theme (and system), "Next 6 h" runway range |

## Numbers

- Tests: 145 vitest tests in 22 files, all passing (core logic, store/controller recovery, IPC validation, WCAG contrast, widget docking, the 7 sync scenarios). Smoke test (`scripts/smoke.mjs`, Electron under Xvfb) passes: launch, reveal, quick-add, keyboard scheduling, Focus start + stray thought + finish ritual, recycle + Undo, shelf, schedule editor, settings, About, no console errors.
- Bundle (from `npm run audit`): renderer JS 71.2 KB gz (budget 220), CSS 7.5 KB gz (budget 30), main 59.4 KB (budget 150), launch.css 2.8 KB (budget 8). Zero network requests: CSP `connect-src 'none'` plus a main-process request blocker (D-033).
- Startup instrumentation: `perf.ts` marks `app.ready`, `home.ready`, `home.shown`; the renderer reports `launch.script` and `hydrated`. They are logged to `logs\chronos.log` and shown in About → Copy diagnostics. On the Linux/Xvfb smoke run: app.ready 305 ms, home.shown 649 ms (≈ 344 ms after ready), hydrated 300 ms after page start. Targets (≤ 600 ms ready→shown, ≤ 400 ms launch paint) must be measured on Windows.

## UNVERIFIED-ON-WINDOWS

Implemented, never run on Windows: always-on-top over the taskbar and re-assertion after Start menu; widget docking maths against the real taskbar; DPI 125/150 % and drag drift; Home covering the work area and z-order burst; Alt+Tab/Win+D escape hatch; launch at login and the `fast-startup.ps1` modes; global shortcuts and taken-accelerator errors; tray; notifications and beep; suspend/resume/shutdown events; `shell.trashItem` to the Recycle Bin; OneDrive-redirected Desktop and `app.getFileIcon`; multi-monitor display choice; NSIS/portable packaging and SmartScreen; real-world startup timings. Steps: `docs/WINDOWS_CHECKLIST.md`.

## Known issues

- Notification dedupe resets on restart (D-030).
- The schedule editor's week grid shows the current week only; past/future weeks are edited through the same series.
- Keyboard resize changes a block's end only (D-035); drag resizes both edges.
- 'System' theme switching when Windows changes theme is untested.

## Reviewer passes

The owner allowed one spawned agent, so one independent read-only reviewer (brief: `.claude/agents/reviewer.md`, widened with leanness and design-system fidelity) ran grouped passes instead of one per milestone (D-018).

- **Pass 1 (after M0–M9): FAIL.** 1 blocker (a resume after a long pause raised a false sleep gap: the tick baseline went stale while the fast tick was off), 5 majors (dropped/reopened tasks re-locked at the queue head; event-zone minutes used as local minutes in free gaps; several orange points per view; box-shadow/border transitions; design-lint items), minors (sync config read per broadcast, dead code, duplicate palette, focus trap, segmented arrow keys, hotkeys under modals, a 392-line editor). All fixed in `0ea4549`, with regression tests that fail without the fixes (D-034, D-035, D-036).
- **Pass 2: PASS.** It re-ran the round-1 reproductions (both now behave), the audit and the smoke test. Two minors (baseline reset on failed timer commands; a no-op `data-theme` attribute) fixed in the final commit.
- Deliberately unchanged: four small listener stores (each backs a different `useSyncExternalStore` consumer), per-file `MIN` constants, type exports that form API contracts.

## Decisions summary

D-001–D-012 as agreed. Made during the build: the builtbyjosef design system overrides §9.1 tokens (D-013) with local fonts (D-014) and orange as state only (D-034); Drop parks a task and Drop/Reopen start a new run (D-015, D-036); model refinements, deterministic session/closure/exception ids and `tombs` for stubs (D-016); react as devDependencies (D-017); grouped reviewer passes (D-018); per-collection pull and re-push of local winners (D-019, D-020); clock-step-back dirty-tracking limitation (D-021); Monolith 0.2 metrics ported, chain/grades dropped (D-022); countdown to block end only for a fresh countdown (D-023); test-coverage rule (D-024); launch dial turns once (D-025); real brand assets (D-026); public tokens/launch CSS (D-027); one shelf module (D-028); fast tick only while running (D-029); per-run notification dedupe (D-030); `CHRONOS_USER_DATA` (D-031); `--now` token (D-032); main-process request blocker (D-033); end-edge keyboard resize (D-035).

## Screenshots (docs/screens)

1-launch, 2-runway, 3-focus, 4-schedule, 5-settings, 6-about, 7-widget, from `scripts/smoke.mjs` on Xvfb at 1600×900.
