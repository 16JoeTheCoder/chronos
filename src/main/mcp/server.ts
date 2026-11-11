// The local MCP endpoint (docs/MCP.md): HTTP on 127.0.0.1 only, a random free port
// (persisted in device.json) and a random bearer token. The stdio bridge that
// Claude Desktop launches forwards tool calls here; the handlers live in core/mcp.

import crypto from 'node:crypto';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import type { Mcp } from '../../core/mcp/handlers';

export const MAX_BODY = 1_000_000;

export const newToken = (): string => crypto.randomBytes(24).toString('hex');

const LOOPBACK = new Set(['127.0.0.1', '::1', '::ffff:127.0.0.1']);

export function tokenMatches(header: string | undefined, token: string): boolean {
  const got = Buffer.from(header?.startsWith('Bearer ') ? header.slice(7) : '');
  const want = Buffer.from(token);
  return token.length > 0 && got.length === want.length && crypto.timingSafeEqual(got, want);
}

export class McpServer {
  private server: http.Server | null = null;
  port = 0;
  error: string | null = null;

  constructor(private mcp: () => Mcp, private log: (m: string) => void) {}

  get running(): boolean {
    return this.server !== null;
  }

  /** Listen on 127.0.0.1:port (0 = any free port). Resolves with the port actually used. */
  async start(port: number, token: () => string): Promise<number> {
    await this.stop();
    const server = http.createServer((req, res) => this.handle(req, res, token()));
    const listen = (p: number) =>
      new Promise<number>((resolve, reject) => {
        server.once('error', reject);
        server.listen(p, '127.0.0.1', () => {
          server.off('error', reject);
          resolve((server.address() as AddressInfo).port);
        });
      });
    try {
      this.port = await listen(port).catch((e) => {
        // The saved port is taken (another app): pick a new free one.
        if (port !== 0 && (e as NodeJS.ErrnoException).code === 'EADDRINUSE') return listen(0);
        throw e;
      });
      this.server = server;
      this.error = null;
      this.log(`mcp: listening on 127.0.0.1:${this.port}`);
      return this.port;
    } catch (e) {
      this.error = `Could not start: ${String(e)}`;
      this.log(`mcp: ${this.error}`);
      throw e;
    }
  }

  async stop(): Promise<void> {
    const s = this.server;
    this.server = null;
    if (s) await new Promise<void>((r) => s.close(() => r()));
  }

  private handle(req: http.IncomingMessage, res: http.ServerResponse, token: string): void {
    const reply = (status: number, body: unknown) => {
      res.writeHead(status, { 'content-type': 'application/json' });
      res.end(JSON.stringify(body));
    };
    if (!LOOPBACK.has(req.socket.remoteAddress ?? '')) return reply(403, { ok: false, error: 'Loopback only.' });
    if (!tokenMatches(req.headers.authorization, token)) return reply(401, { ok: false, error: 'Bad token. Copy the Claude Desktop config from Chronos again.' });
    if (req.method === 'GET' && req.url === '/health') return reply(200, { ok: true });
    if (req.method !== 'POST' || req.url !== '/call') return reply(404, { ok: false, error: 'Not found.' });
    let size = 0;
    const chunks: Buffer[] = [];
    // Over the cap: keep reading but drop the bytes, then answer 413. Destroying the
    // socket mid-upload makes Windows reset it before the client reads the reply.
    req.on('data', (c: Buffer) => {
      size += c.length;
      if (size <= MAX_BODY) chunks.push(c);
      else chunks.length = 0;
    });
    req.on('end', () => {
      if (size > MAX_BODY) {
        res.setHeader('connection', 'close');
        return reply(413, { ok: false, error: 'Request too large.' });
      }
      let body: { tool?: unknown; args?: unknown };
      try {
        body = JSON.parse(Buffer.concat(chunks).toString('utf8'));
      } catch {
        return reply(400, { ok: false, error: 'Invalid JSON.' });
      }
      if (typeof body.tool !== 'string') return reply(400, { ok: false, error: 'Missing tool.' });
      const r = this.mcp().call(body.tool, body.args ?? {});
      if (!r.ok) this.log(`mcp: ${body.tool} refused: ${r.error}`);
      reply(200, r);
    });
  }
}
