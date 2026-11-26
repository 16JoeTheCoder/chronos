// Web build: Vite builds src/renderer/web.html into dist-web/ (vite.web.config.ts), the page is
// renamed index.html, then esbuild bundles src/sw.ts to dist-web/sw.js with the list of built files
// injected (precache) and a version derived from their names and the entry page.
import { build as esbuild } from 'esbuild';
import { build as vite } from 'vite';
import { createHash } from 'node:crypto';
import { readdirSync, readFileSync, renameSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

const OUT = 'dist-web';
const SKIP = new Set(['sw.js', '_headers']);

function walk(dir) {
  return readdirSync(dir).flatMap((n) => {
    const p = join(dir, n);
    return statSync(p).isDirectory() ? walk(p) : [p];
  });
}

await vite({ configFile: 'vite.web.config.ts', logLevel: 'warn' });
renameSync(join(OUT, 'web.html'), join(OUT, 'index.html'));

const files = walk(OUT)
  .map((p) => relative(OUT, p).split('\\').join('/'))
  .filter((f) => !SKIP.has(f) && !f.endsWith('.map') && !f.endsWith('.woff'))
  .sort();
// "/" is the shell (the Worker serves index.html there; /index.html would redirect).
const precache = files.map((f) => (f === 'index.html' ? '/' : '/' + f));
const version = createHash('sha1').update(precache.join('\n')).update(readFileSync(join(OUT, 'index.html'))).digest('hex').slice(0, 12);

await esbuild({
  entryPoints: ['src/sw.ts'],
  outfile: join(OUT, 'sw.js'),
  bundle: true,
  minify: true,
  format: 'iife',
  target: 'es2020',
  logLevel: 'warning',
  define: { __PRECACHE__: JSON.stringify(precache), __VERSION__: JSON.stringify(version) },
});

const total = files.reduce((n, f) => n + statSync(join(OUT, f)).size, 0);
console.log(`-> built ${OUT}/ (${files.length} files, ${(total / 1024).toFixed(0)} KB, sw ${version})`);
