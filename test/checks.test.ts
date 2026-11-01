import { describe, expect, it } from 'vitest';
import { CHECKS, coversKey, findIssues, type Check } from '../src/checks.js';
import type { OsmElement } from '../src/osm.js';

function check(id: string): Check {
  const found = CHECKS.find((c) => c.id === id);
  if (found === undefined) {
    throw new Error(id);
  }
  return found;
}

function node(id: number, tags: Record<string, string>): OsmElement {
  return { type: 'node', id, version: 1, lat: 0, lon: 0, tags };
}

describe('key patterns', () => {
  it.each([
    ['phone', 'phone', true],
    ['phone', 'contact:phone', true],
    ['phone', 'fax', true],
    ['phone', 'phone:mobile', false],
    ['url', 'website', true],
    ['url', 'contact:website', true],
    ['url', 'url', true],
    ['url', 'website:menu', true],
    ['url', 'website:opening_hours', true],
    ['url', 'reservation:website', true],
    ['url', 'website:departures', true],
    ['url', 'opening_hours:url', true],
    ['url', 'website:1', false],
    ['url', 'website:note', false],
    ['url', 'contact:website:menu', false],
    ['wikipedia', 'brand:wikipedia', true],
    ['wikipedia', 'wikipedia:de', false],
    ['wikidata', 'wikidata', true],
    ['twitter', 'contact:x', true],
  ])('%s matches %s: %s', (id, key, expected) => {
    expect(coversKey(check(id), key)).toBe(expected);
  });

  it('every key belongs to at most one check', () => {
    const keys = ['phone', 'contact:phone', 'email', 'website', 'url', 'wikipedia', 'brand:wikidata', 'contact:facebook', 'contact:twitter'];
    for (const key of keys) {
      expect(CHECKS.filter((c) => new RegExp(c.keyPattern).test(key))).toHaveLength(1);
    }
  });
});

describe('findIssues', () => {
  it('reports invalid values with a suggestion', () => {
    const issues = findIssues([node(1, { phone: '030 1234567', name: 'A' })], [check('phone')], 'DE');
    expect(issues).toHaveLength(1);
    expect(issues[0]).toMatchObject({ key: 'phone', value: '030 1234567', valid: false, suggestion: '+49 30 1234567' });
  });

  it('prefers addr:country over the fallback country', () => {
    const issues = findIssues([node(1, { phone: '01 23 45 67 89', 'addr:country': 'FR' })], [check('phone')], 'DE');
    expect(issues[0]?.suggestion).toBe('+33 1 23 45 67 89');
  });

  it('checks each part of a multi-value', () => {
    const issues = findIssues([node(1, { phone: '+49 30 1234567;030 7654321' })], [check('phone')], 'DE');
    expect(issues[0]).toMatchObject({ valid: false, suggestion: '+49 30 1234567;+49 30 7654321' });
    expect(issues[0]?.message).toMatch(/^030 7654321: /);
  });

  it('ignores valid values and unrelated keys', () => {
    const issues = findIssues(
      [node(1, { phone: '+49 30 1234567', website: 'https://example.org', name: 'x' })],
      [check('phone'), check('url')],
    );
    expect(issues).toEqual([]);
  });

  it('reports valid values that have a preferred form', () => {
    const issues = findIssues([node(1, { 'contact:twitter': 'https://twitter.com/osm' })], [check('twitter')]);
    expect(issues[0]).toMatchObject({ valid: true, suggestion: 'https://x.com/osm' });
  });

  it('only runs the selected checks', () => {
    const issues = findIssues([node(1, { phone: 'nonsense', email: 'nonsense' })], [check('mail')]);
    expect(issues.map((i) => i.key)).toEqual(['email']);
  });
});
