// npm run audit (§11.2): the mechanical backstop. Typecheck, tests, build, then
// the standing rules: core purity, dependency allowlist, no network code, bundle
// budgets, no fast intervals in main, no unexplained TODOs, every core module
// covered by a test. Prints one line per check and exits non-zero on any failure.
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

check('core imports only core', () => {
  const bad = [];
  for (const f of files('src/core')) {
    const src = readFileSync(f, 'utf8');
    for (const i of imports(src)) if (!i.startsWith('.')) bad.push(`${f}: imports ${i}`);
    if (/\b(document|window|localStorage|navigator)\./.test(src)) bad.push(`${f}: touches the DOM`);
  }
  return bad;
});

check('renderer never imports main', () =>
  files('src/renderer').flatMap((f) => imports(readFileSync(f, 'utf8')).filter((i) => i.includes('/main/')).map((i) => `${f}: imports ${i}`)),
);

check('dependency allowlist', () => {
  const allow = new Set(['electron', 'react', 'react-dom', 'typescript', 'vite', '@vitejs/plugin-react', 'esbuild', 'electron-builder', 'vitest', 'playwright-core', '@types/node', '@types/react', '@types/react-dom']);
  const pkg = JSON.parse(readFileSync('package.json', 'utf8'));
  return Object.keys({ ...pkg.dependencies, ...pkg.devDependencies }).filter((d) => !allow.has(d)).map((d) => `not allowed: ${d}`);
});

check('no network code in src', () => {
  const bad = [];
  for (const f of files('src')) {
    const src = readFileSync(f, 'utf8');
    if (/\bfetch\(|new WebSocket|XMLHttpRequest|EventSource\(/.test(src)) bad.push(`${f}: network API`);
    if (/https?:\/\//.test(src)) bad.push(`${f}: URL literal`);
    for (const i of imports(src)) if (/^(node:)?(http|https|net|tls|dgram)$|firebase/.test(i)) bad.push(`${f}: imports ${i}`);
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
  const launch = statSync(join(r, 'launch.css')).size;
  console.log(`   renderer JS ${(js / 1024).toFixed(1)} KB gz, CSS ${(css / 1024).toFixed(1)} KB gz, main ${(main / 1024).toFixed(1)} KB, launch.css ${(launch / 1024).toFixed(1)} KB`);
  if (js > 220 * 1024) bad.push('renderer JS over 220 KB gzipped');
  if (css > 30 * 1024) bad.push('CSS over 30 KB gzipped');
  if (main > 150 * 1024) bad.push('main bundle over 150 KB');
  if (launch > 8 * 1024) bad.push('launch.css over 8 KB');
  return bad;
});

check('TODO/FIXME have a decision', () => {
  const decisions = readFileSync('docs/DECISIONS.md', 'utf8');
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
  ['docs/DECISIONS.md', 'docs/ARCHITECTURE.md', 'docs/SPEC_MATRIX.md', 'docs/SYNC_V1_1.md', 'docs/WINDOWS_CHECKLIST.md', 'docs/BUILD_REPORT.md', 'README.md', '.claude/agents/reviewer.md']
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
