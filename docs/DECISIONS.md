# Decisions

ADR-lite. Each entry: Context / Options / Decision / Consequence / Revisit-when. D-001 to D-012 were agreed before the build; the rest were made during it.

## D-001 Electron over Tauri
Context: Chronos replaces Monolith, which is Electron + React + TypeScript. Options: Electron, Tauri. Decision: Electron. Consequence: direct code reuse (timer, tasks, store, IPC, window drag); larger installer. Revisit-when: memory or install size becomes a real complaint.

## D-002 New repo, Monolith code ported in
Context: Monolith is a different product shape (overlay card). Options: evolve Monolith in place, new repo. Decision: new repo; Monolith's engine and main-process pieces are ported, with tests. Consequence: Monolith stays untouched as a reference. Revisit-when: never.

## D-003 One app, two windows, one controller
Context: Home and the taskbar widget show the same state. Options: two apps with a bridge, one app. Decision: one Electron app, Home + widget (+ capture) windows, one controller in main. Consequence: no inter-app protocol. Revisit-when: never.

## D-004 JSON store behind a Persistence interface
Context: one user, small data. Options: SQLite now, JSON now. Decision: atomic JSON (Monolith's procedure) behind `Persistence`; move to SQLite if data exceeds ~5 MB. Consequence: no native module. Revisit-when: `chronos-data.json` passes 5 MB.

## D-005 No Firebase SDK in v1
Context: sync is v1.1. Options: ship the SDK now, build the engine now and the adapter later. Decision: engine built and tested against an in-memory provider; v1 ships `nullProvider`. Consequence: zero network code in v1. Revisit-when: v1.1.

## D-006 LWW + tombstones, purge stubs for 60 days
Context: multi-device sync without a server merge function. Decision: last-write-wins per record on `updatedAt` (tie-break `deviceId`); delete is a tombstone; at 7 days content is wiped and a stub `{id, updatedAt, deletedAt, deviceId, v, purged}` remains for 60 days so an offline device cannot resurrect it. Consequence: the user's content is gone within 7 days of deletion. Revisit-when: a device can stay offline for more than 60 days.

## D-007 Planning free, execution strict; finish condition required at start, not at capture
Context: Monolith demanded a finish condition at creation; quick capture must be frictionless. Decision: a task may be created with only a title (an inbox task); it needs a finish condition (>= 8 characters) before it can become the active task. Consequence: inbox tasks sit in the queue until defined. Revisit-when: inbox tasks pile up undefined.

## D-008 Home is a work-area window, not kiosk fullscreen
Context: Home covers the desktop but must never lock the user out. Decision: frameless window sized to the display's work area, briefly always-on-top on show (~1.5 s), then ordinary; Alt+Tab and Win+D always work; Esc hides. Revisit-when: never.

## D-009 Desktop shelf is read-only
Decision: the shelf lists and opens files; Chronos never moves or renames them. The only file action is "move to Recycle Bin" after confirmation (`shell.trashItem`). Revisit-when: never.

## D-010 Holidays: only computable dates seeded; user confirms applicability
Decision: fixed-date national holidays plus Good Friday and Ascension (from a computus) are seeded as unconfirmed closures; lunar and other movable dates are user-entered. A Heads-up card asks per scope. Revisit-when: a reliable offline source for Indonesian movable holidays exists.

## D-011 Timer owned by one device
Decision: `ActiveTimer.ownerDeviceId` owns the running timer; others show it read-only with Take over. Revisit-when: never.

## D-012 Split Deck layout preset and build-vs-consume tracking are deferred
Decision: out of v1. Revisit-when: after v1.1.

## D-013 The builtbyjosef design system overrides the visual tokens in spec §9.1
Context: the owner instructed, at build time, that all design follows github.com/16JoeTheCoder/builtbyjosef-designsystem. The spec's §9.1 (amber accent, glows, gradients, weight 600, Segoe) conflicts with it. Options: follow §9.1, follow the design system. Decision: the design system wins on visual language (orange `#FF5B1F` accent as "now", hard 4px stamp shadow instead of glow, no gradients or blur, weights 300/400/500/700, radius 10 + pill, 140/240/400/640 ms durations, status blue/amber/red with shape + word). §9's layout, interactions and the draw-in sequence are kept. The fixed-lane hatch uses a `repeating-linear-gradient` as a texture (not a decorative gradient) so the lock glyph and label still carry the meaning. Consequence: Chronos looks like the rest of the owner's work. Revisit-when: the design system changes.

## D-014 Fonts: Space Grotesk and JetBrains Mono bundled locally
Context: §3 says system fonts, no web fonts or CDN; the design system specifies Space Grotesk and JetBrains Mono (OFL woff2 files in its repo). Decision: copy the woff2 files into the renderer and load them with `@font-face` from `'self'`. No network, CSP `font-src 'self'`. Digits use JetBrains Mono / tabular figures. Consequence: about 150 KB of font files in the installer, outside the CSS/JS budgets. Revisit-when: never.

## D-015 Drop parks the task at the back of the queue
Context: §6.4 orders unscheduled tasks by priority, then `order`. Dropping a `must` task and only bumping `order` would put it straight back at the head (and lock it again). Decision: Drop sets `parkedAt`; parked tasks sort behind all unparked ones (oldest drop first) until they are started again or reordered. Reopen puts a task at the front of its priority band (`order = min - 1`). Keyboard reorder that crosses a band adopts the neighbour's priority. Revisit-when: users want strict "front of everything" reopen.

## D-016 Model refinements
Decision: added `Activity` (started/finished/dropped/killed log, synced) for metrics; `Task.outcome`, `Task.parkedAt`, `Task.pomodorosCompleted`, `Task.nextCheckpointMs` (a work-time threshold, not a clock time, so pauses don't trigger it); `Settings.blockEnd`; `ActiveTimer.ownerName/takeoverAt`. Session ids are deterministic (`s-<taskId>-<startedAt>`) so two devices recording the same slice write one record. Purge stubs live in `Data.tombs`, not in the live collections, so UI code never sees half-records. Revisit-when: schema v2.

## D-017 react and react-dom are devDependencies
Context: §3 lists them as runtime/bundled deps. Vite bundles them into the renderer, so electron-builder must not ship `node_modules`. Decision: keep Monolith's layout (everything in devDependencies, `files: dist/**`). Consequence: smaller installer; audit's allowlist covers both sections. Revisit-when: never.

## D-018 One reviewer agent, reused across grouped milestone passes
Context: §11.4 wants a reviewer after every milestone; the owner allowed exactly one spawned agent. Decision: `.claude/agents/reviewer.md` is committed as specified; one general-purpose agent with that brief is spawned once and resumed for review passes over grouped milestones (core, main, UI, final). Consequence: fewer, larger review passes. Revisit-when: a CI reviewer exists.

## D-019 Pull per collection
Context: §10.1 sketches `pull(since)`. Firestore pulls per collection with `where('serverUpdatedAt', '>', cursor)`. Decision: `pull(coll, since)` with per-collection cursors in `device.json`. Revisit-when: never.

## D-020 Re-push when the local copy wins
Context: Firestore `set()` overwrites; a slow device can overwrite a newer server copy with an older record. Decision: when a pulled record loses LWW against the local copy, the local copy is pushed again in the same round, so all devices converge without server-side logic. Consequence: occasional extra writes. Revisit-when: v1.1 adds a transactional precondition instead.

## D-021 Known limitation: dirty tracking and a clock that steps back
Context: "dirty = updatedAt > lastPushedAt" (§10.1). If the device clock steps back by more than the time since the last push, edits to other records get an `updatedAt` below `lastPushedAt` and are not pushed until edited again. Decision: accepted for v1 (sync is off); v1.1 should also mark records dirty in a local set. Revisit-when: v1.1.

## D-022 Monolith 0.2 is already on main
Context: §2 says focus metrics live on a PR branch. The v0.2 PR is merged (`cade612`). Decision: port the weekly started/finished/dropped summary and focused time; drop chain, grades, self-grade and journal (not in this spec). Revisit-when: never.

## D-023 Countdown to block end only for a fresh countdown
Context: §6.6 says a task inside a block defaults to a countdown to the block end. Decision: applied when the timer is idle, in countdown mode (the default), and a block of that task contains now; a chosen Pomodoro or stopwatch is respected. Overtime keeps counting by default (`settings.blockEnd = 'continue'`). Revisit-when: never.

## D-024 "Every core module has a test" means referenced by a test
Context: §11.2. Decision: the audit requires each `src/core/**/*.ts` (except the type-only `model/types.ts`) to be imported by at least one file in `tests/`. Revisit-when: never.

## D-025 The launch dial turns once, then holds still
Context: §8.3 asks for a slowly rotating dial; the design system's rule is that motion runs once and stops (perpetual motion reads as nervous). Decision: the dial rotates into place over 2.4 s and then stays still; the orange now-notch is the one hot point. Consequence: no animation runs while Home idles. Revisit-when: the owner wants the loop back.

## D-026 Brand assets come from the design system
Context: §9.10 asks for placeholder `builtbyjosef.svg` and `jy-monogram.svg`. The owner's real logos already exist in the design system repo. Decision: copy `tab-lockup-dark.svg` and `tab-primary-dark.svg` under those exact names; the About brand block sits on a fixed dark stage so the dark variants always read. The owner can still replace the files. Revisit-when: a light-variant About is wanted.

## D-027 Tokens, fonts and launch.css live in the renderer's public folder
Context: Vite merges stylesheets linked from HTML into the entry CSS, so `launch.css` would not stay a small separate file, and fonts would be copied twice. Decision: `public/tokens.css` (with `@font-face`), `public/launch.css` and `public/fonts/` are copied verbatim and linked from `index.html` and `widget.html`; component CSS is bundled. Consequence: one font copy, launch styles are 2.8 KB and paint before any script. Revisit-when: never.

## D-028 Shelf and Recycle Bin share one main module
Decision: `main/shelf.ts` lists, opens and trashes (`shell.trashItem`) with one path guard (a direct child of the shelf folder), instead of a separate `trash.ts`. Revisit-when: never.

## D-029 Two ticks in main, and the fast one only while a timer runs
Context: idle CPU ≈ 0 (§3). Decision: a 30 s tick always (block ends, prep nudges, holidays, purge every 6 h, day rollover) and a 250 ms tick only while a timer runs (Monolith's boundary/heartbeat/gap logic). The widget's 8 ms cursor polling runs only while the pointer is held on it (marked `audit-allow`). Revisit-when: never.

## D-030 Notification dedupe is per run
Decision: prep-nudge, checkpoint and block-end notifications are deduplicated in memory per app run; a restart can repeat one notification at most. Revisit-when: users report repeats.

## D-031 CHRONOS_USER_DATA overrides the data folder
Decision: an environment variable (set before the instance lock) points the data folder elsewhere, so the smoke test never touches real data. Revisit-when: never.

## D-032 A separate --now token for the now-line
Context: orange on paper is 2.8:1, below the 3:1 rule for meaningful marks. Decision: the now-line uses `--now` (orange in dark, `accent-text` #B93A09 in light); caps and the primary fill stay `--accent` as decoration. Tested in `tests/main/contrast.test.ts`. Revisit-when: never.

## D-033 Main blocks every non-local request
Context: "zero network requests in v1". Decision: besides the CSP, `session.webRequest.onBeforeRequest` cancels anything that is not `file:`, `data:`, `devtools:` or the dev server, and logs it. Revisit-when: v1.1 (allow the Firebase hosts only).
