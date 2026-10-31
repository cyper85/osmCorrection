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
const CHECKS = (process.env.CHECKS ?? 'phone,url,facebook').split(',');
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
await page.evaluate((checks) => {
  // Ilmenau, zoom 15
  localStorage.setItem('osmCorrection.view', JSON.stringify({ lat: 50.684, lon: 10.917, zoom: 15 }));
  localStorage.setItem('osmCorrection.checks', JSON.stringify(checks));
  localStorage.removeItem('osmCorrection.changes');
}, CHECKS);
await page.reload();

check('login step shown', await page.locator('#step-login').isVisible());
await page.click('#guest');
const sidebarWidth = () => page.locator('#sidebar').evaluate((el) => Math.round(el.getBoundingClientRect().width));
const selectWidth = await sidebarWidth();
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

  await page.keyboard.press('PageDown');
  check('PageDown skips', (await text('progress')).startsWith('Fund 2'));
  await page.keyboard.press('PageUp');
  check('PageUp goes back', (await text('progress')).startsWith('Fund 1'));

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
  await page.evaluate(() => localStorage.removeItem('osmCorrection.changes'));
} else {
  check('confirm mode lists values to confirm', false, 'no values to confirm in the area');
}

check('no page errors', pageErrors.length === 0, pageErrors.join(' | '));
await browser.close();
process.exit(failed ? 1 : 0);
