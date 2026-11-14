# Decisions

Every decision, numbered. D-001 to D-036 are the v1 decisions (ADR-lite, folded in from the old `docs/DECISIONS.md`, numbers kept). D-101 onwards were made during Phase 1 (data model v2, live sync, local MCP): one or two lines each, what and why.

## v1 (D-001 to D-036)


### D-001 Electron over Tauri
Context: Chronos replaces Monolith, which is Electron + React + TypeScript. Options: Electron, Tauri. Decision: Electron. Consequence: direct code reuse (timer, tasks, store, IPC, window drag); larger installer. Revisit-when: memory or install size becomes a real complaint.

### D-002 New repo, Monolith code ported in
Context: Monolith is a different product shape (overlay card). Options: evolve Monolith in place, new repo. Decision: new repo; Monolith's engine and main-process pieces are ported, with tests. Consequence: Monolith stays untouched as a reference. Revisit-when: never.

### D-003 One app, two windows, one controller
Context: Home and the taskbar widget show the same state. Options: two apps with a bridge, one app. Decision: one Electron app, Home + widget (+ capture) windows, one controller in main. Consequence: no inter-app protocol. Revisit-when: never.

### D-004 JSON store behind a Persistence interface
Context: one user, small data. Options: SQLite now, JSON now. Decision: atomic JSON (Monolith's procedure) behind `Persistence`; move to SQLite if data exceeds ~5 MB. Consequence: no native module. Revisit-when: `chronos-data.json` passes 5 MB.

### D-005 No Firebase SDK in v1
Context: sync is v1.1. Options: ship the SDK now, build the engine now and the adapter later. Decision: engine built and tested against an in-memory provider; v1 ships `nullProvider`. Consequence: zero network code in v1. Revisit-when: v1.1.

### D-006 LWW + tombstones, purge stubs for 60 days
Context: multi-device sync without a server merge function. Decision: last-write-wins per record on `updatedAt` (tie-break `deviceId`); delete is a tombstone; at 7 days content is wiped and a stub `{id, updatedAt, deletedAt, deviceId, v, purged}` remains for 60 days so an offline device cannot resurrect it. Consequence: the user's content is gone within 7 days of deletion. Revisit-when: a device can stay offline for more than 60 days.

### D-007 Planning free, execution strict; finish condition required at start, not at capture
Context: Monolith demanded a finish condition at creation; quick capture must be frictionless. Decision: a task may be created with only a title (an inbox task); it needs a finish condition (>= 8 characters) before it can become the active task. Consequence: inbox tasks sit in the queue until defined. Revisit-when: inbox tasks pile up undefined.

### D-008 Home is a work-area window, not kiosk fullscreen
Context: Home covers the desktop but must never lock the user out. Decision: frameless window sized to the display's work area, briefly always-on-top on show (~1.5 s), then ordinary; Alt+Tab and Win+D always work; Esc hides. Revisit-when: never.

### D-009 Desktop shelf is read-only
Decision: the shelf lists and opens files; Chronos never moves or renames them. The only file action is "move to Recycle Bin" after confirmation (`shell.trashItem`). Revisit-when: never.

### D-010 Holidays: only computable dates seeded; user confirms applicability
Decision: fixed-date national holidays plus Good Friday and Ascension (from a computus) are seeded as unconfirmed closures; lunar and other movable dates are user-entered. A Heads-up card asks per scope. Revisit-when: a reliable offline source for Indonesian movable holidays exists.

### D-011 Timer owned by one device
Decision: `ActiveTimer.ownerDeviceId` owns the running timer; others show it read-only with Take over. Revisit-when: never.

### D-012 Split Deck layout preset and build-vs-consume tracking are deferred
Decision: out of v1. Revisit-when: after v1.1.

### D-013 The builtbyjosef design system overrides the visual tokens in spec §9.1
Context: the owner instructed, at build time, that all design follows github.com/16JoeTheCoder/builtbyjosef-designsystem. The spec's §9.1 (amber accent, glows, gradients, weight 600, Segoe) conflicts with it. Options: follow §9.1, follow the design system. Decision: the design system wins on visual language (orange `#FF5B1F` accent as "now", hard 4px stamp shadow instead of glow, no gradients or blur, weights 300/400/500/700, radius 10 + pill, 140/240/400/640 ms durations, status blue/amber/red with shape + word). §9's layout, interactions and the draw-in sequence are kept. The fixed-lane hatch uses a `repeating-linear-gradient` as a texture (not a decorative gradient) so the lock glyph and label still carry the meaning. Consequence: Chronos looks like the rest of the owner's work. Revisit-when: the design system changes.

### D-014 Fonts: Space Grotesk and JetBrains Mono bundled locally
Context: §3 says system fonts, no web fonts or CDN; the design system specifies Space Grotesk and JetBrains Mono (OFL woff2 files in its repo). Decision: copy the woff2 files into the renderer and load them with `@font-face` from `'self'`. No network, CSP `font-src 'self'`. Digits use JetBrains Mono / tabular figures. Consequence: about 150 KB of font files in the installer, outside the CSS/JS budgets. Revisit-when: never.

### D-015 Drop parks the task at the back of the queue
Context: §6.4 orders unscheduled tasks by priority, then `order`. Dropping a `must` task and only bumping `order` would put it straight back at the head (and lock it again). Decision: Drop sets `parkedAt`; parked tasks sort behind all unparked ones (oldest drop first) until they are started again or reordered. Reopen puts a task at the front of its priority band (`order = min - 1`). Keyboard reorder that crosses a band adopts the neighbour's priority. Revisit-when: users want strict "front of everything" reopen.

### D-016 Model refinements
Decision: added `Activity` (started/finished/dropped/killed log, synced) for metrics; `Task.outcome`, `Task.parkedAt`, `Task.pomodorosCompleted`, `Task.nextCheckpointMs` (a work-time threshold, not a clock time, so pauses don't trigger it); `Settings.blockEnd`; `ActiveTimer.ownerName/takeoverAt`. Session ids are deterministic (`s-<taskId>-<startedAt>`) so two devices recording the same slice write one record. Purge stubs live in `Data.tombs`, not in the live collections, so UI code never sees half-records. Revisit-when: schema v2.

### D-017 react and react-dom are devDependencies
Context: §3 lists them as runtime/bundled deps. Vite bundles them into the renderer, so electron-builder must not ship `node_modules`. Decision: keep Monolith's layout (everything in devDependencies, `files: dist/**`). Consequence: smaller installer; audit's allowlist covers both sections. Revisit-when: never.

### D-018 One reviewer agent, reused across grouped milestone passes
Context: §11.4 wants a reviewer after every milestone; the owner allowed exactly one spawned agent. Decision: `.claude/agents/reviewer.md` is committed as specified; one general-purpose agent with that brief is spawned once and resumed for review passes over grouped milestones (core, main, UI, final). Consequence: fewer, larger review passes. Revisit-when: a CI reviewer exists.

### D-019 Pull per collection
Context: §10.1 sketches `pull(since)`. Firestore pulls per collection with `where('serverUpdatedAt', '>', cursor)`. Decision: `pull(coll, since)` with per-collection cursors in `device.json`. Revisit-when: never.

### D-020 Re-push when the local copy wins
Context: Firestore `set()` overwrites; a slow device can overwrite a newer server copy with an older record. Decision: when a pulled record loses LWW against the local copy, the local copy is pushed again in the same round, so all devices converge without server-side logic. Consequence: occasional extra writes. Revisit-when: v1.1 adds a transactional precondition instead.

### D-021 Known limitation: dirty tracking and a clock that steps back
Context: "dirty = updatedAt > lastPushedAt" (§10.1). If the device clock steps back by more than the time since the last push, edits to other records get an `updatedAt` below `lastPushedAt` and are not pushed until edited again. Decision: accepted for v1 (sync is off); v1.1 should also mark records dirty in a local set. Revisit-when: v1.1.

### D-022 Monolith 0.2 is already on main
Context: §2 says focus metrics live on a PR branch. The v0.2 PR is merged (`cade612`). Decision: port the weekly started/finished/dropped summary and focused time; drop chain, grades, self-grade and journal (not in this spec). Revisit-when: never.

### D-023 Countdown to block end only for a fresh countdown
Context: §6.6 says a task inside a block defaults to a countdown to the block end. Decision: applied when the timer is idle, in countdown mode (the default), and a block of that task contains now; a chosen Pomodoro or stopwatch is respected. Overtime keeps counting by default (`settings.blockEnd = 'continue'`). Revisit-when: never.

### D-024 "Every core module has a test" means referenced by a test
Context: §11.2. Decision: the audit requires each `src/core/**/*.ts` (except the type-only `model/types.ts`) to be imported by at least one file in `tests/`. Revisit-when: never.

### D-025 The launch dial turns once, then holds still
Context: §8.3 asks for a slowly rotating dial; the design system's rule is that motion runs once and stops (perpetual motion reads as nervous). Decision: the dial rotates into place over 2.4 s and then stays still; the orange now-notch is the one hot point. Consequence: no animation runs while Home idles. Revisit-when: the owner wants the loop back.

### D-026 Brand assets come from the design system
Context: §9.10 asks for placeholder `builtbyjosef.svg` and `jy-monogram.svg`. The owner's real logos already exist in the design system repo. Decision: copy `tab-lockup-dark.svg` and `tab-primary-dark.svg` under those exact names; the About brand block sits on a fixed dark stage so the dark variants always read. The owner can still replace the files. Revisit-when: a light-variant About is wanted.

### D-027 Tokens, fonts and launch.css live in the renderer's public folder
Context: Vite merges stylesheets linked from HTML into the entry CSS, so `launch.css` would not stay a small separate file, and fonts would be copied twice. Decision: `public/tokens.css` (with `@font-face`), `public/launch.css` and `public/fonts/` are copied verbatim and linked from `index.html` and `widget.html`; component CSS is bundled. Consequence: one font copy, launch styles are 2.8 KB and paint before any script. Revisit-when: never.

### D-028 Shelf and Recycle Bin share one main module
Decision: `main/shelf.ts` lists, opens and trashes (`shell.trashItem`) with one path guard (a direct child of the shelf folder), instead of a separate `trash.ts`. Revisit-when: never.

### D-029 Two ticks in main, and the fast one only while a timer runs
Context: idle CPU ≈ 0 (§3). Decision: a 30 s tick always (block ends, prep nudges, holidays, purge every 6 h, day rollover) and a 250 ms tick only while a timer runs (Monolith's boundary/heartbeat/gap logic). The widget's 8 ms cursor polling runs only while the pointer is held on it (marked `audit-allow`). Revisit-when: never.

### D-030 Notification dedupe is per run
Decision: prep-nudge, checkpoint and block-end notifications are deduplicated in memory per app run; a restart can repeat one notification at most. Revisit-when: users report repeats.

### D-031 CHRONOS_USER_DATA overrides the data folder
Decision: an environment variable (set before the instance lock) points the data folder elsewhere, so the smoke test never touches real data. Revisit-when: never.

### D-032 A separate --now token for the now-line
Context: orange on paper is 2.8:1, below the 3:1 rule for meaningful marks. Decision: the now-line uses `--now` (orange in dark, `accent-text` #B93A09 in light); caps and the primary fill stay `--accent` as decoration. Tested in `tests/main/contrast.test.ts`. Revisit-when: never.

### D-033 Main blocks every non-local request
Context: "zero network requests in v1". Decision: besides the CSP, `session.webRequest.onBeforeRequest` cancels anything that is not `file:`, `data:`, `devtools:` or the dev server, and logs it. Revisit-when: v1.1 (allow the Firebase hosts only).

### D-034 In the app, orange is state only
Context: the reviewer counted several orange points per view (button caps, switch knobs, focus underlines, sprint marks), against "one orange point per view". The design system's app recipe says heat appears only as state. Decision: primary buttons keep the Tab cap in a neutral tone; knobs and focus underlines are ink; orange is reserved for the now-line, the active card's cap, the single accent button (Start/Pause in Focus), the widget's running bar, overtime digits and the launch notch. Revisit-when: the design system changes its app recipe.

### D-035 Keyboard resize moves the end of a block
Context: §9.11 says "Alt+arrows resize". Decision: Alt+Left/Right moves the block's end by 5 minutes (Shift for 15); the start moves with plain arrows (move) and then Alt to resize. Dragging covers both edges. The schedule editor's week grid has no drawn hour lines (the hour labels carry it) to avoid a gradient. Revisit-when: users ask for start-edge resizing from the keyboard.

### D-036 Drop and Reopen start a new run
Context: the reviewer showed a dropped task kept `startedAt`, so it re-locked the moment it headed the queue, ahead of a new `must` task. Decision: Drop and Reopen clear `startedAt`; the lock (§6.4) means "the timer has run in this run". Starting again logs a new `started` activity. Revisit-when: never.

## Phase 1 (D-101 onwards)

### D-101 Branch name
The build prompt asks for `phase-1-foundation`; the session is pinned to `claude/pensive-bardeen-m7hj1l`, so all Phase 1 work and the PR use that branch.

### D-102 Record schema version reuses `v`
`Base.v` already existed and is now the record's schemaVersion (2): the schema of the app that last wrote it. No second field; the Firestore rules check `v is int`. Supersedes D-016's "Revisit-when: schema v2".

### D-103 Outbox from a Data diff, not from each command
Every mutation path (commands, normalize, housekeeping, purge, imports, restore, MCP) ends in one `commit(next)` in the controller, which diffs old vs new Data per record and per top-level field (`core/sync/outbox.diffData`). Nothing can write without being queued. Replaces the clock-based dirty detection and closes D-021.

### D-104 Version gate
A pulled doc with `v` > 2, or one read inside a flush transaction, is never merged or written over; sync turns read-only ("Update Chronos on this device.") while edits keep queueing.

### D-105 Per-field versions `fv` plus per-field writers `fw`
`fv.<field>` is the server commit time (µs) of the field's last write; `fw.<field>` the device that wrote it. A conflict is logged only when the remote `fv` differs from the edit's `baseFv` **and** the last writer was another device **and** the values differ, so our own unechoed writes and identical writes (deterministic records) never count. `fw` is an addition to the prompt's model: without it a second quick edit on the same device would log a false conflict against its own first write, and the conflict record could not name `otherDeviceId`.

### D-106 Coalescing waits for any queued entry of the same record
An edit merges into any waiting (not in-flight) entry for the same record, not only the last one: per-record writes are independent in Firestore, so this is the same semantics with fewer writes. The earliest `baseFv` per field is kept. Seed entries never merge with edits.

### D-107 First sign-in seeds by filling gaps
After the first full pull, fields with no `fv` are queued as `seed` entries; a seed writes only fields the server lacks and adopts the rest. So two devices signing in at once never overwrite each other's real data with defaults (found by the two-device test). Signing in to a different account clears `fv`/`fw` so everything uploads again.

### D-108 A tombstone beats an edit; purge stubs are terminal
In the flush transaction an entry that neither deletes nor restores loses to a remote `deletedAt` or purge stub: nothing is written, the lost fields are logged as conflicts and the remote doc is adopted locally. Purged stubs drop locally after 30 days (was 60, D-006) because the server keeps the stub and the outbox no longer re-pushes whole records.

### D-109 `ideas` stays the collection name; it holds notes
`body` is the note; `text` keeps its first 1000 characters for the v1 views. `parsedTaskIds` waits for the Phase 2 parser.

### D-110 One validation gate, structural for whole records
`recordProblem(coll, rec)` (core/validation) is used by the loader, the sync pull, imports and MCP writes go through commands which use the field validators. Record checks are structural with generous bounds (types, enums, required fields) so real data is never quarantined for being long; invalid records are kept in `quarantine.json`, never silently dropped.

### D-111 Task status v2 is derived for open tasks
`doing` = the one task in focus; other open tasks are `planned` when they have a block today or later, else `inbox`; `normalize()` keeps it right on every device. The in-app Drop still parks the focused task (D-015, status back to inbox/planned). `dropped` closes a task (MCP `drop_task`, command `task.close`); Reopen works for done and dropped. Phase 3's UX should decide whether the in-app Drop becomes this.

### D-112 `deadline` renamed to `dueDate`; exception `move` renamed to `edit`
Migration moves the values (lossless). `edit` exceptions carry nullable overrides for title, start, end and tag; null = unchanged. Every record field is explicit (null, never undefined) so Firestore writes never carry `undefined`.

### D-113 `order` and `sortKey` both stay
`order` (number) is the focus-queue order from v1; `sortKey` (fractional-index string, `core/model/sortKey`) is the manual list / board order (`move_card`). Different orders, different fields.

### D-114 Deterministic queue tie-breaks
The derived queue breaks ties by id, and two locked tasks (only after a merge) resolve to the timer's task, then the lower id, so every device derives the same focused task from the same data (found by the two-device test).

### D-115 Recurring instances step from the due date
Next date = first recurrence date after the task's `dueDate` (completion date if none), id `<parentId>:<date>`. Using the due date, not the clock, is what makes two devices agree.

### D-116 Renderers stay offline; sync networking runs in main
The request blocker and CSP (`connect-src 'none'`, D-033) still apply to every window. Firestore, Firebase Auth and the Google token exchange use Node networking in the main process, which the Chromium request blocker does not see. The audit limits network code to `main/sync/{firestore,auth,remote}.ts`, `main/mcp/server.ts` and `src/bridge`.

### D-117 Firebase loads on demand from `dist/sync.js`
The SDK (about 1 MB bundled) is a separate esbuild entry that main `require`s only when `firebase.config.json` is complete. `main.js` stays inside its 150 KB budget and the app starts and runs with no config, no network and no sign-in. Firebase, MiniSearch and the MCP SDK are devDependencies bundled at build time, like React (D-017).

### D-118 Config keys include the Desktop OAuth client
`firebase.config.json` adds `googleClientId` and `googleClientSecret` (a Desktop-app client's secret is not confidential, per Google). It is read from the data folder, then from `firebase/` in the repo for `npm run dev`, or from `CHRONOS_FIREBASE_*` env vars. Incomplete = local-only.

### D-119 The MCP bridge runs on Chronos's own Electron
Claude Desktop launches `Chronos.exe` with `ELECTRON_RUN_AS_NODE=1` and `resources\chronos-mcp.js` (copied outside the asar via `extraResources`), so Node need not be installed. "Copy Claude Desktop config" writes the exact snippet with real paths. Unverified on Windows (checklist 19).

### D-120 MCP undo reverts only the fields the write changed
An undo token keeps, per changed record, the previous values of exactly the changed fields (a created record is recycled, never hard-deleted). Undo goes through the `records.revert` command, so it validates, syncs and is logged like any edit. Tokens live in memory (100 kept): a restart forgets them.

### D-121 MCP `drop_task` closes the task (status `dropped`)
It uses the new `task.close` command (any open task, reason required, blocks from today on recycled), not the in-app park-at-the-back Drop (D-111).

### D-122 Two internal commands are never parsed from IPC
`records.revert` (undo, snapshot restore) and `activity.claude` exist only for main and the MCP handlers; `parseCommand` has no case for them, so a renderer cannot send them.

### D-123 Snapshots are named by date or by purpose
`snapshots\chronos-<date>.json` once per local day, `chronos-before-restore-<ms>.json` / `chronos-before-resync-<ms>.json` before those actions; the newest 7 files (by time) are kept.

### D-124 No Firestore emulator run in this build
Downloading and running the emulator JAR was refused by the session's permission policy, so the real provider and the rules were not exercised; the engine and merge rules are tested against `memoryProvider`, which mimics transactions, server timestamps, field updates and listeners. Rule checks are documented as manual steps (docs/SYNC.md). Revisit: add an emulator job to CI.

### D-125 Invalid singletons fall back to defaults
If `settings/main` or `timer/current` fails validation at load, it is quarantined and replaced by its defaults; the app never starts without them.

### D-126 Fixes from the Phase 1 test pass
The test suite found four bugs, all fixed with regression tests: (1) appended sortKeys grew a character every ~6 appends and failed validation after ~385 tasks: appending now bumps the first bumpable digit (one character per ~61 appends), migration/import keys are balanced and equal-length, and the length limit is 512; (2) `SyncEngine.start()` did not reset seeding, so switching account in one run never uploaded existing data; (3) restoring a snapshot dropped records made after it without syncing that: they are now recycled, so the restore reaches every device; (4) the MCP bridge said "not running" instead of "the integration is off" on a fresh install.


## Phase 2+3, checkpoint A (schema v3 and planning)

### D-127 Schema v3 reuses the Phase 1 version gate
`SCHEMA_V` is 3 and `Data.schema` is 3. `migrate()` accepts schema 1, 2 and 3 and runs v1 -> v2 -> v3 per record (`upgradeRecord`): it only adds missing v3 fields (event `durationMin`, note `projectId`, block `auto`, the new settings, filled deep from defaults) and never rewrites a value that is there, so it is lossless and idempotent (tests/core/migrateV3.test.ts on `tests/fixtures/v2-josef.json`). Every record is stamped `v: 3`, so a Phase 1 client (accepts `v <= 2`) sees a newer record and goes read-only (D-104) instead of writing v2 shapes over v3 data. A record pulled from a v2 device (a new event without `durationMin`) is upgraded in `mergeRemote` before validation rather than quarantined. A newer file (schema 4) is refused (`migrate` returns null). There is no cross-midnight flag in the model, so `endMin > startMin` still always holds for placed events; the PHASE23 wording "unless the cross-midnight flag is set" is not implemented (nothing can create such an event).

### D-128 Unplaced events ("to place")
`CalEvent.startMin` and `endMin` are both null or both set (validators and `recordProblem`); only a one-off event (`date` not null) may be unplaced. `durationMin` (default 60) is the length: a placed event keeps it equal to `endMin - startMin` (event.create/update set it), an unplaced one uses it. `expandEvents` skips events without times, so gaps, time left, prep nudges and `upcoming` ignore them; `unplacedOn(d, date)` is the tray. Command `event.place {id, startMin}` sets `startMin` and `endMin = startMin + durationMin` (refuses past midnight and an event that already has a time). An edit exception cannot make a recurring event unplaced.

### D-129 New settings and device fields
Synced settings: `themeSchedule`, `weeklyFocusTargetH`, `sound`, `energy`, `widgets`, `parserReports`, `planning` (defaults as in the prompt), all validated in `validateSettings`. `parserReports` is newest-last, capped at 200 by the `parser.report` command and by `migrate`; each string is cut to 300/500/500 characters (input/expected/actual) so 200 reports stay far below Firestore's 1 MiB document limit. Device settings gain `composerProjectId` and `onboarded`. The synced `Settings.onboarded` from v2 is kept as is (the schedule setup guide still uses it); the device flag is the per-machine onboarding.

### D-130 MCP: Log tools, and the parser hook for add_task is left open
Added `post_log {body, projectId?}` (a note via `idea.add`, now with `projectId`), `search_log {query}` (notes only), `list_unplaced {date?}` (omitted date = every unplaced event from today on) and `place_event {eventId, startMin}` (refused with the reason on overlap, like `place_block`). `get_day` also returns `unplaced`. Safety rules unchanged: no hard deletes, 30 writes a minute, undo tokens. The parser-backed `text` argument of `add_task` is not wired yet: there is a TODO(D-130) at the top of the `add_task` handler. The hub adds the argument to the tool schema, calls `parse` with `source: 'claude'` and, if confidence is not high, returns the parse for Claude to confirm.

### D-131 Estimates
`estimateFor(d, task)`: the task's own estimate; else, with `planning.learnEstimates`, the median actual focus time (the larger of `workMs` and its work sessions) of the last 5 finished tasks (not killed, with a measured time above 0) that share the project or the tag, when there are at least 3, rounded to 5 minutes and kept within 5-480; else `planning.defaultBlockMin`. Tasks without a project and tag never learn.

### D-132 Auto-plan
Free time comes from `timeLeft` (fixed events padded by the transition variant, the meal reserve, the gap filter, the end-of-day buffer, every existing block), starting at `now` snapped up to `snapMin` for today and at the day start for later days. "Prep" in the prompt is read as that padding, not as prep nudges. Candidates: open tasks that were not started and have no block on that date or later, ordered by priority, due date (none last), `sortKey`, id. First fit, no splitting: a task longer than every remaining gap is reported as unplaced and a shorter one behind it may still fit. Blocks are `auto: true` with the deterministic id `ab-<taskId>-<date>`, so two devices planning the same morning write one block and running it twice adds nothing. It never reads or touches a manual block.

### D-133 Re-plan
Movable = auto blocks of today that have already ended, whose task is open and was never started. They are lifted out, then placed again in their original order into the gaps from now on; a block that finds no room stays where it is (the end-of-day review still sees its task). In-progress, started, finished and future auto blocks and every manual block are untouched.

### D-134 End-of-day review
Asked: open tasks with a block on the day, or due on or before it, except the task being timed right now and overdue tasks already answered "unscheduled" in an earlier review. Due at `dayEndMin - bufferMin`, or on demand. `review.submit {date, outcomes}` applies the answers (done = finish, dropped = close with a fixed reason, unscheduled = remove the day's blocks, tomorrow = remove them and place the task as an auto block next day if it fits, else it stays unscheduled), then writes `reviews/review-<date>`; its existence on any device means reviewed, so nobody is asked twice and a second submit is refused. Answering a subset is allowed; the rest are not asked again. A finished task keeps its block as history.

### D-135 Wellness
`breakDue(d, now, shown)`: continuous focus = work sessions plus the slice running now, merged across gaps shorter than 5 minutes (a 5-minute gap counts as a break taken). The prompt is for a block that ended at most 10 minutes ago, whose chain was at least `breakAfterMin` long at the block's end, only while no block is in progress (back-to-back blocks suppress it) and not after 5 quiet minutes. Which prompts were shown is device-local, passed in by the caller.

### D-136 Planning commands are one commit and one undo
`plan.auto`, `plan.replan`, `review.submit` return `undo: RevertOp[]` (the previous values of exactly the fields they changed, from `core/undo.revertOpsBetween`, the same function the MCP undo tokens use). Passing it to `records.revert` undoes the whole command as one action. `records.revert` is internal and is not parsed from IPC (it would let a renderer write arbitrary fields), so the UI must keep the ops in main behind a token like the MCP does, or main exposes a `plan.undo`. `Result.id` carries the count placed/moved (`plan.*`) or the review id.

### D-137 Audit changes
New rule: no Electron or Node imports or APIs in `src/core/parser`. `chrono-node` is allowed as an import inside `src/core/parser` only and in the dependency allowlist (pinned, D13 of the parser notes), and `@fontsource/*` packages are allowed (fonts are never loaded from a CDN). The "typed finish phrase is gone" check is unchanged; `docs/PHASE23_PROMPT.md` was reworded so it no longer quotes the old sentence.

### D-138 Firestore rules for v3
Rules stay generic per collection, plus a `shape()` check for the v3 fields: event `durationMin` an int 1-1440 and times both null or both set, note `projectId` a string or null, block `auto` a bool, settings lists/maps for `themeSchedule` (<= 24), `parserReports` (<= 200), `sound`, `energy`, `widgets`, `planning`, and `weeklyFocusTargetH` a number 0-168. Absent fields pass, so documents from v2 devices are still writable. Not run against the emulator (D-124); the manual rule checks in docs/SYNC.md still apply.

# Parser

# decision.md (parser)

What was decided mid-design. Each item overrides the matching line in CHRONOS_PARSER_REQUIREMENTS.md. Josef confirmed D1-D12 in chat on 2026-11-14; D13-D15 are proposals that need his OK.

## Confirmed by Josef

**D1. No default length for fixed events.** A fixed event with a start and no end is saved start-only; the UI asks for the end. Exceptions live in the pack as `defaultDurationMin`: `call` = 30, `class` = 60 (fallback only). Josef can add more per word.

**D2. Class length comes from the schedule.** Order: (1) an entry in `ctx.timetable` for that weekday starting at that time, so double periods fall out for free (Mon P1-2 Math = 07:45-09:05); (2) a bell start in `ctx.bells` = one period (40 min); (3) the pack default (60). Typing "double" extends to two periods. Two new ParseContext fields: `bells`, `timetable`. The one-day edit or skip of a timetable entry is a Chronos feature; the parser just receives that day's version.

**D3. "by" and "due" beat fixed keywords.** `Call mom by 8pm` is a task due 20:00. `by <name>` is not a deadline (`finish design request by ko dieky`).

**D4. Start + length = fixed**, with or without "for": `Gym workout 90 mins 4pm`, `call oma 4pm for 1h`, `2hrs sleep nap 2pm`. A range also makes it fixed and beats a task keyword (`Study with Mr. Tjong at 10to1pm`).

**D5. Passed times.** Tasks keep their date (today); the end-of-day review asks "done?". Fixed events are kept and get a warning. Replaces "move to tomorrow".

**D6. A bare number is never a time.** It is a time only with am/pm or a colon (`4pm`, `4:30`, `16:00`), after `at`, `@`, `by`, `due`, `from`, `till`, `until`, or as a valid clock range next to a time word or fixed keyword (`10-1`, `4-6`). `math hw 5` keeps the 5 in the title. `pages 10-20` is not a range of times. Removes spec rule 6(d).

**D7. "tonight" = today, no time.** It queues the item for today. Replaces "start 18:00". So `dinner tonight` is a task today (a fixed word with a date only is a task).

**D8. Event words.** Added to the pack: workout, gym, meet, padel, birthday, restaurant. `test` and `exam` are date-only event words: `Math test tomorrow!` is a fixed all-day reminder, not a task. A task keyword wins over them: `Study for magnets test on this fri` stays a task. ASSUMPTION TO CHECK: the v2 data model must allow a fixed event with no time. Read `types.ts` first; if it does not, ask Josef.

**D9. Fixed word + date only = task** (`go to church tmr`, `gym next mon`).

**D10. Notes vs tasks.** Prefix `note ` or `//` always wins. In quick-add, bias to task. A line is a task if it starts with a verb from the lexicon, has a task keyword, or carries a time, duration, priority or project. A line is a note when it has none of those and starts with a hedge, first-person or function word, or is sentence-like (>= 6 words with >= 2 function words). Notes keep the raw text: nothing is consumed (`tdy` stays). Uncertain cases get `confidence: low` and the other kind as `alternatives[0]`. Replaces ">12 words". Thresholds live in `lexicon.en.json` and are tuned on the corpus.

**D11. Fuzzy matching is conservative.** Only inside a number+unit or a date/time slot. Collapse repeated letters first, same first letter, max edit distance 1 (targets up to 5 letters) or 2 (6+), keyboard-neighbour or one stray punctuation character counts as 1. Never correct a real word: generate `neverCorrect` at build time by checking every target against a common-word list. The chip shows the corrected meaning; the user's typed text is never rewritten.

**D12. Cleanup of the title.** Consumed spans also remove adjacent `at/on/by/due/for`, the day parts `morning/afternoon/evening`, and `in the morning of`. A leading `in` is dropped after a removed duration (`2hrzz in mechanical engineering prep`). Only `for <duration>` is consumed (`for shorts` stays). `in Kopi Kenangan` is never `in N days`. Letter/digit glue is split (`10to1pm`, `mom4pm`, `3pages`); letters-only glue is not (`keyboardthis`).

## Proposed, needs Josef's OK

**D13. Project words.** Consume a project word only at the start of the line, or right before a priority marker at the end, or with a `#` prefix. Mid-line it stays plain text and sets no project. This is the rule that makes all confirmed corpus lines consistent (`Finish Chronos Build`, `Meeting with SC`, `work on sc draft proposal` keep the word; `sc budget draft !2 tmr`, `greenmech build robot arm`, `fix parser bug chronos !1` consume it). If consuming would leave the title empty, keep the word (`greenmech 3pm to 4:30pm friday`).

**D14. Corpus size.** Josef cannot hand-write 150 lines. Shipped 117: crucial categories are his own words, the grammar categories (4-6 each) are Claude drafts he confirmed. This is below the spec's 10 per category. Make up the difference through the misparse loop (D15).

**D15. Misparse loop.** The quick-add has a "Report misparse" action: it stores the input, what Josef expected, and what the parser produced in synced settings. Claude reads these, adds the line to `corpus.txt`, and ships a pack or lexicon update. Most fixes are data, not code. A fix may not break any older corpus line.

## Decided 2026-11-14 (Phase 2+3 planning chat)

**D13 revised (replaces the proposal).** Any project word anywhere in the line sets the project; the word stays in the title. Only `#name` is removed from the title.

**D16. Tests and exams use the timetable.** `<subject> test|exam <date>`: if that day's timetable has a period whose title matches the subject (case-insensitive, prefix/alias match, e.g. "math" = "Math"), the event takes that period's start and end (first match). If not, it is a fixed event on that date with no time yet and a 60 min duration ("to place"), which the user drags onto the timeline. Replaces "all day" in D8. Needs the CalEvent schema change in the build prompt.

**D17. 1 h default for every fixed event typed with a start and no end** (replaces D1). Exceptions: `call` = 30 min (pack), classes and timetable matches take the period length. The user adjusts by dragging.

## Not decided / out of scope here
- The schedule importer (PDF or image to LLM to JSON). Separate feature, built after the parser. The AI runs once at import time; the parser only reads the resulting JSON, so "no AI in the parse path" still holds.
- "yesterday" handling, bare-hour rules (1-6 = pm, 7-11 next occurrence, 12 = noon), `half 5`, `quarter past 4`, `noon/midnight`, `1700`, `5.30`: no corpus lines yet. See `tests/parser/corpus.known-gaps.txt`.
