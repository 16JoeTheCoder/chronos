// Production build: esbuild bundles main and preload to CommonJS (dist/main.js,
// dist/preload.js); Vite builds the renderer into dist/renderer.
import { build as esbuild } from 'esbuild';
import { build as vite } from 'vite';
import { rmSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

export const nodeBundles = [
  { entryPoints: ['src/main/main.ts'], outfile: 'dist/main.js' },
  { entryPoints: ['src/preload/preload.ts'], outfile: 'dist/preload.js' },
].map((b) => ({ ...b, bundle: true, platform: 'node', format: 'cjs', target: 'node20', external: ['electron'], sourcemap: false, logLevel: 'warning' }));

// Run only when invoked directly (dev.mjs imports nodeBundles from here).
if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  rmSync('dist', { recursive: true, force: true });
  for (const b of nodeBundles) await esbuild({ ...b, minify: true });
  await vite({ configFile: 'vite.config.mts', logLevel: 'warn' });
  console.log('-> built dist/main.js, dist/preload.js, dist/renderer/');
}
