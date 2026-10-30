# Sync in v1.1 (Firestore)

v1 ships the sync engine (`src/core/sync/engine.ts`) and runs it against a null provider. v1.1 adds a Firestore provider and Google sign-in. Nothing else changes.

## Collection map

Every record lives at `users/{uid}/{collection}/{id}`.

| Collection | Contents | Notes |
| --- | --- | --- |
| `tasks` | tasks and sprints | runtime is written only by the timer owner |
| `events` | timetable and one-off events | |
| `eventExceptions` | skip/move of one occurrence | id `x-<eventId>-<date>` (deterministic) |
| `closures` | holidays and breaks | seeded ids `hol-<date>` (deterministic, so devices agree) |
| `blocks` | planned blocks | |
| `sessions` | closed timer slices | id `s-<taskId>-<startedAt>` (deterministic) |
| `tags` | tags | |
| `ideas` | stray thoughts | |
| `activity` | started/finished/dropped/killed log | added in v1 for metrics (D-016) |
| `timer` | single doc `current` | the timer owner (`ActiveTimer`) |
| `settings` | single doc `main` | synced settings; device settings never leave `device.json` |

Each document's `id` field equals its document id (the rules check this).

## Push, pull, merge

- **Push**: records this device wrote with `updatedAt > lastPushedAt`, plus local winners found during the last pull, in batched writes. Each write sets `serverUpdatedAt: serverTimestamp()`. Purge stubs `{id, updatedAt, deletedAt, deviceId, v, purged}` are pushed like records.
- **Pull**: per collection, `where('serverUpdatedAt', '>', cursor)`, cursor = the largest `serverUpdatedAt` seen. Cursors live in `device.json`. Server time drives cursors, so client clock skew never skips changes.
- **Merge**: last-write-wins per record on the client's `updatedAt` (core/repo keeps it strictly increasing per record), tie-break on `deviceId`. A purge stub always wins. If the local copy beats what came down, it is pushed again, so plain overwriting `set()` converges (D-020).
- **Timer**: only `ActiveTimer.ownerDeviceId` drives the running timer. Take over writes a new owner and `takeoverAt`; both devices bank the old slice at `min(now, takeoverAt)` under the same session id.
- **Known limitation**: a device clock that steps back between pushes can hide new edits from "dirty" detection (D-021). v1.1 should also keep a local dirty set.

## Auth plan

Google sign-in from Electron through the system browser: an OAuth client of type "Desktop app" in the same Google Cloud project as Firebase; loopback redirect (`http://127.0.0.1:<random port>`) with PKCE; exchange the Google ID token with Firebase Auth `signInWithCredential(GoogleAuthProvider.credential(idToken))`. Passkeys/WebAuthn are not planned: Electron support is doubtful.

## Cost rule

Never write timer ticks: only start, pause, resume, stop, finish and slices become records. Batch writes. A single user should stay far inside the Spark free tier (to re-verify against current Firestore quotas before launch). Optional: a Firestore TTL policy on `deletedAt` for purge stubs older than 60 days.

## Config

`firebase/` holds `.firebaserc` (project `chronos-jy`), `firebase.json`, `firestore.rules`, `firestore.indexes.json` and `firebase.config.example.json` (keys only). The real `firebase.config.json` is git-ignored; at runtime `src/main/config.ts` reads it from the data folder (`%APPDATA%\Chronos\firebase.config.json`) or from `CHRONOS_FIREBASE_API_KEY`, `CHRONOS_FIREBASE_AUTH_DOMAIN`, `CHRONOS_FIREBASE_PROJECT_ID`, `CHRONOS_FIREBASE_APP_ID`. Never commit secrets.

## v1.1 task list

1. Add the `firebase` dependency and load it lazily after first paint.
2. Implement `FirestoreSyncProvider` (`push` with batched `set` + `serverTimestamp`, `pull` per collection, `subscribe` via `onSnapshot`).
3. Auth flow above, token refresh, sign-out.
4. Sync settings UI: status, account, last sync, "Sync now"; run `syncOnce` on start, on change (debounced) and on subscription events.
5. Publish `firestore.rules` and the indexes (`firebase deploy --only firestore`, from the `firebase/` folder).
6. Add the local dirty set (D-021) and widen the "no network" audit rule to allow the provider module only.
