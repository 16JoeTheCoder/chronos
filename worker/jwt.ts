// Firebase ID token verification (RS256) with WebCrypto only, adapted from
// cloudflare/worker/src/jwt.ts. Google's public keys are cached in module memory for the
// max-age Google sends; an unknown kid forces one refetch (key rotation).

export const JWKS_URL = 'https://www.googleapis.com/service_accounts/v1/jwk/securetoken@system.gserviceaccount.com';
const DEFAULT_TTL_S = 3600;
const CLOCK_SKEW_S = 300;

export interface Jwk {
  kid: string;
  kty: string;
  alg?: string;
  n: string;
  e: string;
}

export interface VerifyOptions {
  /** Injected in tests; defaults to global fetch. */
  fetcher?: typeof fetch;
  /** Epoch ms; defaults to Date.now(). */
  now?: number;
}

let cache: { keys: Jwk[]; expires: number } | null = null;

/** Test hook. */
export function resetJwksCache(): void {
  cache = null;
}

export function b64urlToBytes(s: string): Uint8Array<ArrayBuffer> {
  const bin = atob(s.replace(/-/g, '+').replace(/_/g, '/').padEnd(Math.ceil(s.length / 4) * 4, '='));
  return Uint8Array.from(bin, (c) => c.charCodeAt(0));
}

function maxAge(res: Response): number {
  const m = /max-age=(\d+)/.exec(res.headers.get('cache-control') ?? '');
  return m ? Number(m[1]) : DEFAULT_TTL_S;
}

async function jwks(force: boolean, fetcher: typeof fetch, nowMs: number): Promise<Jwk[]> {
  if (!force && cache && nowMs < cache.expires) return cache.keys;
  const res = await fetcher(JWKS_URL);
  if (!res.ok) throw new Error(`jwks ${res.status}`);
  const body = (await res.json()) as { keys?: Jwk[] };
  if (!body.keys?.length) throw new Error('jwks empty');
  cache = { keys: body.keys, expires: nowMs + maxAge(res) * 1000 };
  return cache.keys;
}

function parseJson<T>(b64: string): T {
  try {
    return JSON.parse(new TextDecoder().decode(b64urlToBytes(b64))) as T;
  } catch {
    throw new Error('malformed');
  }
}

/** Returns the uid (`sub`) of a valid Firebase ID token for `projectId`, or throws. */
export async function verifyFirebaseToken(token: string, projectId: string, opts: VerifyOptions = {}): Promise<string> {
  const fetcher = opts.fetcher ?? fetch;
  const nowMs = opts.now ?? Date.now();
  const parts = token.split('.');
  if (parts.length !== 3) throw new Error('malformed');
  const [h, p, s] = parts as [string, string, string];
  const header = parseJson<{ alg?: string; kid?: string }>(h);
  const claims = parseJson<{ iss?: string; aud?: string; exp?: number; iat?: number; auth_time?: number; sub?: string }>(p);
  if (header.alg !== 'RS256' || !header.kid) throw new Error('bad header');

  let key = (await jwks(false, fetcher, nowMs)).find((k) => k.kid === header.kid);
  if (!key) key = (await jwks(true, fetcher, nowMs)).find((k) => k.kid === header.kid);
  if (!key) throw new Error('unknown kid');

  const cryptoKey = await crypto.subtle.importKey('jwk', { kty: key.kty, n: key.n, e: key.e, alg: 'RS256', ext: true }, { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['verify']);
  const ok = await crypto.subtle.verify('RSASSA-PKCS1-v1_5', cryptoKey, b64urlToBytes(s), new TextEncoder().encode(`${h}.${p}`));
  if (!ok) throw new Error('bad signature');

  const now = Math.floor(nowMs / 1000);
  if (claims.iss !== `https://securetoken.google.com/${projectId}`) throw new Error('bad iss');
  if (claims.aud !== projectId) throw new Error('bad aud');
  if (typeof claims.exp !== 'number' || claims.exp <= now) throw new Error('expired');
  if (typeof claims.iat !== 'number' || claims.iat > now + CLOCK_SKEW_S) throw new Error('bad iat');
  if (typeof claims.auth_time === 'number' && claims.auth_time > now + CLOCK_SKEW_S) throw new Error('bad auth_time');
  if (typeof claims.sub !== 'string' || !claims.sub) throw new Error('no sub');
  return claims.sub;
}
