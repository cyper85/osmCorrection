import { describe, expect, it } from 'vitest';
import {
  aiLabel,
  exportJobs,
  importFindings,
  jobFiles,
  loadOpeningHours,
  sameMeaning,
  readFolder,
  statedAi,
} from '../src/assist.js';
import type { OsmElement } from '../src/osm.js';

function element(type: OsmElement['type'], id: number, tags: Record<string, string>): OsmElement {
  return { type, id, version: 1, tags };
}

const SITE = 'https://www.sonnenschein.example/';
const shop = element('node', 42, { shop: 'bakery', website: SITE, 'addr:street': 'Lindenstraße', 'addr:housenumber': '5' });
const building = element('way', 4711, { building: 'yes', website: SITE, 'addr:street': 'Lindenstraße', 'addr:housenumber': '5' });
const branch = element('node', 43, { shop: 'bakery', website: SITE, 'addr:street': 'Marktstraße', 'addr:housenumber': '1' });
const checked = element('node', 44, { shop: 'florist', website: 'https://blumen.example/', 'check_date:opening_hours': '2026-10-01' });
const noSite = element('node', 45, { shop: 'kiosk' });

describe('exportJobs', () => {
  it('groups elements with the same website and address', () => {
    const jobs = exportJobs([shop, building, branch, checked, noSite], new Date('2026-11-02'));
    expect(jobs).toEqual([
      { id: 'a1', elements: [{ type: 'node', id: 42 }, { type: 'way', id: 4711 }] },
      { id: 'a2', elements: [{ type: 'node', id: 43 }] },
    ]);
  });

  it('splits into files', () => {
    const jobs = Array.from({ length: 5 }, (_, i) => ({ id: `a${i + 1}`, elements: [{ type: 'node' as const, id: i }] }));
    const files = jobFiles(jobs, '2026-11-02', 2);
    expect(files).toHaveLength(3);
    expect(files[2]).toContain('(Teil 3 von 3)');
    expect(files[2]).toContain('- a5: node/4');
  });
});

describe('sameMeaning', () => {
  // first real run in Claude Code (2026-11-02): Eberhardt's Backstube, Tierarztpraxis Klemm
  it('treats explicit closing days as no change', async () => {
    const same = sameMeaning(await loadOpeningHours());
    expect(same('opening_hours', 'Mo-Fr 07:00-17:00; Sa 07:00-11:00; Su,PH off', 'Mo-Fr 07:00-17:00; Sa 07:00-11:00')).toBe(true);
    expect(
      same(
        'opening_hours',
        'Mo,Tu,Th,Fr 10:00-12:00,15:00-18:00; We 10:00-12:00; Sa,Su,PH off',
        'Mo,Tu 10:00-12:00,15:00-18:00; We 10:00-12:00; Th,Fr 10:00-12:00,15:00-18:00',
      ),
    ).toBe(true);
  });

  // first real run in Claude Code (2026-11-02): the hyphen before the extension was dropped
  it('treats phone numbers with the same digits as no change', async () => {
    const same = sameMeaning(await loadOpeningHours());
    expect(same('contact:phone', '+49 3677 6414-0', '+49 3677 64140')).toBe(true);
    expect(same('phone', '+49 3677 1; +49 3677 2', '+49 3677 2;+49 3677 1')).toBe(true);
    expect(same('fax', '+49 3677 6414-0', '+49 3677 6414-9')).toBe(false);
  });

  it('keeps real changes', async () => {
    const same = sameMeaning(await loadOpeningHours());
    expect(same('opening_hours', 'Mo-Sa 08:00-20:00', 'Mo-Sa 07:00-20:00')).toBe(false);
    expect(same('opening_hours', 'kaputt', 'Mo-Sa 07:00-20:00')).toBe(false);
    expect(same('website', 'https://a.de/', 'https://a.de/')).toBe(false);
  });
});

const HTML = `<html><body><p>Öffnungszeiten: Montag bis Freitag 6–18 Uhr</p>
<a href="https://www.instagram.com/sonnenschein_ilmenau/">Instagram</a></body></html>`;

function file(path: string, text: string): File {
  const f = new File([text], path.split('/').at(-1)!);
  Object.defineProperty(f, 'webkitRelativePath', { value: path });
  return f;
}

const answer = {
  format: 'osmcorrection-assist-answer',
  version: 1,
  job: 'a1',
  elements: ['node/42', 'way/4711'],
  url: SITE,
  pages: [{ url: SITE, file: 'seiten/a1-1.html' }],
  proposals: [
    { field: 'opening_hours', network: 'none', value: 'Mo-Fr 06:00-18:00', quote: 'Montag bis Freitag 6-18 Uhr', source_url: SITE },
    {
      field: 'social',
      network: 'instagram',
      value: 'https://www.instagram.com/sonnenschein_ilmenau/',
      quote: 'Instagram (https://www.instagram.com/sonnenschein_ilmenau/)',
      source_url: SITE,
    },
  ],
  signals: [],
};

describe('import', () => {
  it('reads the working folder', async () => {
    const folder = await readFolder([
      file('arbeit/auftrag.md', '# Auftrag'),
      file('arbeit/antworten/a1.json', JSON.stringify(answer)),
      file('arbeit/antworten/a2.json', '{"format":"x"}'),
      file('arbeit/seiten/a1-1.html', HTML),
      file('arbeit/browser/Default/Cookies', ''),
    ]);
    expect(folder.answers.map((a) => a.job)).toEqual(['a1']);
    expect([...folder.pages.keys()]).toEqual(['seiten/a1-1.html']);
    expect(folder.errors).toEqual([expect.stringMatching(/^antworten\/a2\.json: not an answer file/)]);
  });

  it('reads what the answers state about the AI', async () => {
    const withAi = { ...answer, job: 'a2', ai: { vendor: 'Anthropic', model: 'claude-opus-5-5', tool: 'Kiro' } };
    const folder = await readFolder([
      file('arbeit/antworten/a1.json', JSON.stringify(answer)),
      file('arbeit/antworten/a2.json', JSON.stringify(withAi)),
    ]);
    expect(statedAi(folder)).toEqual({
      vendors: ['Anthropic'],
      models: ['claude-opus-5-5'],
      descriptions: ['Anthropic (claude-opus-5-5, Kiro)'],
      missing: 1,
    });
  });

  it('names vendor and model for ai_assisted', () => {
    expect(aiLabel('Anthropic', 'claude-opus-5-5')).toBe('Anthropic Claude Opus 5.5');
    expect(aiLabel('OpenAI', ' gpt-5.2 ')).toBe('OpenAI gpt-5.2');
    expect(aiLabel('Anthropic', '')).toBe('Anthropic');
    expect(aiLabel('Google', 'unknown')).toBe('Google');
  });

  it('turns the answers into findings for each element', async () => {
    const folder = await readFolder([file('arbeit/antworten/a1.json', JSON.stringify(answer)), file('arbeit/seiten/a1-1.html', HTML)]);
    const current = { ...shop, tags: { ...shop.tags, opening_hours: 'Mo-Fr 06:00-18:00' } };
    const issues = await importFindings(folder, [current, building], () => 'DE', '2026-11-02', 'Anthropic');
    expect(issues.map((i) => `${i.element.id} ${i.key}=${i.suggestion}`)).toEqual([
      '42 contact:instagram=https://www.instagram.com/sonnenschein_ilmenau/',
      '4711 opening_hours=Mo-Fr 06:00-18:00',
      '4711 contact:instagram=https://www.instagram.com/sonnenschein_ilmenau/',
    ]);
    expect(issues.every((i) => i.kind === 'proposal' && i.assist?.model === 'Anthropic')).toBe(true);
  });
});
