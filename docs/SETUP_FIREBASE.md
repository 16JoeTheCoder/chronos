# Set up sync (Firebase + Google sign-in)

One-time setup for the Firebase project `chronos-jy`. Each step says where it happens. Until this is done Chronos runs local-only, exactly as before; nothing breaks without it.

## 1. Enable Google sign-in — Firebase console (browser)

1. Open console.firebase.google.com → project **chronos-jy**.
2. **Build → Authentication → Get started** (if shown) → **Sign-in method** → **Google** → **Enable**, choose your support email → **Save**.

## 2. Create the database — Firebase console (browser)

1. **Build → Firestore Database → Create database**.
2. Mode: **production** (the rules from step 6 replace the defaults). Location: **asia-southeast2 (Jakarta)**, or the closest region. The location cannot be changed later.

## 3. Register the app's web config — Firebase console (browser)

1. **Project settings** (gear) → **General** → **Your apps** → **Add app** → **Web** (`</>`). Nickname `Chronos desktop`. No Hosting.
2. Copy `apiKey`, `authDomain`, `projectId` and `appId` from the config it shows. (These identify the project; they are not secrets. Access is controlled by the rules.)

## 4. Create the Desktop OAuth client — Google Cloud console (browser)

1. Open console.cloud.google.com → select the project **chronos-jy** (top bar).
2. **APIs & Services → OAuth consent screen** (or **Google Auth Platform → Branding**): app name `Chronos`, your email as support and developer contact. Audience **External**; while it is in **Testing**, add your own Google account under **Test users**. Chronos asks only for `openid email profile`, so refresh tokens do not expire after 7 days in Testing mode.
3. **APIs & Services → Credentials → Create credentials → OAuth client ID** → Application type **Desktop app** → name `Chronos` → **Create**.
4. Copy the **Client ID** and **Client secret**. (For a Desktop app client Google treats the secret as non-confidential; it still belongs only in the git-ignored config file.)
5. Back in the **Firebase console → Authentication → Sign-in method → Google**, open **Safelist client IDs from external projects**, paste the Desktop **Client ID**, **Save**. (Harmless if Firebase already accepts it; required if sign-in fails with `invalid-credential` / audience errors.)

## 5. Fill the config file — VS Code

1. Copy `firebase/firebase.config.example.json` to `firebase/firebase.config.json` (git-ignored) and fill all six values:

```json
{
  "apiKey": "…",
  "authDomain": "chronos-jy.firebaseapp.com",
  "projectId": "chronos-jy",
  "appId": "…",
  "googleClientId": "…apps.googleusercontent.com",
  "googleClientSecret": "…"
}
```

2. The installed app reads it from the data folder. In **Windows PowerShell**, from the repo root:

```powershell
Copy-Item firebase\firebase.config.json "$env:APPDATA\Chronos\firebase.config.json"
```

`npm run dev` also finds `firebase/firebase.config.json` in the repo. Alternatively set `CHRONOS_FIREBASE_API_KEY`, `CHRONOS_FIREBASE_AUTH_DOMAIN`, `CHRONOS_FIREBASE_PROJECT_ID`, `CHRONOS_FIREBASE_APP_ID`, `CHRONOS_FIREBASE_GOOGLE_CLIENT_ID`, `CHRONOS_FIREBASE_GOOGLE_CLIENT_SECRET`. Never commit the file.

Do this on **each** PC that should sync (same file on both).

## 6. Deploy the security rules — VS Code terminal, from `firebase/`

```bash
npx firebase-tools login
```

```bash
npx firebase-tools deploy --only firestore:rules
```

(`.firebaserc` already points at `chronos-jy`. If you have the CLI installed globally, `firebase deploy --only firestore:rules` is the same.) Then run the manual rule checks at the end of `docs/SYNC.md` in the Firebase console → Firestore → Rules → **Rules Playground**.

## 7. Sign in — Chronos

1. Quit Chronos (tray → Quit) and start it again so it reads the config.
2. **Settings → Sync → Sign in with Google**. Your browser opens; choose your account. The tab says "Signed in to Chronos"; close it. (If you close the browser instead, Chronos gives up after 3 minutes with a clear message.)
3. The first sign-in uploads your local data. On the second PC, sign in with the same account: it downloads everything and adds anything it had locally.
4. After that, restarts sign in silently (the refresh token is stored encrypted with Windows DPAPI via Electron `safeStorage` in `device.json`).

To check it works, follow "Two-PC sync" in `docs/WINDOWS_CHECKLIST.md`. Turn on **Settings → Advanced → Experimental** to see the Diagnostics section.
