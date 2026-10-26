# Build report: Chronos 1.0.0

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

- Sync dirty tracking can miss edits if the clock steps back between pushes (D-021); sync is off in v1.
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
