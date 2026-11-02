// Screenshots for the help pages (hilfe.html, help.html), in every language.
// Overpass, Nominatim, the OSM API and the Anthropic API are replaced by
// made-up data; only the map tiles come from openstreetmap.org.
//
//   npm run build && npx vite preview --port 4173   (in a second terminal)
//   npm run screenshots                              (LANGS=de to take only some)
//
// Writes public/help/<lang>/*.png and *.jpg (full window as JPEG, because of the map).
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';

const BASE = process.env.BASE ?? 'http://127.0.0.1:4173/';
const LANGS = (process.env.LANGS ?? 'de,en').split(',');
const OUT = new URL('../public/help/', import.meta.url);
const VIEW = { lat: 50.6837, lon: 10.9185, zoom: 17 };

// made-up shops around the market square of Ilmenau; the values have the usual mistakes
const SITE = 'https://www.baeckerei-sonnenschein.example/';
const elements = [
  {
    type: 'node', id: 9000001, version: 4, lat: 50.68395, lon: 10.91808,
    tags: { amenity: 'cafe', name: 'Café am Markt', phone: '0049 3677 123456', website: 'http://cafe-am-markt.example/', email: 'info@cafe-am-markt.example' },
  },
  {
    type: 'node', id: 9000002, version: 2, lat: 50.68342, lon: 10.91911,
    tags: { shop: 'books', name: 'Buchhandlung Seitenweise', 'contact:phone': '03677 98765', website: 'https://seitenweise.example/', 'contact:website': 'https://seitenweise.example/' },
  },
  {
    type: 'node', id: 9000003, version: 7, lat: 50.68301, lon: 10.91702,
    tags: { shop: 'florist', name: 'Blumen Lindner', email: 'kontakt@blumen-lindner .example', phone: '+49 3677 55443;' },
  },
  {
    type: 'node', id: 9000004, version: 3, lat: 50.68432, lon: 10.92012,
    tags: { shop: 'bakery', name: 'Bäckerei Sonnenschein', website: SITE, opening_hours: 'Mo-Fr 07:00-18:00' },
  },
];
const bakery = elements[3];
// what Overpass answers: all shops, or only the bakery for the AI
let served = elements;

const PAGE = `Bäckerei Sonnenschein
Öffnungszeiten: Montag bis Freitag 6–18 Uhr, Samstag 6–12 Uhr
Telefon: 03677 999999
Folgen Sie uns: https://www.instagram.com/sonnenschein_ilmenau/`;
const answer = {
  proposals: [
    { field: 'opening_hours', network: 'none', value: 'Mo-Fr 06:00-18:00; Sa 06:00-12:00', quote: 'Öffnungszeiten: Montag bis Freitag 6–18 Uhr, Samstag 6–12 Uhr', source_url: SITE },
    { field: 'phone', network: 'none', value: '+49 3677 999999', quote: 'Telefon: 03677 999999', source_url: SITE },
    { field: 'social', network: 'instagram', value: 'https://www.instagram.com/sonnenschein_ilmenau/', quote: 'Folgen Sie uns: https://www.instagram.com/sonnenschein_ilmenau/', source_url: SITE },
  ],
  signals: [],
};
const message = {
  id: 'msg_1', type: 'message', role: 'assistant', model: 'claude-sonnet-5-5', stop_reason: 'end_turn', stop_sequence: null,
  usage: { input_tokens: 14200, output_tokens: 900, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 },
  content: [
    { type: 'server_tool_use', id: 'srvtoolu_1', name: 'web_fetch', input: { url: SITE } },
    {
      type: 'web_fetch_tool_result', tool_use_id: 'srvtoolu_1',
      content: {
        type: 'web_fetch_result', url: SITE, retrieved_at: '2026-11-02T10:00:00Z',
        content: { type: 'document', title: null, citations: null, source: { type: 'text', media_type: 'text/plain', data: PAGE } },
      },
    },
    { type: 'text', text: JSON.stringify(answer) },
  ],
};

const browser = await chromium.launch({ channel: process.env.BROWSER === 'chrome' ? 'chrome' : 'msedge' });
const pageErrors = [];

for (const lang of LANGS) {
  const dir = new URL(`${lang}/`, OUT);
  mkdirSync(dir, { recursive: true });
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 }, locale: lang, deviceScaleFactor: 1, colorScheme: 'light' });
  page.on('pageerror', (error) => pageErrors.push(`${lang}: ${error.message}`));
  page.on('dialog', (dialog) => dialog.accept());
  await mock(page);

  const highlight = (selector) => page.locator(selector).evaluateAll((list) => list.forEach((el) => el.classList.add('shot-highlight')));
  const clear = () => page.evaluate(() => document.querySelectorAll('.shot-highlight').forEach((el) => el.classList.remove('shot-highlight')));
  // the whole window (with the map), as JPEG
  async function full(name, ...marked) {
    for (const selector of marked) await highlight(selector);
    await page.waitForTimeout(300);
    await page.screenshot({ path: fileURLToPath(new URL(`${name}.jpg`, dir)), type: 'jpeg', quality: 80 });
    await clear();
    console.log(`${lang}/${name}.jpg`);
  }
  // the area around some elements of the sidebar, as PNG
  async function part(name, selectors, ...marked) {
    for (const selector of marked) await highlight(selector);
    // a tall window, so the whole sidebar fits without scrolling
    await page.setViewportSize({ width: 1280, height: 2000 });
    await page.locator('#sidebar').evaluate((el) => el.scrollTo(0, 0));
    const boxes = [];
    for (const selector of selectors) {
      const box = await page.locator(selector).first().boundingBox();
      if (box) boxes.push(box);
    }
    if (boxes.length === 0) throw new Error(`${name}: nothing to show (${selectors.join(', ')})`);
    const sidebar = await page.locator('#sidebar').boundingBox();
    const top = Math.max(0, Math.min(...boxes.map((b) => b.y)) - 10);
    const bottom = Math.max(...boxes.map((b) => b.y + b.height)) + 10;
    await page.screenshot({ path: fileURLToPath(new URL(`${name}.png`, dir)), clip: { x: sidebar.x, y: top, width: sidebar.width, height: bottom - top } });
    await page.setViewportSize({ width: 1280, height: 800 });
    await clear();
    console.log(`${lang}/${name}.png`);
  }

  async function start(checks, shops = elements) {
    served = shops;
    await page.goto(BASE);
    await page.evaluate(
      ({ checks, view }) => {
        localStorage.clear();
        sessionStorage.clear();
        localStorage.setItem('osmCorrection.view', JSON.stringify(view));
        localStorage.setItem('osmCorrection.checks', JSON.stringify(checks));
      },
      { checks, view: VIEW },
    );
    await page.reload();
    await page.addStyleTag({ content: '.shot-highlight { outline: 3px solid #e8590c !important; outline-offset: 3px; border-radius: 4px; }' });
    await page.waitForLoadState('networkidle');
  }

  // ---------------------------------------------------------------- login, select
  await start(['phone', 'mail', 'url', 'duplicates']);
  await part('login', ['#sidebar header', '#step-login'], '#login', '#guest');
  await page.click('#guest');
  await page.waitForTimeout(800);
  await full('select', '#download');
  await part('checks', ['#search-form', '#online-checks']);

  // ---------------------------------------------------------------- review
  await page.click('#download');
  await page.waitForSelector('#step-review:not([hidden])');
  await page.waitForTimeout(1000);
  await full('review', '#accept');
  await part('finding', ['#step-review h2', '#issue-form'], '#issue-input');
  await page.click('#note-open');
  await part('note', ['#note']);
  await page.keyboard.press('Escape');
  await page.click('#close-open');
  await part('closure', ['#closure']);
  await page.keyboard.press('Escape');
  // accept a few findings for the upload step
  for (let i = 0; i < 3 && (await page.locator('#issue-form').isVisible()); i++) {
    await page.keyboard.press('Enter');
    await page.waitForTimeout(200);
  }
  await page.click('#to-upload');
  await page.waitForSelector('#step-upload:not([hidden])');
  await part('upload', ['#step-upload'], '#comment');

  // ---------------------------------------------------------------- AI with an API key
  await start(['ai-assist'], [bakery]);
  await page.click('#guest');
  await page.fill('#ai-key', 'sk-ant-api03-example');
  await page.locator('#ai-key').dispatchEvent('change');
  await part('ai-settings', ['#online-checks', '#assist-settings'], '#ai-key');
  await page.click('#download');
  await page.waitForSelector('#step-review:not([hidden])');
  await part('ai-run', ['#step-review h2', '#assist'], '#assist-run');
  await page.click('#assist-run');
  await page.waitForFunction(() => /\d/.test(document.querySelector('#assist-status')?.textContent ?? '') && !document.querySelector('#assist-cancel:not([hidden])'), null, { timeout: 15_000 });
  await part('ai-result', ['#assist']);
  await page.keyboard.press('Enter');
  await page.waitForTimeout(300);
  await part('ai-proposal', ['#issue .element', '#issue-form > .row'], '#issue-quote');

  // ---------------------------------------------------------------- AI agent
  await start(['ai-assist'], [bakery]);
  await page.click('#guest');
  const [download] = await Promise.all([page.waitForEvent('download'), page.click('#export-claude')]);
  const job = await download.path();
  await part('agent-export', ['#download', '#claude-code'], '#export-claude', '#import-claude');
  const folder = mkdtempSync(join(tmpdir(), 'osmcorrection-help-'));
  const folders = lang === 'de' ? { file: 'auftrag.md', pages: 'seiten', answers: 'antworten' } : { file: 'job.md', pages: 'pages', answers: 'answers' };
  mkdirSync(join(folder, folders.pages));
  mkdirSync(join(folder, folders.answers));
  writeFileSync(join(folder, folders.file), readFileSync(job));
  writeFileSync(join(folder, folders.pages, 'a1-1.html'), `<html><body><p>${PAGE.replace(/\n/g, '</p><p>')}</p></body></html>`);
  writeFileSync(
    join(folder, folders.answers, 'a1.json'),
    JSON.stringify({
      format: 'osmcorrection-assist-answer', version: 1,
      ai: { vendor: 'anthropic', model: 'claude-opus-5-5', tool: 'Claude Code' },
      job: 'a1', elements: [`node/${bakery.id}`], url: SITE, fetched_with: 'browser',
      pages: [{ url: SITE, file: `${folders.pages}/a1-1.html` }],
      ...answer,
    }),
  );
  await page.setInputFiles('#import-folder', folder);
  await page.waitForSelector('#import-confirm:not([hidden])');
  await part('agent-import', ['#import-confirm'], '#import-confirm-ok');
  await page.click('#import-confirm-ok');
  await page.waitForSelector('#step-review:not([hidden])');
  await part('agent-review', ['#step-review h2', '#review-notice', '#issue-quote']);
  rmSync(folder, { recursive: true, force: true });

  await page.close();
}

await browser.close();
if (pageErrors.length > 0) {
  console.error(pageErrors.join('\n'));
  process.exit(1);
}

/** Made-up answers for everything except the page itself and the map tiles. */
async function mock(page) {
  const json = (body) => ({ contentType: 'application/json', body: JSON.stringify(body) });
  const cors = { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': 'GET, POST, OPTIONS' };
  await page.route(
    (url) => !url.href.startsWith(BASE) && !/tile\.openstreetmap\.org/.test(url.hostname),
    async (route) => {
      const url = new URL(route.request().url());
      if (route.request().method() === 'OPTIONS') {
        return route.fulfill({ status: 204, headers: cors });
      }
      if (/interpreter/.test(url.pathname)) {
        return route.fulfill(json({ elements: served }));
      }
      if (/nominatim/.test(url.hostname)) {
        return route.fulfill(json(url.pathname.includes('search') ? [] : { address: { country_code: 'de' } }));
      }
      if (url.hostname === 'api.openstreetmap.org') {
        const ids = (url.searchParams.get('nodes') ?? '').split(',').map(Number);
        return route.fulfill({ ...json({ elements: elements.filter((e) => ids.includes(e.id)) }), headers: cors });
      }
      if (url.hostname === 'api.anthropic.com') {
        await new Promise((resolve) => setTimeout(resolve, 300));
        return route.fulfill({ headers: { ...cors, 'content-type': 'application/json' }, body: JSON.stringify(message) });
      }
      return route.abort();
    },
  );
}
