// End-to-end happy path in a real browser against a fresh database.
// Run after `npm run build`:  npm run test:e2e
// Set SCREENSHOT_DIR to also save screenshots at phone, tablet and desktop widths.
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import writeXlsxFile from 'write-excel-file/node';

const PORT = 3999;
const BASE = `http://localhost:${PORT}`;
const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'i8-e2e-'));
const shots = process.env.SCREENSHOT_DIR;

const server = spawn(process.execPath, ['server/index.js'], {
  env: { ...process.env, PORT: String(PORT), DATA_DIR: dataDir },
  stdio: ['ignore', 'pipe', 'inherit'],
});
await new Promise((resolve, reject) => {
  server.stdout.on('data', (d) => String(d).includes('running') && resolve());
  server.on('exit', (code) => reject(new Error(`server exited ${code}`)));
});

const browser = await chromium.launch(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {});
let failed = false;
try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));

  // 1. First-run setup creates the owner
  await page.goto(BASE);
  await page.getByRole('heading', { name: 'Set up your studio' }).waitFor();
  await page.getByLabel('Your name').fill('Tanner');
  await page.getByLabel('Email').fill('tanner@example.com');
  await page.getByLabel('Password').fill('password123');
  await page.getByRole('button', { name: 'Create account' }).click();
  await page.getByRole('heading', { name: /Tanner/ }).waitFor();

  // 2. Create a board
  await page.getByRole('button', { name: '+ New board' }).click();
  await page.getByLabel('Board name').fill('Coffee shop rebrand');
  await page.getByRole('button', { name: 'Create board' }).click();
  await page.getByRole('heading', { name: 'Coffee shop rebrand' }).waitFor();

  // 3. Kanban: quick-add a task in "To do"
  await page.getByRole('tab', { name: 'Kanban' }).click();
  const todo = page.getByRole('region', { name: 'To do' });
  await todo.getByRole('button', { name: '+ Add task' }).click();
  await todo.getByLabel('New task in To do').fill('Logo concepts');
  await todo.getByLabel('New task in To do').press('Enter');
  const card = todo.getByText('Logo concepts');
  await card.waitFor();

  // 4. Drag it to "In progress"
  const doing = page.getByRole('region', { name: 'In progress' });
  const from = await card.boundingBox();
  const to = await doing.boundingBox();
  await page.mouse.move(from.x + 20, from.y + 10);
  await page.mouse.down();
  await page.mouse.move(from.x + 40, from.y + 20, { steps: 5 });
  await page.mouse.move(to.x + to.width / 2, to.y + 80, { steps: 15 });
  await page.mouse.up();
  await doing.getByText('Logo concepts').waitFor();
  assert.equal(await todo.getByText('Logo concepts').count(), 0, 'card should leave To do');

  // 5. Open the task, set a due date, add a comment
  await doing.getByText('Logo concepts').click();
  const drawer = page.getByRole('dialog', { name: 'Task details' });
  await drawer.waitFor();
  const due = new Date(Date.now() + 3 * 86400000).toISOString().slice(0, 10);
  await drawer.getByLabel('Due date').fill(due);
  await drawer.getByLabel('New comment').fill('Three directions please');
  await drawer.getByRole('button', { name: 'Comment' }).click();
  await drawer.getByText('Three directions please').waitFor();
  await drawer.getByRole('button', { name: 'Close task' }).click();

  // 6. Every view renders the task
  await page.getByRole('tab', { name: 'Table' }).click();
  assert.equal(await page.getByLabel('Task name').first().inputValue(), 'Logo concepts');
  await page.getByRole('tab', { name: 'Timeline' }).click();
  await page.locator('.tl-bar', { hasText: 'Logo concepts' }).waitFor();
  await page.getByRole('tab', { name: 'Calendar' }).click();
  await page.locator('.cal-item', { hasText: 'Logo concepts' }).waitFor();

  // 7. Home shows it under My tasks? (unassigned, so not yet) - assign and check
  await page.locator('.cal-item', { hasText: 'Logo concepts' }).click();
  await drawer.getByLabel('Owner').selectOption({ label: 'Tanner' });
  await page.waitForTimeout(300);
  await drawer.getByRole('button', { name: 'Close task' }).click();
  await page.getByRole('link', { name: 'Home' }).click();
  await page.locator('.my-item', { hasText: 'Logo concepts' }).waitFor();

  // 8. Import a Monday.com Excel export
  const xlsx = path.join(dataDir, 'monday.xlsx');
  const cells = (rows) => rows.map((r) => r.map((v) => (v === '' ? null : { value: v })));
  await writeXlsxFile(cells([
    ['Old Monday board'], [], ['Phase 1'],
    ['Name', 'Subitems', 'Person', 'Status', 'Date'],
    ['Brand guide', '', 'Tanner', 'Working on it', '2026-11-20'],
    ['', 'Subitems', 'Name', 'Status'],
    ['', '', 'Colours', 'Done'],
    ['Business cards', '', '', 'Done', '2026-11-10'],
  ]), { filePath: xlsx });
  await page.getByRole('button', { name: '+ New board' }).click();
  await page.getByLabel('Start from').selectOption('monday');
  await page.setInputFiles('#monday-file', xlsx);
  await page.getByRole('button', { name: 'Import 2 items' }).click();
  await page.getByRole('heading', { name: 'Old Monday board' }).waitFor();
  await page.getByRole('tab', { name: 'Kanban' }).click();
  await page.getByRole('region', { name: 'Working on it' }).getByText('Brand guide').waitFor();
  await page.getByRole('region', { name: 'Done' }).getByText('Business cards').waitFor();

  // 9. Share a project with someone new through a view-only invite link
  await page.getByRole('link', { name: 'Coffee shop rebrand' }).first().click();
  await page.getByRole('heading', { name: 'Coffee shop rebrand' }).waitFor();
  assert.match(await page.locator('.project-id').innerText(), /^PRJ-0001/);
  await page.getByRole('button', { name: 'Share' }).click();
  const share = page.getByRole('dialog', { name: 'Share project' });
  await share.getByLabel('Access for the new link').selectOption('viewer');
  await share.getByRole('button', { name: 'Create link & copy' }).click();
  const link = share.getByLabel('Invite link').first();
  await link.waitFor();
  const inviteUrl = await link.inputValue();
  assert.match(inviteUrl, /\/join\/[\w-]+$/);
  if (shots) await page.screenshot({ path: path.join(shots, 'share-modal.png') });
  await share.getByRole('button', { name: 'Close' }).click();

  const guestCtx = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const guest = await guestCtx.newPage();
  guest.on('pageerror', (e) => errors.push(e.message));
  await guest.goto(inviteUrl);
  await guest.getByText('invited you to').waitFor();
  assert.match(await guest.locator('.invite-banner').innerText(), /Tanner invited you to Coffee shop rebrand/);
  if (shots) await guest.screenshot({ path: path.join(shots, 'invite-signup.png') });
  await guest.getByLabel('Your name').fill('Client Person');
  await guest.getByLabel('Email').fill('client@example.com');
  await guest.getByLabel('Password').fill('password123');
  await guest.getByRole('button', { name: 'Create account' }).click();
  await guest.getByRole('heading', { name: 'Coffee shop rebrand' }).waitFor();
  await guest.getByText('Shared with you · view & comment').waitFor();
  assert.equal(await guest.getByRole('button', { name: '+ New task' }).count(), 0, 'viewer cannot add tasks');
  assert.equal(await guest.getByRole('button', { name: 'Share' }).count(), 0, 'guest cannot share');
  // The guest's menu lists only the shared project.
  await guest.getByRole('button', { name: 'Open menu' }).click();
  assert.deepEqual(await guest.locator('.side-boards a').allInnerTexts(), ['Coffee shop rebrand']);
  await guest.keyboard.press('Escape');
  if (shots) await guest.screenshot({ path: path.join(shots, 'guest-board.png') });
  await guestCtx.close();

  // The owner sees them in the share list.
  await page.getByRole('button', { name: 'Share' }).click();
  await share.getByText('Client Person').waitFor();
  await share.getByRole('button', { name: 'Close' }).click();

  assert.deepEqual(errors, [], 'no page errors');
  console.log('E2E passed: setup → board → add → drag → comment → all views → my tasks → Monday.com import → share & join as guest');

  if (shots) {
    fs.mkdirSync(shots, { recursive: true });
    const boardUrl = page.url();
    for (const [w, h] of [[1280, 800], [768, 1000], [375, 780]]) {
      await page.setViewportSize({ width: w, height: h });
      await page.goto(`${BASE}/`);
      await page.waitForTimeout(400);
      await page.screenshot({ path: path.join(shots, `home-${w}.png`) });
      const link = await page.locator('.board-card').first().getAttribute('href');
      for (const v of ['kanban', 'table', 'timeline', 'calendar']) {
        await page.goto(`${BASE}${link}?view=${v}`);
        await page.waitForTimeout(400);
        await page.screenshot({ path: path.join(shots, `${v}-${w}.png`) });
      }
    }
    void boardUrl;
  }
} catch (err) {
  failed = true;
  console.error('E2E failed:', err);
} finally {
  await browser.close();
  server.kill();
  fs.rmSync(dataDir, { recursive: true, force: true });
}
process.exit(failed ? 1 : 0);
