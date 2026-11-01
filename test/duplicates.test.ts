import { describe, expect, it } from 'vitest';
import { ChangeStore } from '../src/changes.js';
import { removeTag } from '../src/closure.js';
import { duplicateIssues } from '../src/duplicates.js';
import type { OsmElement } from '../src/osm.js';

function element(tags: Record<string, string>): OsmElement {
  return { type: 'node', id: 1, version: 1, tags };
}

describe('duplicateIssues', () => {
  it('reports the plain key if contact:* has the same value', () => {
    const shop = element({ shop: 'bakery', website: 'https://example.org/', 'contact:website': 'https://example.org/' });
    const [issue, ...rest] = duplicateIssues([shop]);
    expect(rest).toEqual([]);
    expect(issue).toMatchObject({ key: 'website', kind: 'duplicate', duplicateOf: 'contact:website' });
    expect(issue?.check.id).toBe('url');
  });

  it('ignores formatting differences', () => {
    const tags = {
      website: 'https://example.org/',
      'contact:website': 'https://example.org',
      email: 'Info@Example.org',
      'contact:email': 'info@example.org',
      phone: '+49 3677 123456; +49 3677 654321',
      'contact:phone': '+49 3677 654321;+49 3677 123456',
    };
    const keys = duplicateIssues([element(tags)]).map((issue) => issue.key);
    expect(keys.sort()).toEqual(['email', 'phone', 'website']);
  });

  it('finds social networks', () => {
    const tags = { facebook: 'https://www.facebook.com/example', 'contact:facebook': 'https://www.facebook.com/example' };
    expect(duplicateIssues([element(tags)]).map((issue) => issue.key)).toEqual(['facebook']);
  });

  it('keeps different values and keys without a contact: form', () => {
    const tags = {
      website: 'https://example.org/',
      'contact:website': 'https://example.com/',
      name: 'Bäckerei',
      'contact:name': 'Bäckerei',
    };
    expect(duplicateIssues([element(tags)])).toEqual([]);
  });

  it('reports nothing without the plain key', () => {
    expect(duplicateIssues([element({ 'contact:website': 'https://example.org/' })])).toEqual([]);
  });
});

describe('removing a duplicate', () => {
  it('records the key that keeps the value', () => {
    const shop = element({ shop: 'bakery', website: 'https://example.org/', 'contact:website': 'https://example.org/' });
    const store = new ChangeStore();
    removeTag(store, shop, 'website', 'contact:website');
    expect(store.list()).toEqual([
      { type: 'node', id: 1, label: 'Punkt 1', key: 'website', oldValue: 'https://example.org/', duplicateOf: 'contact:website' },
    ]);
  });
});
