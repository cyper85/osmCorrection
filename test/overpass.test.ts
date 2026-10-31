import { afterEach, describe, expect, it, vi } from 'vitest';
import { buildQuery, download, OVERPASS_URLS, parseResponse } from '../src/overpass.js';

const bbox = { south: 50.68, west: 10.91, north: 50.69, east: 10.93 };

describe('buildQuery', () => {
  it('combines all key patterns into one query', () => {
    const query = buildQuery(['^(contact:)?phone$', '^url$'], bbox);
    expect(query).toBe(
      [
        '[out:json][timeout:90];',
        'nw[~"(^(contact:)?phone$)|(^url$)"~"."](50.680000,10.910000,50.690000,10.930000);',
        'out meta geom;',
        'rel[~"(^(contact:)?phone$)|(^url$)"~"."](50.680000,10.910000,50.690000,10.930000);',
        'out meta bb;',
      ].join('\n'),
    );
  });

  it('rejects an empty list', () => {
    expect(() => buildQuery([], bbox)).toThrow();
  });
});

describe('parseResponse', () => {
  it('keeps tagged elements with their geometry', () => {
    const elements = parseResponse({
      elements: [
        { type: 'node', id: 1, version: 3, lat: 1, lon: 2, tags: { phone: '1' } },
        { type: 'way', id: 2, version: 1, geometry: [{ lat: 1, lon: 2 }, null], tags: { phone: '2' } },
        { type: 'relation', id: 3, version: 7, bounds: { minlat: 1, minlon: 2, maxlat: 3, maxlon: 4 }, tags: { url: 'x' } },
        { type: 'node', id: 4, version: 1 },
      ],
    });
    expect(elements).toEqual([
      { type: 'node', id: 1, version: 3, lat: 1, lon: 2, tags: { phone: '1' } },
      { type: 'way', id: 2, version: 1, geometry: [{ lat: 1, lon: 2 }, null], tags: { phone: '2' } },
      { type: 'relation', id: 3, version: 7, bounds: { minlat: 1, minlon: 2, maxlat: 3, maxlon: 4 }, tags: { url: 'x' } },
    ]);
  });

  it('throws on Overpass runtime errors', () => {
    expect(() =>
      parseResponse({ elements: [], remark: 'runtime error: Query timed out in "query" at line 2 after 91 seconds.' }),
    ).toThrow(/timed out/);
  });
});

describe('download', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  function stubFetch(...responses: Response[]): string[] {
    const urls: string[] = [];
    vi.stubGlobal('fetch', async (url: string) => {
      urls.push(url);
      const response = responses.shift();
      if (response === undefined) {
        throw new Error('unexpected request');
      }
      return response;
    });
    return urls;
  }

  const ok = () => new Response(JSON.stringify({ elements: [{ type: 'node', id: 1, version: 1, tags: { a: 'b' } }] }));

  it('falls back to the next server if one is busy', async () => {
    const urls = stubFetch(new Response('at capacity', { status: 504 }), ok());
    await expect(download('q')).resolves.toHaveLength(1);
    expect(urls).toEqual(OVERPASS_URLS);
  });

  it('does not retry a broken query', async () => {
    const urls = stubFetch(new Response('parse error', { status: 400 }));
    await expect(download('q')).rejects.toThrow(/400 parse error/);
    expect(urls).toHaveLength(1);
  });
});
