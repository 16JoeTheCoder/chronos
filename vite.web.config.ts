// Vite config for the web build (chronos.josefyang.com): one page, src/renderer/web.html, into
// dist-web/. `npm run build:web` (scripts/build-web.mjs) runs this, renames web.html to index.html
// and builds the service worker next to it. The desktop renderer keeps vite.config.mts.
import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import { cpSync, existsSync, mkdirSync, readFileSync, rmSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';

const repo = fileURLToPath(new URL('.', import.meta.url));
const version = (JSON.parse(readFileSync(join(repo, 'package.json'), 'utf8')) as { version: string }).version;

// Vite has one publicDir. The web build needs the renderer's own public files (boot.js, launch.css,
// tokens.css) and the web-only ones (manifest, icons, _headers, register-sw.js), so stage a merge.
function stagePublic(): string {
  const staged = join(repo, 'node_modules', '.cache', 'chronos-web-public');
  rmSync(staged, { recursive: true, force: true });
  mkdirSync(staged, { recursive: true });
  for (const dir of ['src/renderer/public', 'public-web']) if (existsSync(join(repo, dir))) cpSync(join(repo, dir), staged, { recursive: true });
  return staged;
}

// Production CSP. Firebase sign-in (popup) needs apis.google.com for scripts and the firebaseapp /
// accounts.google.com frames; sync needs the Google APIs; the files and API Workers live on workers.dev.
const CSP = [
  "default-src 'self'",
  "script-src 'self' https://apis.google.com",
  "style-src 'self'",
  "img-src 'self' data: blob:",
  "font-src 'self'",
  "connect-src 'self' https://*.googleapis.com https://*.firebaseio.com https://firestore.googleapis.com https://identitytoolkit.googleapis.com https://securetoken.googleapis.com https://*.workers.dev",
  'frame-src https://*.firebaseapp.com https://accounts.google.com',
  "worker-src 'self'",
  "manifest-src 'self'",
  "object-src 'none'",
  "base-uri 'none'",
].join('; ');

const web: Plugin = {
  name: 'chronos-web',
  transformIndexHtml(html, ctx) {
    return html.replace('<!--CSP-->', ctx.server ? '' : `<meta http-equiv="Content-Security-Policy" content="${CSP}" />`);
  },
  configureServer(server) {
    // The only page is web.html: serve it for / and for client-side routes.
    server.middlewares.use((req, _res, next) => {
      const url = req.url ?? '/';
      const path = url.split('?')[0] ?? '/';
      if (req.method === 'GET' && !/\.[a-z0-9]+$/i.test(path) && !path.startsWith('/@') && !path.startsWith('/api/')) req.url = '/web.html' + url.slice(path.length);
      next();
    });
  },
};

// Firebase stays out of the entry chunk: split into its own chunks, which only load when the page
// dynamically imports them (the web bridge does that on sign-in / sync).
function manualChunks(id: string): string | undefined {
  if (!/node_modules[\\/](@firebase|firebase|idb)[\\/]/.test(id)) return undefined;
  if (/[\\/]@firebase[\\/]auth[\\/]|[\\/]firebase[\\/]auth[\\/]/.test(id)) return 'firebase-auth';
  if (/[\\/]@firebase[\\/]firestore[\\/]|[\\/]firebase[\\/]firestore[\\/]/.test(id)) return 'firebase-firestore';
  return 'firebase';
}

export default defineConfig({
  root: 'src/renderer',
  base: '/',
  envDir: repo,
  publicDir: stagePublic(),
  plugins: [react(), web],
  define: { 'import.meta.env.VITE_APP_VERSION': JSON.stringify(version) },
  build: {
    outDir: join(repo, 'dist-web'),
    emptyOutDir: true,
    target: ['es2020', 'safari15'],
    assetsInlineLimit: 0,
    rollupOptions: { input: { web: join(repo, 'src/renderer/web.html') }, output: { manualChunks } },
  },
  server: { port: 5174, strictPort: true, fs: { allow: [repo] } },
  preview: { port: 4174 },
});
