// The stdio bridge's client: endpoint discovery and every way a call can fail to reach Chronos.
import fs from 'node:fs';
import http from 'node:http';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DISABLED, NOT_RUNNING, callChronos, dataDir, post, readEndpoint } from '../../src/bridge/client';

let dir: string;
beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'chronos-bridge-'));
});
afterEach(() => {
  vi.unstubAllEnvs();
  fs.rmSync(dir, { recursive: true, force: true });
});

const writeDevice = (mcp: unknown) => fs.writeFileSync(path.join(dir, 'device.json'), JSON.stringify({ deviceId: 'd', mcp }));

/** A port nothing listens on: bind a socket, note its port, close it. */
async function closedPort(): Promise<number> {
  const s = net.createServer();
  await new Promise<void>((r) => s.listen(0, '127.0.0.1', r));
  const port = (s.address() as net.AddressInfo).port;
  await new Promise<void>((r) => s.close(() => r()));
  return port;
}

describe('messages', () => {
  it('are the exact strings the bridge shows Claude', () => {
    expect(NOT_RUNNING).toBe('Chronos is not running. Open Chronos and try again.');
    expect(DISABLED).toBe('The Claude integration is off. Turn it on in Chronos: Settings, Integrations.');
  });
});

describe('dataDir', () => {
  it('honours CHRONOS_USER_DATA first', () => {
    expect(dataDir({ CHRONOS_USER_DATA: '/tmp/custom', APPDATA: '/tmp/appdata' })).toBe('/tmp/custom');
  });
  it('uses %APPDATA%\\Chronos next', () => {
    expect(dataDir({ APPDATA: '/tmp/appdata' })).toBe(path.join('/tmp/appdata', 'Chronos'));
  });
  it('falls back to a Chronos folder in the home directory', () => {
    const d = dataDir({});
    expect(path.basename(d)).toBe('Chronos');
    expect(d.startsWith(os.homedir())).toBe(true);
  });
  it('reads process.env by default', () => {
    vi.stubEnv('CHRONOS_USER_DATA', dir);
    expect(dataDir()).toBe(dir);
  });
});

describe('readEndpoint', () => {
  it('reads port, token and enabled from device.json', () => {
    writeDevice({ enabled: true, port: 51234, token: 'secret' });
    expect(readEndpoint(dir)).toEqual({ port: 51234, token: 'secret', enabled: true });
  });
  it('enabled is true only for the boolean true', () => {
    writeDevice({ enabled: 'yes', port: 1, token: 't' });
    expect(readEndpoint(dir)?.enabled).toBe(false);
    writeDevice({ port: 1, token: 't' });
    expect(readEndpoint(dir)?.enabled).toBe(false);
  });
  it('is null when the file is missing, unreadable JSON, or has no usable mcp block', () => {
    expect(readEndpoint(dir)).toBeNull();
    fs.writeFileSync(path.join(dir, 'device.json'), '{ not json');
    expect(readEndpoint(dir)).toBeNull();
    fs.writeFileSync(path.join(dir, 'device.json'), JSON.stringify({ deviceId: 'd' }));
    expect(readEndpoint(dir)).toBeNull();
    writeDevice({ enabled: true, port: '51234', token: 't' });
    expect(readEndpoint(dir)).toBeNull();
    writeDevice({ enabled: true, port: 1, token: 5 });
    expect(readEndpoint(dir)).toBeNull();
    writeDevice(null);
    expect(readEndpoint(dir)).toBeNull();
  });
  it('does not exist for a missing directory', () => {
    expect(readEndpoint(path.join(dir, 'nope'))).toBeNull();
  });
});

describe('callChronos', () => {
  it('returns exactly NOT_RUNNING when device.json is missing', async () => {
    expect(await callChronos('get_day', {}, dir)).toEqual({ ok: false, error: NOT_RUNNING });
  });

  it('returns NOT_RUNNING when device.json is corrupt or has no port yet', async () => {
    fs.writeFileSync(path.join(dir, 'device.json'), 'garbage');
    expect(await callChronos('get_day', {}, dir)).toEqual({ ok: false, error: NOT_RUNNING });
    writeDevice({ enabled: true, port: 0, token: 't' });
    expect(await callChronos('get_day', {}, dir)).toEqual({ ok: false, error: NOT_RUNNING });
  });

  it('returns exactly NOT_RUNNING when nothing listens on the saved port', async () => {
    writeDevice({ enabled: true, port: await closedPort(), token: 'secret' });
    expect(await callChronos('get_day', {}, dir)).toEqual({ ok: false, error: NOT_RUNNING });
  });

  it('returns exactly DISABLED when mcp.enabled is false', async () => {
    writeDevice({ enabled: false, port: await closedPort(), token: 'secret' });
    expect(await callChronos('get_day', {}, dir)).toEqual({ ok: false, error: DISABLED });
  });

  it('does not contact the server while disabled', async () => {
    let hits = 0;
    const server = http.createServer((_req, res) => {
      hits++;
      res.end('{"ok":true,"result":1}');
    });
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
    writeDevice({ enabled: false, port: (server.address() as net.AddressInfo).port, token: 't' });
    expect(await callChronos('get_day', {}, dir)).toEqual({ ok: false, error: DISABLED });
    expect(hits).toBe(0);
    await new Promise<void>((r) => server.close(() => r()));
  });

  // Regression (fixed, D-126): a fresh install has mcp {enabled:false, port:0}; with port 0 the bridge says "not running" even though Chronos is running with the integration off (src/bridge/client.ts:56 checks `!ep.port` before `enabled`)
  it('says DISABLED (not NOT_RUNNING) for the default device.json with the integration off', async () => {
    writeDevice({ enabled: false, port: 0, token: '' });
    expect(await callChronos('get_day', {}, dir)).toEqual({ ok: false, error: DISABLED });
  });

  it('uses CHRONOS_USER_DATA when no directory is passed', async () => {
    vi.stubEnv('CHRONOS_USER_DATA', dir);
    expect(await callChronos('get_day', {})).toEqual({ ok: false, error: NOT_RUNNING });
    writeDevice({ enabled: false, port: await closedPort(), token: 't' });
    expect(await callChronos('get_day', {})).toEqual({ ok: false, error: DISABLED });
  });
});

describe('post', () => {
  const serve = async (handler: http.RequestListener) => {
    const server = http.createServer(handler);
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
    return { port: (server.address() as net.AddressInfo).port, close: () => new Promise<void>((r) => server.close(() => r())) };
  };

  it('sends tool and args as JSON with the bearer token and returns the reply', async () => {
    let seen: { auth?: string; method?: string; url?: string; body?: unknown } = {};
    const s = await serve((req, res) => {
      const chunks: Buffer[] = [];
      req.on('data', (c: Buffer) => chunks.push(c));
      req.on('end', () => {
        seen = { auth: req.headers.authorization, method: req.method, url: req.url, body: JSON.parse(Buffer.concat(chunks).toString()) };
        res.end(JSON.stringify({ ok: true, result: { hello: 'world' } }));
      });
    });
    expect(await post(s.port, 'tok', { tool: 'get_day', args: { date: '2026-10-26' } })).toEqual({ ok: true, result: { hello: 'world' } });
    expect(seen).toEqual({ auth: 'Bearer tok', method: 'POST', url: '/call', body: { tool: 'get_day', args: { date: '2026-10-26' } } });
    await s.close();
  });

  it('turns an unparsable or unexpected reply into one clear message', async () => {
    const html = await serve((_req, res) => res.end('<html>proxy</html>'));
    expect(await post(html.port, 't', {})).toEqual({ ok: false, error: 'Chronos sent an unexpected reply.' });
    await html.close();
    const odd = await serve((_req, res) => res.end('[1,2,3]'));
    expect(await post(odd.port, 't', {})).toEqual({ ok: false, error: 'Chronos sent an unexpected reply.' });
    await odd.close();
    const nul = await serve((_req, res) => res.end('null'));
    expect(await post(nul.port, 't', {})).toEqual({ ok: false, error: 'Chronos sent an unexpected reply.' });
    await nul.close();
  });

  it('a server that hangs up becomes NOT_RUNNING', async () => {
    const s = await serve((req) => req.socket.destroy());
    expect(await post(s.port, 't', {})).toEqual({ ok: false, error: NOT_RUNNING });
    await s.close();
  });

  it('a server that never answers times out as NOT_RUNNING', async () => {
    const s = await serve(() => {
      /* never respond */
    });
    expect(await post(s.port, 't', {}, 150)).toEqual({ ok: false, error: NOT_RUNNING });
    await s.close();
  });
});
