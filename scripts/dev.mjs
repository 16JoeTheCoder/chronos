// Development: Vite dev server for the renderer (hot reload), esbuild in watch
// mode for main/preload, and Electron pointed at the dev server. Restart
// Electron manually (Ctrl+C, npm run dev) after changing main-process code.
import { context } from 'esbuild';
import { createServer } from 'vite';
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { nodeBundles } from './build.mjs';

const server = await createServer({ configFile: 'vite.config.mts' });
await server.listen();
const url = `http://localhost:${server.config.server.port}/`;

for (const b of nodeBundles) {
  const ctx = await context({ ...b, sourcemap: 'inline' });
  await ctx.rebuild();
  await ctx.watch();
}

const electron = createRequire(import.meta.url)('electron');
const child = spawn(electron, ['.'], { stdio: 'inherit', env: { ...process.env, CHRONOS_DEV_URL: url } });
child.on('exit', (code) => {
  void server.close();
  process.exit(code ?? 0);
});
