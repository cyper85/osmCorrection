import { describe, expect, it } from 'vitest';
import type { OsmElement } from '../src/osm.js';
import {
  CHECK_INTERVAL_MONTHS,
  checkDateKey,
  confirmIssues,
  isRecentlyChecked,
  isVerifiable,
  lastChecked,
  openableUrl,
  parseCheckDate,
  today,
} from '../src/verification.js';

const now = new Date(2026, 9, 31); // 2026-10-31

function node(id: number, tags: Record<string, string>): OsmElement {
  return { type: 'node', id, version: 1, lat: 0, lon: 0, tags };
}

describe('keys', () => {
  it('knows which keys can be verified online', () => {
    for (const key of ['website', 'contact:website', 'url', 'contact:facebook', 'facebook', 'contact:twitter', 'contact:x']) {
      expect(isVerifiable(key)).toBe(true);
    }
    for (const key of ['phone', 'email', 'wikidata', 'website:menu']) {
      expect(isVerifiable(key)).toBe(false);
    }
  });

  it('uses the checked key as suffix', () => {
    expect(checkDateKey('contact:website')).toBe('check_date:contact:website');
  });
});

describe('dates', () => {
  it('formats today as YYYY-MM-DD', () => {
    expect(today(new Date(2026, 0, 5))).toBe('2026-01-05');
  });

  it('parses full and partial dates', () => {
    expect(parseCheckDate('2025-03-14')).toEqual(new Date(2025, 2, 14));
    expect(parseCheckDate('2025-03')).toEqual(new Date(2025, 2, 1));
    expect(parseCheckDate('2025')).toEqual(new Date(2025, 0, 1));
    expect(parseCheckDate('14.03.2025')).toBeUndefined();
  });

  it('uses 24 months by default', () => {
    expect(CHECK_INTERVAL_MONTHS).toBe(24);
  });

  it('treats a value as recently checked within the interval', () => {
    expect(isRecentlyChecked(node(1, { 'check_date:website': '2024-11-01' }), 'website', now)).toBe(true);
    expect(isRecentlyChecked(node(1, { 'check_date:website': '2024-10-30' }), 'website', now)).toBe(false);
    expect(isRecentlyChecked(node(1, { 'check_date:website': 'gestern' }), 'website', now)).toBe(false);
    expect(isRecentlyChecked(node(1, {}), 'website', now)).toBe(false);
    expect(isRecentlyChecked(node(1, { 'check_date:website': '2026-01-01' }), 'website', now, 6)).toBe(false);
  });

  it('accepts check_date:website for contact:website', () => {
    const element = node(1, { 'contact:website': 'https://a.de/', 'check_date:website': '2026-01-01' });
    expect(lastChecked(element, 'contact:website')).toBe('2026-01-01');
    expect(isRecentlyChecked(element, 'contact:website', now)).toBe(true);
  });
});

describe('openableUrl', () => {
  it('opens URLs and turns usernames into profile URLs', () => {
    expect(openableUrl('website', 'https://a.de/')).toBe('https://a.de/');
    expect(openableUrl('contact:facebook', 'cafe.mueller')).toBe('https://www.facebook.com/cafe.mueller');
    expect(openableUrl('contact:twitter', '@osm')).toBe('https://x.com/osm');
    expect(openableUrl('website', 'a.de')).toBeUndefined();
  });
});

describe('confirmIssues', () => {
  it('asks to confirm valid values without a recent check_date', () => {
    const issues = confirmIssues(
      [
        node(1, { website: 'https://a.de/' }),
        node(2, { website: 'https://b.de/', 'check_date:website': '2026-02-01' }),
        node(3, { 'contact:facebook': 'https://www.facebook.com/cafe.mueller', 'check_date:contact:facebook': '2023-05' }),
        node(4, { website: 'not a url', phone: '+49 30 1234567' }),
      ],
      [],
      now,
    );
    expect(issues.map((i) => [i.element.id, i.key, i.kind])).toEqual([
      [1, 'website', 'confirm'],
      [3, 'contact:facebook', 'confirm'],
    ]);
    expect(issues[0]?.message).toMatch(/Noch nie/);
    expect(issues[1]?.message).toMatch(/Zuletzt geprüft: 2023-05/);
  });

  it('skips keys that already have an issue', () => {
    const element = node(1, { website: 'https://a.de/' });
    const existing = confirmIssues([element], [], now);
    expect(confirmIssues([element], existing, now)).toEqual([]);
  });
});
