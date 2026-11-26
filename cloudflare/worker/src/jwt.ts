// Firebase ID token verification (RS256) with WebCrypto only. Pure: no Workers-specific APIs.

const JWKS_URL = 'https://www.googleapis.com/service_accounts/v1/jwk/securetoken@system.gserviceaccount.com';
const JWKS_TTL_MS = 60 * 60 * 1000;

interface Jwk {
  kid: string;
  kty: string;
  alg?: string;
  n: string;
  e: string;
}

let cache: { keys: Jwk[]; at: number } | null = null;

export function b64urlToBytes(s: string): Uint8Array {
  const b = atob(s.replace(/-/g, '+').replace(/_/g, '/').padEnd(Math.ceil(s.length / 4) * 4, '='));
  return Uint8Array.from(b, (c) => c.charCodeAt(0));
}

async function jwks(force: boolean, fetcher: typeof fetch): Promise<Jwk[]> {
  if (!force && cache && Date.now() - cache.at < JWKS_TTL_MS) return cache.keys;
  const res = await fetcher(JWKS_URL);
  if (!res.ok) throw new Error(`jwks ${res.status}`);
  const body = (await res.json()) as { keys?: Jwk[] };
  if (!body.keys?.length) throw new Error('jwks empty');
  cache = { keys: body.keys, at: Date.now() };
  return cache.keys;
}

/** Test hook. */
export function resetJwksCache(): void {
  cache = null;
}

/** Returns the uid (sub) of a valid Firebase ID token for `projectId`, or throws. */
export async function verifyFirebaseToken(token: string, projectId: string, opts: { fetcher?: typeof fetch; now?: number } = {}): Promise<string> {
  const fetcher = opts.fetcher ?? fetch;
  const parts = token.split('.');
  if (parts.length !== 3) throw new Error('malformed');
  const [h, p, s] = parts as [string, string, string];
  const dec = new TextDecoder();
  const header = JSON.parse(dec.decode(b64urlToBytes(h))) as { alg?: string; kid?: string };
  if (header.alg !== 'RS256' || !header.kid) throw new Error('bad header');

  let key = (await jwks(false, fetcher)).find((k) => k.kid === header.kid);
  if (!key) key = (await jwks(true, fetcher)).find((k) => k.kid === header.kid); // key rotation
  if (!key) throw new Error('unknown kid');

  const cryptoKey = await crypto.subtle.importKey('jwk', { kty: key.kty, n: key.n, e: key.e, alg: 'RS256', ext: true }, { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['verify']);
  const ok = await crypto.subtle.verify('RSASSA-PKCS1-v1_5', cryptoKey, b64urlToBytes(s), new TextEncoder().encode(`${h}.${p}`));
  if (!ok) throw new Error('bad signature');

  const c = JSON.parse(dec.decode(b64urlToBytes(p))) as { iss?: string; aud?: string; exp?: number; iat?: number; sub?: string };
  const now = Math.floor((opts.now ?? Date.now()) / 1000);
  if (c.iss !== `https://securetoken.google.com/${projectId}`) throw new Error('bad iss');
  if (c.aud !== projectId) throw new Error('bad aud');
  if (typeof c.exp !== 'number' || c.exp <= now) throw new Error('expired');
  if (typeof c.iat === 'number' && c.iat > now + 300) throw new Error('issued in future');
  if (typeof c.sub !== 'string' || !c.sub) throw new Error('no sub');
  return c.sub;
}
