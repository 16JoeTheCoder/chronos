// Cache items, attachments on posts and cache items, and the cloud file client.
import { describe, expect, it, vi } from 'vitest';
import { apply } from '../../src/core/commands';
import { ATTACH_INLINE_MAX_CHARS, CACHE_TTL_MS, type Attachment } from '../../src/core/model/types';
import { live } from '../../src/core/repo/repo';
import { recycled } from '../../src/core/repo/recycle';
import { recordProblem } from '../../src/core/validation';
import { createFilesService } from '../../src/main/files';
import { ctx, fresh, run, T0 } from '../helpers';

const att = (o: Partial<Attachment> = {}): Attachment => ({ id: 'a1b2c3d4-e5f6', name: 'shot.png', mime: 'image/png', size: 10, cloud: true, data: null, ...o });

describe('cache commands', () => {
  it('adds an item that expires in 3 days, and rejects an empty one', () => {
    expect(apply(fresh(), { type: 'cache.add', body: '   ' }, ctx()).ok).toBe(false);
    const { d, id } = run(fresh(), { type: 'cache.add', body: ' npm run build ' });
    const it = d.cache[id]!;
    expect(it.body).toBe('npm run build');
    expect(it.expiresAt).toBe(T0 + CACHE_TTL_MS);
    expect(recordProblem('cache', it)).toBeNull();
  });

  it('a files-only item is fine; remove and clear tombstone, and the recycle bin never lists cache', () => {
    let { d, id } = run(fresh(), { type: 'cache.add', body: '', files: [att()] });
    d = run(d, { type: 'cache.add', body: 'two' }).d;
    expect(live(d, 'cache')).toHaveLength(2);
    d = run(d, { type: 'cache.remove', id }).d;
    expect(live(d, 'cache')).toHaveLength(1);
    d = run(d, { type: 'cache.clear' }).d;
    expect(live(d, 'cache')).toHaveLength(0);
    expect(recycled(d).filter((r) => r.coll === 'cache')).toHaveLength(0);
  });
});

describe('attachments', () => {
  it('a post can carry files, and no text is needed', () => {
    const { d, id } = run(fresh(), { type: 'idea.add', text: '', taskId: null, files: [att()] });
    expect(d.ideas[id]!.files).toHaveLength(1);
    expect(recordProblem('ideas', d.ideas[id])).toBeNull();
  });

  it('rejects an inline file over the budget, a cloud file with data, and a non-data url', () => {
    const big = att({ cloud: false, data: `data:image/png;base64,${'A'.repeat(ATTACH_INLINE_MAX_CHARS)}` });
    expect(apply(fresh(), { type: 'cache.add', body: 'x', files: [big] }, ctx()).ok).toBe(false);
    expect(apply(fresh(), { type: 'cache.add', body: 'x', files: [att({ cloud: true, data: 'data:x,1' })] }, ctx()).ok).toBe(false);
    expect(apply(fresh(), { type: 'cache.add', body: 'x', files: [att({ cloud: false, data: 'http://evil' })] }, ctx()).ok).toBe(false);
    expect(apply(fresh(), { type: 'cache.add', body: 'x', files: [att({ cloud: false, data: 'data:text/plain,hi' })] }, ctx()).ok).toBe(true);
  });
});

describe('cloud file client', () => {
  const ok = (body = 'x', init: ResponseInit = {}) => new Response(body, { status: 200, ...init });
  const svc = (fetchFn: typeof fetch, token: string | null = 'tok', url: string | null = 'https://w.example.dev/') => createFilesService({ url: () => url, token: async () => token, fetchFn, maxBytes: 100 });

  it('sends the token, name and bytes to /files/<area>/<id>', async () => {
    const f = vi.fn(async () => ok('{"key":"k"}'));
    const r = await svc(f as unknown as typeof fetch).put('cache', 'abcd1234efgh', 'my file.png', 'image/png', new Uint8Array(4));
    expect(r.ok).toBe(true);
    const [url, init] = f.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('https://w.example.dev/files/cache/abcd1234efgh');
    expect(init.method).toBe('PUT');
    expect((init.headers as Record<string, string>).Authorization).toBe('Bearer tok');
    expect((init.headers as Record<string, string>)['X-Name']).toBe('my%20file.png');
  });

  it('refuses without a token, without a Worker, over the size limit, or on a bad id; says so when a file is gone', async () => {
    const f = vi.fn(async () => new Response('{"error":"nope"}', { status: 404 }));
    expect((await svc(f as unknown as typeof fetch, null).get('log', 'abcd1234efgh')).ok).toBe(false);
    expect((await svc(f as unknown as typeof fetch, 'tok', null).get('log', 'abcd1234efgh')).ok).toBe(false);
    expect((await svc(f as unknown as typeof fetch).put('log', 'abcd1234efgh', 'a', 'x/y', new Uint8Array(101))).ok).toBe(false);
    expect((await svc(f as unknown as typeof fetch).get('log', '../etc')).ok).toBe(false);
    expect(f).not.toHaveBeenCalled();
    const g = await svc(f as unknown as typeof fetch).get('cache', 'abcd1234efgh');
    expect(g.ok === false && /gone|expire/.test(g.error)).toBe(true);
  });

  it('a network failure is a plain message, never a throw', async () => {
    const f = vi.fn(async () => { throw new TypeError('fetch failed'); });
    const r = await svc(f as unknown as typeof fetch).remove('log', 'abcd1234efgh');
    expect(r.ok).toBe(false);
  });
});
