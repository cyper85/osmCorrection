import { afterEach, describe, expect, it, vi } from 'vitest';
import type { OsmElement } from '../src/osm.js';
import { fetchItems, referenceIssues, referencesToFetch, wikiSite, type WikidataItem } from '../src/references.js';

function node(id: number, tags: Record<string, string>): OsmElement {
  return { type: 'node', id, version: 1, lat: 0, lon: 0, tags };
}

function items(entries: Record<string, Partial<WikidataItem>>): Map<string, WikidataItem> {
  return new Map(
    Object.entries(entries).map(([id, item]) => [id, { id, missing: false, sitelinks: {}, ...item }]),
  );
}

describe('wikiSite', () => {
  it('builds the site ID', () => {
    expect(wikiSite('de')).toBe('dewiki');
    expect(wikiSite('zh-yue')).toBe('zh_yuewiki');
  });
});

describe('referencesToFetch', () => {
  it('collects valid IDs and Wikipedia languages', () => {
    const result = referencesToFetch([
      node(1, { wikidata: 'Q64', wikipedia: 'de:Berlin' }),
      node(2, { 'brand:wikidata': 'Q1;Q2', wikipedia: 'en:Foo' }),
      node(3, { wikidata: 'https://www.wikidata.org/wiki/Q5', wikipedia: 'Berlin' }),
    ]);
    expect(result).toEqual({ ids: ['Q64', 'Q1', 'Q2'], languages: ['de', 'en'] });
  });
});

describe('referenceIssues', () => {
  it('reports missing items', () => {
    const issues = referenceIssues([node(1, { wikidata: 'Q5' })], items({ Q5: { missing: true } }), []);
    expect(issues).toHaveLength(1);
    expect(issues[0]).toMatchObject({ key: 'wikidata', valid: false });
    expect(issues[0]?.suggestion).toBeUndefined();
  });

  it('suggests the target of a redirect, also in multi-values', () => {
    const issues = referenceIssues([node(1, { 'brand:wikidata': 'Q1;Q2' })], items({ Q1: {}, Q2: { id: 'Q3' } }), []);
    expect(issues[0]).toMatchObject({ key: 'brand:wikidata', suggestion: 'Q1;Q3' });
    expect(issues[0]?.message).toMatch(/Q2 ist eine Weiterleitung auf Q3/);
  });

  it('accepts a matching wikipedia tag', () => {
    const issues = referenceIssues(
      [node(1, { wikidata: 'Q64', wikipedia: 'de:berlin_Mitte' })],
      items({ Q64: { sitelinks: { dewiki: 'Berlin Mitte' } } }),
      [],
    );
    expect(issues).toEqual([]);
  });

  it('suggests the linked article if the wikipedia tag differs', () => {
    const issues = referenceIssues(
      [node(1, { wikidata: 'Q64', wikipedia: 'de:Berlin-Mitte' })],
      items({ Q64: { sitelinks: { dewiki: 'Berlin' } } }),
      [],
    );
    expect(issues[0]).toMatchObject({ key: 'wikipedia', suggestion: 'de:Berlin' });
  });

  it('reports a missing article in the language of the wikipedia tag', () => {
    const issues = referenceIssues(
      [node(1, { wikidata: 'Q64', wikipedia: 'fr:Berlin' })],
      items({ Q64: { sitelinks: { dewiki: 'Berlin' } } }),
      [],
    );
    expect(issues[0]?.key).toBe('wikipedia');
    expect(issues[0]?.suggestion).toBeUndefined();
  });

  it('skips keys that already have an issue', () => {
    const element = node(1, { wikidata: 'Q5' });
    const existing = referenceIssues([element], items({ Q5: { missing: true } }), []);
    expect(referenceIssues([element], items({ Q5: { missing: true } }), existing)).toEqual([]);
  });
});

describe('fetchItems', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('follows redirects, marks missing items and retries without an unknown ID', async () => {
    const requests: string[] = [];
    vi.stubGlobal('fetch', async (url: string) => {
      const ids = new URL(url).searchParams.get('ids') ?? '';
      requests.push(ids);
      if (ids.includes('Q999999999999')) {
        return Response.json({ error: { code: 'no-such-entity', id: 'Q999999999999' } });
      }
      return Response.json({
        entities: {
          Q64: { id: 'Q64', sitelinks: { dewiki: { site: 'dewiki', title: 'Berlin' } } },
          Q2: { id: 'Q3', redirects: { from: 'Q2', to: 'Q3' }, sitelinks: {} },
          Q5: { id: 'Q5', missing: '' },
        },
      });
    });

    const result = await fetchItems(['Q64', 'Q999999999999', 'Q2', 'Q5'], ['de']);
    expect(requests).toEqual(['Q64|Q999999999999|Q2|Q5', 'Q64|Q2|Q5']);
    expect(result.get('Q64')).toEqual({ id: 'Q64', missing: false, sitelinks: { dewiki: 'Berlin' } });
    expect(result.get('Q2')?.id).toBe('Q3');
    expect(result.get('Q5')?.missing).toBe(true);
    expect(result.get('Q999999999999')?.missing).toBe(true);
  });
});
