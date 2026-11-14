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

const app = await electron.launch({ args: ['.', '--no-sandbox'], env: { ...process.env, CHRONOS_USER_DATA: dataDir, CHRONOS_SMOKE: '1' } });
try {
  const home = await waitForWindow(app, 'index.html');
  home.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
  home.on('pageerror', (e) => errors.push(String(e)));
  await home.setViewportSize({ width: 1600, height: 900 });

  step('launch screen paints');
  await home.waitForSelector('#launch .launch-word');
  await home.waitForSelector('[data-stat="left"]:not(.sk)');
  await home.screenshot({ path: `${shots}/1-launch.png` });

  step('Enter reveals Home; finish onboarding (sets the device flag)');
  await home.keyboard.press('Enter');
  await home.getByRole('button', { name: 'Skip setup' }).click();
  await home.waitForSelector('.nowscreen');
  await home.waitForTimeout(1100);

  step('seed events, tasks and a plan through the command channel');
  await home.evaluate(async () => {
    const c = window.chronos.command;
    const tag = (await c({ type: 'tag.create', input: { name: 'Physics', color: 'tag1', kind: 'class' } })).id;
    const tz = 'Asia/Jakarta';
    const all = { weekdays: [1, 2, 3, 4, 5, 6, 7], everyNWeeks: 1, anchorDate: '2026-10-26', from: null, until: null };
    await c({ type: 'event.create', input: { title: 'Football', tagId: null, scope: 'other', tz, startMin: 1020, endMin: 1110, date: null, recur: all, notes: '' } });
    await c({ type: 'task.create', input: { title: 'Wind sim: blade pitch model', finishCondition: 'Power curve plateaus at rated speed', tagId: tag, estimateMin: 90, priority: 'must' } });
    await c({ type: 'task.create', input: { title: 'Find NREL 5 MW data', finishCondition: 'Dataset downloaded and checked', estimateMin: 25 } });
    await c({ type: 'task.create', input: { title: 'Reply to coach', finishCondition: 'Reply sent about Saturday', estimateMin: 15 } });
    await c({ type: 'settings.update', patch: { dayStartMin: 0, dayEndMin: 1440 } });
    await c({ type: 'idea.add', text: 'Cp drops hard past 12 m/s. Ramp pitch from 10 m/s and compare.', taskId: null });
  });
  await home.waitForSelector('.now-title');
  await home.screenshot({ path: `${shots}/2-home.png` });

  step('Focus: Space starts without clicking, a short Enter does not finish, a 2 s hold does');
  await home.keyboard.press('f');
  await home.waitForSelector('.focus .focus-title');
  await home.keyboard.press('Space');
  await home.waitForSelector('button:has-text("Pause")');
  await home.waitForTimeout(1500);
  await home.screenshot({ path: `${shots}/3-focus.png` });

  step('overlay (windows.html#overlay): the timer pill shows while a task runs');
  const overlay = await waitForWindow(app, 'windows.html#overlay');
  await overlay.waitForSelector('.sig, .ov, #root > *', { timeout: 8000 });
  await overlay.waitForTimeout(600);
  await overlay.screenshot({ path: `${shots}/7-overlay.png` });
  await home.keyboard.press('Space');
  await home.waitForSelector('button:has-text("Resume")');
  const title = await home.locator('.focus-title').textContent();
  await home.keyboard.down('Enter');
  await home.waitForTimeout(500);
  await home.keyboard.up('Enter');
  await home.waitForTimeout(500);
  if ((await home.locator('.toast:has-text("Done.")').count()) > 0) throw new Error('an early release finished the task');
  await home.keyboard.down('Enter');
  await home.waitForTimeout(1000);
  await home.screenshot({ path: `${shots}/3b-hold.png` });
  await home.waitForTimeout(1300);
  await home.keyboard.up('Enter');
  await home.waitForSelector('.toast:has-text("Done.")');
  if ((await home.locator('.focus-title').textContent()) === title) throw new Error('finished task is still in focus');

  step('Plan: Re-plan toast, drag a card onto the Plan lane, drag the block back');
  await home.keyboard.press('Escape');
  await home.keyboard.press('p');
  await home.waitForSelector('.runway .rw-plan');
  await home.getByRole('button', { name: 'Re-plan' }).click();
  await home.waitForSelector('.toast');
  const card = home.locator('.card').first();
  const lane = await home.locator('.rw-plan').boundingBox();
  const cb = await card.boundingBox();
  if (lane && cb) {
    await home.mouse.move(cb.x + 40, cb.y + 20);
    await home.mouse.down();
    await home.mouse.move(lane.x + lane.width * 0.6, lane.y + 30, { steps: 8 });
    await home.mouse.up();
    await home.waitForTimeout(400);
  }
  await home.screenshot({ path: `${shots}/4-plan.png` });
  const blocks = await home.locator('.blk').count();
  if (blocks > 0) {
    const bb = await home.locator('.blk-body').first().boundingBox();
    const cards = await home.locator('.cards').boundingBox();
    if (bb && cards) {
      await home.mouse.move(bb.x + 20, bb.y + 10);
      await home.mouse.down();
      await home.mouse.move(cards.x + 100, cards.y + 60, { steps: 8 });
      await home.mouse.up();
      await home.waitForTimeout(400);
      if ((await home.locator('.blk').count()) >= blocks) throw new Error('dropping a block on the cards did not unschedule it');
    }
  }
  await home.keyboard.press('Escape');

  step('Ctrl+K in Home opens the palette (verified), Esc closes it');
  await home.keyboard.press('Escape');
  await home.keyboard.press('Control+k');
  await home.waitForSelector('[role="dialog"][aria-label="Palette"]');
  await home.screenshot({ path: `${shots}/8-palette-in-home.png` });
  await home.keyboard.press('Escape');
  await home.waitForSelector('[role="dialog"][aria-label="Palette"]', { state: 'detached' });

  step('notepad and palette windows (windows.html#notepad, #palette)');
  await app.evaluate(() => globalThis.__chronosSmoke.openNotepad());
  const notepad = await waitForWindow(app, 'windows.html#notepad');
  await notepad.waitForSelector('textarea');
  await notepad.waitForTimeout(500);
  await notepad.screenshot({ path: `${shots}/9-notepad.png` });
  await app.evaluate(() => globalThis.__chronosSmoke.openPalette());
  const palette = await waitForWindow(app, 'windows.html#palette');
  await palette.waitForSelector('.pal-input');
  await palette.waitForTimeout(500);
  await palette.screenshot({ path: `${shots}/10-palette.png` });
  await palette.keyboard.press('Escape');
  await home.bringToFront();

  step('Settings, Board and Log from the rail; a Log post edit is saved through idea.edit');
  await home.getByRole('button', { name: 'Settings', exact: true }).first().click();
  await home.getByRole('heading', { name: 'Settings' }).first().waitFor();
  await home.screenshot({ path: `${shots}/5-settings.png` });
  await home.getByRole('button', { name: 'Board', exact: true }).click();
  await home.waitForTimeout(700);
  await home.getByRole('button', { name: 'Home', exact: true }).click();
  await home.keyboard.press('Control+l');
  await home.waitForSelector('textarea[aria-label="Write a post"]');
  await home.getByRole('button', { name: /^Edit post from/ }).first().click();
  const editBox = home.locator('textarea[aria-label="Edit post"]');
  await editBox.fill('Edited in the smoke test: the Log saves through idea.edit.');
  await home.waitForTimeout(1500);
  const saved = await home.evaluate(async () => Object.values((await window.chronos.getSnapshot()).data.ideas).some((i) => i.body.startsWith('Edited in the smoke test')));
  if (!saved) throw new Error('Log post edit was not saved (idea.edit)');
  await home.locator('.note-head').getByRole('button', { name: 'Done' }).first().click();
  await home.getByRole('button', { name: 'Home', exact: true }).click();

  step('theme matrix: 1440 and 390 px in every launch theme');
  await home.evaluate(() => window.chronos.command({ type: 'plan.auto' }));
  await home.waitForTimeout(8500); // let the toasts clear before the screenshots
  const themes = ['tactile-instrument', 'stark-workshop', 'tars-gargantua/day', 'tars-gargantua/night'];
  for (const themeId of themes) {
    await home.evaluate((id) => window.chronos.command({ type: 'settings.update', patch: { themeId: id } }), themeId);
    await home.waitForFunction((id) => document.documentElement.dataset.themeId === id, themeId);
    for (const [w, h] of [[1440, 900], [390, 844]]) {
      await home.setViewportSize({ width: w, height: h });
      await home.waitForTimeout(1300);
      const tag = themeId.replace('/', '-');
      await home.screenshot({ path: `${shots}/theme-${tag}-${w}-home.png` });
      await home.keyboard.press('f');
      await home.waitForTimeout(900);
      await home.screenshot({ path: `${shots}/theme-${tag}-${w}-focus.png` });
      await home.keyboard.press('f');
      await home.keyboard.press('p');
      await home.waitForTimeout(500);
      await home.screenshot({ path: `${shots}/theme-${tag}-${w}-plan.png` });
      await home.keyboard.press('p');
      await home.waitForTimeout(200);
    }
  }
  await home.setViewportSize({ width: 1440, height: 900 });

  step('Board, Log and Settings at 1440 in tactile-instrument and stark-workshop');
  for (const themeId of ['tactile-instrument', 'stark-workshop']) {
    await home.evaluate((id) => window.chronos.command({ type: 'settings.update', patch: { themeId: id } }), themeId);
    await home.waitForFunction((id) => document.documentElement.dataset.themeId === id, themeId);
    await home.waitForTimeout(800);
    await home.getByRole('button', { name: 'Board', exact: true }).click();
    await home.waitForTimeout(900);
    await home.screenshot({ path: `${shots}/theme-${themeId}-1440-board.png` });
    await home.keyboard.press('Control+l');
    await home.waitForTimeout(900);
    await home.screenshot({ path: `${shots}/theme-${themeId}-1440-log.png` });
    await home.getByRole('button', { name: 'Settings', exact: true }).first().click();
    await home.waitForTimeout(900);
    await home.screenshot({ path: `${shots}/theme-${themeId}-1440-settings.png` });
    await home.getByRole('button', { name: 'Home', exact: true }).click();
  }

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
