# Architecture

## Layers

```
src/core      pure TypeScript: model, repo, time, timer, tasks, sync, commands, validation, format
src/main      Electron shell: controller, store, windows, tray, shortcuts, IPC, shelf, notifications
src/preload   the one typed bridge (window.chronos)
src/renderer  React UI: launch screen, Home, runway, cards, Focus Core, schedule editor, settings, shelf, widget
```

`core` imports nothing outside itself: no Electron, no DOM, no React, no `node:fs`, no network. `npm run audit` enforces it. Both `main` and `renderer` import `core`; the renderer never imports `main`.

## Data flow

1. The renderer sends a `Command` (one discriminated union in `core/commands.ts`) over the single `command` IPC channel.
2. `main/ipc.ts` checks the sender is one of our windows and rebuilds the payload field by field from known keys.
3. `main/controller.ts` handles the few machine commands (gap answer, device settings, takeover, import/export) and passes the rest to `core/commands.apply()`, which validates again with the same shared validators and returns new data or field errors.
4. Every entity write goes through `core/repo` (stamps `updatedAt`, `deviceId`, `v`; deletes are tombstones). `apply()` ends with `normalize()`, which keeps exactly one active task.
5. The controller persists (timer and session changes at once, planning edits debounced 300 ms, flushed on quit) and pushes a snapshot to every window. Snapshots go out on change only; renderers recompute the clock from snapshot + `Date.now()` every 250 ms while visible.

Timer ticks are never records. Main runs a 250 ms tick only while a timer runs (boundaries, heartbeat every 5 s, gap detection), and a 30 s tick for block ends, prep nudges, holiday seeding, purge (every 6 h) and day rollover.

## Persistence

`%APPDATA%\Chronos\chronos-data.json` holds all synced data (`Data`: one record map per collection plus `tombs` for purge stubs). Writes use Monolith's procedure: `.tmp` + fsync, previous file to `.bak`, atomic rename. A corrupt file falls back to `.bak`. `device.json` holds the device-local settings (never synced) and sync cursors; `heartbeat` holds the last time a running timer was seen alive. The store sits behind a `Persistence` interface so SQLite can replace it (D-004).

## Window model

One app, one controller, three windows (D-003):

- **Home**: frameless, sized to the chosen display's work area, `skipTaskbar`. Shown with a short always-on-top burst, then an ordinary window; Esc hides it, nothing destroys it. Hosts the static launch screen (painted before React) and the React app.
- **Widget**: a 300×44 transparent, non-focusable, always-on-top card docked in the taskbar's free slot (or free, dragged by cursor polling). Click toggles Home; right-click opens a menu.
- **Capture** (P1): created on the hotkey, destroyed after use.

All windows share one hardened factory (`main/windows/common.ts`): context isolation, sandbox, no node integration, no navigation, no popups, no permissions except clipboard writes, and a production CSP without `unsafe-inline`. Main also cancels any request that is not a local file.

## Sync model

Built and tested now, shipped in v1.1 (D-005). `core/sync/engine.ts` pulls each collection since a server cursor, merges last-write-wins per record (tie-break on `deviceId`; a purge stub always wins), re-pushes local winners, and pushes records this device wrote since `lastPushedAt`. The timer has one owner (`ActiveTimer`); Take over banks the previous owner's slice at the takeover instant on both devices with the same deterministic session id. v1 runs `nullProvider`; tests run two devices against `memoryProvider`. See `docs/SYNC_V1_1.md`.
