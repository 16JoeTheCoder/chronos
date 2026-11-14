# Architecture

## Layers

```
src/core      pure TypeScript: model, repo, time, timer, tasks, planning, parser (chrono-node), theme engine, log, board,
              sync engine, search, MCP handlers, commands, validation, format, undo
src/main      Electron shell: controller, store, windows, tray, shortcuts, IPC, shelf, notifications,
              sync/ (Firestore provider, Google sign-in, manager), mcp/ (loopback endpoint)
src/bridge    the stdio MCP server Claude Desktop runs (dist/chronos-mcp.js)
src/preload   the one typed bridge (window.chronos)
src/renderer  React UI: launch screen, rail, Home (Now), Focus, runway, cards, Board, Log, Settings, schedule/timetable, shelf,
              palette, planning prompts, widgets, signature timers, moments, sound, theme provider;
              windows.tsx = the small windows (overlay, notepad, palette), routed by hash
```

`core` imports nothing outside itself (exceptions: `minisearch` in `core/search`, `chrono-node` in `core/parser`; the parser also uses no Node API): no Electron, no DOM, no React, no `node:fs`, no network; `core/mcp` uses no Node APIs at all. Network code lives only in `main/sync/{firestore,auth,remote}.ts` (Firebase), `main/mcp/server.ts` and `src/bridge`. `npm run audit` enforces all of it. Both `main` and `renderer` import `core`; the renderer never imports `main`.

## Data flow (Phase 1)

```
renderer (Home, overlay, notepad, palette)
   | IPC 'command' (sender checked, payload rebuilt field by field)
   v
main/controller.command() --> core/commands.apply() --> new Data
   |
   +--> controller.commit(next): diffData(old, new) --> outbox.json (atomic) --> chronos-data.json (debounced)
   |                                                        |
   |                                                   core/sync SyncEngine --> main/sync/firestore --> Firestore users/{uid}/...
   |                                                        ^                                              |
   +<-- controller.applyRemote() <-- mergeRemote() <--------+---- onSnapshot per collection <-------------+
   |
   +--> snapshot to every window (on change only)

Claude Desktop --stdio--> dist/chronos-mcp.js --HTTP 127.0.0.1 + token--> main/mcp/server --> core/mcp handlers
                                                                                                  |
                                                                       controller.command() (same path as the UI)
```

## Data flow

1. The renderer sends a `Command` (one discriminated union in `core/commands.ts`) over the single `command` IPC channel.
2. `main/ipc.ts` checks the sender is one of our windows and rebuilds the payload field by field from known keys.
3. `main/controller.ts` handles the few machine commands (gap answer, device settings, takeover, import/export) and passes the rest to `core/commands.apply()`, which validates again with the same shared validators and returns new data or field errors.
4. Every entity write goes through `core/repo` (stamps `updatedAt`, `deviceId`, `v`; deletes are tombstones; sync metadata `fv`/`fw` is left to sync). `apply()` ends with `normalize()`, which keeps exactly one `doing` task and the derived inbox/planned status.
5. The controller adopts the result through `commit()`, which records every changed field in the outbox (D-103), persists (timer and session changes at once, planning edits debounced 300 ms, flushed on quit) and pushes a snapshot to every window. Snapshots go out on change only; renderers recompute the clock from snapshot + `Date.now()` every 250 ms while visible.

Timer ticks are never records. Main runs a 250 ms tick only while a timer runs (boundaries, heartbeat every 5 s, gap detection), and a 30 s tick for block ends, prep nudges, holiday seeding, purge (every 6 h) and day rollover.

## Persistence

`%APPDATA%\Chronos\chronos-data.json` holds all synced data (`Data`, schema 3: one record map per collection plus `tombs` for purge stubs). Beside it: `outbox.json` (writes waiting for Firestore), `conflicts.json`, `quarantine.json`, `snapshots\` (daily, 7 kept) and `device.json`. Loading runs `migrate()` (v1 → v2 → v3, lossless and idempotent) and moves records that fail validation to quarantine. Writes use Monolith's procedure: `.tmp` + fsync, previous file to `.bak`, atomic rename. A corrupt file falls back to `.bak`. `device.json` holds the device-local settings (never synced) and sync cursors; `heartbeat` holds the last time a running timer was seen alive. The store sits behind a `Persistence` interface so SQLite can replace it (D-004).

## Window model

One app, one controller, four windows (D-003, D-145):

- **Home**: frameless, sized to the chosen display's work area, `skipTaskbar`. Shown with a short always-on-top burst, then an ordinary window; Esc hides it, nothing destroys it. Hosts the static launch screen (painted before React) and the whole app (`index.html`). With `liveOnDesktop` on (default **off**, D-144) Esc attaches it behind the desktop icons (`main/desktopLayer.ts`, koffi, WorkerW); any failure leaves a normal window.
- **Overlay**: `windows.html#overlay`, bottom-left, `focusable: false` + `showInactive`, shown only while a task is in focus or a notice is up, hidden under a full-screen app (`overlayHideInFullscreen`). Click toggles Home; hover grows it with Hold to finish.
- **Notepad** and **Palette**: `windows.html#notepad` / `#palette`, created on first use, then hidden and reused. Notepad (Ctrl+Alt+N, top-right) autosaves task notes and turns `- `, `task `, `@ ` lines into records on Esc (one Undo). Palette (Ctrl+K inside Home, Ctrl+Alt+K global) adds with live parse chips, searches, runs `>` commands, and hands text to Claude Desktop (D-146).

The renderer is a rail (Home, Board, Log, Settings) over screens; Plan (P), Focus (F) and the palette are one key away (D-152). Focus is one shared grid layout for every theme (D-157).

All windows share one hardened factory (`main/windows/common.ts`): context isolation, sandbox, no node integration, no navigation, no popups, no permissions except clipboard writes, and a production CSP without `unsafe-inline`. Main also cancels any request that is not a local file.

## Sync model

Live per-field sync with Firestore through a durable outbox; the eight rules, the failure modes and the cost estimate are in `docs/SYNC.md`. Signed out or unconfigured, the app is local-only and the outbox keeps recording.

## Claude (MCP)

A local MCP server: Claude Desktop runs the bridge, which forwards to a loopback endpoint in main; the handlers in `core/mcp` run the same commands as the UI (validation, outbox, sync), with undo tokens, activity logging and a write rate limit. See `docs/MCP.md`.

## Search

`core/search` keeps one MiniSearch index over tasks, notes, projects and events, updated incrementally from Data (only changed record objects are re-indexed). It serves the MCP `search` tool and the Ctrl+K palette; `core/log/search` adds phrases and the `project:` `before:` `after:` `is:task` filters for the Log and MCP `search_log`.

## Planning (schema v3, Checkpoint A)

`core/planning/`: `estimates.ts` (default block, learned median), `plan.ts` (free gaps, auto-plan, re-plan), `review.ts` (who is asked at the end of the day, once across devices), `wellness.ts` (break prompt). All pure. Effects go through the single commit path as commands `plan.auto`, `plan.replan`, `review.submit`; each returns `undo` ops (`core/undo.ts`, shared with the MCP undo tokens) that `records.revert` applies as one action. Unplaced events (no time yet) are skipped by `expandEvents` and listed by `unplacedOn`. Rules and edge cases: decision.md D-127 to D-136.

## Parser (Checkpoint A)

`core/parser/`: `parse(text, ctx)` returns a task, fixed event, note or unplaced event with spans and confidence. Deterministic and offline, built on pinned `chrono-node`; rules (`builtin.chronos-parser.json`) and words (`lexicon.en.json`) are data; the timetable and bell grid come in through `ParseContext` (`core/parseContext.ts`). Learned and user rules beat built-in ones. It is bundled into the renderer and, for MCP `add_task text`, built as the lazy `dist/parser.js` (D-147). Fixing a misparse: `docs/parser/` (add the corpus line first).

## Themes (Checkpoint C)

`core/theme/` validates a theme JSON (`chronos-theme/1`), checks contrast, maps it to CSS custom properties (`themeToCssVars`) and resolves the scheduled theme. `renderer/themes/` holds the four launch themes (Tactile instrument, Stark workshop, TARS day and Gargantua night in one file); `renderer/theme/ThemeProvider.tsx` applies the active one, switches on schedule and with the OS, and takes imported themes from `useCustomThemes()` (this PC's localStorage, D-149). Components use only theme tokens; `public/boot.js` re-applies the last theme before first paint. `data-signature` on `<html>` selects the composition in `styles/screens.css`.

## Log and Board (Checkpoint D / C)

`core/log/` (lines, links, search, calendar, windowing) and `renderer/log/` implement the feed; posts are Ideas, edits use `idea.edit`, task lines link to tasks without a schema change (D-139 to D-142). `core/board/` is the pure move planner for the Doing slot; `renderer/board/Board.tsx` is the UI (D-150).

## Desktop layer

`main/desktopLayer.ts` is Windows-only and untested on Windows. It ships OFF and the fallback (a normal window) is the active path. See D-144 and `docs/WINDOWS_CHECKLIST.md` items 24-26 and 33-34.
