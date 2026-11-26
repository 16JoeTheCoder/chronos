// Chronos file storage: a Cloudflare Worker in front of R2. Every request carries a Firebase ID token;
// the object key is always <uid>/<area>/<id>, with uid taken from the verified token, never the URL.

import { verifyFirebaseToken } from './jwt';

interface Env {
  FILES: R2Bucket;
  FIREBASE_PROJECT_ID: string;
  ALLOWED_UID?: string;
  ALLOWED_ORIGINS?: string;
}

const MAX_BYTES = 25 * 1024 * 1024;
const ROUTE = /^\/files\/(cache|log)\/([A-Za-z0-9_-]{8,64})$/;

const list = (v?: string): string[] => (v ?? '').split(',').map((s) => s.trim()).filter(Boolean);

function corsHeaders(req: Request, env: Env): Headers {
  const h = new Headers();
  const origin = req.headers.get('Origin');
  if (origin && list(env.ALLOWED_ORIGINS).includes(origin)) {
    h.set('Access-Control-Allow-Origin', origin);
    h.set('Vary', 'Origin');
  }
  return h;
}

function json(body: unknown, status: number, base: Headers): Response {
  const h = new Headers(base);
  h.set('Content-Type', 'application/json');
  return new Response(JSON.stringify(body), { status, headers: h });
}

function safeName(raw: string | null): string {
  let n = '';
  try {
    n = decodeURIComponent(raw ?? '');
  } catch {
    n = '';
  }
  n = n.replace(/[\u0000-\u001f\u007f/\\]/g, '_').slice(0, 200);
  return n || 'file';
}

export default {
  async fetch(req: Request, env: Env): Promise<Response> {
    const cors = corsHeaders(req, env);
    const origin = req.headers.get('Origin');
    if (origin && !cors.has('Access-Control-Allow-Origin')) {
      // Browser request from an unlisted origin. (No Origin header = desktop app, always allowed.)
      return json({ error: 'origin not allowed' }, 403, cors);
    }

    if (req.method === 'OPTIONS') {
      cors.set('Access-Control-Allow-Methods', 'GET, PUT, DELETE, OPTIONS');
      cors.set('Access-Control-Allow-Headers', 'Authorization, Content-Type, X-Name');
      cors.set('Access-Control-Max-Age', '86400');
      return new Response(null, { status: 204, headers: cors });
    }

    const m = ROUTE.exec(new URL(req.url).pathname);
    if (!m) return json({ error: 'not found' }, 404, cors);
    const [, area, id] = m as unknown as [string, string, string];

    const auth = req.headers.get('Authorization') ?? '';
    const token = /^Bearer (.+)$/.exec(auth)?.[1];
    if (!token) return json({ error: 'missing token' }, 401, cors);
    let uid: string;
    try {
      uid = await verifyFirebaseToken(token, env.FIREBASE_PROJECT_ID);
    } catch {
      return json({ error: 'invalid token' }, 401, cors);
    }
    const only = list(env.ALLOWED_UID);
    if (only.length && !only.includes(uid)) return json({ error: 'forbidden' }, 403, cors);

    const key = `${uid}/${area}/${id}`;

    if (req.method === 'PUT') {
      const declared = req.headers.get('Content-Length');
      if (declared === null || !/^\d+$/.test(declared)) return json({ error: 'content-length required' }, 411, cors);
      if (Number(declared) > MAX_BYTES) return json({ error: 'file too large (max 25 MB)' }, 413, cors);
      const body = await req.arrayBuffer();
      if (body.byteLength > MAX_BYTES) return json({ error: 'file too large (max 25 MB)' }, 413, cors);
      const contentType = req.headers.get('Content-Type') ?? 'application/octet-stream';
      await env.FILES.put(key, body, {
        httpMetadata: { contentType },
        customMetadata: { name: encodeURIComponent(safeName(req.headers.get('X-Name'))), contentType },
      });
      return json({ key, size: body.byteLength }, 200, cors);
    }

    if (req.method === 'GET') {
      const obj = await env.FILES.get(key);
      if (!obj) return json({ error: 'not found' }, 404, cors);
      const h = new Headers(cors);
      h.set('Content-Type', obj.customMetadata?.contentType || obj.httpMetadata?.contentType || 'application/octet-stream');
      h.set('Content-Disposition', `inline; filename*=UTF-8''${encodeURIComponent(safeName(decodeURIComponent(obj.customMetadata?.name ?? 'file')))}`);
      h.set('Cache-Control', 'private, max-age=3600');
      h.set('X-Content-Type-Options', 'nosniff');
      h.set('Content-Length', String(obj.size));
      return new Response(obj.body, { status: 200, headers: h });
    }

    if (req.method === 'DELETE') {
      await env.FILES.delete(key);
      return new Response(null, { status: 204, headers: cors });
    }

    return json({ error: 'method not allowed' }, 405, cors);
  },
};
