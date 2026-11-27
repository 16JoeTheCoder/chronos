// Viewport QA for the web build: screenshots, overflow, chrome budget and touch targets.
//
//   npm run build:web                                   -> dist-web/ (local-only mode, no sign-in screen)
//   VITE_FIREBASE_API_KEY=x VITE_FIREBASE_AUTH_DOMAIN=x VITE_FIREBASE_PROJECT_ID=x VITE_FIREBASE_APP_ID=x \
//     npm run build:web && mv dist-web dist-web-signin   -> a second copy whose sign-in screen shows (optional)
//   node scripts/viewports.mjs [--dist dist-web] [--signin dist-web-signin] [--out docs/screens/web] [--only 390x844,1366x768]
//
// (package.json is not edited by QA; add  "viewports": "node scripts/viewports.mjs"  to run it as `npm run viewports`.)
// It serves the folders itself, drives the UI (Ctrl+K quick add, Board, Log Write/Publish) to seed data, then for every
// viewport: screenshots each screen (JPEG q70 into docs/screens/web/<screen>-<w>x<h>.jpg), and prints per screen
//   overflow  scrollWidth > innerWidth (fails the run)
//   chrome    top bar + running pill + tab bar as a share of the height at 390x844 (> 20 % fails the run)
//   targets   visible interactive elements under 44x44 at phone sizes (listed, does not fail the run)
// and the phone rules it can read off the page (top bar <= 52, pill <= 48, tab bar 56, tab label >= 12 px, body >= 16 px).
// Writes docs/screens/web/report.json. Exit code 1 on overflow, chrome budget failure or a screen that could not be reached.
import { createServer } from 'node:http';
import { createRequire } from 'node:module';
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { extname, join, normalize, resolve } from 'node:path';

const require = createRequire(import.meta.url);
const { chromium } = require('playwright');

const arg = (name, dflt) => {
  const i = process.argv.indexOf(`--${name}`);
  return i > 0 ? process.argv[i + 1] : dflt;
};
const DIST = resolve(arg('dist', 'dist-web'));
const SIGNIN = resolve(arg('signin', 'dist-web-signin'));
const OUT = resolve(arg('out', 'docs/screens/web'));
const ONLY = arg('only', '')
  .split(',')
  .filter(Boolean);

const VIEWPORTS = [
  [360, 740],
  [390, 844],
  [412, 915],
  [768, 1024],
  [1366, 768],
  [1920, 1080],
].filter(([w, h]) => !ONLY.length || ONLY.includes(`${w}x${h}`));
const PHONE_MAX = 640;
/** Screens that add nothing at the two extra sizes (412 is 390's twin, 1920 is 1366 with more margin). */
const TRIVIAL = new Set(['tasks-inbox', 'tasks-upcoming', 'tasks-all', 'log-write', 'palette', 'signin']);
const EXTRA = new Set(['412x915', '1920x1080']);

const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.webmanifest': 'application/manifest+json', '.svg': 'image/svg+xml', '.png': 'image/png', '.woff2': 'font/woff2', '.woff': 'font/woff' };
function serve(root) {
  const srv = createServer((req, res) => {
    const url = new URL(req.url, 'http://x');
    let p = normalize(join(root, decodeURIComponent(url.pathname)));
    if (!p.startsWith(root)) return void res.writeHead(403).end();
    if (existsSync(p) && statSync(p).isDirectory()) p = join(p, 'index.html');
    if (!existsSync(p)) return void res.writeHead(404).end();
    res.writeHead(200, { 'content-type': MIME[extname(p)] ?? 'application/octet-stream' }).end(readFileSync(p));
  });
  return new Promise((ok) => srv.listen(0, '127.0.0.1', () => ok({ srv, url: `http://127.0.0.1:${srv.address().port}/` })));
}

/** Runs in the page: interactive elements that are visible, on screen, on top, and smaller than 44x44. */
const MEASURE = () => {
  const sel = (el) => {
    const id = el.id ? `#${el.id}` : '';
    const cls = typeof el.className === 'string' ? el.className.trim().split(/\s+/).filter(Boolean).slice(0, 2).map((c) => `.${c}`).join('') : '';
    const lbl = (el.getAttribute('aria-label') || el.textContent || el.getAttribute('placeholder') || '').trim().replace(/\s+/g, ' ').slice(0, 24);
    return `${el.tagName.toLowerCase()}${id}${cls}${lbl ? ` "${lbl}"` : ''}`;
  };
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  const targets = [];
  for (const el of document.querySelectorAll('button, a[href], input:not([type=hidden]), select, textarea, [role=button], [role=tab], [role=switch], [role=checkbox], summary')) {
    // A checkbox is tapped through its label: measure that.
    const r = ((el.type === 'checkbox' || el.type === 'radio') && el.labels && el.labels[0] ? el.labels[0] : el).getBoundingClientRect();
    if (r.width === 0 || r.height === 0 || r.bottom < 0 || r.right < 0 || r.top > vh || r.left > vw) continue;
    const cs = getComputedStyle(el);
    if (cs.visibility === 'hidden' || cs.display === 'none' || Number(cs.opacity) === 0) continue;
    const top = document.elementFromPoint(Math.min(Math.max(r.left + r.width / 2, 0), vw - 1), Math.min(Math.max(r.top + r.height / 2, 0), vh - 1));
    if (!top || !(el === top || el.contains(top) || top.contains(el))) continue;
    if (r.width < 44 || r.height < 44) targets.push(`${sel(el)} ${Math.round(r.width)}x${Math.round(r.height)}`);
  }
  const h = (s) => {
    const e = [...document.querySelectorAll(s)].find((x) => {
      const r = x.getBoundingClientRect();
      if (r.height === 0) return false;
      const t = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
      return !!t && (x === t || x.contains(t));
    });
    return e ? Math.round(e.getBoundingClientRect().height * 10) / 10 : 0;
  };
  const tabSpan = document.querySelector('.tabbar .tab span');
  return {
    overflow: Math.max(document.documentElement.scrollWidth, document.body.scrollWidth) > vw,
    scrollWidth: Math.max(document.documentElement.scrollWidth, document.body.scrollWidth),
    top: h('.topbar'),
    pill: h('.runpill'),
    tab: h('.tabbar'),
    tabLabelPx: tabSpan ? parseFloat(getComputedStyle(tabSpan).fontSize) : 0,
    bodyPx: parseFloat(getComputedStyle(document.body).fontSize),
    targets,
  };
};

async function seed(page, nav) {
  const settle = (ms = 400) => page.waitForTimeout(ms);
  const add = async (text) => {
    for (let i = 0; i < 3 && !(await page.locator('#pal-input').isVisible()); i++) {
      await page.keyboard.press('Control+k');
      await settle(350);
    }
    await page.locator('#pal-input').waitFor({ timeout: 3000 });
    await page.keyboard.type(text);
    await settle(250);
    await page.keyboard.press('Enter');
    await page.locator('#pal-input').waitFor({ state: 'hidden', timeout: 5000 }).catch(() => undefined);
    await settle(500);
  };
  await add('Write the proposal 45m today');
  await add('Call the accountant 15m today');
  await add('Review pull requests 30m tomorrow');
  await add('Book flights for the offsite friday');
  await add('Plan the offsite');
  // A project with tasks (the Board).
  await nav('board');
  const name = page.getByPlaceholder('Project name');
  if (await name.count()) {
    await name.fill('Website');
    await page.getByRole('button', { name: 'Create', exact: true }).click();
    await settle(600);
  }
  await page.getByRole('button', { name: 'Add a task to this project' }).first().click();
  for (const t of ['Draft homepage copy', 'Pick a colour palette', 'Ship the contact form']) {
    await settle(200);
    await page.keyboard.type(t); // the form stays open after Enter
    await page.keyboard.press('Enter');
    await settle(350);
  }
  await page.getByRole('button', { name: 'Done', exact: true }).first().click({ timeout: 3000 }).catch(() => undefined);
  // Two Log posts through Write -> Publish.
  for (const text of ['Shipped the first cut of the homepage. Next up is the contact form.', '- slow start\n- fast finish\n\nNotes for tomorrow: **call the accountant**.']) {
    await nav('log');
    await page.getByRole('button', { name: /^Write( W)?$/ }).first().click();
    const box = page.locator('textarea.write-input');
    await box.waitFor();
    await box.fill(text);
    await settle(1300); // autosave
    await page.getByRole('button', { name: /^Publish\b/ }).click();
    await settle(600);
  }
}

async function run() {
  if (!existsSync(join(DIST, 'index.html'))) throw new Error(`no build in ${DIST} (run npm run build:web)`);
  mkdirSync(OUT, { recursive: true });
  const local = await serve(DIST);
  const signin = existsSync(join(SIGNIN, 'index.html')) ? await serve(SIGNIN) : null;
  if (!signin) console.log(`(no ${SIGNIN}: the sign-in screen is skipped)`);
  const browser = await chromium.launch();
  const rows = [];
  const problems = [];
  const t0 = new Date('2026-11-26T10:00:00Z');

  for (const [w, h] of VIEWPORTS) {
    const key = `${w}x${h}`;
    const phone = w < PHONE_MAX;
    const mk = async (url) => {
      const ctx = await browser.newContext({ viewport: { width: w, height: h }, timezoneId: 'Europe/London', hasTouch: w < 1024, isMobile: phone, deviceScaleFactor: 1, serviceWorkers: 'block' });
      const page = await ctx.newPage();
      await page.clock.install({ time: t0 });
      page.on('pageerror', (e) => problems.push(`${key} page error: ${e.message}`));
      await page.goto(url);
      await page.waitForTimeout(700);
      return { ctx, page };
    };

    const shot = async (page, name, { measure = true } = {}) => {
      if (EXTRA.has(key) && TRIVIAL.has(name)) return;
      await page.waitForTimeout(350);
      await page.screenshot({ path: join(OUT, `${name}-${key}.jpg`), type: 'jpeg', quality: 70 });
      if (!measure) return;
      const m = await page.evaluate(MEASURE);
      rows.push({ viewport: key, screen: name, ...m });
    };

    // ---- the app (local-only build) ----
    const { ctx, page } = await mk(local.url);
    const vis = async (loc) => (await loc.count()) > 0 && (await loc.first().isVisible());
    /** Go to a screen by whatever navigation this width shows: tab bar, rail or More sheet. */
    const nav = async (screen) => {
      if (await page.locator('section.focus').count()) {
        await page.keyboard.press('Escape'); // Focus is full-screen on a phone: no tab bar until it is left
        await page.waitForTimeout(400);
      }
      const label = { home: 'Home', tasks: 'Tasks', log: 'Log', plan: 'Plan', board: 'Board', cache: 'Cache', settings: 'Settings' }[screen];
      const tab = page.locator('.tabbar .tab', { hasText: label });
      const rail = page.locator(`.rail-btn[aria-label="${label}"]`);
      if (await vis(tab)) await tab.first().click();
      else if (await vis(rail)) await rail.first().click();
      else if (screen === 'plan') {
        await nav('home');
        await page.keyboard.press('p');
      } else if (await vis(page.locator('.tabbar .tab', { hasText: 'More' }))) {
        await page.locator('.tabbar .tab', { hasText: 'More' }).click();
        await page.locator('.sheet').getByRole('button', { name: new RegExp(label) }).first().click();
      } else throw new Error(`no way to reach ${screen}`);
      await page.waitForTimeout(650);
    };
    const step = async (name, fn) => {
      try {
        await fn();
      } catch (e) {
        problems.push(`${key} ${name}: ${String(e.message).split('\n')[0]}`);
        await page.screenshot({ path: join(OUT, `_fail-${name}-${key}.png`) }).catch(() => undefined);
        await page.keyboard.press('Escape').catch(() => undefined);
      }
    };

    await page.keyboard.press('Enter'); // the launch screen
    await page.waitForTimeout(700);
    const skip = page.getByRole('button', { name: 'Skip setup' });
    if (await skip.count()) await skip.click();
    await page.waitForTimeout(400);
    await step('seed', () => seed(page, nav));

    // Start a task so the running pill shows on every phone screen.
    await step('start', async () => {
      await nav('home');
      await page.getByRole('button', { name: /^Start / }).first().click();
      await page.waitForTimeout(700);
    });

    await step('home', async () => { await nav('home'); await shot(page, 'home'); });
    for (const [label, name] of [['Inbox', 'tasks-inbox'], ['Today', 'tasks-today'], ['Upcoming', 'tasks-upcoming'], ['All', 'tasks-all']]) {
      await step(name, async () => {
        await nav('tasks');
        await page.getByRole('button', { name: label, exact: true }).first().click();
        await shot(page, name);
      });
    }
    await step('board', async () => { await nav('board'); await shot(page, 'board'); });
    await step('focus', async () => { await nav('home'); await page.keyboard.press('f'); await page.waitForTimeout(500); await shot(page, 'focus'); });
    await step('plan', async () => { await nav('plan'); await shot(page, 'plan'); });
    await step('log-read', async () => { await nav('log'); await shot(page, 'log-read'); });
    await step('log-write', async () => {
      await nav('log');
      await page.getByRole('button', { name: /^Write( W)?$/ }).first().click();
      const box = page.locator('textarea.write-input');
      await box.waitFor();
      await box.fill('A draft in progress. Autosave keeps it.\n\n- one\n- two');
      await shot(page, 'log-write');
      await page.getByRole('button', { name: /Back to Read|Read/ }).first().click().catch(() => undefined);
      await page.waitForTimeout(300);
    });
    await step('settings', async () => { await nav('settings'); await page.waitForTimeout(500); await shot(page, 'settings'); });
    await step('palette', async () => {
      await page.keyboard.press('Control+k');
      await page.locator('#pal-input').waitFor();
      await page.keyboard.type('Call the dentist 20m tomorrow');
      await shot(page, 'palette');
      await page.keyboard.press('Escape');
    });
    await ctx.close();

    // ---- the sign-in screen ----
    if (signin) {
      await step('signin', async () => {
        const s = await mk(signin.url);
        await s.page.keyboard.press('Enter');
        await s.page.waitForTimeout(900);
        await shot(s.page, 'signin');
        await s.ctx.close();
      });
    }
  }
  await browser.close();
  local.srv.close();
  signin?.srv.close();

  // ---- report ----
  const pct = (r) => ((r.top + r.pill + r.tab) / Number(r.viewport.split('x')[1])) * 100;
  const line = (r) => {
    const [w] = r.viewport.split('x').map(Number);
    const chrome = w < PHONE_MAX && r.tab ? ` chrome ${pct(r).toFixed(1)}% (top ${r.top} pill ${r.pill} tab ${r.tab})` : '';
    return `${r.viewport.padEnd(9)} ${r.screen.padEnd(14)} overflow ${r.overflow ? `YES sw=${r.scrollWidth}` : 'no '}${chrome}  targets<44: ${w < PHONE_MAX ? r.targets.length : '-'}`;
  };
  console.log('\nviewport  screen         overflow / chrome / targets');
  for (const r of rows) console.log(line(r));

  const fails = [];
  for (const r of rows) {
    if (r.overflow) fails.push(`overflow: ${r.viewport} ${r.screen} (scrollWidth ${r.scrollWidth})`);
    if (r.viewport === '390x844' && r.tab) {
      if (!r.pill) fails.push(`chrome: 390x844 ${r.screen}: running pill not showing, the budget was not measured with it`);
      if (pct(r) > 20) fails.push(`chrome: 390x844 ${r.screen} is ${pct(r).toFixed(1)} % (> 20 %)`);
    }
  }
  console.log('\nPhone rules (reported, not failing):');
  const seen = new Set();
  for (const r of rows.filter((x) => Number(x.viewport.split('x')[0]) < PHONE_MAX && x.tab)) {
    const issues = [];
    if (r.top > 52) issues.push(`top bar ${r.top}px > 52`);
    if (r.pill > 48) issues.push(`pill ${r.pill}px > 48`);
    if (r.tab < 56) issues.push(`tab bar ${r.tab}px < 56`);
    if (r.tabLabelPx < 12) issues.push(`tab label ${r.tabLabelPx}px < 12`);
    if (r.bodyPx < 16) issues.push(`body ${r.bodyPx}px < 16`);
    for (const i of issues) if (!seen.has(`${r.viewport}${i}`)) { seen.add(`${r.viewport}${i}`); console.log(`  ${r.viewport} ${r.screen}: ${i}`); }
  }
  console.log('\nTouch targets under 44x44 at phone sizes (selector size):');
  for (const r of rows.filter((x) => Number(x.viewport.split('x')[0]) < PHONE_MAX && x.targets.length)) {
    console.log(`  ${r.viewport} ${r.screen}:`);
    for (const t of r.targets) console.log(`    ${t}`);
  }
  if (problems.length) {
    console.log('\nProblems:');
    for (const p of problems) console.log(`  ${p}`);
    fails.push(...problems.map((p) => `script: ${p}`));
  }
  writeFileSync(join(OUT, 'report.json'), JSON.stringify({ rows, problems }, null, 1));
  if (fails.length) {
    console.log(`\nFAIL (${fails.length}):`);
    for (const f of fails) console.log(`  ${f}`);
    process.exit(1);
  }
  console.log('\nOK: no overflow, chrome budget met.');
}

run().catch((e) => {
  console.error(e);
  process.exit(2);
});
