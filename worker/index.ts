// chronos-web: static assets (the web app) plus a tiny API. wrangler.jsonc sends only /api/* here
// (run_worker_first), every other path is served straight from the assets with SPA fallback.
// Phase 4 ships /api/health; the Ramble and MCP routes are authenticated stubs for Phase 4.5.
import pkg from '../package.json';
import { verifyFirebaseToken, type VerifyOptions } from './jwt';

// Minimal local types so this file also type-checks under the root tsconfig (no workers-types there).
export interface Env {
  ASSETS: { fetch(request: Request): Promise<Response> };
  FIREBASE_PROJECT_ID: string;
  NVIDIA_API_KEY?: string;
}

const JSON_HEADERS = { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' };

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: JSON_HEADERS });
}

export async function handle(request: Request, env: Env, verify: VerifyOptions = {}): Promise<Response> {
  const path = new URL(request.url).pathname.replace(/\/+$/, '') || '/';

  if (path !== '/api' && !path.startsWith('/api/')) return env.ASSETS.fetch(request);

  if (path === '/api/health') {
    if (request.method !== 'GET' && request.method !== 'HEAD') return json({ error: 'method not allowed' }, 405);
    return json({ ok: true, version: pkg.version });
  }

  if (path === '/api/ramble' || path.startsWith('/api/ramble/') || path === '/api/mcp' || path.startsWith('/api/mcp/')) {
    const m = /^Bearer (.+)$/.exec(request.headers.get('authorization') ?? '');
    if (!m) return json({ error: 'unauthorized' }, 401);
    try {
      await verifyFirebaseToken(m[1] as string, env.FIREBASE_PROJECT_ID, verify);
    } catch {
      return json({ error: 'unauthorized' }, 401);
    }
    return json({ error: 'not implemented (Phase 4.5)' }, 501);
  }

  return json({ error: 'not found' }, 404);
}

export default {
  fetch: (request: Request, env: Env): Promise<Response> => handle(request, env),
};
