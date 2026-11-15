// Production build: esbuild bundles main and preload to CommonJS (dist/main.js,
// dist/preload.js), the Firebase-backed sync module main loads on demand
// (dist/sync.js), the quick-add parser with chrono-node main loads on demand for MCP add_task
// `text` (dist/parser.js), and the stdio MCP bridge Claude Desktop runs (dist/chronos-mcp.js);
// Vite builds the renderer into dist/renderer.
import { build as esbuild } from 'esbuild';
import { build as vite } from 'vite';
import { rmSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

export const nodeBundles = [
  { entryPoints: ['src/main/main.ts'], outfile: 'dist/main.js' },
  { entryPoints: ['src/preload/preload.ts'], outfile: 'dist/preload.js' },
  { entryPoints: ['src/main/sync/remote.ts'], outfile: 'dist/sync.js' },
  { entryPoints: ['src/core/parser/index.ts'], outfile: 'dist/parser.js' },
  { entryPoints: ['src/bridge/chronos-mcp.ts'], outfile: 'dist/chronos-mcp.js' },
].map((b) => ({ ...b, bundle: true, platform: 'node', format: 'cjs', target: 'node20', external: ['electron', 'koffi'], sourcemap: false, logLevel: 'warning' }));

// Run only when invoked directly (dev.mjs imports nodeBundles from here).
if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  rmSync('dist', { recursive: true, force: true });
  for (const b of nodeBundles) await esbuild({ ...b, minify: true });
  await vite({ configFile: 'vite.config.mts', logLevel: 'warn' });
  console.log('-> built dist/main.js, dist/preload.js, dist/renderer/');
}
