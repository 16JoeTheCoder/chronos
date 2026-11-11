# Architecture

## Layers

```
src/core      pure TypeScript: model, repo, time, timer, tasks, sync engine, search, MCP handlers, commands, validation, format
src/main      Electron shell: controller, store, windows, tray, shortcuts, IPC, shelf, notifications,
              sync/ (Firestore provider, Google sign-in, manager), mcp/ (loopback endpoint)
src/bridge    the stdio MCP server Claude Desktop runs (dist/chronos-mcp.js)
src/preload   the one typed bridge (window.chronos)
src/renderer  React UI: launch screen, Home, runway, cards, Focus Core, schedule editor, settings, shelf, widget
```

`core` imports nothing outside itself (one exception: `minisearch` in `core/search`): no Electron, no DOM, no React, no `node:fs`, no network; `core/mcp` uses no Node APIs at all. Network code lives only in `main/sync/{firestore,auth,remote}.ts` (Firebase), `main/mcp/server.ts` and `src/bridge`. `npm run audit` enforces all of it. Both `main` and `renderer` import `core`; the renderer never imports `main`.

## Data flow (Phase 1)

```
renderer (Home, widget, capture)
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

`%APPDATA%\Chronos\chronos-data.json` holds all synced data (`Data`, schema 2: one record map per collection plus `tombs` for purge stubs). Beside it: `outbox.json` (writes waiting for Firestore), `conflicts.json`, `quarantine.json`, `snapshots\` (daily, 7 kept) and `device.json`. Loading runs `migrate()` (v1 → v2, lossless) and moves records that fail validation to quarantine. Writes use Monolith's procedure: `.tmp` + fsync, previous file to `.bak`, atomic rename. A corrupt file falls back to `.bak`. `device.json` holds the device-local settings (never synced) and sync cursors; `heartbeat` holds the last time a running timer was seen alive. The store sits behind a `Persistence` interface so SQLite can replace it (D-004).

## Window model

One app, one controller, three windows (D-003):

- **Home**: frameless, sized to the chosen display's work area, `skipTaskbar`. Shown with a short always-on-top burst, then an ordinary window; Esc hides it, nothing destroys it. Hosts the static launch screen (painted before React) and the React app.
- **Widget**: a 300×44 transparent, non-focusable, always-on-top card docked in the taskbar's free slot (or free, dragged by cursor polling). Click toggles Home; right-click opens a menu.
- **Capture** (P1): created on the hotkey, destroyed after use.

All windows share one hardened factory (`main/windows/common.ts`): context isolation, sandbox, no node integration, no navigation, no popups, no permissions except clipboard writes, and a production CSP without `unsafe-inline`. Main also cancels any request that is not a local file.

## Sync model

Live per-field sync with Firestore through a durable outbox; the eight rules, the failure modes and the cost estimate are in `docs/SYNC.md`. Signed out or unconfigured, the app is local-only and the outbox keeps recording.

## Claude (MCP)

A local MCP server: Claude Desktop runs the bridge, which forwards to a loopback endpoint in main; the handlers in `core/mcp` run the same commands as the UI (validation, outbox, sync), with undo tokens, activity logging and a write rate limit. See `docs/MCP.md`.

## Search

`core/search` keeps one MiniSearch index over tasks, notes, projects and events, updated incrementally from Data (only changed record objects are re-indexed). It serves the MCP `search` tool now and the Ctrl+K palette later.
