# Sync (Firestore)

What was built in Phase 1. Chronos stays local-first: every edit lands in the local store at once and the UI never waits on the network. Sync replicates that store to Firestore and back, per field, through a durable outbox. Signed out, or with no `firebase.config.json`, nothing changes from v1 except that edits are still recorded in the outbox.

```
renderer --IPC--> controller.command() --> core/commands.apply()
                       |
                  controller.commit(next)          one write path (D-103)
                       |  diffData(old, new) per record, per field
                       v
            chronos-data.json        outbox.json (atomic, before data)
                                          |
                                     SyncEngine.flush()  ---- one transaction per batch ---->  Firestore
                                          ^                  planCommit() per entry            users/{uid}/{coll}/{id}
                                          |                                                          |
            controller.applyRemote() <--- mergeRemote() <--- onSnapshot(serverUpdatedAt >= cursor) <-+
```

Code: `src/core/sync/` (pure: `outbox.ts`, `merge.ts`, `engine.ts`, `provider.ts`, `memoryProvider.ts` = the fake Firestore used by tests), `src/main/sync/` (`firestore.ts` provider, `auth.ts` Google sign-in, `remote.ts` = entry of `dist/sync.js`, `manager.ts` = sign-in state and lifecycle), `src/main/controller.ts` (`commit`, the `SyncHost`).

## The eight rules, as built

1. **Main process owns sync.** The Firebase SDK is imported only in `src/main/sync/{firestore,auth,remote}.ts` (the audit enforces it) and bundled to `dist/sync.js`, which main loads only when the config is complete. Renderer windows talk to the controller over IPC, as before. One Firestore client per app instance, memory cache only.
2. **Local-first, durable outbox.** `Controller.commit(next)` diffs the old and new Data and appends one entry per changed record: `{opId, coll, id, fields, baseFv, createdAt}` (`fields` = changed field → value, `baseFv` = the field versions seen at edit time). `outbox.json` is written atomically (temp file, fsync, rename) before the call returns. Entries waiting for the same record are coalesced (D-106); an entry in flight is never changed. An entry is removed only after Firestore acknowledged its transaction. At startup the outbox is replayed onto the loaded data, so a crash between the outbox write and the (debounced) data write loses nothing.
3. **Idempotent writes.** Ids are client-generated. Generated records have deterministic ids: exceptions `x-<eventId>-<date>`, holidays `hol-<date>`, sessions `s-<taskId>-<startedAt>`, reviews `review-<date>`, recurring instances `<parentId>:<date>`. Re-sending an entry writes the same fields again.
4. **Per-field merge.** A write sends only the changed fields plus `fv.<field> = serverTimestamp()`, `fw.<field> = deviceId` and `serverUpdatedAt = serverTimestamp()`, with `update()` field paths (a map field is replaced whole, never deep-merged). Inside the transaction, if the remote `fv[field]` differs from the entry's `baseFv[field]`, the last writer was another device, and the values differ, another device changed that field since this edit: **the local pending edit still wins**, and a conflict `{at, coll, id, field, overwrittenValue, newValue, otherDeviceId}` is appended to `conflicts.json`. Different fields of one record never conflict. Server timestamps order everything; client clocks never decide (test (h)).
5. **Tombstones.** Deletes set `deletedAt`; clients never hard-delete (the rules forbid it). A remote tombstone beats an edit that neither deletes nor restores: nothing is written, the lost fields are logged as conflicts, the remote doc is adopted (D-108). After 7 days the content is wiped locally and a purge stub replaces the doc on the server; stubs are terminal and are dropped locally after 30 days.
6. **Version gate.** `v` is the record's schemaVersion (D-102). A pulled doc with `v` greater than this build's schema (3 since Phase 2+3, `SCHEMA_V`) is not merged, and such a doc read in a flush transaction is not written over. Every record the v3 migration touches is stamped `v: 3`, so a Phase 1 client (schema 2) sees it as newer and goes read-only. A new doc from a v2 device (no v3 fields) is upgraded with defaults before validation (D-127). Sync turns **read-only**: edits keep queueing, nothing is pushed, the dot turns red, "Update Chronos on this device."
7. **Reconnect and catch-up.** One `onSnapshot` listener per collection with `where('serverUpdatedAt', '>=', cursor)` (>= plus idempotent merge, so a commit that shares the cursor's timestamp is never skipped). Cursors (server µs) live in `device.json`. On `powerMonitor` resume and unlock-screen, on network regain (polled with `net.isOnline()` on the 30 s tick) and on any listener error, the listeners are torn down and re-attached from the stored cursors. Flush failures back off 1 s, 2 s, 4 s … 60 s, ±25 % jitter; the entries stay. Snapshot changes with `hasPendingWrites` are ignored.
8. **Validate everything that arrives.** Every merged doc passes `recordProblem()` (core/validation, D-110). Invalid docs go to `quarantine.json` with the reason and are never merged or rendered. The same check runs on the local store at load: an invalid record is moved to quarantine, not dropped.

**First sign-in** (D-107): after the first snapshot of every collection, fields that were never synced (no `fv`) are queued as *seed* entries, which only fill what the server lacks and adopt the rest. Two devices signing in at the same time cannot overwrite each other's data with defaults. Signing in to a different account clears `fv`/`fw` and uploads everything again.

**Timer ownership** is unchanged: only `timer/current.ownerDeviceId` drives a running timer; Take over banks the previous owner's slice at the takeover instant on both devices under the same session id (tested over the engine).

## Documents

`users/{uid}/{collection}/{id}` = `{ ...record fields, fv: {field: Timestamp}, fw: {field: deviceId}, serverUpdatedAt: Timestamp }`. Collections: tasks, events, eventExceptions, closures, blocks, sessions, tags, ideas (notes), activity, timer (`current`), settings (`main`), projects, reviews. `device.json` never syncs.

## States (`Snapshot.sync`)

`off` (no config) · `signedOut` · `syncing` (listeners attaching, first snapshot pending) · `synced` · `pending` (outbox not empty) · `offline` · `error` (reason) · `readOnly` (reason). Normal mode shows only a dot near time-left: hidden when synced or signed out, amber when changes have waited more than ~10 s or offline, red on error/read-only; clicking it shows the reason and Retry. Experimental mode adds Diagnostics (state, outbox count and age, last sync, cursors, Force resync, snapshots with Restore, conflict log, quarantine, Export log, MCP).

## Contingencies

- **Daily snapshots**: `snapshots\chronos-<date>.json`, the newest 7 kept, plus the existing `.bak`. A snapshot is also written before a restore and before a force resync.
- **Restore**: snapshots the current data first; the restored values become ordinary edits (outbox), so other devices follow.
- **Force resync**: snapshot, clear cursors, re-pull everything, re-merge; the outbox is kept and re-flushed.
- **Conflict log / quarantine**: `conflicts.json`, `quarantine.json` (500 kept), viewable and clearable in Diagnostics.
- **Export log**: one text file with the sync state, outbox summary, conflicts, quarantine and `logs\chronos.log`.

## Failure modes

| Cause | What the user sees | Automatic recovery | Manual recovery |
| --- | --- | --- | --- |
| Offline (no network, airplane mode) | Amber dot after ~10 s: "Offline. Changes are saved here…" | Outbox keeps every edit; reconnect on network regain; backoff retries | Retry on the dot |
| Laptop asleep / screen locked | Nothing; on wake the other device's edits appear | Re-attach listeners from cursors on resume/unlock | Retry |
| Crash or power loss after an edit | Edit is there after restart | Outbox replayed at startup and re-flushed once; deterministic ids, no duplicates (test (e)) | none |
| Same field edited on two devices | The later flush's value on both devices | Conflict logged with both values | Diagnostics → Conflict log; re-edit if needed |
| Edit on a record deleted elsewhere | Record stays deleted | Edit not written; logged as a conflict; remote adopted | Restore from Recently deleted, re-edit |
| Newer Chronos version on another device wrote a higher schema (e.g. a Phase 1 device meeting v3) | Red dot: "Update Chronos on this device." | Nothing is pushed; edits keep queueing | Update Chronos; the outbox flushes afterwards |
| Invalid / corrupt doc on the server | Nothing (doc not shown) | Quarantined, never merged | Diagnostics → Quarantine, clear |
| Firestore error, quota, rules denial | Red dot with the error | Backoff 1 s → 60 s; entries kept | Retry; Export log |
| Google sign-in revoked / expired | Signed out in Settings → Sync | Local data and outbox kept | Sign in again (outbox flushes) |
| Offline at launch | Local as before | Silent sign-in retried every minute | none |
| Bad local data after a merge | Wrong data | Daily snapshots | Diagnostics → Restore a snapshot / Force resync |

## Cost (to re-verify)

Spark free quotas as last known: 50,000 document reads, 20,000 writes and 20,000 deletes per day, 1 GiB stored. **Re-verify against current Firebase pricing before relying on this.**

One user, two devices, a busy day (estimate): ~150 edits coalesce to ~100 flushed entries in ~80 transactions = ~100 reads + ~100 writes; the other device's listener reads each change once (~100 reads); ~20 reconnects × 13 collections ≈ 260 reads (each query costs at least one read). Timer starts/pauses and sessions add ~30 writes. Steady state ≈ 500 reads and 150 writes a day, about 1 % of the quota. The first sign-in reads every document once and uploads every record (a few thousand), still inside one day's quota. Timer ticks are never written.

## Firestore rules

`firebase/firestore.rules` (v3 field shapes: D-138): only `request.auth.uid == uid` reads or writes `users/{uid}/**`, only known collections, the doc's `id` must equal the doc id, `v` must be an int, `serverUpdatedAt` must be the server time, no deletes, everything else denied. The Admin SDK (a future trusted server, Phase 4) bypasses rules, so it needs no change. Deploy: see `docs/SETUP_FIREBASE.md`.

Rules are not unit-tested (the emulator was not run in this build). Manual checks after deploying, in the Firebase console → Firestore → Rules → **Rules Playground**: (1) authenticated as uid A, `get /users/A/tasks/x` allowed; (2) as uid B, `get /users/A/tasks/x` denied; (3) unauthenticated, any path denied; (4) `create /users/A/tasks/x` with `{id: 'y', v: 2, serverUpdatedAt: request.time}` denied (id mismatch); (5) with `v: "2"` denied; (6) `delete /users/A/tasks/x` denied; (7) `create /users/A/unknown/x` denied.

## Verification status

- Engine, merge rules, outbox and the eight rules: tested against the fake Firestore (`tests/sync/`), including scenarios (a)-(h), takeover, recurring tasks on two devices, latency and reconnects.
- The real Firestore provider (`src/main/sync/firestore.ts`) type-checks against the SDK and its bundle loads, but has **not run against Firestore or the emulator** in this build. Test it with the two-PC steps in `docs/WINDOWS_CHECKLIST.md`.
