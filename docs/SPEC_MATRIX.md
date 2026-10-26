# Spec matrix

One row per MUST sentence in the build spec, plus one row per subsection of §6, §8 and §9. Evidence is a test (`tests/...`), the smoke run (`scripts/smoke.mjs`, screenshots in `docs/screens/`), the audit (`npm run audit`), or `UNVERIFIED-ON-WINDOWS` with the manual step in `docs/WINDOWS_CHECKLIST.md`.

## MUST rows

| ID | Requirement | File(s) | Test / evidence |
| --- | --- | --- | --- |
| M-6.1 | MUST handle DST correctly (Berlin, Zurich spring-forward and fall-back; Jakarta no DST) | `src/core/time/zone.ts` | `tests/core/zone.test.ts` |
| M-6.3a | Time-left MUST be table-driven tested (empty day, event spanning now, overlaps merged, now before start / after end, buffer > window, each variant) | `src/core/time/timeLeft.ts` | `tests/core/timeLeft.test.ts` (11 table rows + identity check) |
| M-10.1a | Two simulated devices converge after interleaved edits | `src/core/sync/engine.ts`, `memoryProvider.ts` | `tests/core/sync.test.ts` "two devices converge" |
| M-10.1b | Concurrent edit LWW | `engine.ts` (`wins`, re-push) | `sync.test.ts` "concurrent edits" |
| M-10.1c | Delete vs edit | `engine.ts` | `sync.test.ts` "delete vs edit" |
| M-10.1d | Purge stub does not resurrect | `engine.ts`, `core/repo/recycle.ts` | `sync.test.ts` "a purge stub never lets..." |
| M-10.1e | Offline device reconnects after 10 days | `engine.ts` | `sync.test.ts` "reconnecting after 10 days" |
| M-10.1f | Timer takeover closes the right slice | `engine.ts` (`takeover`, `afterTakeover`) | `sync.test.ts` "timer takeover" |
| M-10.1g | Running the sync twice is a no-op | `engine.ts` | `sync.test.ts` "running the sync twice" |
| M-11.1 | Tests (vitest): Monolith timer/tasks/store/recovery ports; time-left; recurrence incl. week A/B and exceptions; zones/DST; holidays/Easter; queue derivation and locked-active; prep nudges; recycle + purge; repo stamping; persistence (atomic, .bak); IPC validation; WCAG contrast; sprint checkpoints; §10 sync | `src/core/**`, `src/main/**` | `tests/core/*.test.ts`, `tests/main/*.test.ts` (all passing; count in `docs/BUILD_REPORT.md`) |
| M-11.4 | Reviewer subagent exists and audits | `.claude/agents/reviewer.md` | reviewer passes recorded in `docs/BUILD_REPORT.md` |

## §6 Core logic

| ID | Requirement | File(s) | Test / evidence |
| --- | --- | --- | --- |
| 6.1 | Time and zones: UTC ms, wall time + IANA tz, Intl only, "today" in `settings.timezone`, tz changeable | `core/time/zone.ts`, `core/tasks/tasks.ts` (`todayOf`), Settings → General | `tests/core/zone.test.ts` |
| 6.2 | Recurrence: one-offs, weekdays, from/until, every N weeks from anchor, exceptions, scope switches, closures, master switch | `core/time/schedule.ts` | `tests/core/schedule.test.ts` |
| 6.3 | Holidays (P1): computable dates seeded unconfirmed for this and next year, idempotent; Heads-up card; holiday banner; confirm sets Off scopes | `core/time/holidays.ts`, `main/controller.ts` (`housekeeping`), `renderer/home/Strips.tsx`, `renderer/runway/Runway.tsx` | `tests/core/holidays.test.ts`, `tests/main/controller.test.ts` "seeds holidays", `tests/core/schedule.test.ts` closures |
| 6.3a | Time-left formula and advanced variants | `core/time/timeLeft.ts`, `renderer/runway/TimeLeft.tsx`, Settings → Advanced | `tests/core/timeLeft.test.ts`; `docs/screens/2-runway.png` |
| 6.4 | Queue derivation and the locked active task; inbox tasks need a finish condition to become active | `core/tasks/tasks.ts`, `core/commands.ts` | `tests/core/tasks.test.ts` |
| 6.5 | Prep nudges (P1): explicit/implicit, needs vs free, tight flag; Before-class strip, widget dot, one notification at lead time; "Do before" on tagging | `core/time/prep.ts`, `main/controller.ts` (`slowTick`), `renderer/home/Strips.tsx`, `renderer/widget/Widget.tsx`, `renderer/cards/TaskEditor.tsx` | `tests/core/prep.test.ts`; notification UNVERIFIED-ON-WINDOWS |
| 6.6 | Timer engine ported unchanged; countdown to block end with overtime; `overrunMs`; overrun line; single owner with Take over | `core/timer/timer.ts`, `core/commands.ts` (`timer`), `core/tasks/tasks.ts` (`recordSlices`), `core/tasks/metrics.ts`, `core/sync/engine.ts` | `tests/core/timer.test.ts`, `tests/core/tasks.test.ts` "inside a block", `tests/core/sync.test.ts` takeover |
| 6.7 | Sprints (P1): stopwatch default, checkpoint every N min of work, Continue/Ship/Kill, Done counts | `core/tasks/sprints.ts`, `core/commands.ts`, `renderer/focus/FocusCore.tsx`, `main/controller.ts` (notify) | `tests/core/sprints.test.ts`, `tests/main/controller.test.ts` "notifies once per sprint checkpoint" |
| 6.8 | Focus metrics (P1): week from Monday, started/finished/dropped, focus today/week | `core/tasks/metrics.ts`, `renderer/home/DoneDrawer.tsx` | `tests/core/metrics.test.ts` |

## §8 Windows and OS integration

| ID | Requirement | File(s) | Test / evidence |
| --- | --- | --- | --- |
| 8.1 | Security: contextIsolation, sandbox, no node, one preload API, deny window.open, block will-navigate, strict CSP in production (no unsafe-inline), no remote content, single-instance lock | `main/windows/common.ts`, `main/main.ts`, `vite.config.mts`, `preload/preload.ts` | audit "no network code"; built `dist/renderer/index.html` carries the CSP; smoke run has no console errors |
| 8.2 | Home: frameless work-area window, skipTaskbar, show:false + ready-to-show, background colour, briefly on top then ordinary, Esc hides, re-fit on display changes | `main/windows/home.ts`, `renderer/home/Home.tsx` | smoke (launch, Esc paths); UNVERIFIED-ON-WINDOWS (checklist 6, 7, 12) |
| 8.3 | Launch sequence: static HTML + linked launch.css (≤ 8 KB) + one SVG, stat skeletons fill on hydration, Enter/Space reveal, skip option | `renderer/index.html`, `renderer/public/launch.css`, `renderer/launch/launch.ts` | audit budget (launch.css 2.8 KB); smoke `1-launch.png`; startup marks in About |
| 8.4 | Fast startup: login item (packaged), `fast-startup.ps1` Registry/Task/Undo | `main/startup.ts`, `scripts/windows/fast-startup.ps1` | UNVERIFIED-ON-WINDOWS (checklist 4) |
| 8.5 | Taskbar widget: always-on-top, re-asserted, docks left/right/free, auto-hide/side fallback, click/right-click, dot | `main/windows/widget.ts`, `renderer/widget/Widget.tsx` | `tests/main/windows.test.ts` (`dockBounds`); `docs/screens/7-widget.png`; UNVERIFIED-ON-WINDOWS (checklist 1, 5) |
| 8.6 | Tray and three configurable shortcuts with error reporting; quick capture window (P1) | `main/tray.ts`, `main/shortcuts.ts`, `main/windows/capture.ts`, `renderer/widget/Capture.tsx` | UNVERIFIED-ON-WINDOWS (checklist 11) |
| 8.7 | Desktop shelf: real Desktop (OneDrive-aware), overridable, readdir + getFileIcon, debounced watch, openPath, read-only, hides dotfiles/desktop.ini | `main/shelf.ts`, `renderer/shelf/Shelf.tsx` | smoke "open the Desktop shelf"; UNVERIFIED-ON-WINDOWS (checklist 9) |
| 8.8 | Trash: tombstone + 8 s Undo; occurrence vs series; file → confirm → `shell.trashItem`; Recently deleted with Restore | `renderer/components/actions.ts`, `renderer/shelf/Shelf.tsx`, `main/shelf.ts` | `tests/core/tasks.test.ts` recycle/restore; smoke "recycle a card, then Undo"; Recycle Bin UNVERIFIED-ON-WINDOWS |
| 8.9 | Power events ported; notifications for block end, Pomodoro boundaries, prep nudges, checkpoints; silent/beep settings | `main/controller.ts`, `main/notify.ts`, `renderer/widget.tsx` (beep) | `tests/main/controller.test.ts` suspend/resume, gaps; UNVERIFIED-ON-WINDOWS (checklist 10, 11) |
| 8.10 | Packaging: appId, NSIS + portable, generated icon, CI on windows-latest, release on v* tags, unsigned | `package.json` `build`, `scripts/make-icon.mjs`, `.github/workflows/build-windows.yml` | CI run on push; UNVERIFIED-ON-WINDOWS (checklist 2) |

## §9 UI/UX

| ID | Requirement | File(s) | Test / evidence |
| --- | --- | --- | --- |
| 9.1 | Visual language (builtbyjosef design system per D-013), draw-in ≤ 900 ms on transform/opacity, reduced-motion crossfade | `renderer/public/tokens.css`, `renderer/styles/app.css` | screenshots; `tests/main/contrast.test.ts` |
| 9.2 | Home layout: header, Plan │ Focus top centre (F), time left, runway, before class, unscheduled, Desktop/Trash; runway top or bottom | `renderer/home/Home.tsx` | `docs/screens/2-runway.png` |
| 9.3 | Runway: axis, Fixed (hatched, lock glyph, label) and Plan lanes, free stretches labelled ≥ 90 min, now-line every 30 s, past dimmed, done check, 5-min snap, drag ghost valid/invalid, shorten to gap with "+Xm unscheduled", move/resize, events not draggable except to Trash, duration chips; Next 6 h (P2) | `renderer/runway/Runway.tsx`, `renderer/runway/model.ts`, `renderer/cards/Cards.tsx`, `renderer/components/drag.ts` | smoke (keyboard scheduling); drag paths UNVERIFIED-ON-WINDOWS (checklist 8) |
| 9.4 | Focus Core: stage, huge timer shared with widget, Start/Pause, Skip phase, mode before first start, Finish ritual, Drop, rail, stray-thought input, sprint checkpoint card | `renderer/focus/FocusCore.tsx`, `renderer/focus/TimerDigits.tsx` | smoke (start, stray thought, finish); `docs/screens/3-focus.png` |
| 9.5 | Schedule editor: week grid, click-drag create, Basic/Advanced, days chips, duplicate to days, delete, valid-from/until, every N weeks + anchor, tz override, notes, exceptions, timetable switches, Holidays list | `renderer/schedule/ScheduleEditor.tsx` | smoke; `docs/screens/4-schedule.png` |
| 9.6 | Onboarding: ≤ 3 steps, timezone + day window, timetable or skip, land on Runway, no sample data | `renderer/onboarding/Onboarding.tsx` | smoke ("Skip setup") |
| 9.7 | Done drawer and Ideas | `renderer/home/DoneDrawer.tsx` | `tests/core/metrics.test.ts`; manual |
| 9.8 | Shelf, Trash glow when dragging, toasts bottom-centre 8 s | `renderer/shelf/Shelf.tsx`, `renderer/components/ui.tsx` | smoke |
| 9.9 | Settings sections incl. Data, Sync card, Advanced | `renderer/settings/Settings.tsx` | `docs/screens/5-settings.png` |
| 9.10 | About: mark, version, "Built by Josef Yang · builtbyjosef", JY monogram, Copy diagnostics with startup marks; brand assets by exact name | `renderer/settings/Settings.tsx` (`About`), `renderer/assets/builtbyjosef.svg`, `renderer/assets/jy-monogram.svg` | `docs/screens/6-about.png` |
| 9.11 | Keyboard parity: Enter/Space, Esc, F, N, S, arrows/Shift/Alt on blocks, Delete with Undo; tab order | `renderer/home/Home.tsx`, `renderer/cards/Cards.tsx`, `renderer/runway/Runway.tsx`, `renderer/launch/launch.ts` | smoke (Enter, N, S, F, Delete, Esc) |
| 9.12 | Accessibility: contrast ≥ 4.5:1, focus-visible rings, meaningful aria-labels, polite live region, reduced motion, zoom-safe, DPI-safe window maths | `renderer/styles/app.css`, components | `tests/main/contrast.test.ts`; DPI UNVERIFIED-ON-WINDOWS (checklist 7) |
