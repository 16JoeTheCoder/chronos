// Sign-in state and the sync lifecycle in main (no Firebase import here: the SDK
// lives in dist/sync.js, loaded only when firebase.config.json is complete, so the
// app runs offline and signed out with no config at all).
//
// States the UI sees: off (no config) · signedOut · whatever the engine reports.
// Revoked/expired sign-in drops to signedOut; local data and the outbox stay.

import type { Controller } from '../controller';
import type { FirebaseConfig } from '../config';
import type { Remote } from './remote';

export interface Crypto {
  available(): boolean;
  encrypt(s: string): string;
  decrypt(b64: string): string;
}

type RemoteModule = { createRemote(cfg: FirebaseConfig): Remote; AuthError: new (...a: never[]) => Error & { kind: string } };

export class SyncManager {
  private remote: Remote | null = null;
  signedIn = false;
  busy = false;
  lastError: string | null = null;
  private retryAt = 0;

  constructor(
    private controller: Controller,
    private cfg: FirebaseConfig | null,
    private load: () => RemoteModule,
    private crypto: Crypto,
    private openExternal: (url: string) => Promise<void>,
    private log: (m: string) => void,
    private changed: () => void,
  ) {}

  get configured(): boolean {
    return this.cfg !== null;
  }

  private ensureRemote(): Remote | null {
    if (!this.cfg) return null;
    if (!this.remote) {
      try {
        this.remote = this.load().createRemote(this.cfg);
      } catch (e) {
        this.lastError = `Sync could not load: ${String(e)}`;
        this.log(this.lastError);
        return null;
      }
    }
    return this.remote;
  }

  /** At launch: sign in silently if we have a stored token. Offline = stay local, retry later. */
  async resume(): Promise<void> {
    const enc = this.controller.device.auth.refreshTokenEnc;
    if (!enc || this.signedIn || this.busy) return;
    const remote = this.ensureRemote();
    if (!remote || !this.crypto.available()) return;
    this.busy = true;
    try {
      const who = await remote.silent(this.crypto.decrypt(enc));
      this.begin(remote, who.uid, who.email);
    } catch (e) {
      this.fail(e, 'silent');
    } finally {
      this.busy = false;
      this.changed();
    }
  }

  /** The 30 s tick: retry a silent sign-in that failed because we were offline. */
  tick(now: number): void {
    if (!this.signedIn && !this.busy && this.controller.device.auth.refreshTokenEnc && now >= this.retryAt) {
      this.retryAt = now + 60_000;
      void this.resume();
    }
  }

  async signIn(): Promise<{ ok: true } | { ok: false; error: string }> {
    const remote = this.ensureRemote();
    if (!remote) return { ok: false, error: this.lastError ?? 'Sync is not set up on this PC (docs/SETUP_FIREBASE.md).' };
    if (this.busy) return { ok: false, error: 'Already signing in.' };
    this.busy = true;
    this.changed();
    try {
      const who = await remote.signIn(this.openExternal);
      const refreshTokenEnc = who.refreshToken && this.crypto.available() ? this.crypto.encrypt(who.refreshToken) : null;
      this.controller.setDeviceFields({ auth: { refreshTokenEnc, email: who.email, uid: who.uid } });
      this.begin(remote, who.uid, who.email);
      return { ok: true };
    } catch (e) {
      this.fail(e, 'interactive');
      return { ok: false, error: this.lastError ?? 'Sign-in failed.' };
    } finally {
      this.busy = false;
      this.changed();
    }
  }

  async signOut(): Promise<void> {
    this.controller.stopSync();
    this.signedIn = false;
    await this.remote?.signOut();
    // Keep sync.uid: signing in again as the same account does not re-upload.
    this.controller.setDeviceFields({ auth: { refreshTokenEnc: null, email: null, uid: null } });
    this.log('sync: signed out');
    this.changed();
  }

  private begin(remote: Remote, uid: string, email: string | null): void {
    this.signedIn = true;
    this.lastError = null;
    if (this.controller.device.auth.email !== email || this.controller.device.auth.uid !== uid) this.controller.setDeviceFields({ auth: { ...this.controller.device.auth, email, uid } });
    this.controller.startSync(remote.provider(uid, this.controller.device.deviceId), uid);
    this.log(`sync: signed in (${email ?? uid})`);
  }

  private fail(e: unknown, how: string): void {
    const kind = (e as { kind?: string }).kind;
    this.lastError = e instanceof Error ? e.message : String(e);
    this.log(`sync: ${how} sign-in failed (${kind ?? 'error'}): ${this.lastError}`);
    if (kind === 'revoked') {
      this.controller.stopSync();
      this.signedIn = false;
      this.controller.setDeviceFields({ auth: { refreshTokenEnc: null, email: null, uid: null } });
    }
  }
}
