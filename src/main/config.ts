// Firebase + Google OAuth config for sync (docs/SETUP_FIREBASE.md). Read from the
// git-ignored firebase.config.json in the data folder (or next to the app in
// firebase/ during development), or CHRONOS_FIREBASE_* environment variables.
// Absent or incomplete = the app runs local-only, signed out.

import fs from 'node:fs';
import path from 'node:path';

export interface FirebaseConfig {
  apiKey: string;
  authDomain: string;
  projectId: string;
  appId: string;
  /** Google Cloud OAuth client of type "Desktop app" (its secret is not confidential for installed apps). */
  googleClientId: string;
  googleClientSecret: string;
}

const KEYS = ['apiKey', 'authDomain', 'projectId', 'appId', 'googleClientId', 'googleClientSecret'] as const;

export function readFirebaseConfig(dirs: string | string[], env: NodeJS.ProcessEnv = process.env): FirebaseConfig | null {
  let file: Record<string, unknown> = {};
  for (const dir of Array.isArray(dirs) ? dirs : [dirs]) {
    try {
      file = JSON.parse(fs.readFileSync(path.join(dir, 'firebase.config.json'), 'utf8'));
      break;
    } catch {
      // absent is normal: local-only
    }
  }
  const cfg = Object.fromEntries(KEYS.map((k) => [k, env[`CHRONOS_FIREBASE_${k.replace(/[A-Z]/g, (c) => `_${c}`).toUpperCase()}`] ?? file[k]]));
  return KEYS.every((k) => typeof cfg[k] === 'string' && cfg[k]) ? (cfg as unknown as FirebaseConfig) : null;
}
