import { describe, expect, it } from 'vitest';
import { ChangeStore } from '../src/changes.js';
import {
  applyClosure,
  currentActions,
  defaultActions,
  previewClosure,
  remainingTags,
  removeTag,
  updateDeletion,
} from '../src/closure.js';
import type { OsmElement } from '../src/osm.js';

function element(type: OsmElement['type'], tags: Record<string, string>): OsmElement {
  return { type, id: 1, version: 1, tags };
}

const bakery = element('way', {
  building: 'yes',
  'building:levels': '2',
  'addr:street': 'Markt',
  'addr:housenumber': '1',
  shop: 'bakery',
  name: 'Bäckerei Krume',
  opening_hours: 'Mo-Fr 06:00-18:00',
  website: 'https://krume.de/',
});

function tagsAfter(store: ChangeStore, el: OsmElement): Record<string, string> {
  return remainingTags(el.tags, store.forElement(el));
}

describe('defaultActions', () => {
  it('keeps the building and its address, marks the shop as disused, removes the rest', () => {
    expect(defaultActions(bakery)).toEqual({
      building: 'keep',
      'building:levels': 'keep',
      'addr:street': 'keep',
      'addr:housenumber': 'keep',
      shop: 'disused',
      name: 'delete',
      opening_hours: 'delete',
      website: 'delete',
    });
  });

  it('removes the address of a shop without building', () => {
    expect(defaultActions(element('node', { amenity: 'cafe', 'addr:street': 'Markt' }))).toEqual({
      amenity: 'disused',
      'addr:street': 'delete',
    });
  });
});

describe('applyClosure', () => {
  it('records removals and the prefixed main tag', () => {
    const store = new ChangeStore();
    applyClosure(store, bakery, defaultActions(bakery));
    expect(tagsAfter(store, bakery)).toEqual({
      building: 'yes',
      'building:levels': '2',
      'addr:street': 'Markt',
      'addr:housenumber': '1',
      'disused:shop': 'bakery',
    });
    expect(store.list().every((change) => change.closed === true)).toBe(true);
    expect(store.list().some((change) => change.deleteIfUnused === true)).toBe(false);
  });

  it('can be shown and changed again', () => {
    const store = new ChangeStore();
    applyClosure(store, bakery, { ...defaultActions(bakery), shop: 'was' });
    expect(currentActions(bakery, store.forElement(bakery))).toMatchObject({ shop: 'was', name: 'delete', building: 'keep' });

    applyClosure(store, bakery, { ...defaultActions(bakery), shop: 'keep', name: 'keep' });
    expect(tagsAfter(store, bakery)).toMatchObject({ shop: 'bakery', name: 'Bäckerei Krume' });
    expect(tagsAfter(store, bakery)).not.toHaveProperty('was:shop');
  });

  it('keeps corrections of kept tags and drops confirmations of removed ones', () => {
    const store = new ChangeStore();
    const cafe = element('node', { amenity: 'cafe', phone: '030 1', website: 'http://a.de/' });
    store.set({ type: 'node', id: 1, key: 'phone', oldValue: '030 1', newValue: '+49 30 1' });
    store.set({ type: 'node', id: 1, key: 'check_date:website', newValue: '2026-10-31', verifies: { key: 'website', value: 'http://a.de/' } });
    applyClosure(store, cafe, { amenity: 'disused', phone: 'keep', website: 'delete' });
    expect(tagsAfter(store, cafe)).toEqual({ 'disused:amenity': 'cafe', phone: '+49 30 1' });
  });

  it('marks a node without remaining tags for deletion', () => {
    const store = new ChangeStore();
    const cafe = element('node', { amenity: 'cafe', name: 'X' });
    applyClosure(store, cafe, { amenity: 'delete', name: 'delete' });
    expect(store.list().map((change) => change.deleteIfUnused)).toEqual([true, true]);
    applyClosure(store, cafe, { amenity: 'disused', name: 'delete' });
    expect(store.list().filter((change) => change.deleteIfUnused === true)).toEqual([]);
  });

  it('never marks ways for deletion', () => {
    const store = new ChangeStore();
    const way = element('way', { shop: 'bakery' });
    expect(previewClosure(way, { shop: 'delete' }, [])).toEqual({});
    applyClosure(store, way, { shop: 'delete' });
    expect(store.list()[0]?.deleteIfUnused).toBeUndefined();
  });

  it('does not change the store in the preview', () => {
    const store = new ChangeStore();
    expect(previewClosure(bakery, defaultActions(bakery), store.list())).toHaveProperty('disused:shop', 'bakery');
    expect(store.size).toBe(0);
  });
});

describe('removeTag', () => {
  it('removes a single tag, and the node if it was the last one', () => {
    const store = new ChangeStore();
    const node = element('node', { website: 'https://a.de/', name: 'A' });
    removeTag(store, node, 'website');
    expect(store.list()).toEqual([{ type: 'node', id: 1, key: 'website', oldValue: 'https://a.de/', label: 'A' }]);
    removeTag(store, node, 'name');
    expect(store.list().every((change) => change.deleteIfUnused === true)).toBe(true);

    // a new value for the website: the node stays
    store.set({ type: 'node', id: 1, key: 'website', oldValue: 'https://a.de/', newValue: 'https://b.de/' });
    updateDeletion(store, node);
    expect(store.list().some((change) => change.deleteIfUnused === true)).toBe(false);
  });
});
