# Build log (Phase 1)

Terse, for a fresh session to resume from.

## Done
- A: model v2, `migrate` v1->v2 (lossless, idempotent), sortKey, deterministic ids, `recordProblem` validators; recurring tasks; `task.finish` without phrase, `task.close`, `task.moveCard`, `event.editOn`, `project.create`, `records.revert`, `activity.claude`.
- B: outbox (diff/coalesce/replay/seed), per-field merge, `SyncEngine`, fake Firestore; controller `commit()` single write path, outbox.json, conflicts.json, quarantine.json, daily snapshots, restore, force resync; Firestore provider + Google PKCE sign-in in `src/main/sync` (lazy `dist/sync.js`); `SyncManager` (silent sign-in, revoke, offline retry); reconnect on resume/unlock/network.
- E: `core/search` (MiniSearch, incremental).
- F: `core/mcp` tools + handlers (undo, rate limit, strict args), `main/mcp/server.ts`, `src/bridge` -> `dist/chronos-mcp.js` (stdio verified by hand: lists tools, "not running" error).
- Docs: SYNC.md, SETUP_FIREBASE.md, MCP.md, ARCHITECTURE, WINDOWS_CHECKLIST 13-23, SPEC_MATRIX Phase 1 rows, README; firestore.rules; audit rules.
- Tests: tests/sync (23, scenarios a-h).

## Phase 1 PR
- 16JoeTheCoder/chronos#2 merged (with red audit: missing tests). Follow-up on this branch: 232 tests from the test agent, four bugs fixed (D-126), audit green.

## In progress (superseded)
- Renderer (G1-G5, Settings sync/integrations/experimental/diagnostics, notices): Sonnet agent in a worktree; merge when it reports.
- Test suite (migration fixtures, validation, exceptions, recurrence, sortKey, search+bench, MCP handlers, bridge/server, controllerSync): Sonnet agent in a worktree; merge and fix any BUGs it reports.

## Next
- Merge both branches, `npm run audit`, smoke under xvfb, reviewer agent pass, BUILD_REPORT, PR.

## Known failures / unverified
- Renderer build fails until the UI branch is merged (FocusCore imports the removed phrase helpers).
- Real Firestore provider and rules never run (emulator blocked, D-124). Google sign-in, MCP via Claude Desktop, ELECTRON_RUN_AS_NODE: Windows checklist.
