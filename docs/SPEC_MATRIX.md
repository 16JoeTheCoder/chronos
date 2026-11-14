# Spec matrix

One row per MUST sentence in the build spec, plus one row per subsection of §6, §8 and §9. Evidence is a test (`tests/...`), the smoke run (`scripts/smoke.mjs`, screenshots in `docs/screens/`), the audit (`npm run audit`), or `UNVERIFIED-ON-WINDOWS` with the manual step in `docs/WINDOWS_CHECKLIST.md`.

## MUST rows

| ID | Requirement | File(s) | Test / evidence |
| --- | --- | --- | --- |
| M-6.1 | MUST handle DST correctly (Berlin, Zurich spring-forward and fall-back; Jakarta no DST) | `src/core/time/zone.ts` | `tests/core/zone.test.ts` |
| M-6.3a | Time-left MUST be table-driven tested (empty day, event spanning now, overlaps merged, now before start / after end, buffer > window, each variant) | `src/core/time/timeLeft.ts` | `tests/core/timeLeft.test.ts` (11 table rows + identity check) |
| M-10.1a | Two simulated devices converge after interleaved edits | `src/core/sync/engine.ts`, `memoryProvider.ts` | `tests/sync/twoDevice.test.ts` (a), first sign-in |
| M-10.1b | Concurrent edit LWW | `core/sync/merge.ts` (`planCommit`) | `tests/sync/twoDevice.test.ts` (c): per-field, one conflict logged (LWW replaced, D-105) |
| M-10.1c | Delete vs edit | `engine.ts` | `tests/sync/twoDevice.test.ts` (d) |
| M-10.1d | Purge stub does not resurrect | `engine.ts`, `core/repo/recycle.ts` | `tests/sync/twoDevice.test.ts` "a purge stub on the server is terminal" |
| M-10.1e | Offline device reconnects after 10 days | `engine.ts` | `tests/sync/twoDevice.test.ts` (b), latency/reconnect |
| M-10.1f | Timer takeover closes the right slice | `engine.ts` (`takeover`, `afterTakeover`) | `tests/sync/twoDevice.test.ts` "timer takeover" |
| M-10.1g | Re-sending a write is a no-op | `core/sync/outbox.ts`, deterministic ids | `tests/sync/twoDevice.test.ts` (e) |
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
| 6.6 | Timer engine ported unchanged; countdown to block end with overtime; `overrunMs`; overrun line; single owner with Take over | `core/timer/timer.ts`, `core/commands.ts` (`timer`), `core/tasks/tasks.ts` (`recordSlices`), `core/tasks/metrics.ts`, `core/sync/engine.ts` | `tests/core/timer.test.ts`, `tests/core/tasks.test.ts` "inside a block", `tests/sync/twoDevice.test.ts` takeover |
| 6.7 | Sprints (P1): stopwatch default, checkpoint every N min of work, Continue/Ship/Kill, Done counts | `core/tasks/sprints.ts`, `core/commands.ts`, `renderer/focus/FocusCore.tsx`, `main/controller.ts` (notify) | `tests/core/sprints.test.ts`, `tests/main/controller.test.ts` "notifies once per sprint checkpoint" |
| 6.8 | Focus metrics (P1): week from Monday, started/finished/dropped, focus today/week | `core/tasks/metrics.ts`, `renderer/home/DoneDrawer.tsx` | `tests/core/metrics.test.ts` |

## §8 Windows and OS integration

| ID | Requirement | File(s) | Test / evidence |
| --- | --- | --- | --- |
| 8.1 | Security: contextIsolation, sandbox, no node, one preload API, deny window.open, block will-navigate, strict CSP in production (no unsafe-inline), no remote content, single-instance lock | `main/windows/common.ts`, `main/main.ts`, `vite.config.mts`, `preload/preload.ts` | audit "no network code"; built `dist/renderer/index.html` carries the CSP; smoke run has no console errors |
| 8.2 | Home: frameless work-area window, skipTaskbar, show:false + ready-to-show, background colour, briefly on top then ordinary, Esc hides, re-fit on display changes | `main/windows/home.ts`, `renderer/home/Home.tsx` | smoke (launch, Esc paths); UNVERIFIED-ON-WINDOWS (checklist 6, 7, 12) |
| 8.3 | Launch sequence: static HTML + linked launch.css (≤ 8 KB) + one SVG, stat skeletons fill on hydration, Enter/Space reveal, skip option | `renderer/index.html`, `renderer/public/launch.css`, `renderer/launch/launch.ts` | audit budget (launch.css 2.8 KB); smoke `1-launch.png`; startup marks in About |
| 8.4 | Fast startup: login item (packaged), `fast-startup.ps1` Registry/Task/Undo | `main/startup.ts`, `scripts/windows/fast-startup.ps1` | UNVERIFIED-ON-WINDOWS (checklist 4) |
| 8.5 | ~~Taskbar widget~~ replaced in Phase 2+3 by the overlay pill (P23-5b) | `main/windows/overlay.ts`, `renderer/overlay/Overlay.tsx` | UNVERIFIED-ON-WINDOWS (checklist 27, 35) |
| 8.6 | Tray and three configurable shortcuts with error reporting; the capture shortcut now opens the Notepad (P23-5c) | `main/tray.ts`, `main/shortcuts.ts`, `main/windows/popup.ts` | `tests/main/windows.test.ts` (bounds); UNVERIFIED-ON-WINDOWS (checklist 29, 31, 36) |
| 8.7 | Desktop shelf: real Desktop (OneDrive-aware), overridable, readdir + getFileIcon, debounced watch, openPath, read-only, hides dotfiles/desktop.ini | `main/shelf.ts`, `renderer/shelf/Shelf.tsx` | smoke "open the Desktop shelf"; UNVERIFIED-ON-WINDOWS (checklist 9) |
| 8.8 | Trash: tombstone + 8 s Undo; occurrence vs series; file → confirm → `shell.trashItem`; Recently deleted with Restore | `renderer/components/actions.ts`, `renderer/shelf/Shelf.tsx`, `main/shelf.ts` | `tests/core/tasks.test.ts` recycle/restore; smoke "recycle a card, then Undo"; Recycle Bin UNVERIFIED-ON-WINDOWS |
| 8.9 | Power events ported; notifications for block end, Pomodoro boundaries, prep nudges, checkpoints; silent/beep settings | `main/controller.ts`, `main/notify.ts`, `renderer/windows.tsx` (beep in the overlay window) | `tests/main/controller.test.ts` suspend/resume, gaps; UNVERIFIED-ON-WINDOWS (checklist 10, 11) |
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

## Phase 1 rows

| ID | Requirement | File(s) | Test / evidence |
| --- | --- | --- | --- |
| P1-A | Data model v2 + lossless, idempotent v1 migration | `core/model/types.ts`, `core/repo/migrate.ts` | `tests/core/migrateV2.test.ts`, `tests/core/migrate.test.ts` |
| P1-A2 | Validation is the single gate (loader, pull, imports, MCP) | `core/validation.ts` (`recordProblem`), `main/controller.ts` (`splitInvalid`), `core/sync/merge.ts` | `tests/core/validationV2.test.ts`, `tests/sync/twoDevice.test.ts` (g) |
| P1-B | Outbox, per-field merge, tombstones, version gate, reconnect, quarantine | `core/sync/*`, `main/sync/*`, `main/controller.ts` | `tests/sync/*.test.ts` (a)-(h); real Firestore UNVERIFIED (docs/SYNC.md) |
| P1-B2 | Daily snapshots, force resync, restore, conflict log, quarantine, log export | `main/store.ts`, `main/controller.ts`, `main/main.ts` | `tests/main/controllerSync.test.ts`; UI `WINDOWS_CHECKLIST.md` 23 |
| P1-C | Google sign-in (system browser, loopback, PKCE, safeStorage) | `main/sync/auth.ts`, `main/sync/manager.ts` | UNVERIFIED: `WINDOWS_CHECKLIST.md` 17 |
| P1-D | Experimental mode, Diagnostics, quiet sync dot | `renderer/settings/Settings.tsx`, `renderer/home` | smoke + `WINDOWS_CHECKLIST.md` 15 |
| P1-E | Search index, incremental, < 10 ms per query at 5,000 records | `core/search/index.ts` | `tests/core/search.test.ts` (benchmark) |
| P1-F | Local MCP server: tools, undo, rate limit, not-running path | `core/mcp/*`, `main/mcp/server.ts`, `src/bridge/*` | `tests/mcp/*.test.ts`, `tests/main/mcpServer.test.ts`; Claude Desktop UNVERIFIED: checklist 19 |
| P1-G4 | Hold-to-complete replaces the typed phrase | `renderer/focus/hold.ts`, `FocusCore.tsx`, `core/commands.ts` | `tests/renderer/hold.test.ts`, audit "typed finish phrase is gone", smoke |
| P1-G1-3 | Now-line label, visible buffer, per-day event override | `renderer/runway/*`, `core/commands.ts` (`event.editOn`) | `tests/core/eventExceptions.test.ts`, smoke screenshots, checklist 21-22 |

## Phase 2+3 rows (docs/PHASE23_PROMPT.md)

"UNVERIFIED-ON-WINDOWS" means implemented and covered on Linux only; the matching checklist item in `docs/WINDOWS_CHECKLIST.md` (33-42, and 24-32) is the evidence still owed.

| ID | Requirement | File(s) | Test / evidence |
| --- | --- | --- | --- |
| P23-2 | Schema v3: unplaced events, `Idea.projectId`, new settings and device fields, lossless idempotent migration, old-client read-only gate | `core/model/types.ts`, `core/repo/migrate.ts`, `core/validation.ts`, `firebase/firestore.rules` | `tests/core/migrateV3.test.ts`, `tests/core/schemaV3.test.ts` (fixture `tests/fixtures/v2-josef.json`); rules not run on the emulator (D-124, D-138) |
| P23-3 | Parser on chrono-node: 100 % of the corpus, property tests, benchmark < 5 ms, learning (two corrections), packs, misparse loop | `core/parser/*`, `core/parseContext.ts` | `tests/parser/corpus.test.ts`, `grammar.test.ts`, `property.test.ts`, `bench.test.ts`, `learning.test.ts`, `calendarLexicon.test.ts`; `corpus.known-gaps.txt` |
| P23-3b | School timetable screen and bell grid, seeded on request | `renderer/schedule/Timetable.tsx`, `timetable.ts`, `timetableSeed.ts` | `tests/core/parseContext.test.ts`; screenshot `docs/screens/theme-*-1440-settings.png` |
| P23-4 | Estimates, auto-plan (manual blocks untouched, one undo), re-plan, end-of-day review (once across devices), wellness | `core/planning/*`, `core/commands.ts`, `core/undo.ts`, `renderer/planning/*` | `tests/planning/*.test.ts`; smoke "Re-plan toast" |
| P23-5a | Desktop layer (WorkerW, koffi), **ships OFF**, fallback to a normal window on any failure | `main/desktopLayer.ts`, `main/windows/home.ts`, Settings switch | UNVERIFIED-ON-WINDOWS: checklist 24-26, 33, 34 (D-144) |
| P23-5b | Overlay: non-focusable, bottom-left, hides in full-screen apps (setting `overlayHideInFullscreen`) | `main/windows/overlay.ts`, `renderer/overlay/Overlay.tsx` | smoke `7-overlay.png`; UNVERIFIED-ON-WINDOWS: 27, 28, 35 |
| P23-5c | Notepad (Ctrl+Alt+N): task notes, autosave, Esc returns focus, lines become records with Undo | `main/windows/popup.ts`, `renderer/notepad/Notepad.tsx` | smoke `9-notepad.png`; UNVERIFIED-ON-WINDOWS: 29, 36 |
| P23-5d | Palette (Ctrl+K in Home, Ctrl+Alt+K global): add with live chips, search, `>` commands, Ask Claude (clipboard + `claude://`, D-146) | `renderer/palette/*`, `main/askClaude.ts` | `tests/renderer/fromParse.test.ts`; smoke "Ctrl+K in Home opens the palette", `8-palette-in-home.png`, `10-palette.png`; UNVERIFIED-ON-WINDOWS: 30, 32 |
| P23-5e | Focus: Space and hold-Enter work with no click; buffer cushion | `renderer/focus/keys.ts`, `Cushion.tsx`, `cushion.ts` | `tests/renderer/focusKeys.test.ts`, `hold.test.ts`; smoke (Space, short Enter, 2 s hold); checklist 37 |
| P23-6a | Theme engine: schema, validation, contrast, import/export with a reason on rejection, schedule switching, four launch themes | `core/theme/*`, `renderer/themes/*`, `renderer/theme/ThemeProvider.tsx`, `docs/THEMES.md` | `tests/theme/theme.test.ts`, `tests/main/contrast.test.ts`; checklist 38 |
| P23-6b | Signature timers: ticking digits, reactor ring, slab monolith, accretion ring (mini variants for the overlay) | `renderer/signature/*` | smoke `theme-*-home/focus` at 1440 and 390 |
| P23-6c | Home (Now, Next, time left), shared Focus layout, widgets that dim in Focus, one composition per theme | `renderer/home/NowScreen.tsx`, `renderer/focus/FocusCore.tsx`, `renderer/widgets/*`, `renderer/styles/screens.css` | `tests/renderer/widgetStats.test.ts`; screenshots `docs/screens/theme-*` (D-157) |
| P23-6d | Energy layers (Stark), moments, synthesised sound | `renderer/moments/*`, `renderer/sound/sound.ts`, `signature.css` | reduced-motion path by CSS; UNVERIFIED-ON-WINDOWS audio: checklist 39 |
| P23-6e | Runway drag and drop: snapping, Alt free drag, "just today / every week", To place tray, keyboard nudge | `renderer/runway/dnd.ts`, `dropActions.ts`, `Runway.tsx` | `tests/renderer/dnd.test.ts`; smoke drag card to Plan and block back |
| P23-6f | Project board: one-card Doing slot with swap, Board and List views | `core/board/index.ts`, `renderer/board/Board.tsx` | `tests/board/board.test.ts` (11); smoke `theme-*-1440-board.png` |
| P23-6g | Settings: six sections plus Experimental; custom themes device-local; switches for `liveOnDesktop` (experimental) and `overlayHideInFullscreen` | `renderer/settings/*` | smoke `5-settings.png`, `theme-*-1440-settings.png`; partial: `snapMin`, parser rule edits and report clearing need main/ipc.ts (D-151) |
| P23-7 | Log feed: composer, auto-add vs chip, tick sync, edited flag (edit saves via `idea.edit`), search filters, calendar, project view | `core/log/*`, `renderer/log/*`, `core/commands.ts` (`idea.edit`) | `tests/log/lines.test.ts`, `tests/log/search.test.ts`; smoke: edit a post and read it back, `theme-*-1440-log.png`; cross-PC ~2 s: checklist 40 |
| P23-8 | MCP: `add_task text`, `post_log`, `search_log`, `list_unplaced`, `place_event` | `core/mcp/*` | `tests/mcp/addTaskText.test.ts`, `logTools.test.ts` |
| P23-9 | Audit additions: no Node/Electron in `core/parser`; no hard-coded colours outside theme files; barrel-aware test coverage rule | `scripts/audit.mjs` | `npm run audit` (D-156) |
