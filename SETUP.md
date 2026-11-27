# Chronos: setup and deployment

This file is for people and for agents. An agent that holds Firebase and Cloudflare API access can follow it top to bottom. Every step says **where** it runs and what you should see.

| Part | Platform | Where it lives |
| --- | --- | --- |
| Sync (desktop and web) | Firebase project `chronos-jy` (Firestore + Google sign-in) | Section 1 |
| Web app, `https://chronos.josefyang.com` | Cloudflare Worker `chronos-web` (static app + `/api/*`) | Section 2 |
| Files (attachments, cache) | Cloudflare Worker `chronos-files` + R2 | `cloudflare/SETUP.md` |
| Desktop app (Windows) | GitHub Releases | Section 3 |

Where steps run: **agent shell** = the agent's bash at the repo root; **VS Code terminal** = a terminal at the repo root on Josef's PC; **PowerShell** = Windows PowerShell; **browser** = a signed-in browser.

---

## 1. Firebase

Project **`chronos-jy`** (`firebase/.firebaserc` sets it as default). The credentials used need the **Firebase Rules Admin** role (or Owner/Editor) on it. Nothing else is deployed to Firebase: no Functions, Hosting or Storage.

| Item | File | Deployed by |
| --- | --- | --- |
| Firestore rules | `firebase/firestore.rules` | `firebase deploy --only firestore:rules` |
| Firestore indexes | `firebase/firestore.indexes.json` (empty: queries are by path) | `firebase deploy --only firestore:indexes` |

### 1.1 Check the account and project (agent shell / VS Code terminal)

```bash
npx firebase-tools projects:list
npx firebase-tools use chronos-jy
```

Expected: the table lists `chronos-jy`; `use` prints `Now using project chronos-jy`. If not signed in: `npx firebase-tools login` (people) or set `GOOGLE_APPLICATION_CREDENTIALS` / `FIREBASE_TOKEN` (agents).

### 1.2 Save the live rules, then deploy (agent shell / VS Code terminal)

```bash
npx firebase-tools firestore:rules:get --project chronos-jy > firebase/rules.live.backup
cd firebase && npx firebase-tools deploy --only firestore:rules,firestore:indexes --project chronos-jy
```

If your CLI has no `firestore:rules:get`, copy the text from console.firebase.google.com → chronos-jy → Firestore → Rules into `firebase/rules.live.backup` (git-ignored). Expected: `✔ firestore: released rules firestore.rules to cloud.firestore` and `✔ Deploy complete!`.

### 1.3 Verify in the Rules Playground (browser)

Firebase console → chronos-jy → Firestore → Rules → **Rules Playground**. Simulate **create**, authenticated as your own uid (Authentication → Users shows it):

| Path | Data | Expected |
| --- | --- | --- |
| `/users/<uid>/tasks/t1` | `{ id: "t1", v: 4, serverUpdatedAt: request.time, labels: ["a"], priority: "none" }` | Allowed |
| same | `priority: "urgent"` | Denied |
| `/users/<uid>/ideas/i1` | `{ id: "i1", v: 4, serverUpdatedAt: request.time, draft: true }` | Allowed |
| same | `draft: "yes"` | Denied |
| `/users/<uid>/rambles/r1` | `{ id: "r1", v: 4, serverUpdatedAt: request.time, recordedAt: 1, durationSec: 5, device: "phone", transcript: "", status: "pending" }` | Allowed |
| same | `status: "bogus"` | Denied |

The other checks (other user's uid denied, unsigned denied) are listed at the end of `docs/SYNC.md`.

### 1.4 Allow the web domains for Google sign-in

Sign-in popups only work on authorized domains. Add `chronos.josefyang.com` and the Worker's `workers.dev` host (you learn its `<subdomain>` from the first `wrangler deploy` in section 2; it is printed as `https://chronos-web.<subdomain>.workers.dev`).

**Agent shell** (needs `gcloud` signed in as an Owner/Editor of `chronos-jy`). `PATCH` replaces the whole list, so read it first and append:

```bash
TOKEN=$(gcloud auth print-access-token)
API=https://identitytoolkit.googleapis.com/admin/v2/projects/chronos-jy/config
CURRENT=$(curl -s -H "Authorization: Bearer $TOKEN" -H "x-goog-user-project: chronos-jy" "$API" | jq -c '.authorizedDomains')
NEW=$(echo "$CURRENT" | jq -c '. + ["chronos.josefyang.com","chronos-web.<subdomain>.workers.dev"] | unique')
curl -s -X PATCH "$API?updateMask=authorizedDomains" \
  -H "Authorization: Bearer $TOKEN" -H "x-goog-user-project: chronos-jy" -H "Content-Type: application/json" \
  -d "{\"authorizedDomains\": $NEW}" | jq '.authorizedDomains'
```

Expected: the printed list includes both new hosts (plus `localhost` and `chronos-jy.firebaseapp.com`, which are there by default).

**Or in the browser:** Firebase console → Authentication → Settings → **Authorized domains** → Add domain, once per host.

Also check Authentication → Sign-in method → **Google** is enabled (it is, for the desktop app).

### 1.5 Web app config (agent shell / VS Code terminal)

The web build needs a Firebase **Web app**. Reuse it if it exists:

```bash
npx firebase-tools apps:list WEB --project chronos-jy
```

If the list is empty:

```bash
npx firebase-tools apps:create WEB "Chronos web" --project chronos-jy
```

Print its config (use the App ID from the list):

```bash
npx firebase-tools apps:sdkconfig WEB <appId> --project chronos-jy
```

Copy the values into **`.env.production`** at the repo root. These are public identifiers (they ship in the page; security comes from the Firestore rules), so the file may be committed:

```
VITE_FIREBASE_API_KEY=<apiKey>
VITE_FIREBASE_AUTH_DOMAIN=chronos-jy.firebaseapp.com
VITE_FIREBASE_PROJECT_ID=chronos-jy
VITE_FIREBASE_STORAGE_BUCKET=<storageBucket>
VITE_FIREBASE_MESSAGING_SENDER_ID=<messagingSenderId>
VITE_FIREBASE_APP_ID=<appId>
VITE_FILES_URL=https://chronos-files.<subdomain>.workers.dev
```

`VITE_FILES_URL` is the files Worker URL from `cloudflare/SETUP.md` step 5 (no trailing slash). `import.meta.env.VITE_APP_VERSION` is set by the build from `package.json`; do not put it in the file.

### 1.6 Let the web origin use the files Worker (agent shell / VS Code terminal)

Browsers send an `Origin` header, so the files Worker must list the web origin. Edit `cloudflare/worker/wrangler.jsonc`:

```jsonc
"ALLOWED_ORIGINS": "https://chronos.josefyang.com"
```

(Comma-separated; add `https://chronos-web.<subdomain>.workers.dev` to test on the workers.dev host.) Redeploy that Worker:

```bash
cd cloudflare/worker && npx wrangler deploy
```

Verify: `curl -si -H "Origin: https://chronos.josefyang.com" <VITE_FILES_URL>/ | grep -i access-control-allow-origin` prints the origin back.

### Rollback (rules)

```bash
cp firebase/rules.live.backup firebase/firestore.rules && cd firebase && npx firebase-tools deploy --only firestore:rules --project chronos-jy
git checkout firebase/firestore.rules
```

The console also keeps history: Firestore → Rules → clock icon → pick a version → Publish.

### Schema notes

- Records carry schema version **4**. A device on an older build sees v4 records as "newer" and goes read-only for sync until it updates (by design). Update every PC.
- Log drafts are `ideas` records with `draft: true` (no schema bump, D-184). `rambles` (Phase 4.5) has rules but is not synced yet (D-185).

---

## 2. Cloudflare (web app)

One Worker, `chronos-web`, serves the built app from `dist-web/` (single-page-app fallback) and handles `/api/*`. Config: `wrangler.jsonc`. Domain: `chronos.josefyang.com` (custom domain, DNS and certificate are created by the deploy).

### 2.1 Credentials (agent shell, or PowerShell for Josef)

The zone `josefyang.com` must be on the same Cloudflare account. Create an API token (dash.cloudflare.com → My Profile → API Tokens → Create Token → *Edit Cloudflare Workers* template, then add **Zone → DNS → Edit** and **Zone → Workers Routes → Edit** for `josefyang.com`). Then:

```bash
export CLOUDFLARE_API_TOKEN=<token> CLOUDFLARE_ACCOUNT_ID=<account id>
npx wrangler whoami
```

PowerShell: `$env:CLOUDFLARE_API_TOKEN="<token>"; $env:CLOUDFLARE_ACCOUNT_ID="<account id>"`. A person can run `npx wrangler login` instead. Expected: `whoami` shows the account.

### 2.2 Build (agent shell / VS Code terminal)

```bash
npm ci
npm run build:web
```

Expected: `-> built dist-web/ (N files, ... KB, sw <hash>)`. Requires `.env.production` from step 1.5 (without it the app builds but cannot sign in).

### 2.3 Deploy (agent shell / VS Code terminal)

```bash
npx wrangler deploy
```

Expected: `Deployed chronos-web triggers`, listing `https://chronos-web.<subdomain>.workers.dev` and `chronos.josefyang.com (custom domain)`. First deploy: now do step 1.4 with the printed `<subdomain>`.

### 2.4 Verify (agent shell)

```bash
curl -sI https://chronos.josefyang.com | head -3
curl -s https://chronos.josefyang.com/api/health
curl -s -o /dev/null -w "%{http_code}\n" https://chronos.josefyang.com/api/ramble/x
curl -sI https://chronos.josefyang.com/sw.js | grep -i cache-control
```

Expected: `HTTP/2 200`; `{"ok":true,"version":"1.0.0"}`; `401`; `cache-control: no-cache`. The certificate can take a minute or two on the first deploy (retry). Then in a **browser** open the URL, sign in with Google, and see the same tasks as the desktop.

Preview without deploying: `npm run build:web && npm run preview:web` (serves `dist-web` and the Worker at http://localhost:8787).

### 2.5 Secrets (later, not set yet)

Phase 4.5 (Ramble processing) will need these. Do not set them now; set each only when asked:

```bash
npx wrangler secret put NVIDIA_API_KEY
```

### 2.6 Roll back

```bash
npx wrangler versions list
npx wrangler rollback
```

`rollback` with no argument goes to the previous version; pass a version id to pick one. Service workers update on the next visit, so a rolled-back shell reaches open tabs after a reload.

---

## 3. Desktop releases (Josef's PCs)

CI (`.github/workflows/build-windows.yml`) runs tests, typecheck and the audit, then builds the installer:

- **Push to `main`**: stamps version `1.0.<run number>` and publishes GitHub Release `v1.0.<run number>` with `Chronos-Setup-*.exe`, `Chronos-Portable-*.exe`, `latest.yml`.
- **Tag `vX.Y.Z`**: publishes a release named after the tag (the app version in the build is whatever `package.json` says).

```bash
git tag v1.1.0 && git push origin v1.1.0
```

Installed copies check for updates 30 s after start and every 4 h, and install on quit. The repo must be public for that. Builds are unsigned: on first install SmartScreen shows a warning; click **More info → Run anyway**.

---

## 4. Get the new build (Josef's PCs, from source)

Run in the **VS Code terminal at the repo root** on each PC:

```bash
git checkout main
git pull
npm ci
npm run build
```

Then quit Chronos (tray icon → Quit) and start it again: `npm run dev` for development, or package an installer with `npm run package:win` and run `release\Chronos-Setup-1.0.0.exe`.
