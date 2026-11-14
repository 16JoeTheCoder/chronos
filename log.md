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


## Parser handoff log (imported)

# log.md (parser)

Keeps the AI on track. Update at the end of every work session.

## Status (2026-11-14)
- Requirements: `CHRONOS_PARSER_REQUIREMENTS.md` (Josef's spec). Overrides: `decision.md`.
- Nothing is built yet. This folder is the design handoff.
- Corpus: `tests/parser/corpus.txt`, 117 lines, all confirmed by Josef. Fixture: `tests/parser/fixture.json`.
- Data: `src/core/parser/builtin.chronos-parser.json` (rules) and `lexicon.en.json` (words, shorthand, thresholds).

## Rules for the build
1. Read `src/core/model/types.ts`, `src/core/validation.ts`, `src/core/commands.ts` first. Check D8 (fixed event with no time).
2. Write the corpus runner FIRST (reads corpus.txt + fixture.json, calls `parse`), watch it fail, then implement.
3. Pin chrono-node's version. Override it in our layer for our cases; never fork it.
4. Keep the code lean. Skip anything costly that does not raise accuracy on the corpus. Everything tunable stays in the JSON files.
5. Tell Josef where to run every command (VS Code terminal at the repo root, or PowerShell).
6. Every misparse Josef reports becomes a corpus line BEFORE it is fixed.
7. Do not mark done until 100% of the corpus passes or the failure is moved to `corpus.known-gaps.txt` with a reason.

## Next steps
1. Read the three core files; settle D8 and D13 with Josef.
2. Scaffold `src/core/parser/` (types, index.ts exports: parse, applyCorrection, validatePack, mergePacks), the runner, the property tests and the benchmark.
3. Implement in layers: tokenizer + fuzzy, chrono-node dates/times, durations, recurrence, keyword/kind classifier (D3-D10), project/priority, title cleanup (D12).
4. Add the "Report misparse" action and the Ctrl+K preview wiring last.

## Log
- 2026-11-14: design finished, corpus confirmed, handoff exported.
