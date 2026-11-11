// Google sign-in for a desktop app (docs/SETUP_FIREBASE.md): the system browser,
// a loopback redirect on 127.0.0.1:<random port>, PKCE, then the Google ID token
// signs in to Firebase with signInWithCredential. The Google refresh token is kept
// encrypted (Electron safeStorage) so a restart signs in silently.

import crypto from 'node:crypto';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { GoogleAuthProvider, signInWithCredential, signOut, type Auth } from 'firebase/auth';

export interface GoogleClient {
  clientId: string;
  clientSecret: string;
}

export interface SignedIn {
  uid: string;
  email: string | null;
  refreshToken: string | null;
}

export class AuthError extends Error {
  constructor(message: string, readonly kind: 'cancelled' | 'revoked' | 'offline' | 'config' | 'failed') {
    super(message);
  }
}

const AUTH_URL = 'https://accounts.google.com/o/oauth2/v2/auth';
const TOKEN_URL = 'https://oauth2.googleapis.com/token';
export const SIGN_IN_TIMEOUT_MS = 3 * 60_000;
const b64url = (b: Buffer) => b.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

async function token(params: Record<string, string>): Promise<{ id_token?: string; refresh_token?: string; error?: string }> {
  let res: Response;
  try {
    res = await fetch(TOKEN_URL, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams(params).toString() });
  } catch (e) {
    throw new AuthError(`Could not reach Google: ${String(e)}`, 'offline');
  }
  const body = (await res.json().catch(() => ({}))) as { id_token?: string; refresh_token?: string; error?: string };
  if (!res.ok) {
    if (body.error === 'invalid_grant') throw new AuthError('Your Google sign-in expired or was revoked. Sign in again.', 'revoked');
    throw new AuthError(`Google refused the sign-in (${body.error ?? res.status}).`, 'failed');
  }
  return body;
}

async function firebaseSignIn(auth: Auth, idToken: string, refreshToken: string | null): Promise<SignedIn> {
  try {
    const cred = await signInWithCredential(auth, GoogleAuthProvider.credential(idToken));
    return { uid: cred.user.uid, email: cred.user.email, refreshToken };
  } catch (e) {
    const code = (e as { code?: string }).code ?? '';
    if (code.includes('network')) throw new AuthError('Offline: could not reach Firebase.', 'offline');
    throw new AuthError(`Firebase refused the sign-in (${code || String(e)}).`, 'failed');
  }
}

/** Interactive sign-in through the system browser. */
export async function signInInteractive(auth: Auth, client: GoogleClient, openExternal: (url: string) => Promise<void>, timeoutMs = SIGN_IN_TIMEOUT_MS): Promise<SignedIn> {
  const verifier = b64url(crypto.randomBytes(32));
  const challenge = b64url(crypto.createHash('sha256').update(verifier).digest());
  const state = b64url(crypto.randomBytes(16));
  const server = http.createServer();
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const redirect = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  try {
    const code = await new Promise<string>((resolve, reject) => {
      const timer = setTimeout(() => reject(new AuthError('Sign-in timed out. The browser was closed or nothing was chosen.', 'cancelled')), timeoutMs);
      server.on('request', (req, res) => {
        const url = new URL(req.url ?? '/', redirect);
        const done = (ok: boolean, text: string) => {
          res.writeHead(ok ? 200 : 400, { 'content-type': 'text/html; charset=utf-8' });
          res.end(`<!doctype html><meta charset="utf-8"><title>Chronos</title><body style="font:16px system-ui;background:#0D0E10;color:#F3F2EE;padding:48px"><p>${text}</p></body>`);
        };
        if (url.searchParams.get('state') !== state) return done(false, 'This sign-in link is not from Chronos.');
        clearTimeout(timer);
        const err = url.searchParams.get('error');
        const c = url.searchParams.get('code');
        if (err || !c) {
          done(false, 'Sign-in was cancelled. You can close this tab.');
          reject(new AuthError(err === 'access_denied' ? 'Sign-in was cancelled.' : `Sign-in failed (${err ?? 'no code'}).`, 'cancelled'));
          return;
        }
        done(true, 'Signed in to Chronos. You can close this tab.');
        resolve(c);
      });
      const q = new URLSearchParams({ client_id: client.clientId, redirect_uri: redirect, response_type: 'code', scope: 'openid email profile', code_challenge: challenge, code_challenge_method: 'S256', state, access_type: 'offline', prompt: 'consent' });
      openExternal(`${AUTH_URL}?${q}`).catch((e) => reject(new AuthError(`Could not open the browser: ${String(e)}`, 'failed')));
    });
    const t = await token({ code, client_id: client.clientId, client_secret: client.clientSecret, redirect_uri: redirect, grant_type: 'authorization_code', code_verifier: verifier });
    if (!t.id_token) throw new AuthError('Google returned no ID token.', 'failed');
    return await firebaseSignIn(auth, t.id_token, t.refresh_token ?? null);
  } finally {
    server.close();
  }
}

/** Restart: a fresh Google ID token from the stored refresh token, then Firebase. */
export async function signInSilently(auth: Auth, client: GoogleClient, refreshToken: string): Promise<SignedIn> {
  const t = await token({ refresh_token: refreshToken, client_id: client.clientId, client_secret: client.clientSecret, grant_type: 'refresh_token' });
  if (!t.id_token) throw new AuthError('Google returned no ID token.', 'failed');
  return firebaseSignIn(auth, t.id_token, refreshToken);
}

export async function signOutFirebase(auth: Auth): Promise<void> {
  await signOut(auth).catch(() => undefined);
}
