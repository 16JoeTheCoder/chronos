import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { handle, type Env } from '../../worker/index';
import { JWKS_URL, resetJwksCache, verifyFirebaseToken } from '../../worker/jwt';

const PROJECT = 'chronos-jy';
const NOW = 1_800_000_000_000;
const sec = Math.floor(NOW / 1000);

function b64u(data: Uint8Array | string): string {
  const bytes = typeof data === 'string' ? new TextEncoder().encode(data) : data;
  let s = '';
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

let pair: CryptoKeyPair;
let otherPair: CryptoKeyPair;
let jwk: JsonWebKey;

function genPair(): Promise<CryptoKeyPair> {
  return crypto.subtle.generateKey({ name: 'RSASSA-PKCS1-v1_5', modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256' }, true, ['sign', 'verify']) as Promise<CryptoKeyPair>;
}

async function sign(claims: Record<string, unknown>, opts: { kid?: string; alg?: string; key?: CryptoKey } = {}): Promise<string> {
  const h = b64u(JSON.stringify({ alg: opts.alg ?? 'RS256', kid: opts.kid ?? 'k1', typ: 'JWT' }));
  const p = b64u(JSON.stringify(claims));
  const sig = await crypto.subtle.sign('RSASSA-PKCS1-v1_5', opts.key ?? pair.privateKey, new TextEncoder().encode(`${h}.${p}`));
  return `${h}.${p}.${b64u(new Uint8Array(sig))}`;
}

const good = (over: Record<string, unknown> = {}) => ({ iss: `https://securetoken.google.com/${PROJECT}`, aud: PROJECT, sub: 'uid-1', iat: sec - 10, auth_time: sec - 10, exp: sec + 3600, ...over });

let fetches = 0;
function fetcher(cacheControl = 'public, max-age=600'): typeof fetch {
  return (async (input: RequestInfo | URL) => {
    expect(String(input)).toBe(JWKS_URL);
    fetches++;
    return new Response(JSON.stringify({ keys: [{ ...jwk, kid: 'k1', alg: 'RS256', use: 'sig' }] }), { status: 200, headers: { 'cache-control': cacheControl } });
  }) as typeof fetch;
}

beforeAll(async () => {
  pair = await genPair();
  otherPair = await genPair();
  jwk = await crypto.subtle.exportKey('jwk', pair.publicKey);
});
beforeEach(() => {
  resetJwksCache();
  fetches = 0;
});

describe('verifyFirebaseToken', () => {
  const v = (token: string, f = fetcher(), now = NOW) => verifyFirebaseToken(token, PROJECT, { fetcher: f, now });

  it('accepts a valid token and returns sub', async () => {
    expect(await v(await sign(good()))).toBe('uid-1');
  });
  it('rejects wrong iss, aud, expired, future iat, missing sub', async () => {
    await expect(v(await sign(good({ iss: 'https://securetoken.google.com/other' })))).rejects.toThrow('bad iss');
    await expect(v(await sign(good({ aud: 'other' })))).rejects.toThrow('bad aud');
    await expect(v(await sign(good({ exp: sec - 1 })))).rejects.toThrow('expired');
    await expect(v(await sign(good({ iat: sec + 3600 })))).rejects.toThrow('bad iat');
    await expect(v(await sign(good({ sub: '' })))).rejects.toThrow('no sub');
  });
  it('rejects bad signature, wrong alg, malformed, unknown kid', async () => {
    await expect(v(await sign(good(), { key: otherPair.privateKey }))).rejects.toThrow('bad signature');
    await expect(v(await sign(good(), { alg: 'HS256' }))).rejects.toThrow('bad header');
    await expect(v('abc')).rejects.toThrow('malformed');
    await expect(v('a.b.c')).rejects.toThrow('malformed');
    await expect(v(await sign(good(), { kid: 'nope' }))).rejects.toThrow('unknown kid');
  });
  it('caches keys for max-age, then refetches', async () => {
    const t = await sign(good());
    const f = fetcher('public, max-age=600');
    await v(t, f);
    await v(t, f);
    expect(fetches).toBe(1);
    await v(t, f, NOW + 601_000).catch(() => {});
    expect(fetches).toBe(2);
  });
  it('refetches once when the kid is unknown (key rotation)', async () => {
    const t = await sign(good(), { kid: 'k2' });
    let call = 0;
    const f = (async () => {
      call++;
      const kids = call === 1 ? ['k1'] : ['k1', 'k2'];
      return new Response(JSON.stringify({ keys: kids.map((kid) => ({ ...jwk, kid })) }), { status: 200 });
    }) as typeof fetch;
    expect(await v(t, f)).toBe('uid-1');
    expect(call).toBe(2);
  });
  it('fails when the key endpoint fails', async () => {
    const f = (async () => new Response('x', { status: 500 })) as typeof fetch;
    await expect(v(await sign(good()), f)).rejects.toThrow('jwks 500');
  });
});

describe('worker routes', () => {
  const env: Env = { FIREBASE_PROJECT_ID: PROJECT, ASSETS: { fetch: async () => new Response('asset', { status: 200 }) } };
  const call = (path: string, init: RequestInit = {}) => handle(new Request(`https://chronos.example${path}`, init), env, { fetcher: fetcher(), now: NOW });

  it('health is public JSON with a version', async () => {
    const res = await call('/api/health');
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('application/json');
    const body = (await res.json()) as { ok: boolean; version: string };
    expect(body.ok).toBe(true);
    expect(body.version).toMatch(/^\d+\.\d+\.\d+/);
  });
  it('health rejects POST', async () => {
    expect((await call('/api/health', { method: 'POST' })).status).toBe(405);
  });
  it.each(['/api/ramble', '/api/ramble/x', '/api/mcp/tools'])('%s needs a token (401)', async (p) => {
    expect((await call(p)).status).toBe(401);
    expect((await call(p, { headers: { authorization: 'Bearer junk' } })).status).toBe(401);
    expect((await call(p, { headers: { authorization: 'Basic abc' } })).status).toBe(401);
  });
  it.each(['/api/ramble', '/api/ramble/x', '/api/mcp/tools'])('%s with a valid token is 501', async (p) => {
    const token = await sign(good());
    const res = await call(p, { method: 'POST', headers: { authorization: `Bearer ${token}` } });
    expect(res.status).toBe(501);
    expect(await res.json()).toEqual({ error: 'not implemented (Phase 4.5)' });
  });
  it('other /api paths are 404 without needing a token', async () => {
    expect((await call('/api/nope')).status).toBe(404);
    expect((await call('/api')).status).toBe(404);
  });
  it('non-api paths go to assets', async () => {
    expect(await (await call('/anything')).text()).toBe('asset');
  });
});
