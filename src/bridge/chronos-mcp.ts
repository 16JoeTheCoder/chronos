// dist/chronos-mcp.js: the stdio MCP server Claude Desktop launches. It lists the
// Chronos tools (always, even when the app is closed) and forwards each call to
// the running app's local endpoint.

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import { TOOLS } from '../core/mcp/tools';
import { callChronos } from './client';

const server = new Server({ name: 'chronos', version: '1.0.0' }, { capabilities: { tools: {} } });

server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: TOOLS.map((t) => ({ name: t.name, description: t.description, inputSchema: t.inputSchema as unknown as { type: 'object'; properties?: Record<string, object> } })),
}));

server.setRequestHandler(CallToolRequestSchema, async (req) => {
  const r = await callChronos(req.params.name, req.params.arguments ?? {});
  return r.ok ? { content: [{ type: 'text' as const, text: JSON.stringify(r.result) }] } : { content: [{ type: 'text' as const, text: r.error }], isError: true };
});

void server.connect(new StdioServerTransport());
