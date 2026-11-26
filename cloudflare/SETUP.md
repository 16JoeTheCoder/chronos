# Chronos file storage on Cloudflare (free plan, Windows)

Chronos stores cached files and log attachments in a Cloudflare R2 bucket through a tiny Worker. The Worker checks your Firebase sign-in on every request and only lets you into your own folder.

Run all commands in PowerShell. You need Node 20+ (already installed if you build Chronos).

## 1. Enable R2 and create the bucket

1. Sign in at https://dash.cloudflare.com (free account is fine).
2. Left menu: **Storage & databases -> R2 object storage -> Purchase R2 / Get started**. R2 needs a card on file; the free tier below is not charged.
3. **Create bucket**, name exactly `chronos-files`, location Automatic, default storage class.

## 2. Find your Firebase uid

Firebase console -> your project -> **Authentication -> Users** -> copy the **User UID** of your Google account (a 28-character string). The same value shows in Chronos under Settings -> sync account.

## 3. Lifecycle rule (cache files expire after 3 days)

Keys are `<uid>/cache/<id>`, so the rule must name your uid:

R2 -> `chronos-files` -> **Settings -> Object lifecycle rules -> Add rule**
- Rule name: `expire-cache`
- Prefix: `<your-uid>/cache/` (with the trailing slash)
- Action: **Delete objects after 3 days**

Files under `<your-uid>/log/` are kept until Chronos deletes them.

## 4. Deploy the Worker

Edit `cloudflare/worker/wrangler.jsonc` and set:

```jsonc
"vars": {
  "FIREBASE_PROJECT_ID": "chronos-jy",   // your Firebase projectId
  "ALLOWED_UID": "<your-uid>",           // only this account may use the Worker
  "ALLOWED_ORIGINS": ""                  // desktop sends no Origin; for the web app set "https://chronos.josefyang.com" (comma-separated list)
}
```

Then:

```powershell
cd cloudflare\worker
npm i
npx wrangler login
npx wrangler deploy
```

`wrangler login` opens a browser; click Allow. Variables live in `wrangler.jsonc`, so redeploy (`npx wrangler deploy`) after changing them.

## 5. Point Chronos at the Worker

`wrangler deploy` prints the URL, like `https://chronos-files.<your-subdomain>.workers.dev`. (Also: dashboard -> Workers & Pages -> `chronos-files`.)

Paste it, with no trailing slash, into `firebase.config.json` (copy `firebase/firebase.config.example.json` if you don't have one):

```json
"filesUrl": "https://chronos-files.<your-subdomain>.workers.dev"
```

Restart Chronos. For the web app (`chronos.josefyang.com`), put the same URL in `.env.production` as `VITE_FILES_URL` and add the web origin to `ALLOWED_ORIGINS` (see `SETUP.md` section 1.6). Quick check: opening the URL in a browser shows `{"error":"not found"}`, which means the Worker is live.

## 6. Firestore rules (one time)

The new Cache collection needs its rules deployed:

```powershell
firebase deploy --only firestore:rules
```

## Auto-update

- Every push to `main` builds and publishes a GitHub Release `v1.0.<run number>` containing the installers plus `latest.yml`.
- The installed app checks 30 s after start and every 4 h, downloads quietly, and installs when you quit. It shows "Update downloaded, installs when you quit".
- Install with **Chronos-Setup-*.exe**. The Portable exe and dev runs never auto-update.
- The repo must be **public**, otherwise the app cannot read the release. Check: open https://github.com/16JoeTheCoder/chronos/releases in a private window; if you see the release, you're set.
- Unsigned builds: SmartScreen warns on the first install (More info -> Run anyway).

## Limits and costs (Cloudflare free)

| Resource | Free per month | Chronos use |
|---|---|---|
| R2 storage | 10 GB | files you attach; cache auto-expires |
| R2 writes (Class A) | 1,000,000 | one per upload |
| R2 reads (Class B) | 10,000,000 | one per download (browser cache 1 h) |
| R2 egress | free | - |
| Worker requests | 100,000 per day | one per file action |
| Max file size | 25 MB (enforced by the Worker) | - |
