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

  type Answer = Response | 'network-error' | 'hang';

  /** Answers the requests in order; 'hang' waits until the request is aborted. */
  function stubFetch(...answers: Answer[]): string[] {
    const urls: string[] = [];
    vi.stubGlobal('fetch', async (url: string, init: RequestInit) => {
      urls.push(url);
      const answer = answers.shift();
      if (answer === undefined) {
        throw new Error('unexpected request');
      }
      if (answer === 'network-error') {
        throw new TypeError('Failed to fetch');
      }
      if (answer === 'hang') {
        return new Promise<Response>((_, reject) => {
          init.signal?.addEventListener('abort', () => reject(init.signal?.reason));
        });
      }
      return answer;
    });
    return urls;
  }

  const ok = () => new Response(JSON.stringify({ elements: [{ type: 'node', id: 1, version: 1, tags: { a: 'b' } }] }));
  const busy = () => new Response('at capacity', { status: 502 });
  const fast = { roundDelaysMs: [0, 0], timeoutMs: 50 };

  it('falls back to the next server if one is busy', async () => {
    const urls = stubFetch(busy(), ok());
    await expect(download('q', fast)).resolves.toHaveLength(1);
    expect(urls).toEqual(OVERPASS_URLS.slice(0, 2));
  });

  it('skips servers that do not answer or cannot be reached', async () => {
    const urls = stubFetch('hang', 'network-error', ok());
    await expect(download('q', fast)).resolves.toHaveLength(1);
    expect(urls).toEqual(OVERPASS_URLS);
  });

  it('tries all servers again in a second round', async () => {
    const attempts: number[] = [];
    const urls = stubFetch(busy(), busy(), 'hang', ok());
    await expect(download('q', { ...fast, onAttempt: (_, round) => attempts.push(round) })).resolves.toHaveLength(1);
    expect(urls).toEqual([...OVERPASS_URLS, OVERPASS_URLS[0]]);
    expect(attempts).toEqual([1, 1, 1, 2]);
  });

  it('reports every server if none answers', async () => {
    stubFetch(busy(), 'network-error', 'hang', busy(), busy(), busy());
    await expect(download('q', fast)).rejects.toThrow(
      /Kein Overpass-Server.*overpass-api\.de: ausgelastet \(HTTP 502\).*maps\.mail\.ru: nicht erreichbar.*private\.coffee: keine Antwort/,
    );
  });

  it('does not retry a broken query', async () => {
    const urls = stubFetch(new Response('parse error', { status: 400 }));
    await expect(download('q', fast)).rejects.toThrow(/400 parse error/);
    expect(urls).toHaveLength(1);
  });
});
