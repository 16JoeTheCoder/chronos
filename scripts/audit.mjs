// npm run audit (§11.2): the mechanical backstop. Typecheck, tests, build, then
// the standing rules: core purity (and core/mcp and core/parser free of Node/Electron), dependency
// allowlist, network code only where it belongs (Firebase only in src/main/sync),
// the typed finish phrase gone, bundle budgets, no fast intervals in main, no
// unexplained TODOs, every core module covered by a test. Prints one line per check and exits non-zero on any failure.
import { execSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { gzipSync } from 'node:zlib';

const results = [];
const check = (name, fn) => {
  try {
    const problems = fn() ?? [];
    results.push([name, problems]);
  } catch (e) {
    results.push([name, [String(e.message ?? e).split('\n').slice(-15).join('\n')]]);
  }
};
const files = (dir, ext = /\.(ts|tsx)$/) =>
  readdirSync(dir).flatMap((f) => {
    const p = join(dir, f);
    // Forward slashes everywhere, so path checks behave the same on Windows CI.
    return statSync(p).isDirectory() ? files(p, ext) : ext.test(f) ? [p.replace(/\\/g, '/')] : [];
  });
const sh = (cmd) => execSync(cmd, { stdio: 'pipe', encoding: 'utf8' });
const imports = (src) => [...src.matchAll(/(?:import|export)[^'"]*?from\s+['"]([^'"]+)['"]|import\(\s*['"]([^'"]+)['"]\s*\)|require\(\s*['"]([^'"]+)['"]\s*\)/g)].map((m) => m[1] ?? m[2] ?? m[3]);

check('typecheck', () => void sh('npx tsc --noEmit'));
check('tests', () => {
  const out = sh('npx vitest run');
  console.log(`   ${out.match(/Tests\s+.*passed.*/)?.[0] ?? ''}`);
});
check('build', () => void sh('node scripts/build.mjs'));

check('core imports only core (minisearch in core/search, chrono-node in core/parser only)', () => {
  const bad = [];
  for (const f of files('src/core')) {
    const src = readFileSync(f, 'utf8');
    for (const i of imports(src)) if (!i.startsWith('.') && !(i === 'minisearch' && f === 'src/core/search/index.ts') && !(i === 'chrono-node' && f.startsWith('src/core/parser/'))) bad.push(`${f}: imports ${i}`);
    if (/\b(document|window|localStorage|navigator)\./.test(src)) bad.push(`${f}: touches the DOM`);
  }
  return bad;
});

check('core/mcp is free of Electron and Node APIs', () =>
  files('src/core/mcp').flatMap((f) => {
    const src = readFileSync(f, 'utf8');
    return /\b(process\.|Buffer\b|require\(|__dirname|globalThis\.process)/.test(src) ? [`${f}: uses a Node API`] : [];
  }),
);

check('the typed finish phrase is gone', () => {
  const phrase = ['i have', 'finished this task'].join(' ');
  const roots = ['src', 'tests', 'scripts', 'docs', 'README.md', 'decision.md', 'log.md'];
  const all = roots.flatMap((r) => (existsSync(r) ? (statSync(r).isDirectory() ? files(r, /\.(ts|tsx|mjs|md|json|html|css)$/) : [r]) : []));
  return all.filter((f) => readFileSync(f, 'utf8').toLowerCase().includes(phrase)).map((f) => `${f}: still mentions the typed phrase`);
});

check('core/parser is free of Electron and Node imports', () =>
  files('src/core/parser', /\.(ts|tsx)$/).flatMap((f) => {
    const src = readFileSync(f, 'utf8');
    const bad = imports(src).filter((i) => i === 'electron' || i === 'fs' || i === 'path' || i === 'os' || i === 'crypto' || i.startsWith('node:') || i.startsWith('electron/'));
    const api = /\b(process\.|Buffer\b|require\(|__dirname|__filename)/.test(src) ? [`${f}: uses a Node API`] : [];
    return [...bad.map((i) => `${f}: imports ${i}`), ...api];
  }),
);

check('renderer never imports main', () =>
  files('src/renderer').flatMap((f) => imports(readFileSync(f, 'utf8')).filter((i) => i.includes('/main/')).map((i) => `${f}: imports ${i}`)),
);

check('dependency allowlist', () => {
  const allow = new Set(['electron', 'react', 'react-dom', 'typescript', 'vite', '@vitejs/plugin-react', 'esbuild', 'electron-builder', 'vitest', 'playwright-core', '@types/node', '@types/react', '@types/react-dom', 'firebase', 'minisearch', '@modelcontextprotocol/sdk', 'chrono-node']);
  const pkg = JSON.parse(readFileSync('package.json', 'utf8'));
  return Object.keys({ ...pkg.dependencies, ...pkg.devDependencies }).filter((d) => !allow.has(d) && !d.startsWith('@fontsource/')).map((d) => `not allowed: ${d}`);
});

// Network code lives in exactly these files: sync (Firestore, Google sign-in), the
// loopback MCP endpoint and the stdio bridge. Firebase only in src/main/sync.
const NETWORK_FILES = new Set(['src/main/sync/firestore.ts', 'src/main/sync/auth.ts', 'src/main/sync/remote.ts', 'src/main/mcp/server.ts', 'src/bridge/client.ts', 'src/bridge/chronos-mcp.ts']);
const FIREBASE_FILES = new Set(['src/main/sync/firestore.ts', 'src/main/sync/auth.ts', 'src/main/sync/remote.ts']);
check('network code only in the sync, MCP endpoint and bridge modules', () => {
  const bad = [];
  for (const f of files('src')) {
    const src = readFileSync(f, 'utf8');
    const allowed = NETWORK_FILES.has(f);
    if (!allowed && /\bfetch\(|new WebSocket|XMLHttpRequest|EventSource\(/.test(src)) bad.push(`${f}: network API`);
    if (!allowed && /https?:\/\//.test(src)) bad.push(`${f}: URL literal`);
    for (const i of imports(src)) {
      if (/firebase/.test(i) && !FIREBASE_FILES.has(f)) bad.push(`${f}: imports ${i} (Firebase belongs in src/main/sync)`);
      else if (/^(node:)?(http|https|net|tls|dgram)$/.test(i) && !allowed) bad.push(`${f}: imports ${i}`);
    }
  }
  return bad;
});

check('no rAF loops, no sub-250 ms intervals in main', () => {
  const bad = [];
  for (const f of files('src')) if (/requestAnimationFrame/.test(readFileSync(f, 'utf8'))) bad.push(`${f}: requestAnimationFrame`);
  for (const f of files('src/main')) {
    const lines = readFileSync(f, 'utf8').split('\n');
    lines.forEach((line, n) => {
      const m = line.match(/setInterval\([^]*?,\s*(\d[\d_]*)\s*\)/);
      if (m && Number(m[1].replace(/_/g, '')) < 250 && !(lines[n - 1] ?? '').includes('audit-allow')) bad.push(`${f}:${n + 1}: setInterval ${m[1]} ms`);
    });
  }
  return bad;
});

check('bundle budgets', () => {
  const bad = [];
  const gz = (p) => gzipSync(readFileSync(p)).length;
  const r = 'dist/renderer';
  const all = files(r, /\.(js|css)$/);
  const js = all.filter((f) => f.endsWith('.js')).reduce((s, f) => s + gz(f), 0);
  const css = all.filter((f) => f.endsWith('.css')).reduce((s, f) => s + gz(f), 0);
  const main = statSync('dist/main.js').size;
  const sync = statSync('dist/sync.js').size;
  const bridge = statSync('dist/chronos-mcp.js').size;
  const launch = statSync(join(r, 'launch.css')).size;
  console.log(`   renderer JS ${(js / 1024).toFixed(1)} KB gz, CSS ${(css / 1024).toFixed(1)} KB gz, main ${(main / 1024).toFixed(1)} KB, sync ${(sync / 1024).toFixed(0)} KB (on demand), MCP bridge ${(bridge / 1024).toFixed(0)} KB, launch.css ${(launch / 1024).toFixed(1)} KB`);
  if (sync > 1600 * 1024) bad.push('sync bundle over 1.6 MB');
  if (bridge > 700 * 1024) bad.push('MCP bridge over 700 KB');
  if (js > 220 * 1024) bad.push('renderer JS over 220 KB gzipped');
  if (css > 30 * 1024) bad.push('CSS over 30 KB gzipped');
  if (main > 180 * 1024) bad.push("main bundle over 180 KB");
  if (launch > 8 * 1024) bad.push('launch.css over 8 KB');
  return bad;
});

check('TODO/FIXME have a decision', () => {
  const decisions = readFileSync('decision.md', 'utf8');
  const bad = [];
  for (const f of files('src')) {
    readFileSync(f, 'utf8').split('\n').forEach((line, n) => {
      if (!/\b(TODO|FIXME)\b/.test(line)) return;
      const ref = line.match(/D-\d{3}/)?.[0];
      if (!ref || !decisions.includes(`## ${ref}`)) bad.push(`${f}:${n + 1}: ${line.trim()}`);
    });
  }
  return bad;
});

check('every core module has a test', () => {
  const tests = files('tests').map((f) => readFileSync(f, 'utf8')).join('\n');
  return files('src/core')
    .filter((f) => !f.endsWith('model/types.ts'))
    .map((f) => relative('src', f).replace(/\\/g, '/').replace(/\.tsx?$/, ''))
    .filter((m) => !tests.includes(`src/${m}'`))
    .map((m) => `no test imports src/${m}`);
});

check('docs present', () =>
  ['decision.md', 'log.md', 'docs/ARCHITECTURE.md', 'docs/SPEC_MATRIX.md', 'docs/SYNC.md', 'docs/SETUP_FIREBASE.md', 'docs/MCP.md', 'docs/WINDOWS_CHECKLIST.md', 'docs/BUILD_REPORT.md', 'README.md', '.claude/agents/reviewer.md', 'firebase/firestore.rules']
    .filter((f) => !existsSync(f))
    .map((f) => `missing ${f}`),
);

let failed = 0;
for (const [name, problems] of results) {
  console.log(`${problems.length ? 'x' : 'ok'} ${name}`);
  for (const p of problems) console.log(`   ${p}`);
  if (problems.length) failed++;
}
console.log(failed ? `x audit failed: ${failed} check(s)` : 'ok audit passed');
process.exitCode = failed ? 1 : 0;
