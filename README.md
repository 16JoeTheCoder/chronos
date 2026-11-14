# Chronos

**Own your time.** A Windows 11 app for Josef Yang: a day runway (schedule plus time-left maths), a task queue, a single-focus timer, a Log of notes, a project board, a quick-add palette, and four themes (Tactile instrument, Stark workshop, TARS day, Gargantua night). It replaces [Monolith](https://github.com/16JoeTheCoder/monolith).

Planning is free; execution is strict. One task is in focus at a time, it needs a finish condition, and it ends only by **holding Enter for 2 seconds** (Space starts and pauses and never finishes). Everything is local-first; optional live sync between your PCs runs through Firebase, and Claude Desktop can read and change your data through a local MCP server.

**Status, plainly:** built and tested on Linux. The "Live on the desktop" layer (Home behind your desktop icons) ships **OFF** with the normal window as the fallback, and is unverified on Windows, as are the overlay, notepad and palette windows. Do the Windows checklist before trusting them.

## Install

On Windows, in a browser: GitHub, 16JoeTheCoder/chronos, **Actions**, the latest **Build Windows** run, download the `Chronos-windows` artifact and run `Chronos-Setup-<version>.exe`. The build is **unsigned**: SmartScreen warns on first run, choose **More info, Run anyway**. (Portable: `Chronos-Portable-<version>.exe`.) To package locally, in Windows PowerShell at the repo root: `npm run package:win`.

## Run, test, build (developers)

In the VS Code terminal at the repo root (Windows PowerShell or Ubuntu/WSL):

```bash
npm ci                       # install
npm run dev                  # Vite + Electron with hot reload (restart for main-process changes)
npm test                     # unit tests (vitest)
npm run typecheck
npm run audit                # typecheck, tests, build, budgets and the standing rules
npm run build                # dist/
xvfb-run -a node scripts/smoke.mjs   # Linux only, after npm run build: drives the built app, writes docs/screens/
```

## Sign in (sync between your PCs)

One-time setup first: **browser**, Firebase and Google Cloud consoles, following `docs/SETUP_FIREBASE.md` (it says which console each step is in). Then **in Chronos**: Settings, Account and sync, **Sign in with Google**; your browser opens, choose the account, return to Chronos. Signed out or unconfigured, Chronos simply stays local.

## Connect Claude (MCP)

1. **In Chronos:** Settings, Account and sync, Claude MCP: turn **Claude (MCP)** on and click **Copy Claude Desktop config**.
2. **In VS Code** (or Notepad): open `%APPDATA%\Claude\claude_desktop_config.json`, paste the snippet into `mcpServers`, save.
3. **Restart Claude Desktop**, then ask it about your day. Details and the tool list: `docs/MCP.md`.

## Keys

`F` Focus, `P` plan, `N` new task, `Ctrl+K` palette (add, search, `>` commands), `Ctrl+L` Log, `Ctrl+Z` undo the last toast action, `Esc` back. Global: `Ctrl+Alt+K` palette, `Ctrl+Alt+N` notepad, `Ctrl+Alt+Space` show or hide Chronos (all editable in Settings, Focus).

## Where your data lives

`%APPDATA%\Chronos\`: `chronos-data.json` (+ `.bak`), `device.json` (this PC only), `outbox.json` (edits waiting to sync), `conflicts.json`, `quarantine.json`, `snapshots\` (one per day, 7 kept), `heartbeat`, and `logs\chronos.log`. Settings → Data can export everything as JSON, open the folder, and import from Monolith (read-only, from `%APPDATA%\Monolith\`).

## Docs

- `docs/ARCHITECTURE.md`: layers, data flow, windows, sync, parser, themes
- `docs/THEMES.md`: the theme schema and how to write a theme with an AI
- `docs/parser/`: the parser spec and how to fix a misparse (add the corpus line first)
- `decision.md`: every decision and why; `log.md`: build log (status, next steps)
- `docs/SPEC_MATRIX.md`: each spec requirement and its evidence
- `docs/WINDOWS_CHECKLIST.md`: what to test on Windows, and where
- `docs/SYNC.md`: live sync, its rules, failure modes and cost
- `docs/SETUP_FIREBASE.md`: one-time Firebase / Google sign-in setup
- `docs/MCP.md`: the Claude Desktop integration
- `docs/BUILD_REPORT.md`: status, sizes, what is unverified

Built by Josef Yang · builtbyjosef. Code MIT. Fonts (Space Grotesk, JetBrains Mono) SIL OFL 1.1. The builtbyjosef name, logo and JY monogram are all rights reserved.
