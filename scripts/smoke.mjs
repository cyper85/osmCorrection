// Smoke test of the UI in a real browser (installed Edge, or Chrome with
// BROWSER=chrome), against live Overpass and the websites in the area.
//
//   npm run build && npx vite preview --port 4173   (in a second terminal)
//   npm run smoke                                   (BASE=… to test another URL)
//
// Runs without login: select, download, review with keyboard shortcuts,
// accept a change, reload, check that the change survived, discard it.
import { chromium } from 'playwright-core';

const BASE = process.env.BASE ?? 'http://127.0.0.1:4173/';
const CHECKS = (process.env.CHECKS ?? 'phone,mail,url,wikipedia,wikidata,facebook').split(',');
// TU Ilmenau campus, where the 500 m frame had several findings in November 2026
const [lat, lon, zoom] = (process.env.VIEW ?? '50.6815,10.9333,16').split(',').map(Number);
const channel = process.env.BROWSER === 'chrome' ? 'chrome' : 'msedge';

const browser = await chromium.launch({ channel, headless: process.env.HEADED === undefined });
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
const pageErrors = [];
page.on('pageerror', (error) => pageErrors.push(error.message));

const text = (id) => page.locator(`#${id}`).innerText();
let failed = false;
function check(label, ok, detail = '') {
  console.log(`${ok ? '✓' : '✗'} ${label}${detail ? `: ${detail}` : ''}`);
  failed ||= !ok;
}

await page.goto(BASE);
await page.evaluate(
  ({ checks, view }) => {
    localStorage.setItem('osmCorrection.view', JSON.stringify(view));
    localStorage.setItem('osmCorrection.checks', JSON.stringify(checks));
    localStorage.removeItem('osmCorrection.changes');
  },
  { checks: CHECKS, view: { lat, lon, zoom } },
);
await page.reload();

check('login step shown', await page.locator('#step-login').isVisible());
await page.click('#guest');
const sidebarWidth = () => page.locator('#sidebar').evaluate((el) => Math.round(el.getBoundingClientRect().width));
const selectWidth = await sidebarWidth();

// download area: the 500 m frame; zoomed out too far, the download is disabled
check('download hint names the limit', /500 m × 500 m/.test(await text('download-hint')), await text('download-hint'));
// one zoom step at a time; a click during the zoom animation is lost
async function zoomBy(steps) {
  for (let i = 0; i < Math.abs(steps); i++) {
    await page.click(steps < 0 ? '.leaflet-control-zoom-out' : '.leaflet-control-zoom-in');
    await page.waitForTimeout(500);
  }
}
if (process.env.SCREENSHOT) {
  await page.screenshot({ path: process.env.SCREENSHOT.replace(/\.png$/, '-select.png') });
}
const below = zoom - 13;
await zoomBy(-below);
check('zoomed out to 13: download disabled', await page.locator('#download').isDisabled(), await text('download-hint'));
await zoomBy(below);
check('zoomed in again: download enabled', !(await page.locator('#download').isDisabled()));

// „Soziale Netze“: switched as a group, networks still chosen one by one
const groupToggle = page.locator('#checks .group-toggle');
const indeterminate = () => groupToggle.evaluate((el) => el.indeterminate);
if (CHECKS.includes('facebook')) {
  check('social group partly chosen', (await indeterminate()) && (await page.locator('#social-items').isVisible()), await text('social-count'));
  await groupToggle.click();
  check('group selects all networks', /\((\d+) von \1\)/.test(await text('social-count')), await text('social-count'));
  await groupToggle.click();
  check('group deselects all networks', /\(0 von/.test(await text('social-count')), await text('social-count'));
  await page.click('#social-items input[value="facebook"]');
  check('single network selectable', (await indeterminate()) && /\(1 von/.test(await text('social-count')), await text('social-count'));
}
await page.click('#download');
await page.waitForSelector('#step-review:not([hidden]), #error:not([hidden])', { timeout: 300_000 });
if (await page.locator('#error').isVisible()) {
  check('download', false, await text('error'));
  await browser.close();
  process.exit(1);
}
check('review step shown', true, await text('progress'));
const reviewWidth = await sidebarWidth();
check('sidebar wider while editing', reviewWidth > selectWidth, `${selectWidth} → ${reviewWidth} px`);
if (process.env.SCREENSHOT) {
  await page.waitForTimeout(1000);
  await page.screenshot({ path: process.env.SCREENSHOT });
}

if (await page.locator('#issue').isVisible()) {
  await page.click('#note-open');
  check('note form with text', /vor Ort prüfen/.test(await page.inputValue('#note-text')), (await page.inputValue('#note-text')).split('\n')[0]);
  check('note needs a login', await page.locator('#note-create').isDisabled(), await text('note-status'));
  await page.keyboard.press('PageDown');
  check('Bild ↓ stays in the note text', (await text('progress')).startsWith('Fund 1'));
  await page.keyboard.press('Escape');
  check('Esc closes the note form', !(await page.locator('#note').isVisible()) && (await page.locator('#issue-form').isVisible()));

  console.log(`  ${await text('issue-key')} = ${await text('issue-value')} → ${await page.inputValue('#issue-input')}`);
  console.log(`  ${(await text('issue-message')).replace(/\n/g, ' / ')}`);

  // with a single finding, Bild ↓ ends the review
  await page.keyboard.press('PageDown');
  check(
    'PageDown skips',
    (await text('progress')).startsWith('Fund 2') || (await page.locator('#review-done').isVisible()),
    await text('progress'),
  );
  await page.keyboard.press('PageUp');
  check('PageUp goes back', (await text('progress')).startsWith('Fund 1') && (await page.locator('#issue-input').isVisible()));

  await page.fill('#issue-input', 'changed by smoke test');
  await page.keyboard.press('Escape');
  check('Esc restores the old value', (await page.inputValue('#issue-input')) === (await text('issue-value')));

  await page.fill('#issue-input', `${await text('issue-value')} smoke`);
  await page.keyboard.press('Enter');
  check('Enter accepts', (await text('to-upload')).includes('(1)'));

  await page.reload();
  await page.click('#guest');
  check('change survives a reload', await page.locator('#pending').isVisible(), await text('pending-count'));
  await page.click('#pending-upload');
  check('upload step lists the change', (await page.locator('#diff li').count()) === 1);
  check('login required for upload', await page.locator('#upload-login-box').isVisible());
  await page.click('#upload-back');
  page.once('dialog', (dialog) => dialog.accept());
  await page.click('#pending-discard');
  check('discard removes the change', !(await page.locator('#pending').isVisible()));
} else {
  check('findings in the frame', false, 'keine Funde, Ausschnitt (VIEW) oder Prüfungen (CHECKS) anpassen');
}

// confirm mode: open the website, then confirm it → check_date
await page.evaluate(() => {
  localStorage.setItem('osmCorrection.checks', JSON.stringify(['confirm-online']));
  localStorage.removeItem('osmCorrection.changes');
});
await page.reload();
await page.click('#guest');
await page.click('#download');
await page.waitForSelector('#step-review:not([hidden]), #error:not([hidden])', { timeout: 300_000 });
if (await page.locator('#error').isVisible()) {
  check('confirm mode download', false, await text('error'));
} else if (await page.locator('#issue').isVisible()) {
  check('confirm mode lists values to confirm', true, `${await text('progress')}, ${await text('issue-key')} = ${await text('issue-value')}`);
  check('confirm button disabled before opening', await page.locator('#verify').isDisabled(), await text('verify-hint'));
  const [popup] = await Promise.all([page.waitForEvent('popup'), page.click('#issue-open')]);
  await popup.close();
  check('confirm button enabled after opening', !(await page.locator('#verify').isDisabled()), await text('verify-hint'));
  await page.click('#verify');
  await page.click('#to-upload');
  const diff = await text('diff');
  check('check_date added as new tag', /check_date:.*neu \d{4}-\d{2}-\d{2}/s.test(diff), diff.replace(/\n/g, ' '));
  check('comment mentions the check', /online geprüft \(check_date\)/.test(await page.inputValue('#comment')), await page.inputValue('#comment'));

  // no longer existing: choose per tag, the closure is listed and removed as a whole
  await page.click('#upload-back');
  await page.click('#close-open');
  const rows = await page.locator('#closure-tags tr').count();
  check('closure lists all tags', (await page.locator('#closure').isVisible()) && rows > 0, `${rows} Tags, ${await text('closure-result')}`);
  await page.keyboard.press('Escape');
  check('Esc closes the closure', !(await page.locator('#closure').isVisible()) && (await page.locator('#issue-form').isVisible()));
  await page.click('#close-open');
  await page.click('#closure-apply');
  await page.click('#to-upload');
  const closedDiff = await text('diff');
  check('closure removes tags', /löschen/.test(closedDiff), closedDiff.replace(/\n/g, ' ').slice(0, 300));
  check('comment mentions the closure', /existiert nicht mehr: 1 Objekt/.test(await page.inputValue('#comment')), await page.inputValue('#comment'));
  const before = await page.locator('#diff li').count();
  await page.locator('#diff button', { hasText: 'existiert nicht mehr' }).first().click();
  const closedLeft = await page.locator('#diff button', { hasText: 'existiert nicht mehr' }).count();
  check('closure is discarded as a whole', closedLeft === 0, `${before} → ${await page.locator('#diff li').count()} Änderungen`);

  // nothing left to upload (as after an upload): no list, no comment, only the way on
  while ((await page.locator('#diff button').count()) > 0) {
    await page.locator('#diff button').first().click();
  }
  check(
    'empty upload step shows only the way on',
    !(await page.locator('#upload-form').isVisible()) && (await page.locator('#upload-done').isVisible()),
  );
  await page.click('#upload-continue');
  check('continue goes back to the review', await page.locator('#step-review').isVisible());
  await page.evaluate(() => localStorage.removeItem('osmCorrection.changes'));
} else {
  check('confirm mode lists values to confirm', false, 'no values to confirm in the area');
}

check('no page errors', pageErrors.length === 0, pageErrors.join(' | '));
await browser.close();
process.exit(failed ? 1 : 0);
