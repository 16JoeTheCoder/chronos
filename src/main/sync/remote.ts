// Entry of dist/sync.js: everything that needs the Firebase SDK, loaded by main
// only when firebase.config.json is present (the app runs fully offline without it).

import { initializeApp, type FirebaseApp } from 'firebase/app';
import { inMemoryPersistence, initializeAuth, type Auth } from 'firebase/auth';
import { initializeFirestore, memoryLocalCache, type Firestore } from 'firebase/firestore';
import type { FirebaseConfig } from '../config';
import { signInInteractive, signInSilently, signOutFirebase, type SignedIn } from './auth';
import { firestoreProvider } from './firestore';
import type { SyncProvider } from '../../core/sync/provider';

export { AuthError } from './auth';

export interface Remote {
  signIn(openExternal: (url: string) => Promise<void>): Promise<SignedIn>;
  silent(refreshToken: string): Promise<SignedIn>;
  signOut(): Promise<void>;
  provider(uid: string, deviceId: string): SyncProvider;
}

export function createRemote(cfg: FirebaseConfig): Remote {
  const app: FirebaseApp = initializeApp({ apiKey: cfg.apiKey, authDomain: cfg.authDomain, projectId: cfg.projectId, appId: cfg.appId });
  const auth: Auth = initializeAuth(app, { persistence: inMemoryPersistence });
  // One Firestore client per app instance, memory cache only (rule 1).
  const db: Firestore = initializeFirestore(app, { localCache: memoryLocalCache(), ignoreUndefinedProperties: true });
  const client = { clientId: cfg.googleClientId, clientSecret: cfg.googleClientSecret };
  return {
    signIn: (open) => signInInteractive(auth, client, open),
    silent: (rt) => signInSilently(auth, client, rt),
    signOut: () => signOutFirebase(auth),
    provider: (uid, deviceId) => firestoreProvider(db, uid, deviceId),
  };
}
