# Build log (Phase 1)

Terse, for a fresh session to resume from. Newest state at the top of each section.

## Done
- A: model v2 types, `migrate` v1->v2 (lossless, idempotent), sortKey, deterministic ids, record validators (`recordProblem`).
- B (core): outbox (diff, coalesce, replay, seed), per-field merge + commit planning, `SyncEngine` (flush/backoff/listen/reconnect/read-only/quarantine), fake Firestore (`memoryProvider`). Two-device tests a-h + takeover + recurring: green.
- Recurring tasks (`core/tasks/recurrence.ts`), `task.finish` without phrase, `task.close`, `task.moveCard`, `event.editOn`, `project.create`, `records.revert`.

## In progress
- Controller integration (commit/diff, outbox.json, conflicts/quarantine files, snapshots).

## Next
- Firestore provider (main), auth, MCP, search, UI fixes, Settings (sync dot, experimental, integrations), docs, audit rules.

## Known failures
- none in core tests.
