import { describe, expect, it } from 'vitest';
import { ChangeStore } from '../src/changes.js';
import { removeTag } from '../src/closure.js';
import type { OsmElement } from '../src/osm.js';
import { SYNONYM_KEYS, synonymIssues } from '../src/synonyms.js';

function element(tags: Record<string, string>): OsmElement {
  return { type: 'node', id: 1, version: 1, tags };
}

describe('synonymIssues', () => {
  it('moves a menu URL to website:menu', () => {
    const [issue, ...rest] = synonymIssues([element({ amenity: 'restaurant', 'menu:url': 'https://a.de/karte' })]);
    expect(rest).toEqual([]);
    expect(issue).toMatchObject({ key: 'menu:url', kind: 'move', moveTo: 'website:menu' });
    expect(issue?.check.id).toBe('url');
  });

  it('only reports keys with a URL', () => {
    expect(synonymIssues([element({ menu: 'yes', 'image:menu': 'File:Karte.jpg' })])).toEqual([]);
    expect(synonymIssues([element({ 'image:menu': 'www.a.de/karte.jpg' })])[0]?.kind).toBe('move');
  });

  it('removes a synonym with the same value as website:menu', () => {
    const [issue] = synonymIssues([element({ 'website:menu': 'https://a.de/karte', 'url:menu': 'https://a.de/karte/' })]);
    expect(issue).toMatchObject({ key: 'url:menu', kind: 'duplicate', duplicateOf: 'website:menu' });
  });

  it('moves only the first synonym, the same value elsewhere is a duplicate of it', () => {
    const issues = synonymIssues([element({ 'menu:url': 'https://a.de/karte', 'lunch:menu:url': 'https://a.de/karte' })]);
    expect(issues.map(({ key, kind, duplicateOf }) => [key, kind, duplicateOf])).toEqual([
      ['menu:url', 'move', undefined],
      ['lunch:menu:url', 'duplicate', 'menu:url'],
    ]);
  });

  it('only reports a synonym with a different value', () => {
    const [issue] = synonymIssues([element({ 'website:menu': 'https://a.de/karte', 'menu:url': 'https://b.de/' })]);
    expect(issue?.kind).toBeUndefined();
    expect(issue?.message).toMatch(/anderen Wert/);
  });

  it('builds an Overpass key pattern', () => {
    expect(new RegExp(SYNONYM_KEYS).test('image:menu:0')).toBe(true);
    expect(new RegExp(SYNONYM_KEYS).test('menu:de')).toBe(false);
  });
});

describe('removing a moved tag', () => {
  it('undoes the move', () => {
    const restaurant = element({ 'menu:url': 'https://a.de/karte' });
    const store = new ChangeStore();
    const ref = { type: 'node' as const, id: 1 };
    store.set({ ...ref, key: 'website:menu', newValue: 'https://a.de/karte', movedFrom: 'menu:url' });
    store.set({ ...ref, key: 'menu:url', oldValue: 'https://a.de/karte', movedTo: { key: 'website:menu', value: 'https://a.de/karte' } });
    removeTag(store, restaurant, 'menu:url');
    expect(store.list().map((c) => [c.key, c.newValue, c.movedTo])).toEqual([['menu:url', undefined, undefined]]);
  });
});
