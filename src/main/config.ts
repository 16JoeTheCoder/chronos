// Firebase config for v1.1 sync (§10.3). Read from the git-ignored
// firebase.config.json in the data folder, or CHRONOS_FIREBASE_* environment
// variables. v1 only reports whether it is present; nothing connects.

import fs from 'node:fs';
import path from 'node:path';

export interface FirebaseConfig {
  apiKey: string;
  authDomain: string;
  projectId: string;
  appId: string;
}

const KEYS = ['apiKey', 'authDomain', 'projectId', 'appId'] as const;

export function readFirebaseConfig(dir: string, env: NodeJS.ProcessEnv = process.env): FirebaseConfig | null {
  let file: Record<string, unknown> = {};
  try {
    file = JSON.parse(fs.readFileSync(path.join(dir, 'firebase.config.json'), 'utf8'));
  } catch {
    // absent is normal in v1
  }
  const cfg = Object.fromEntries(KEYS.map((k) => [k, env[`CHRONOS_FIREBASE_${k.replace(/[A-Z]/g, (c) => `_${c}`).toUpperCase()}`] ?? file[k]]));
  return KEYS.every((k) => typeof cfg[k] === 'string' && cfg[k]) ? (cfg as unknown as FirebaseConfig) : null;
}
