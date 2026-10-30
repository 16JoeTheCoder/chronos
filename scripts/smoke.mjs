// Smoke test (§11.3): the built app under Xvfb, driven by playwright-core's
// Electron API (no browser download). Walks the main paths and saves
// screenshots to docs/screens/. Run: npm run build && xvfb-run -a node scripts/smoke.mjs
import { _electron as electron } from 'playwright-core';
import { mkdtempSync, mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const shots = 'docs/screens';
mkdirSync(shots, { recursive: true });
const dataDir = mkdtempSync(join(tmpdir(), 'chronos-smoke-'));
const errors = [];
const step = (s) => console.log(`-> ${s}`);

const app = await electron.launch({ args: ['.', '--no-sandbox'], env: { ...process.env, CHRONOS_USER_DATA: dataDir } });
try {
  const home = await waitForWindow(app, 'index.html');
  home.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
  home.on('pageerror', (e) => errors.push(String(e)));
  await home.setViewportSize({ width: 1600, height: 900 });

  step('launch screen paints');
  await home.waitForSelector('#launch .launch-word');
  await home.waitForSelector('[data-stat="left"]:not(.sk)');
  await home.screenshot({ path: `${shots}/1-launch.png` });

  step('Enter reveals the runway');
  await home.keyboard.press('Enter');
  await home.waitForSelector('.runway');
  await home.getByRole('button', { name: 'Skip setup' }).click();
  await home.waitForTimeout(1100); // let the draw-in finish so screenshots are clean

  step('seed a timetable through the command channel');
  await home.evaluate(async () => {
    const c = window.chronos.command;
    const tag = (await c({ type: 'tag.create', input: { name: 'Physics', color: 'tag1', kind: 'class' } })).id;
    const tz = 'Asia/Jakarta';
    const all = { weekdays: [1, 2, 3, 4, 5, 6, 7], everyNWeeks: 1, anchorDate: '2026-10-26', from: null, until: null };
    await c({ type: 'event.create', input: { title: 'Physics', tagId: tag, scope: 'school', tz, startMin: 600, endMin: 660, date: null, recur: all, notes: '' } });
    await c({ type: 'event.create', input: { title: 'Lunch', tagId: null, scope: 'other', tz, startMin: 720, endMin: 780, date: null, recur: all, notes: '' } });
    await c({ type: 'event.create', input: { title: 'Football', tagId: null, scope: 'other', tz, startMin: 1020, endMin: 1110, date: null, recur: all, notes: '' } });
    await c({ type: 'task.create', input: { title: 'Kinematics worksheet', finishCondition: 'All 12 questions answered and checked', tagId: tag, estimateMin: 25, priority: 'must' } });
    await c({ type: 'task.create', input: { title: 'Essay draft', finishCondition: 'Draft of 800 words saved', estimateMin: 45 } });
    await c({ type: 'task.create', input: { title: 'Read chapter 4' } });
  });

  step('quick-add a task with N');
  await home.keyboard.press('n');
  await home.getByLabel('Title').fill('Smoke test task');
  await home.getByLabel('Finish condition').fill('The smoke test finishes it');
  await home.getByRole('button', { name: 'Add task' }).click();
  await home.waitForSelector('.card:has-text("Smoke test task")');

  step('schedule it from the keyboard with S');
  await home.locator('.card:has-text("Smoke test task")').focus();
  await home.keyboard.press('s');
  await home.waitForSelector('.sched');
  await home.keyboard.press('Enter');
  await home.waitForSelector('.blk:has-text("Smoke test task")');
  await home.waitForTimeout(300);
  await home.screenshot({ path: `${shots}/2-runway.png` });

  step('Focus Core: start, then finish with the phrase');
  await home.keyboard.press('f');
  await home.waitForSelector('.focus .digits-hero');
  const title = await home.locator('.focus-title').textContent();
  await home.getByRole('button', { name: /^Start/ }).click();
  await home.waitForSelector('button:has-text("Pause")');
  await home.locator('.stray input').fill('Look up projectile range formula');
  await home.keyboard.press('Enter');
  await home.waitForTimeout(1200);
  await home.screenshot({ path: `${shots}/3-focus.png` });
  await home.getByRole('button', { name: 'Finish', exact: true }).click();
  await home.getByLabel('Finish phrase').fill('I have finished this task');
  await home.getByRole('button', { name: /Finish task|Ship it/ }).click();
  await home.waitForSelector(`.toast:has-text("Done.")`);
  if ((await home.locator('.focus-title').textContent()) === title) throw new Error('finished task is still in focus');

  step('recycle a card, then Undo');
  await home.keyboard.press('f');
  await home.waitForSelector('.cards');
  const card = home.locator('.card:has-text("Read chapter 4")');
  await card.focus();
  await home.keyboard.press('Delete');
  await home.waitForSelector('.toast button:has-text("Undo")');
  await home.locator('.toast button:has-text("Undo")').click();
  await home.waitForSelector('.card:has-text("Read chapter 4")');

  step('open the Desktop shelf');
  await home.getByRole('button', { name: 'Desktop' }).click();
  await home.waitForSelector('.shelf');
  await home.keyboard.press('Escape');

  step('schedule editor');
  await home.getByRole('button', { name: 'Schedule' }).click();
  await home.waitForSelector('.week');
  await home.locator('.wk-ev').first().click();
  await home.screenshot({ path: `${shots}/4-schedule.png` });
  await home.keyboard.press('Escape');

  step('settings and About');
  await home.getByRole('button', { name: 'Settings' }).click();
  await home.waitForSelector('.settings');
  await home.screenshot({ path: `${shots}/5-settings.png` });
  await home.getByRole('button', { name: 'About' }).click();
  await home.waitForSelector('.about');
  await home.screenshot({ path: `${shots}/6-about.png` });

  const widget = app.windows().find((w) => w.url().includes('widget.html'));
  if (widget) await widget.screenshot({ path: `${shots}/7-widget.png` });

  if (errors.length) throw new Error(`console errors:\n${errors.join('\n')}`);
  console.log('ok smoke test passed');
} catch (e) {
  console.error(`x ${e.message}`);
  const w = app.windows().find((x) => x.url().includes('index.html'));
  await w?.screenshot({ path: join(tmpdir(), 'chronos-smoke-failure.png') }).catch(() => undefined);
  if (errors.length) console.error(errors.join('\n'));
  process.exitCode = 1;
} finally {
  await app.close().catch(() => undefined);
  rmSync(dataDir, { recursive: true, force: true });
}

async function waitForWindow(app, page) {
  for (let i = 0; i < 100; i++) {
    const w = app.windows().find((x) => x.url().includes(page));
    if (w) return w;
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error(`no ${page} window`);
}
