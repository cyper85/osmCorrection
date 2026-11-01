import { describe, expect, it } from 'vitest';
import type { OsmElement } from '../src/osm.js';
import { probeAll, probeUrl, websiteIssues, websitesToProbe, type Probe, type ProbeResult } from '../src/websites.js';

function node(id: number, tags: Record<string, string>): OsmElement {
  return { type: 'node', id, version: 1, lat: 0, lon: 0, tags };
}

describe('probeUrl', () => {
  it('requests https URLs as they are', () => {
    expect(probeUrl('https://example.org/a?b=c')).toBe('https://example.org/a?b=c');
  });

  it('requests the https variant of http URLs', () => {
    expect(probeUrl('http://example.org/a')).toBe('https://example.org/a');
  });

  it('skips invalid URLs and hosts that block all requests', () => {
    expect(probeUrl('example.org')).toBeUndefined();
    expect(probeUrl('https://x.com/osm')).toBeUndefined();
    expect(probeUrl('https://www.youtube.com/@osm')).toBeUndefined();
  });
});

describe('websitesToProbe', () => {
  it('collects each URL once, only from website keys', () => {
    const urls = websitesToProbe([
      node(1, { website: 'https://a.de/', 'contact:website': 'http://b.de/' }),
      node(2, { url: 'https://a.de/', 'website:menu': 'https://c.de/', name: 'https://d.de/' }),
    ]);
    expect(urls).toEqual(['https://a.de/', 'https://b.de/', 'https://c.de/']);
  });
});

describe('probeAll', () => {
  it('repeats failed requests once and reports progress', async () => {
    const calls: string[] = [];
    const answers: Record<string, ProbeResult[]> = {
      'https://a.de/': ['reachable'],
      'https://flaky.de/': ['unreachable', 'reachable'],
      'https://dead.de/': ['unreachable', 'unreachable'],
    };
    const probe: Probe = async (url) => {
      calls.push(url);
      return answers[url]?.shift() ?? 'unreachable';
    };
    const progress: number[] = [];
    const results = await probeAll(Object.keys(answers), probe, (done) => progress.push(done));
    expect(Object.fromEntries(results)).toEqual({
      'https://a.de/': 'reachable',
      'https://flaky.de/': 'reachable',
      'https://dead.de/': 'unreachable',
    });
    expect(calls).toHaveLength(5);
    expect(progress.sort()).toEqual([1, 2, 3]);
  });
});

describe('websiteIssues', () => {
  const results = new Map<string, ProbeResult>([
    ['https://ok.de/', 'reachable'],
    ['https://dead.de/', 'unreachable'],
    ['https://slow.de/', 'timeout'],
    ['https://old.de/', 'reachable'],
    ['https://httponly.de/', 'unreachable'],
  ]);

  it('reports unreachable https websites without a suggestion', () => {
    const issues = websiteIssues(
      [node(1, { website: 'https://ok.de/' }), node(2, { website: 'https://dead.de/' }), node(3, { url: 'https://slow.de/' })],
      results,
      [],
    );
    expect(issues.map((i) => [i.element.id, i.valid, i.suggestion])).toEqual([
      [2, false, undefined],
      [3, false, undefined],
    ]);
    expect(issues[1]?.message).toMatch(/antwortet nicht/);
  });

  it('suggests https for http websites that are available via https', () => {
    const issues = websiteIssues([node(1, { website: 'http://old.de/' })], results, []);
    expect(issues[0]).toMatchObject({ valid: true, suggestion: 'https://old.de/' });
  });

  it('does not report http websites without https, they cannot be checked', () => {
    expect(websiteIssues([node(1, { website: 'http://httponly.de/' })], results, [])).toEqual([]);
  });

  it('skips websites with a recent check_date', () => {
    const now = new Date(2026, 9, 31);
    const element = node(1, { website: 'https://dead.de/', 'check_date:website': '2026-01-01' });
    expect(websitesToProbe([element], now)).toEqual([]);
    expect(websiteIssues([element], results, [], now)).toEqual([]);
    const old = node(2, { website: 'https://dead.de/', 'check_date:website': '2020-01-01' });
    expect(websiteIssues([old], results, [], now)).toHaveLength(1);
  });

  it('skips keys that already have an issue', () => {
    const element = node(1, { website: 'https://dead.de/' });
    const existing = websiteIssues([element], results, []);
    expect(websiteIssues([element], results, existing)).toEqual([]);
  });
});
