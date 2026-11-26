// Firebase for the web bridge: config from Vite env, Google sign-in (popup, redirect fallback),
// Firestore with a persistent cache in the leader tab only. Every SDK module is loaded with a
// dynamic import() so none of it is in the initial chunk (a local-only user never downloads it).

import type { Result } from '../../core/commands';
import type { SyncProvider } from '../../core/sync/provider';

export interface WebConfig {
  apiKey: string;
  authDomain: string;
  projectId: string;
  appId: string;
  filesUrl: string | null;
}

export interface Who {
  uid: string;
  email: string | null;
}

export interface Usage {
  reads: number;
  writes: number;
  listeners: number;
}

type Env = Record<string, string | undefined>;

/** All four keys present = configured. VITE_FILES_URL is optional. */
export function readWebConfig(env: Env): WebConfig | null {
  const { VITE_FIREBASE_API_KEY: apiKey, VITE_FIREBASE_AUTH_DOMAIN: authDomain, VITE_FIREBASE_PROJECT_ID: projectId, VITE_FIREBASE_APP_ID: appId, VITE_FILES_URL: files } = env;
  if (!apiKey || !authDomain || !projectId || !appId) return null;
  return { apiKey, authDomain, projectId, appId, filesUrl: files && /^https:\/\/\S+$/.test(files) ? files : null };
}

/** iOS Safari and in-app browsers block or break popups: go straight to redirect. */
export function redirectPreferred(ua: string): boolean {
  const ios = /iPad|iPhone|iPod/.test(ua);
  return ios || /FBAN|FBAV|Instagram|Line\/|MicroMessenger|; wv\)/.test(ua);
}

export interface WebFirebase {
  /** Fires once the redirect result (if any) is handled, then on every sign-in/out, in any tab. */
  onUser(cb: (who: Who | null) => void): () => void;
  signIn(): Promise<Result>;
  signOut(): Promise<void>;
  idToken(): Promise<string | null>;
  /** Creates Firestore (persistent cache; leader tab only) and the counting provider. */
  provider(uid: string, deviceId: string, usage: Usage): Promise<SyncProvider>;
  /** Public computer: terminate Firestore and drop its on-disk cache. */
  wipe(): Promise<void>;
}

const sdkMessage = (e: unknown): string => {
  const code = (e as { code?: string }).code ?? '';
  if (code === 'auth/popup-closed-by-user' || code === 'auth/cancelled-popup-request') return 'Sign-in cancelled.';
  if (code === 'auth/network-request-failed') return 'Could not reach Google. Check the connection.';
  return e instanceof Error ? e.message : 'Sign-in failed.';
};

export function createWebFirebase(cfg: WebConfig): WebFirebase {
  let authP: Promise<{ app: import('firebase/app').FirebaseApp; auth: import('firebase/auth').Auth; m: typeof import('firebase/auth') }> | null = null;
  let db: import('firebase/firestore').Firestore | null = null;

  const authOf = () =>
    (authP ??= (async () => {
      const [{ initializeApp }, m] = await Promise.all([import('firebase/app'), import('firebase/auth')]);
      const app = initializeApp({ apiKey: cfg.apiKey, authDomain: cfg.authDomain, projectId: cfg.projectId, appId: cfg.appId });
      const auth = m.initializeAuth(app, { persistence: m.browserLocalPersistence, popupRedirectResolver: m.browserPopupRedirectResolver });
      return { app, auth, m };
    })());

  return {
    onUser(cb) {
      let off: (() => void) | null = null;
      let dead = false;
      void authOf().then(async ({ auth, m }) => {
        // A completed redirect sign-in lands here on the page that comes back from Google.
        try {
          await m.getRedirectResult(auth);
        } catch {
          // surfaced by the next sign-in attempt
        }
        await auth.authStateReady();
        if (dead) return;
        off = m.onAuthStateChanged(auth, (u) => cb(u ? { uid: u.uid, email: u.email } : null));
      });
      return () => {
        dead = true;
        off?.();
      };
    },

    async signIn() {
      const { auth, m } = await authOf();
      const google = new m.GoogleAuthProvider();
      if (redirectPreferred(navigator.userAgent)) {
        await m.signInWithRedirect(auth, google);
        return { ok: true };
      }
      try {
        await m.signInWithPopup(auth, google);
        return { ok: true };
      } catch (e) {
        const code = (e as { code?: string }).code;
        if (code === 'auth/popup-blocked' || code === 'auth/operation-not-supported-in-this-environment') {
          await m.signInWithRedirect(auth, google);
          return { ok: true };
        }
        return { ok: false, error: sdkMessage(e) };
      }
    },

    async signOut() {
      const { auth, m } = await authOf();
      await m.signOut(auth);
    },

    async idToken() {
      if (!authP) return null;
      const { auth } = await authP;
      return auth.currentUser ? auth.currentUser.getIdToken() : null;
    },

    async provider(uid, deviceId, usage) {
      const { app } = await authOf();
      const fs = await import('firebase/firestore');
      if (!db) {
        try {
          db = fs.initializeFirestore(app, { localCache: fs.persistentLocalCache({ tabManager: fs.persistentSingleTabManager({}) }), ignoreUndefinedProperties: true });
        } catch {
          try {
            db = fs.initializeFirestore(app, { localCache: fs.memoryLocalCache(), ignoreUndefinedProperties: true });
          } catch {
            db = fs.getFirestore(app);
          }
        }
      }
      const { firestoreProvider } = await import('../../main/sync/firestore');
      const inner = firestoreProvider(db, uid, deviceId);
      return {
        async commit(entries, plan) {
          const res = await inner.commit(entries, plan);
          usage.reads += entries.length;
          usage.writes += res.filter((r) => r.plan.write).length;
          return res;
        },
        listen(coll, since, onDocs, onError) {
          usage.listeners++;
          const off = inner.listen(coll, since, (docs) => { usage.reads += Math.max(1, docs.length); onDocs(docs); }, onError);
          return () => {
            usage.listeners--;
            off();
          };
        },
      };
    },

    async wipe() {
      if (!db) return;
      const fs = await import('firebase/firestore');
      try {
        await fs.terminate(db);
        await fs.clearIndexedDbPersistence(db);
      } catch {
        // already gone or never persisted
      }
      db = null;
    },
  };
}
