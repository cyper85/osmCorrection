import { afterEach, describe, expect, it, vi } from 'vitest';
import { EXPORT_CACHE_MS, exportedElements, rememberExported } from '../src/exportCache.js';
import type { OsmElement } from '../src/osm.js';
import type { ApiElement } from '../src/osmApi.js';
import { fetchElements, parseMap } from '../src/osmMap.js';
import { download } from '../src/overpass.js';

const bbox = { south: 50.68, west: 10.91, north: 50.69, east: 10.93 };
const node = (id: number, lat: number, lon: number, tags?: Record<string, string>): ApiElement => ({
  type: 'node',
  id,
  version: 1,
  lat,
  lon,
  ...(tags === undefined ? {} : { tags }),
});

describe('parseMap', () => {
  // the map call returns everything in the box, plus the nodes of ways that reach out of it
  const elements: ApiElement[] = [
    node(1, 50.685, 10.92, { amenity: 'cafe', phone: '0049 3677 1' }),
    node(2, 50.685, 10.92, { amenity: 'bench' }),
    node(3, 50.695, 10.92, { phone: 'outside the box' }),
    node(4, 50.686, 10.921),
    node(5, 50.695, 10.95),
    node(6, 50.684, 10.92, { 'contact:phone': '' }),
    { type: 'way', id: 10, version: 2, nodes: [4, 5], tags: { building: 'yes', 'contact:phone': '+49 3677 2' } },
    { type: 'way', id: 11, version: 1, nodes: [4, 5], tags: { highway: 'residential' } },
    { type: 'relation', id: 20, version: 3, members: [{ type: 'way', ref: 10, role: 'outer' }], tags: { type: 'multipolygon', phone: '+49 3677 3' } },
  ];

  it('keeps what the Overpass query would return, with geometry', () => {
    expect(parseMap(elements, bbox, ['^(contact:)?(phone|fax|mobile)$'])).toEqual([
      { type: 'node', id: 1, version: 1, lat: 50.685, lon: 10.92, tags: { amenity: 'cafe', phone: '0049 3677 1' } },
      {
        type: 'way',
        id: 10,
        version: 2,
        tags: { building: 'yes', 'contact:phone': '+49 3677 2' },
        geometry: [{ lat: 50.686, lon: 10.921 }, { lat: 50.695, lon: 10.95 }],
      },
      {
        type: 'relation',
        id: 20,
        version: 3,
        tags: { type: 'multipolygon', phone: '+49 3677 3' },
        bounds: { minlat: 50.686, minlon: 10.921, maxlat: 50.695, maxlon: 10.95 },
      },
    ]);
  });

  it('combines several key patterns', () => {
    expect(parseMap(elements, bbox, ['^amenity$', '^highway$']).map((e) => `${e.type}/${e.id}`)).toEqual(['node/1', 'node/2', 'way/11']);
  });
});

describe('download with the OSM API as fallback', () => {
  afterEach(() => vi.unstubAllGlobals());
  const busy = () => new Response('at capacity', { status: 502 });
  const fast = { roundDelaysMs: [0, 0], timeoutMs: 50, firstRoundTimeoutMs: 50 };
  const fromApi: OsmElement[] = [{ type: 'node', id: 1, version: 1, tags: { phone: '1' } }];

  it('asks the fallback after the first round, and tells about it', async () => {
    let calls = 0;
    vi.stubGlobal('fetch', async () => {
      calls += 1;
      return busy();
    });
    const steps: string[] = [];
    const result = await download('q', {
      ...fast,
      onAttempt: (_, round) => steps.push(`overpass ${round}`),
      fallback: { host: 'api.openstreetmap.org', run: async () => fromApi, onStart: () => steps.push('fallback') },
    });
    expect(result).toBe(fromApi);
    expect(steps).toEqual(['overpass 1', 'overpass 1', 'fallback']);
    expect(calls).toBe(2);
  });

  it('tries Overpass again if the fallback fails, and names it in the error', async () => {
    vi.stubGlobal('fetch', async () => busy());
    await expect(
      download('q', {
        ...fast,
        fallback: {
          host: 'api.openstreetmap.org',
          run: async () => {
            throw new Error('HTTP 509 bandwidth');
          },
        },
      }),
    ).rejects.toThrow(/overpass-api\.de: ausgelastet.*api\.openstreetmap\.org: HTTP 509 bandwidth.*overpass-api\.de/);
  });

  it('does not need the fallback if Overpass answers', async () => {
    vi.stubGlobal('fetch', async () => new Response(JSON.stringify({ elements: [{ type: 'node', id: 2, version: 1, tags: { a: 'b' } }] })));
    const run = vi.fn(async () => fromApi);
    await expect(download('q', { ...fast, fallback: { host: 'x', run } })).resolves.toHaveLength(1);
    expect(run).not.toHaveBeenCalled();
  });
});

describe('fetchElements', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('fetches the elements and the nodes for their geometry; unknown ones are left out', async () => {
    const urls: string[] = [];
    const api: Record<string, ApiElement[] | number> = {
      'nodes.json?nodes=42,99': 404,
      'node/42.json': [node(42, 50.1, 10.1, { shop: 'bakery' })],
      'node/99.json': 404,
      'ways.json?ways=4711': [{ type: 'way', id: 4711, version: 1, nodes: [1, 2], tags: { building: 'yes' } }],
      'nodes.json?nodes=1,2': [node(1, 50.2, 10.2), node(2, 50.3, 10.3)],
    };
    vi.stubGlobal('fetch', async (url: string) => {
      const path = url.replace('https://api.openstreetmap.org/api/0.6/', '');
      urls.push(path);
      const answer = api[path];
      if (answer === undefined) {
        throw new Error(`unexpected request ${path}`);
      }
      return typeof answer === 'number' ? new Response('', { status: answer }) : new Response(JSON.stringify({ elements: answer }));
    });
    const elements = await fetchElements([
      { type: 'node', id: 42 },
      { type: 'way', id: 4711 },
      { type: 'node', id: 99 },
      { type: 'node', id: 42 },
    ]);
    expect(elements).toEqual([
      { type: 'node', id: 42, version: 1, lat: 50.1, lon: 10.1, tags: { shop: 'bakery' } },
      { type: 'way', id: 4711, version: 1, tags: { building: 'yes' }, geometry: [{ lat: 50.2, lon: 10.2 }, { lat: 50.3, lon: 10.3 }] },
    ]);
    expect(urls).toEqual(Object.keys(api));
  });
});

describe('exportCache', () => {
  function memory(): Pick<Storage, 'getItem' | 'setItem' | 'removeItem'> {
    const data = new Map<string, string>();
    return {
      getItem: (key) => data.get(key) ?? null,
      setItem: (key, value) => void data.set(key, value),
      removeItem: (key) => void data.delete(key),
    };
  }
  const shop: OsmElement = { type: 'node', id: 42, version: 3, lat: 50.1, lon: 10.1, tags: { shop: 'bakery' } };
  const building: OsmElement = { type: 'way', id: 4711, version: 1, tags: { building: 'yes' }, geometry: [] };

  it('keeps the exported elements for 24 hours', () => {
    const store = memory();
    rememberExported([shop], 1_000, store);
    rememberExported([building], 2_000, store);
    const refs = [{ type: 'node' as const, id: 42 }, { type: 'way' as const, id: 4711 }, { type: 'node' as const, id: 7 }];
    expect(exportedElements(refs, 1_000 + EXPORT_CACHE_MS - 1, store)).toEqual({
      found: [shop, building],
      missing: [{ type: 'node', id: 7 }],
    });
    expect(exportedElements(refs, 1_000 + EXPORT_CACHE_MS, store)).toEqual({
      found: [building],
      missing: [{ type: 'node', id: 42 }, { type: 'node', id: 7 }],
    });
    // expired entries are removed from the storage
    expect(exportedElements(refs, 2_000 + EXPORT_CACHE_MS, store).found).toEqual([]);
    expect(store.getItem('osmCorrection.exported')).toBeNull();
  });

  it('works without storage', () => {
    rememberExported([shop], 0, null);
    expect(exportedElements([shop], 0, null)).toEqual({ found: [], missing: [{ type: 'node', id: 42 }] });
  });
});
