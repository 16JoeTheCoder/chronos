// The stdio bridge's link to the running app: read port + token from
// device.json, POST the call to 127.0.0.1. Any failure to reach Chronos becomes
// one clear message. Node only (no Electron), bundled into dist/chronos-mcp.js.

import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';

export const NOT_RUNNING = 'Chronos is not running. Open Chronos and try again.';
export const DISABLED = 'The Claude integration is off. Turn it on in Chronos: Settings, Integrations.';

export type CallResult = { ok: true; result: unknown } | { ok: false; error: string };

/** %APPDATA%\Chronos on Windows (CHRONOS_USER_DATA overrides, like the app). */
export function dataDir(env: NodeJS.ProcessEnv = process.env): string {
  if (env.CHRONOS_USER_DATA) return env.CHRONOS_USER_DATA;
  if (env.APPDATA) return path.join(env.APPDATA, 'Chronos');
  return path.join(os.homedir(), process.platform === 'darwin' ? 'Library/Application Support' : '.config', 'Chronos');
}

export function readEndpoint(dir: string): { port: number; token: string; enabled: boolean } | null {
  try {
    const dev = JSON.parse(fs.readFileSync(path.join(dir, 'device.json'), 'utf8')) as { mcp?: { port?: unknown; token?: unknown; enabled?: unknown } };
    const m = dev.mcp;
    if (!m || typeof m.port !== 'number' || typeof m.token !== 'string') return null;
    return { port: m.port, token: m.token, enabled: m.enabled === true };
  } catch {
    return null;
  }
}

export function post(port: number, token: string, body: unknown, timeoutMs = 15_000): Promise<CallResult> {
  return new Promise((resolve) => {
    const data = Buffer.from(JSON.stringify(body));
    const req = http.request({ host: '127.0.0.1', port, path: '/call', method: 'POST', headers: { 'content-type': 'application/json', 'content-length': data.length, authorization: `Bearer ${token}` }, timeout: timeoutMs }, (res) => {
      const chunks: Buffer[] = [];
      res.on('data', (c: Buffer) => chunks.push(c));
      res.on('end', () => {
        try {
          const r = JSON.parse(Buffer.concat(chunks).toString('utf8')) as CallResult;
          resolve(typeof r === 'object' && r !== null && 'ok' in r ? r : { ok: false, error: 'Chronos sent an unexpected reply.' });
        } catch {
          resolve({ ok: false, error: 'Chronos sent an unexpected reply.' });
        }
      });
    });
    req.on('timeout', () => req.destroy(new Error('timeout')));
    req.on('error', () => resolve({ ok: false, error: NOT_RUNNING }));
    req.end(data);
  });
}

export async function callChronos(tool: string, args: unknown, dir = dataDir()): Promise<CallResult> {
  const ep = readEndpoint(dir);
  if (!ep) return { ok: false, error: NOT_RUNNING };
  if (!ep.enabled) return { ok: false, error: DISABLED };
  if (!ep.port) return { ok: false, error: NOT_RUNNING };
  return post(ep.port, ep.token, { tool, args });
}
