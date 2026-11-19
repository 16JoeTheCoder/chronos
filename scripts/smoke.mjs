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
    await c({ type: 'task.create', input: { title: 'Wind sim: blade pitch model', tagId: tag, estimateMin: 90, priority: 'must' } });
    await c({ type: 'task.create', input: { title: 'Find NREL 5 MW data', estimateMin: 25 } });
    await c({ type: 'task.create', input: { title: 'Reply to coach', estimateMin: 15 } });
    await c({ type: 'settings.update', patch: { dayStartMin: 0, dayEndMin: 1440 } });
    await c({ type: 'idea.add', text: 'Cp drops hard past 12 m/s. Ramp pitch from 10 m/s and compare.', taskId: null });
  });
  await home.waitForSelector('.now-hero.is-empty');
  await home.waitForSelector('.tshelf .tcard');
  await home.screenshot({ path: `${shots}/2-home.png` });

  step('Focus: nothing is auto-focused; Space starts the head of the queue, a short Enter does not finish, a 2 s hold does');
  await home.keyboard.press('f');
  await home.waitForSelector('.focus-empty .focus-title');
  await home.keyboard.press('Space');
  await home.waitForSelector('.focus:not(.focus-empty) .focus-title');
  await home.waitForSelector('button:has-text("Pause")');
  await home.waitForTimeout(1500);
  await home.screenshot({ path: `${shots}/3-focus.png` });
  for (const sel of ['.topbar', '.rail-nav', '.widget']) if (await home.locator(sel).count()) throw new Error(`Focus is not silent: ${sel} is shown`);

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
  // Finishing does not promote the next task: Focus shows the empty state.
  await home.waitForSelector('.focus-empty');
  if ((await home.locator('.focus-title').textContent()) !== 'Nothing in focus') throw new Error('finished task is still in focus, or the next one was promoted');
  if (title && (await home.locator('.focus').textContent())?.includes(title)) throw new Error('finished task is still shown in Focus');

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
  step('Plan: the now-line is on the grid and labelled HH:MM');
  await home.waitForSelector('.runway .now .now-label', { state: 'attached' });
  if (!(await home.locator('.runway .now').count())) throw new Error('Plan has no .now line');
  const nowLabel = (await home.locator('.runway .now .now-label').first().textContent())?.trim() ?? '';
  if (!/^\d\d:\d\d$/.test(nowLabel)) throw new Error(`the now-line label is not HH:MM: "${nowLabel}"`);
  await home.screenshot({ path: `${shots}/10-plan-grid.png` });
  const blocks = await home.locator('.blk').count();
  if (blocks > 0) {
    const bb = await home.locator('.blk-body').first().boundingBox();
    const cards = await home.locator('.cards').boundingBox();
    if (bb && cards) {
      await home.mouse.move(bb.x + bb.width / 2, bb.y + bb.height / 2);
      await home.mouse.down();
      await home.mouse.move(cards.x + Math.min(100, cards.width / 2), cards.y + Math.min(60, cards.height / 2), { steps: 8 });
      await home.mouse.up();
      await home.waitForTimeout(600);
      if ((await home.locator('.blk').count()) >= blocks) throw new Error('dropping a block on the cards did not unschedule it');
    }
  }
  await home.keyboard.press('Escape');

  step('Tasks: g then t opens Tasks; quick add makes a row; Ctrl+Enter completes it and an Undo toast appears');
  await home.getByRole('button', { name: 'Home', exact: true }).click();
  await home.waitForSelector('.nowscreen');
  await home.keyboard.press('g');
  await home.keyboard.press('t');
  await home.waitForSelector('.tk');
  await home.locator('.tk-add-input').click();
  await home.keyboard.type('Essay draft fri !1 @school');
  await home.keyboard.press('Enter');
  const essay = home.locator('.tk-row:has-text("Essay draft")');
  // "fri" dates it ahead, so the Today view may not list it; the All view always does.
  const inToday = await essay.first().waitFor({ timeout: 1500 }).then(() => true, () => false);
  if (!inToday) {
    console.log('note: a quick add dated "fri" does not appear in the Tasks Today view (it is in All)');
    await home.locator('.tk-view[aria-keyshortcuts="G A"]').click();
  }
  await essay.first().waitFor({ timeout: 4000 });
  if ((await essay.count()) !== 1) throw new Error('quick add did not create exactly one "Essay draft" row');
  const essayId = await essay.first().getAttribute('data-task');
  const essayTask = await home.evaluate(async (id) => (await window.chronos.getSnapshot()).data.tasks[id], essayId);
  if (essayTask.priority !== 'must' || !essayTask.labels.includes('school') || essayTask.title !== 'Essay draft') throw new Error(`quick add parsed wrongly: ${JSON.stringify({ t: essayTask.title, p: essayTask.priority, l: essayTask.labels })}`);
  await essay.first().focus();
  await home.keyboard.press('Control+Enter');
  await home.waitForSelector('.toast:has-text("done") button:has-text("Undo")');
  await essay.first().waitFor({ state: 'detached', timeout: 4000 });
  await home.screenshot({ path: `${shots}/8-tasks.png` });

  step('Home shelf: drag the running task onto the shelf pauses it; drag a card onto the hero starts it; Esc cancels a drag');
  await home.getByRole('button', { name: 'Home', exact: true }).click();
  await home.waitForSelector('.nowscreen');
  const taskIdOf = (t) => home.evaluate(async (title) => Object.values((await window.chronos.getSnapshot()).data.tasks).find((x) => x.title === title && x.deletedAt === null)?.id, t);
  const NREL = 'Find NREL 5 MW data';
  const COACH = 'Reply to coach';
  await home.evaluate(async (id) => window.chronos.command({ type: 'task.start', id, run: true }), await taskIdOf(NREL));
  await home.waitForSelector(`.now-hero:not(.is-empty) .now-title:has-text("${NREL}")`);
  await overlay.waitForFunction((t) => document.body.innerText.includes(t), NREL, { timeout: 5000 });
  // The "Plan your day" banner can slide in and move the hero: dismiss it, then hover (which waits for a stable box) before pressing.
  const notToday = home.getByRole('button', { name: /^Not today/ });
  if (await notToday.first().waitFor({ timeout: 1500 }).then(() => true, () => false)) await notToday.first().click();
  await home.waitForTimeout(400);
  const drag = async (from, to, { escape = false } = {}) => {
    await from.hover({ position: { x: 60, y: 24 } });
    await home.mouse.down();
    const b = await to.boundingBox();
    if (!b) throw new Error('drag: no target box');
    await home.mouse.move(b.x + b.width / 2, b.y + b.height / 2, { steps: 12 });
    if (escape) await home.keyboard.press('Escape');
    await home.mouse.up();
    await home.waitForTimeout(500);
  };
  await drag(home.locator('.now-grab'), home.locator('.tshelf'));
  await home.waitForSelector('.now-hero.is-empty');
  await home.waitForSelector(`.tshelf .tcard.is-paused:has-text("${NREL}")`);
  await overlay.waitForFunction((t) => !document.body.innerText.includes(t), NREL, { timeout: 5000 });
  await home.screenshot({ path: `${shots}/9-home-shelf.png` });

  await drag(home.locator(`.tshelf .tcard:has-text("${COACH}")`), home.locator('.now-hero'));
  await home.waitForSelector(`.now-hero:not(.is-empty) .now-title:has-text("${COACH}")`);
  if (await home.locator(`.tshelf .tcard:has-text("${COACH}")`).count()) throw new Error('the active task is still on the shelf');

  // Esc while the mouse is down and moved: nothing changes.
  await drag(home.locator('.now-grab'), home.locator('.tshelf'), { escape: true });
  if (await home.locator('.now-hero.is-empty').count()) throw new Error('Esc did not cancel the drag: the task was paused');
  if (!(await home.locator('.now-hero .now-title').textContent())?.includes(COACH)) throw new Error('Esc during a drag changed the active task');
  if (await home.locator(`.tshelf .tcard:has-text("${COACH}")`).count()) throw new Error('Esc during a drag put the task on the shelf');
  await home.evaluate(async (id) => window.chronos.command({ type: 'task.pause', id }), await taskIdOf(COACH));
  await home.waitForSelector('.now-hero.is-empty');

  step('Ctrl+K opens the centred palette; the top-bar field opens the same one; Esc restores focus; > commands run');
  // (No Escape here: on Home with no layer open, Esc hides the window.)
  await home.keyboard.press('Control+k');
  await home.waitForSelector('.pal[role="dialog"][aria-modal="true"]');
  await home.keyboard.type('reply to coach friday 4pm');
  await home.waitForTimeout(300);
  await home.screenshot({ path: `${shots}/8-palette-in-home.png` });
  const box = await home.locator('.pal').boundingBox();
  const vw = await home.evaluate(() => innerWidth);
  if (!box || Math.abs(box.x + box.width / 2 - vw / 2) > 4) throw new Error('palette is not centred');
  await home.keyboard.press('Escape');
  await home.waitForSelector('.pal[role="dialog"]', { state: 'detached' });
  await home.locator('.tb-search').click();
  await home.waitForSelector('.pal[role="dialog"]');
  if (!(await home.evaluate(() => document.activeElement?.id === 'pal-input'))) throw new Error('palette input is not focused');
  await home.keyboard.press('Escape');
  await home.waitForTimeout(100);
  if (!(await home.evaluate(() => document.activeElement?.classList.contains('tb-search')))) throw new Error('Esc did not return focus to the top-bar field');
  await home.keyboard.press('Control+k');
  await home.keyboard.type('>go log');
  await home.keyboard.press('Enter');
  await home.waitForSelector('textarea[aria-label="Write a post"]');
  if (await home.locator('.pal').count()) throw new Error('palette stayed open after navigating');

  step('? opens the help sheet; Esc closes it');
  await home.getByRole('button', { name: 'Home', exact: true }).click();
  await home.locator('.tb-help').click();
  await home.waitForSelector('[role="dialog"][aria-label="Shortcuts and words"]');
  await home.screenshot({ path: `${shots}/13-help.png` });
  await home.keyboard.press('Escape');
  await home.waitForSelector('[role="dialog"][aria-label="Shortcuts and words"]', { state: 'detached' });

  step('navigation closes layers: Schedule (opened from Plan) open, then Tasks, Board, Log, Home each render');
  await home.getByRole('button', { name: 'Home', exact: true }).click();
  for (const [name, sel] of [['Tasks', '.tk'], ['Board', '.bd-shell'], ['Log', '.log'], ['Home', '.nowscreen']]) {
    await home.getByRole('button', { name: 'Home', exact: true }).click();
    await home.locator('.now-bar').getByRole('button', { name: /^Plan/ }).click();
    await home.locator('.plan-back').getByRole('button', { name: 'Schedule' }).click();
    await home.waitForTimeout(250);
    if (!(await home.locator('.home-main').getByText(/schedule|timetable/i).count())) throw new Error('Schedule did not open');
    await home.getByRole('button', { name, exact: true }).click();
    await home.waitForSelector(sel, { timeout: 4000 }).catch(() => { throw new Error(`${name} did not render after Schedule`); });
  }

  step('notepad and palette windows (windows.html#notepad, #palette)');
  await app.evaluate(() => globalThis.__chronosSmoke.openNotepad());
  const notepad = await waitForWindow(app, 'windows.html#notepad');
  await notepad.waitForSelector('textarea');
  await notepad.locator('textarea').click();
  await notepad.keyboard.type('check wind data');
  await notepad.keyboard.press('Control+Enter');
  await notepad.waitForSelector('.np-recent li:has-text("check wind data")', { timeout: 5000 });
  await notepad.waitForTimeout(500);
  await notepad.screenshot({ path: `${shots}/11-notepad.png` });
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

  step('Board: create a project from the header switcher, pin and unpin the list');
  await home.getByRole('button', { name: 'Board', exact: true }).click();
  await home.locator('.bd-empty .bd-input').fill('Wind turbine');
  await home.locator('.bd-empty').getByRole('button', { name: 'Create' }).click();
  await home.waitForSelector('.bd-switch-btn:has-text("Wind turbine")');
  await home.locator('.bd-switch-btn').click();
  await home.locator('.bd-drop').getByRole('button', { name: /New project/ }).click();
  await home.locator('.bd-drop .bd-input').last().fill('Thesis');
  await home.locator('.bd-drop').getByRole('button', { name: 'Create' }).click();
  await home.waitForSelector('.bd-switch-btn:has-text("Thesis")');
  await home.keyboard.press('Control+Shift+P');
  await home.waitForSelector('.bd-drop');
  await home.waitForTimeout(300);
  await home.screenshot({ path: `${shots}/11-board-switcher.png` });
  await home.locator('.bd-pin input').check();
  await home.waitForSelector('.bd-nav');
  await home.locator('.bd-nav').getByRole('button', { name: 'Hide the project list' }).click();
  await home.waitForSelector('.bd-nav', { state: 'detached' });
  await home.getByRole('button', { name: 'Log', exact: true }).click();
  await home.getByRole('button', { name: 'Calendar', exact: true }).click(); // the calendar and "This month" sit behind this button
  await home.waitForSelector('.stats');
  await home.screenshot({ path: `${shots}/12-log.png` });

  step('size presets 90/100/110/125 at 1366x768 and 1920x1080: no horizontal overflow on any screen');
  mkdirSync(`${shots}/sizes`, { recursive: true });
  for (const scale of [90, 100, 110, 125]) {
    await home.evaluate((n) => window.chronos.command({ type: 'device.update', patch: { uiScale: n } }), scale);
    for (const [w, h] of [[1366, 768], [1920, 1080]]) {
      await home.setViewportSize({ width: w, height: h });
      for (const [name, go] of [['home', 'Home'], ['board', 'Board'], ['log', 'Log'], ['settings', 'Settings']]) {
        await home.getByRole('button', { name: go, exact: true }).first().click();
        await home.waitForTimeout(350);
        const over = await home.evaluate(() => {
          const el = document.scrollingElement;
          const scr = document.querySelector('.screen');
          return Math.max(el.scrollWidth - el.clientWidth, scr ? scr.scrollWidth - scr.clientWidth : 0);
        });
        if (over > 1) throw new Error(`${name} overflows horizontally by ${over}px at ${scale}% ${w}x${h}`);
        await home.screenshot({ path: `${shots}/sizes/${scale}-${w}-${name}.jpg`, type: 'jpeg', quality: 55 });
      }
    }
  }
  await home.evaluate(() => window.chronos.command({ type: 'device.update', patch: { uiScale: 100 } }));
  await home.getByRole('button', { name: 'Home', exact: true }).click();

  step('theme matrix: 1440 and 1366 px in every launch theme');
  await home.evaluate(() => window.chronos.command({ type: 'plan.auto' }));
  await home.waitForTimeout(8500); // let the toasts clear before the screenshots
  const themes = ['tactile-instrument', 'stark-workshop', 'tars-gargantua/day', 'tars-gargantua/night', 'flight-plan', 'pit-wall'].filter((id) => !process.env.CHRONOS_SMOKE_THEMES || process.env.CHRONOS_SMOKE_THEMES.split(',').includes(id));
  for (const themeId of themes) {
    await home.evaluate((id) => window.chronos.command({ type: 'settings.update', patch: { themeId: id } }), themeId);
    await home.waitForFunction((id) => document.documentElement.dataset.themeId === id, themeId);
    for (const [w, h] of [[1440, 900], [1366, 768]]) {
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
