// The local MCP endpoint: a real McpServer on 127.0.0.1, driven through the bridge client.
import fs from 'node:fs';
import http from 'node:http';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { callChronos, post } from '../../src/bridge/client';
import { apply, type Command } from '../../src/core/commands';
import { Mcp, type StorePort } from '../../src/core/mcp/handlers';
import type { Data } from '../../src/core/model/types';
import { live } from '../../src/core/repo/repo';
import { MAX_BODY, McpServer, newToken, tokenMatches } from '../../src/main/mcp/server';
import { addTask, ctx, fresh, T0 } from '../helpers';

let dir: string;
let server: McpServer;
let state: { d: Data };
let logs: string[];
let token = 'right-token-0123456789';

function makeMcp(): Mcp {
  const port: StorePort = {
    data: () => state.d,
    now: () => T0,
    run: (cmd: Command) => {
      const r = apply(state.d, cmd, ctx(T0, 'mcp'));
      if (!r.ok) return { ok: false, error: r.error, fields: r.fields };
      state.d = r.d;
      return { ok: true, id: r.id };
    },
  };
  return new Mcp(port);
}

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'chronos-mcpsrv-'));
  state = { d: addTask(fresh(), 'Existing task', { finishCondition: 'Existing is done' }).d };
  logs = [];
  token = 'right-token-0123456789';
  const mcp = makeMcp();
  server = new McpServer(() => mcp, (m) => logs.push(m));
});
afterEach(async () => {
  await server.stop();
  fs.rmSync(dir, { recursive: true, force: true });
});

const writeDevice = (port: number, enabled = true, tok = token) => fs.writeFileSync(path.join(dir, 'device.json'), JSON.stringify({ mcp: { enabled, port, token: tok } }));

/** Raw request, so status codes are visible. */
function raw(port: number, opts: { method?: string; path?: string; auth?: string | null; body?: string | Buffer }): Promise<{ status: number; json: unknown }> {
  return new Promise((resolve, reject) => {
    const body = opts.body === undefined ? undefined : Buffer.from(opts.body);
    const headers: Record<string, string | number> = {};
    if (opts.auth !== null) headers.authorization = opts.auth ?? `Bearer ${token}`;
    if (body) {
      headers['content-type'] = 'application/json';
      headers['content-length'] = body.length;
    }
    const req = http.request({ host: '127.0.0.1', port, path: opts.path ?? '/call', method: opts.method ?? 'POST', headers }, (res) => {
      const chunks: Buffer[] = [];
      res.on('data', (c: Buffer) => chunks.push(c));
      res.on('end', () => {
        const text = Buffer.concat(chunks).toString();
        let json: unknown = text;
        try {
          json = JSON.parse(text);
        } catch {
          /* leave as text */
        }
        resolve({ status: res.statusCode ?? 0, json });
      });
    });
    req.on('error', reject);
    req.end(body);
  });
}

describe('tokenMatches', () => {
  it('accepts exactly "Bearer <token>"', () => {
    expect(tokenMatches('Bearer abc123', 'abc123')).toBe(true);
    expect(tokenMatches(`Bearer ${token}`, token)).toBe(true);
  });
  it('rejects wrong, missing and malformed tokens', () => {
    expect(tokenMatches('Bearer abc124', 'abc123')).toBe(false);
    expect(tokenMatches('Bearer abc12', 'abc123')).toBe(false); // shorter
    expect(tokenMatches('Bearer abc1234', 'abc123')).toBe(false); // longer
    expect(tokenMatches('abc123', 'abc123')).toBe(false); // no scheme
    expect(tokenMatches('Basic abc123', 'abc123')).toBe(false);
    expect(tokenMatches('bearer abc123', 'abc123')).toBe(false);
    expect(tokenMatches('Bearer  abc123', 'abc123')).toBe(false);
    expect(tokenMatches('Bearer abc123 ', 'abc123')).toBe(false);
    expect(tokenMatches('Bearer ABC123', 'abc123')).toBe(false);
    expect(tokenMatches(undefined, 'abc123')).toBe(false);
    expect(tokenMatches('', 'abc123')).toBe(false);
  });
  it('never matches an empty configured token', () => {
    expect(tokenMatches('Bearer ', '')).toBe(false);
    expect(tokenMatches('', '')).toBe(false);
    expect(tokenMatches(undefined, '')).toBe(false);
  });
  it('newToken is 48 hex chars and different every time', () => {
    const a = newToken();
    expect(a).toMatch(/^[0-9a-f]{48}$/);
    expect(newToken()).not.toBe(a);
  });
});

describe('start / stop', () => {
  it('start(0) picks a free port, reports running, and logs it', async () => {
    expect(server.running).toBe(false);
    const port = await server.start(0, () => token);
    expect(port).toBeGreaterThan(0);
    expect(server.port).toBe(port);
    expect(server.running).toBe(true);
    expect(server.error).toBeNull();
    expect(logs.some((l) => l.includes(String(port)))).toBe(true);
  });

  it('stop() closes the listener; the bridge then reports NOT_RUNNING', async () => {
    const port = await server.start(0, () => token);
    writeDevice(port);
    expect((await callChronos('list_projects', {}, dir)).ok).toBe(true);
    await server.stop();
    expect(server.running).toBe(false);
    expect(await callChronos('list_projects', {}, dir)).toEqual({ ok: false, error: 'Chronos is not running. Open Chronos and try again.' });
    await server.stop(); // idempotent
  });

  it('can be restarted, and start() while running replaces the old listener', async () => {
    const p1 = await server.start(0, () => token);
    const p2 = await server.start(0, () => token);
    expect(server.running).toBe(true);
    expect((await raw(p2, { method: 'GET', path: '/health' })).status).toBe(200);
    if (p1 !== p2) await expect(raw(p1, { method: 'GET', path: '/health' })).rejects.toThrow();
  });

  it('falls back to another free port when the saved port is taken', async () => {
    const blocker = net.createServer();
    await new Promise<void>((r) => blocker.listen(0, '127.0.0.1', r));
    const taken = (blocker.address() as net.AddressInfo).port;
    const port = await server.start(taken, () => token);
    expect(port).not.toBe(taken);
    expect(port).toBeGreaterThan(0);
    expect((await raw(port, { method: 'GET', path: '/health' })).status).toBe(200);
    await new Promise<void>((r) => blocker.close(() => r()));
  });
});

describe('end to end through callChronos', () => {
  it('a read call with the right token returns the tool result', async () => {
    const port = await server.start(0, () => token);
    writeDevice(port);
    const r = await callChronos('list_tasks', {}, dir);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.result).toMatchObject({ total: 1, tasks: [expect.objectContaining({ title: 'Existing task' })] });
  });

  it('a write call changes the data and returns an undoToken', async () => {
    const port = await server.start(0, () => token);
    writeDevice(port);
    const r = await callChronos('add_task', { title: 'From Claude Desktop', finishCondition: 'It shows up in Chronos' }, dir);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect((r.result as { undoToken: string }).undoToken).toBeTruthy();
    expect(live(state.d, 'tasks').map((t) => t.title).sort()).toEqual(['Existing task', 'From Claude Desktop']);
    expect(live(state.d, 'tasks').find((t) => t.title === 'From Claude Desktop')?.source).toBe('claude');
    const undone = await callChronos('undo', { undoToken: (r.result as { undoToken: string }).undoToken }, dir);
    expect(undone.ok).toBe(true);
    expect(live(state.d, 'tasks')).toHaveLength(1);
  });

  it('tool errors come back as ok:false with the reason (HTTP 200), and are logged', async () => {
    const port = await server.start(0, () => token);
    writeDevice(port);
    const r = await callChronos('get_task', { id: 'missing' }, dir);
    expect(r).toEqual({ ok: false, error: 'No task with that id.' });
    expect(await callChronos('add_task', { title: 'x', nope: 1 }, dir)).toEqual({ ok: false, error: expect.stringMatching(/Invalid input/) });
    expect(await callChronos('no_such_tool', {}, dir)).toEqual({ ok: false, error: 'Unknown tool no_such_tool.' });
    expect(logs.some((l) => l.includes('get_task refused'))).toBe(true);
  });

  it('the disabled flag stops the bridge before it talks to the server', async () => {
    const port = await server.start(0, () => token);
    writeDevice(port, false);
    expect(await callChronos('list_tasks', {}, dir)).toEqual({ ok: false, error: 'The Claude integration is off. Turn it on in Chronos: Settings, Integrations.' });
  });
});

describe('authentication', () => {
  it('a wrong token gets 401 and ok:false; nothing runs', async () => {
    const port = await server.start(0, () => token);
    const bad = await post(port, 'wrong-token', { tool: 'add_task', args: { title: 'sneaky' } });
    expect(bad).toEqual({ ok: false, error: expect.stringMatching(/Bad token/) });
    const r = await raw(port, { auth: 'Bearer wrong-token', body: JSON.stringify({ tool: 'add_task', args: { title: 'sneaky' } }) });
    expect(r.status).toBe(401);
    expect(live(state.d, 'tasks')).toHaveLength(1);
  });

  it('a missing or malformed Authorization header gets 401, including on /health', async () => {
    const port = await server.start(0, () => token);
    for (const auth of [null, '', 'Bearer', token, `Basic ${token}`]) {
      expect((await raw(port, { auth, body: '{"tool":"get_day"}' })).status, String(auth)).toBe(401);
    }
    expect((await raw(port, { method: 'GET', path: '/health', auth: null })).status).toBe(401);
    expect((await raw(port, { method: 'GET', path: '/nope', auth: null })).status).toBe(401);
  });

  it('the token is read on every request, so regenerating it takes effect at once', async () => {
    const port = await server.start(0, () => token);
    writeDevice(port);
    expect((await callChronos('list_tasks', {}, dir)).ok).toBe(true);
    token = 'regenerated-token-987654';
    expect(await callChronos('list_tasks', {}, dir)).toEqual({ ok: false, error: expect.stringMatching(/Bad token/) });
    writeDevice(port, true, token);
    expect((await callChronos('list_tasks', {}, dir)).ok).toBe(true);
  });

  it('an empty configured token authenticates nobody', async () => {
    const port = await server.start(0, () => '');
    expect((await raw(port, { auth: 'Bearer ', body: '{"tool":"get_day"}' })).status).toBe(401);
    expect((await raw(port, { auth: '', body: '{"tool":"get_day"}' })).status).toBe(401);
  });
});

describe('routes and bodies', () => {
  it('GET /health is 200 with the token', async () => {
    const port = await server.start(0, () => token);
    expect(await raw(port, { method: 'GET', path: '/health' })).toEqual({ status: 200, json: { ok: true } });
  });

  it('other paths and methods are 404', async () => {
    const port = await server.start(0, () => token);
    expect((await raw(port, { method: 'GET', path: '/call' })).status).toBe(404);
    expect((await raw(port, { method: 'POST', path: '/other', body: '{}' })).status).toBe(404);
    expect((await raw(port, { method: 'DELETE', path: '/call' })).status).toBe(404);
    expect((await raw(port, { method: 'GET', path: '/' })).status).toBe(404);
  });

  it('bad JSON and a missing tool are 400', async () => {
    const port = await server.start(0, () => token);
    expect(await raw(port, { body: '{ not json' })).toEqual({ status: 400, json: { ok: false, error: 'Invalid JSON.' } });
    expect(await raw(port, { body: '{"args":{}}' })).toEqual({ status: 400, json: { ok: false, error: 'Missing tool.' } });
    expect(await raw(port, { body: '{"tool":5}' })).toEqual({ status: 400, json: { ok: false, error: 'Missing tool.' } });
  });

  it('missing args default to {}', async () => {
    const port = await server.start(0, () => token);
    const r = await raw(port, { body: '{"tool":"list_projects"}' });
    expect(r.status).toBe(200);
    expect(r.json).toMatchObject({ ok: true });
  });

  it('a body over the size cap is refused with 413 (never a reset, which Windows surfaced) and nothing runs', async () => {
    const port = await server.start(0, () => token);
    const big = JSON.stringify({ tool: 'add_note', args: { body: 'x'.repeat(MAX_BODY + 10) } });
    expect((await raw(port, { body: big })).status).toBe(413);
    expect(live(state.d, 'ideas')).toHaveLength(0);
    // the server is still healthy afterwards
    expect((await raw(port, { method: 'GET', path: '/health' })).status).toBe(200);
  });
});
