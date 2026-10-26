# Build report: Chronos 1.0.0

Built on Linux in one session, 2026-10-26. Nothing below has run on Windows.

## Status by tier

| Tier | Status |
| --- | --- |
| P0 | Shipped: core (zones/DST, recurrence, time-left, queue rules, timer, repo, recycle/purge), persistence and recovery, IPC, Home with launch screen and draw-in, taskbar widget, tray, shortcuts, runway with drag and keyboard paths, Trash with Undo, Focus Core, schedule editor, tags, onboarding, Desktop shelf, settings, About, sync engine + tests, firebase stubs, CI, smoke test |
| P1 | Shipped: holidays (seed, Heads-up, banner), prep nudges, sprints and checkpoints, stray thoughts / Ideas, Done drawer metrics, quick capture, Monolith import, time-left variants |
| P2 | Shipped: light theme (and system), "Next 6 h" runway range |

## Numbers

- Tests: see `npm test` (vitest), all passing at the final commit.
- Bundle (from `npm run audit`): renderer JS ≈ 71 KB gz (budget 220), CSS ≈ 8 KB gz (budget 30), main ≈ 59 KB (budget 150), launch.css 2.8 KB (budget 8).
- Startup instrumentation: `perf.ts` marks `app.ready`, `home.ready`, `home.shown`; the renderer reports `launch.script` and `hydrated`. They are logged to `logs\chronos.log` and shown in About → Copy diagnostics. On the Linux/Xvfb smoke run: app.ready 305 ms, home.shown 649 ms (≈ 344 ms after ready), hydrated 300 ms after page start. Targets (≤ 600 ms ready→shown, ≤ 400 ms launch paint) must be measured on Windows.

## UNVERIFIED-ON-WINDOWS

Implemented, never run on Windows: always-on-top over the taskbar and re-assertion after Start menu; widget docking maths against the real taskbar; DPI 125/150 % and drag drift; Home covering the work area and z-order burst; Alt+Tab/Win+D escape hatch; launch at login and the `fast-startup.ps1` modes; global shortcuts and taken-accelerator errors; tray; notifications and beep; suspend/resume/shutdown events; `shell.trashItem` to the Recycle Bin; OneDrive-redirected Desktop and `app.getFileIcon`; multi-monitor display choice; NSIS/portable packaging and SmartScreen; real-world startup timings. Steps: `docs/WINDOWS_CHECKLIST.md`.

## Known issues

- Sync dirty tracking can miss edits if the clock steps back between pushes (D-021); sync is off in v1.
- Notification dedupe resets on restart (D-030).
- The schedule editor's week grid shows the current week only; past/future weeks are edited through the same series.

## Reviewer

See "Reviewer passes" below.

## Screenshots (docs/screens)

1-launch, 2-runway, 3-focus, 4-schedule, 5-settings, 6-about, 7-widget, from `scripts/smoke.mjs` on Xvfb at 1600×900.
