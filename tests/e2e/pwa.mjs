// PWA e2e: load once, wait for the service worker, go offline, reload, Home still renders.
//   npm run build:web && node tests/e2e/pwa.mjs [dist-web]
import { createServer } from 'node:http';
import { createRequire } from 'node:module';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { extname, join, normalize, resolve } from 'node:path';

const { chromium } = createRequire(import.meta.url)('playwright');
const root = resolve(process.argv[2] ?? 'dist-web');
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.webmanifest': 'application/manifest+json', '.svg': 'image/svg+xml', '.png': 'image/png', '.woff2': 'font/woff2', '.woff': 'font/woff' };
const srv = createServer((req, res) => {
  let p = normalize(join(root, decodeURIComponent(new URL(req.url, 'http://x').pathname)));
  if (!p.startsWith(root)) return void res.writeHead(403).end();
  if (existsSync(p) && statSync(p).isDirectory()) p = join(p, 'index.html');
  if (!existsSync(p)) return void res.writeHead(404).end();
  res.writeHead(200, { 'content-type': MIME[extname(p)] ?? 'application/octet-stream', 'cache-control': 'no-store' }).end(readFileSync(p));
});
await new Promise((ok) => srv.listen(0, '127.0.0.1', ok));
// register-sw.js skips localhost unless the URL has ?sw=1.
const url = `http://127.0.0.1:${srv.address().port}/?sw=1`;

const fail = [];
const browser = await chromium.launch();
try {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const page = await ctx.newPage();
  await page.goto(url);
  await page.waitForTimeout(500);
  const scope = await page.evaluate(() => Promise.race([navigator.serviceWorker.ready.then((r) => r.scope), new Promise((_, no) => setTimeout(() => no(new Error('service worker never became ready')), 15000))]));
  console.log(`service worker ready, scope ${scope}`);
  // Precache is installed during install; make sure the page is controlled before going offline.
  await page.waitForFunction(() => !!navigator.serviceWorker.controller, null, { timeout: 8000 }).catch(async () => {
    await page.reload();
    await page.waitForFunction(() => !!navigator.serviceWorker.controller, null, { timeout: 8000 });
  });
  await page.keyboard.press('Enter');
  await page.waitForTimeout(500);

  await ctx.setOffline(true);
  await page.reload();
  await page.waitForTimeout(1200);
  await page.keyboard.press('Enter'); // the launch screen
  await page.waitForTimeout(800);
  const text = await page.evaluate(() => document.body.innerText);
  const home = /Home/.test(text) && /free today|Nothing for today|Plan/.test(text);
  console.log(`offline reload: ${home ? 'Home rendered' : 'Home NOT rendered'}`);
  if (!home) fail.push(`Home did not render offline. Body started: ${JSON.stringify(text.slice(0, 120))}`);
  const online = await page.evaluate(() => navigator.onLine);
  if (online) fail.push('context was not offline');
  await ctx.setOffline(false);
} catch (e) {
  fail.push(String(e.message ?? e).split('\n')[0]);
} finally {
  await browser.close();
  srv.close();
}
if (fail.length) {
  console.error(`FAIL\n  ${fail.join('\n  ')}`);
  process.exit(1);
}
console.log('OK: offline reload renders Home');
