# Chronos

**Own your time.** A Windows 11 desktop layer for Josef Yang: a day runway (schedule plus time-left maths), a task queue, and a single-focus timer, with a taskbar widget, a Desktop shelf and a Trash. It replaces [Monolith](https://github.com/16JoeTheCoder/monolith).

Planning is free; execution is strict. One task is in focus at a time, it needs a finish condition, and it ends only with the typed phrase *I have finished this task* or a typed reason to drop it. Everything is local-first: no network in v1.

## Run, test, build

In the VS Code terminal or an Ubuntu/WSL terminal, from the repo root:

```bash
npm ci              # install
npm run dev         # Vite + Electron with hot reload (restart for main-process changes)
npm test            # unit tests (vitest)
npm run typecheck
npm run audit       # typecheck, tests, build, budgets and the standing rules
npm run build       # dist/
xvfb-run -a npm run smoke   # Linux only: drives the built app, writes docs/screens/
```

Windows installers are built by GitHub Actions (`.github/workflows/build-windows.yml`) on every push: `Chronos-Setup-<version>.exe` (choose a folder) and `Chronos-Portable-<version>.exe`. Tags `v*` attach both to a Release. To package locally on Windows, in PowerShell: `npm run package:win`.

**The build is unsigned.** Windows SmartScreen warns on first run: choose **More info → Run anyway**.

## Where your data lives

`%APPDATA%\Chronos\`: `chronos-data.json` (+ `.bak`), `device.json` (this PC only), `heartbeat`, and `logs\chronos.log`. Settings → Data can export everything as JSON, open the folder, and import from Monolith (read-only, from `%APPDATA%\Monolith\`).

## Docs

- `docs/ARCHITECTURE.md`: layers, data flow, windows, sync
- `docs/DECISIONS.md`: every decision and why
- `docs/SPEC_MATRIX.md`: each spec requirement and its evidence
- `docs/WINDOWS_CHECKLIST.md`: what to test on Windows, and where
- `docs/SYNC_V1_1.md`: the Firestore plan
- `docs/BUILD_REPORT.md`: status, sizes, what is unverified

Built by Josef Yang · builtbyjosef. Code MIT. Fonts (Space Grotesk, JetBrains Mono) SIL OFL 1.1. The builtbyjosef name, logo and JY monogram are all rights reserved.
