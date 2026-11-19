# Chronos: setup and deployment

This file is for people and for agents. An agent that holds Firebase and Cloudflare API access can follow it top to bottom. Every step says **where** it runs and what you should see.

| Part | Platform | Status |
| --- | --- | --- |
| Desktop app sync (Phases 1-3.7) | Firebase project `chronos-jy` (Firestore + Google sign-in) | Live. Each phase may change the rules. |
| Web app at `chronos.josefyang.com` (Phase 4) | Cloudflare | Not built yet. Placeholder below. |

The desktop app itself is not deployed anywhere: Josef builds it on his PCs (see "Get the new build" at the end).

---

## 1. Firebase (desktop sync)

### What gets deployed

| Item | File | Deployed by |
| --- | --- | --- |
| Firestore security rules | `firebase/firestore.rules` | `firebase deploy --only firestore:rules` |
| Firestore indexes | `firebase/firestore.indexes.json` (empty: Chronos queries by document path only) | `firebase deploy --only firestore:indexes` |

Nothing else (no Functions, no Hosting, no Storage). Auth is configured once in the console (`docs/SETUP_FIREBASE.md`); it never needs redeploying.

### Account and project

- Project: **`chronos-jy`** (`firebase/.firebaserc` sets it as the default).
- Account: the Google account that owns `chronos-jy` (Josef's). An agent uses whichever Firebase credentials it was given; it must have the **Firebase Rules Admin** (or Owner/Editor) role on `chronos-jy`.

### Order (do this every phase that touches rules)

Run everything from the repo root in a terminal (VS Code terminal on Windows, or the agent's shell).

1. Check you are on the right account and project:

```bash
npx firebase-tools projects:list
```

Expected: a table that includes `chronos-jy`. If not, `npx firebase-tools login` (people) or set the agent's credentials (`GOOGLE_APPLICATION_CREDENTIALS` / `FIREBASE_TOKEN`).

2. Save the rules that are live now (for rollback):

```bash
npx firebase-tools firestore:rules:get --project chronos-jy > firebase/rules.live.backup
```

If your CLI version has no `firestore:rules:get`, open console.firebase.google.com → chronos-jy → Firestore → Rules and copy the text into `firebase/rules.live.backup` (git-ignored by convention; do not commit it).

3. Deploy rules and indexes:

```bash
cd firebase && npx firebase-tools deploy --only firestore:rules,firestore:indexes --project chronos-jy
```

Expected: `✔ firestore: released rules firestore.rules to cloud.firestore` and `✔ Deploy complete!`. Indexes report "deployed indexes" (there are none, so nothing changes).

4. Verify: Firebase console → Firestore → Rules shows the new text (the top comment mentions "Schema v3/v4 fields") and a publish time of a minute ago. Then, in **Rules Playground**, run the checks at the end of `docs/SYNC.md`, plus these two for Phase 3.7:
   - `create` at `/users/<your uid>/tasks/t1` with data `{ id: "t1", v: 4, serverUpdatedAt: request.time, labels: ["a"], priority: "none" }`, signed in as that uid → **Allowed**.
   - The same with `priority: "urgent"` → **Denied**.

5. On a PC, open Chronos → Settings → Account and sync: the dot is green ("Synced") within a minute.

### Rollback

Put the saved text back and deploy it:

```bash
cp firebase/rules.live.backup firebase/firestore.rules && cd firebase && npx firebase-tools deploy --only firestore:rules --project chronos-jy
```

Then `git checkout firebase/firestore.rules` to restore the repo copy. The console also keeps rule history: Firestore → Rules → the clock icon → pick the previous version → Publish.

### Phase 3.7 notes

- Records are now written with schema version **4** (`v: 4`): new task fields `labels`, priority `none` (P4), and settings `tasks.doneRetentionHours` and `pillShowsClass`. A PC still on the Phase 3.5 build sees v4 records as "newer" and switches sync to **read-only** until it is updated (by design, D-104). Update both PCs.
- The new rules only add checks for the new fields; documents from older builds still pass.

---

## 2. Cloudflare (Phase 4 web app, placeholder)

Nothing to deploy in Phase 3.7.

Phase 4 plans a web app at **`chronos.josefyang.com`** that syncs with the desktop app (same Firebase project for data), plus an "Install Chronos for desktop" button. When it exists, this section will list, in order:

1. The Cloudflare account and zone (`josefyang.com`) the agent must use, and the API token scopes it needs (Workers Scripts: Edit, Zone DNS: Edit for `josefyang.com`).
2. The build command and output folder of the web app.
3. `npx wrangler deploy` (or Pages) with the exact project name, and the route / custom domain `chronos.josefyang.com`.
4. Secrets to set with `npx wrangler secret put` (names only; values come from Josef).
5. How to verify (open the URL, sign in, see the same tasks as the desktop) and how to roll back (`npx wrangler rollback`).

Until then, an agent asked to "deploy Chronos to Cloudflare" should answer that there is nothing to deploy yet.

---

## 3. Get the new build (Josef's PCs)

Run in the **VS Code terminal at the repo root** on each PC:

```bash
git checkout main
```

```bash
git pull
```

```bash
npm ci
```

```bash
npm run build
```

Then quit Chronos (tray icon → Quit) and start it again: `npm run dev` for development, or package an installer with `npm run package:win` and run `release\Chronos-Setup-1.0.0.exe`.
