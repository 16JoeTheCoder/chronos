// Cloud file storage client (Cloudflare Worker + R2, cloudflare/SETUP.md). Runs in main: the
// renderer never makes network requests. Each call carries the signed-in user's Firebase ID token.
// Object ids are the attachment ids; `area` keeps Cache files (which expire) apart from Log files.

export type FileArea = 'log' | 'cache';
export type FileGet = { ok: true; bytes: Uint8Array; mime: string } | { ok: false; error: string };
type Res = { ok: true } | { ok: false; error: string };

export const FILE_ID_RE = /^[A-Za-z0-9_-]{8,64}$/;
export const isFileArea = (v: unknown): v is FileArea => v === 'log' || v === 'cache';

export interface FilesService {
  put(area: FileArea, id: string, name: string, mime: string, bytes: Uint8Array): Promise<Res>;
  get(area: FileArea, id: string): Promise<FileGet>;
  remove(area: FileArea, id: string): Promise<Res>;
}

export function createFilesService(cfg: { url: () => string | null; token: () => Promise<string | null>; fetchFn?: typeof fetch; maxBytes: number }): FilesService {
  const f = cfg.fetchFn ?? fetch;
  async function call(method: string, area: FileArea, id: string, init: { headers?: Record<string, string>; body?: Uint8Array } = {}): Promise<Response | { error: string }> {
    const base = cfg.url();
    if (!base) return { error: 'File storage is not set up (cloudflare/SETUP.md).' };
    if (!FILE_ID_RE.test(id)) return { error: 'Bad file id.' };
    const token = await cfg.token();
    if (!token) return { error: 'Sign in to use file storage.' };
    try {
      return await f(`${base.replace(/\/$/, '')}/files/${area}/${id}`, { method, headers: { Authorization: `Bearer ${token}`, ...init.headers }, body: init.body as BodyInit | undefined, signal: AbortSignal.timeout(120_000) });
    } catch {
      return { error: 'Could not reach file storage. Check the connection.' };
    }
  }
  const failed = async (r: Response): Promise<string> => {
    try {
      const j = (await r.json()) as { error?: string };
      if (j.error) return j.error;
    } catch {
      /* not JSON */
    }
    return `File storage answered ${r.status}.`;
  };
  return {
    async put(area, id, name, mime, bytes) {
      if (bytes.byteLength > cfg.maxBytes) return { ok: false, error: 'That file is too large (25 MB at most).' };
      const r = await call('PUT', area, id, { headers: { 'Content-Type': mime || 'application/octet-stream', 'X-Name': encodeURIComponent(name) }, body: bytes });
      if ('error' in r) return { ok: false, error: r.error };
      return r.ok ? { ok: true } : { ok: false, error: await failed(r) };
    },
    async get(area, id) {
      const r = await call('GET', area, id);
      if ('error' in r) return { ok: false, error: r.error };
      if (!r.ok) return { ok: false, error: r.status === 404 ? 'That file is gone (Cache files expire).' : await failed(r) };
      return { ok: true, bytes: new Uint8Array(await r.arrayBuffer()), mime: r.headers.get('Content-Type') ?? 'application/octet-stream' };
    },
    async remove(area, id) {
      const r = await call('DELETE', area, id);
      if ('error' in r) return { ok: false, error: r.error };
      return r.ok || r.status === 404 ? { ok: true } : { ok: false, error: await failed(r) };
    },
  };
}
