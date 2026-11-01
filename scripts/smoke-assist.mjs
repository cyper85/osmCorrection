// Browser test of the AI assistance with a recorded answer: Overpass, Nominatim
// and the Anthropic API are replaced, so it costs nothing and needs no key.
//
//   npm run build && npx vite preview --port 4173   (in a second terminal)
//   npm run smoke:assist
import { chromium } from 'playwright-core';

const BASE = process.env.BASE ?? 'http://127.0.0.1:4173/';
const SITE = 'https://www.baeckerei-sonnenschein.example/';
const PAGE = `Bäckerei Sonnenschein
Öffnungszeiten: Montag bis Freitag 6–18 Uhr, Samstag 6–12 Uhr
Folgen Sie uns: https://www.instagram.com/sonnenschein_ilmenau/`;

const element = {
  type: 'node',
  id: 42,
  version: 3,
  lat: 50.6815,
  lon: 10.9333,
  tags: { shop: 'bakery', name: 'Bäckerei Sonnenschein', website: SITE, opening_hours: 'Mo-Fr 07:00-18:00' },
};

// a second element with the same website, e.g. the building of the shop
const building = {
  type: 'node',
  id: 43,
  version: 1,
  lat: 50.6816,
  lon: 10.9334,
  tags: { building: 'yes', website: SITE, opening_hours: 'Mo-Fr 06:00-18:00; Sa 06:00-12:00' },
};

const answer = {
  proposals: [
    {
      field: 'opening_hours',
      network: 'none',
      value: 'Mo-Fr 06:00-18:00; Sa 06:00-12:00',
      quote: 'Öffnungszeiten: Montag bis Freitag 6-18 Uhr, Samstag 6-12 Uhr',
      source_url: SITE,
    },
    {
      field: 'social',
      network: 'instagram',
      value: 'https://www.instagram.com/sonnenschein_ilmenau/',
      quote: 'Folgen Sie uns: https://www.instagram.com/sonnenschein_ilmenau/',
      source_url: SITE,
    },
    { field: 'phone', network: 'none', value: '+49 3677 999999', quote: 'Telefon: 03677 999999', source_url: SITE },
  ],
  signals: [],
};

const message = {
  id: 'msg_1',
  type: 'message',
  role: 'assistant',
  model: 'claude-sonnet-5-5',
  stop_reason: 'end_turn',
  stop_sequence: null,
  usage: { input_tokens: 12000, output_tokens: 800, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 },
  content: [
    { type: 'server_tool_use', id: 'srvtoolu_1', name: 'web_fetch', input: { url: SITE } },
    {
      type: 'web_fetch_tool_result',
      tool_use_id: 'srvtoolu_1',
      content: {
        type: 'web_fetch_result',
        url: SITE,
        retrieved_at: '2026-11-01T10:00:00Z',
        content: { type: 'document', title: null, citations: null, source: { type: 'text', media_type: 'text/plain', data: PAGE } },
      },
    },
    { type: 'text', text: JSON.stringify(answer) },
  ],
};

const browser = await chromium.launch({ channel: process.env.BROWSER === 'chrome' ? 'chrome' : 'msedge' });
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
const pageErrors = [];
page.on('pageerror', (error) => pageErrors.push(error.message));
let failed = false;
function check(label, ok, detail = '') {
  console.log(`${ok ? '✓' : '✗'} ${label}${detail ? `: ${detail}` : ''}`);
  failed ||= !ok;
}
const text = (id) => page.locator(`#${id}`).innerText();

await page.route(/interpreter/, (route) => route.fulfill({ contentType: 'application/json', body: JSON.stringify({ elements: [element, building] }) }));
await page.route(/nominatim/, (route) => route.fulfill({ contentType: 'application/json', body: '{"address":{"country_code":"de"}}' }));
let apiRequest;
let apiCalls = 0;
const cors = { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': 'POST, OPTIONS' };
await page.route('https://api.anthropic.com/**', async (route) => {
  if (route.request().method() === 'OPTIONS') {
    await route.fulfill({ status: 204, headers: cors });
    return;
  }
  apiCalls += 1;
  apiRequest = { headers: route.request().headers(), body: route.request().postDataJSON() };
  await page.waitForTimeout(300);
  await route.fulfill({ headers: { ...cors, 'content-type': 'application/json' }, body: JSON.stringify(message) });
});

await page.goto(BASE);
await page.evaluate(() => {
  localStorage.setItem('osmCorrection.view', JSON.stringify({ lat: 50.6815, lon: 10.9333, zoom: 16 }));
  localStorage.setItem('osmCorrection.checks', JSON.stringify(['ai-assist']));
  localStorage.removeItem('osmCorrection.changes');
  localStorage.removeItem('osmCorrection.aiKey');
  sessionStorage.removeItem('osmCorrection.aiKey');
});
await page.reload();
await page.click('#guest');

check('settings shown with the check', await page.locator('#assist-settings').isVisible(), await text('ai-cost'));
await page.fill('#ai-key', 'sk-ant-test');
await page.locator('#ai-key').dispatchEvent('change');

await page.click('#download');
await page.waitForSelector('#step-review:not([hidden])');
check('finding to analyze', await page.locator('#assist').isVisible(), await text('assist-status'));

await page.click('#assist-run');
await page.waitForFunction(() => /Vorschl/.test(document.querySelector('#assist-status')?.textContent ?? ''), null, { timeout: 15_000 });
check('result summary', /2 Vorschläge/.test(await text('assist-status')), await text('assist-status'));
check('invented phone number rejected', /verworfen: contact:phone/.test(await text('assist-details')), (await text('assist-details')).replace(/\n/g, ' | '));
const tool = apiRequest?.body?.tools?.[0];
check(
  'only the site is fetched',
  tool?.type === 'web_fetch_20250910' && JSON.stringify(tool.allowed_domains) === '["baeckerei-sonnenschein.example"]',
  JSON.stringify(tool),
);
const sentKey = apiRequest?.headers['x-api-key'] ?? apiRequest?.headers.authorization?.replace(/^Bearer /, '');
check('key sent to the API', sentKey === 'sk-ant-test', Object.keys(apiRequest?.headers ?? {}).filter((h) => /key|auth|anthropic/.test(h)).join(', '));

await page.keyboard.press('Enter');
check('opening hours suggested', (await text('issue-key')) === 'opening_hours' && (await page.inputValue('#issue-input')) === 'Mo-Fr 06:00-18:00; Sa 06:00-12:00');
check('quote and source shown', /Montag bis Freitag/.test(await text('issue-quote')), (await text('issue-quote')).replace(/\n/g, ' '));
if (process.env.SCREENSHOT) {
  await page.screenshot({ path: process.env.SCREENSHOT });
}
check('verify button hidden for suggestions', !(await page.locator('#verify').isVisible()));
await page.keyboard.press('Enter');
check('new profile suggested', (await text('issue-key')) === 'contact:instagram' && (await text('issue-value')) === '(fehlt)');
await page.keyboard.press('Enter');

// same website: the reading is reused, compared with the tags of the building
check('second element with the same website', await page.locator('#assist').isVisible(), await text('assist-status'));
check('marked as already read', /schon ausgewertet/.test(await text('assist-status')));
await page.click('#assist-run');
await page.waitForFunction(() => /Vorschl/.test(document.querySelector('#assist-status')?.textContent ?? ''), null, { timeout: 15_000 });
check('reused without a second API call', apiCalls === 1 && /keine weiteren Kosten/.test(await text('assist-status')), await text('assist-status'));
check('only what differs for the building', /1 Vorschlag,/.test(await text('assist-status')) && /stimmt mit OSM/.test(await text('assist-details')));
await page.keyboard.press('Enter');
check('building gets the profile', (await text('issue-key')) === 'contact:instagram' && (await text('issue-link')) !== 'Bäckerei Sonnenschein');
await page.keyboard.press('PageDown');

await page.click('#to-upload');
const diff = (await text('diff')).replace(/\n/g, ' ');
check('source and check_date', /source:opening_hours.*website/.test(diff) && /check_date:opening_hours/.test(diff), diff.slice(0, 300));
check('suggestion marked in the list', /Vorschlag von Anthropic Claude Sonnet 5\.5/.test(diff));
const comment = await page.inputValue('#comment');
check('comment names the AI', /KI-Unterstützung \(Anthropic Claude Sonnet 5\.5\)/.test(comment), comment);

await page.evaluate(() => {
  localStorage.removeItem('osmCorrection.changes');
  localStorage.removeItem('osmCorrection.aiKey');
  sessionStorage.removeItem('osmCorrection.aiKey');
});
check('no page errors', pageErrors.length === 0, pageErrors.join(' | '));
await browser.close();
process.exit(failed ? 1 : 0);
