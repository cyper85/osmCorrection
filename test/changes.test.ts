import { afterEach, describe, expect, it, vi } from 'vitest';
import { ChangeStore, type TagChange } from '../src/changes.js';

const change: TagChange = { type: 'node', id: 1, key: 'phone', oldValue: '030 1', newValue: '+49 30 1', label: 'Café' };

function memoryStorage(): Storage {
  const data = new Map<string, string>();
  return {
    get length() {
      return data.size;
    },
    clear: () => data.clear(),
    getItem: (key) => data.get(key) ?? null,
    key: (index) => [...data.keys()][index] ?? null,
    removeItem: (key) => void data.delete(key),
    setItem: (key, value) => void data.set(key, value),
  };
}

describe('ChangeStore', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('keeps one change per element and key', () => {
    const store = new ChangeStore();
    store.set(change);
    store.set({ ...change, newValue: '+49 30 2' });
    expect(store.list()).toEqual([{ ...change, newValue: '+49 30 2' }]);
  });

  it('removes a change when the old value is set again', () => {
    const store = new ChangeStore();
    store.set(change);
    store.set({ ...change, newValue: '030 1' });
    expect(store.size).toBe(0);
  });

  it('stores new tags and check_dates with the verified value', () => {
    vi.stubGlobal('localStorage', memoryStorage());
    const checkDate: TagChange = {
      type: 'node',
      id: 1,
      key: 'check_date:website',
      newValue: '2026-10-31',
      verifies: { key: 'website', value: 'https://a.de/' },
    };
    new ChangeStore('test').set(checkDate);
    expect(new ChangeStore('test').list()).toEqual([checkDate]);
  });

  it('stores removals and lists the changes of one element', () => {
    vi.stubGlobal('localStorage', memoryStorage());
    const removal: TagChange = { type: 'node', id: 1, key: 'shop', oldValue: 'bakery', closed: true, deleteIfUnused: true };
    const store = new ChangeStore('test');
    store.set(removal);
    store.set({ ...change, id: 2 });
    expect(new ChangeStore('test').forElement({ type: 'node', id: 1 })).toEqual([removal]);
  });

  it('survives a reload with a storage key', () => {
    vi.stubGlobal('localStorage', memoryStorage());
    new ChangeStore('test').set(change);
    expect(new ChangeStore('test').list()).toEqual([change]);

    new ChangeStore('test').clear();
    expect(localStorage.getItem('test')).toBeNull();
  });

  it('ignores broken stored data', () => {
    vi.stubGlobal('localStorage', memoryStorage());
    localStorage.setItem('test', JSON.stringify([change, { type: 'area', id: 1 }, { type: 'node', id: 1, key: 'a' }, 'x']));
    expect(new ChangeStore('test').list()).toEqual([change]);
    localStorage.setItem('test', '{not json');
    expect(new ChangeStore('test').list()).toEqual([]);
  });

  it('works without storage', () => {
    vi.stubGlobal('localStorage', undefined);
    const store = new ChangeStore('test');
    store.set(change);
    expect(store.size).toBe(1);
  });
});
