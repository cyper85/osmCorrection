import { describe, expect, it } from 'vitest';
import type { TagChange } from '../src/changes.js';
import {
  applyChanges,
  changesetXml,
  escapeXml,
  osmChangeXml,
  splitDeletions,
  upload,
  type ApiElement,
  type AuthFetch,
} from '../src/osmApi.js';

const change: TagChange = { type: 'node', id: 1, key: 'phone', oldValue: '030 1', newValue: '+49 30 1' };

function current(...elements: ApiElement[]): Map<string, ApiElement> {
  return new Map(elements.map((el) => [`${el.type}/${el.id}`, el]));
}

describe('applyChanges', () => {
  it('applies a change to the current version', () => {
    const latest = current({ type: 'node', id: 1, version: 5, lat: 1, lon: 2, tags: { phone: '030 1', name: 'A' } });
    const { modified, conflicts } = applyChanges([change], latest);
    expect(conflicts).toEqual([]);
    expect(modified).toEqual([{ type: 'node', id: 1, version: 5, lat: 1, lon: 2, tags: { phone: '+49 30 1', name: 'A' } }]);
  });

  it('combines several changes of one element', () => {
    const latest = current({ type: 'node', id: 1, version: 5, tags: { phone: '030 1', fax: '030 2' } });
    const { modified } = applyChanges([change, { ...change, key: 'fax', oldValue: '030 2', newValue: '+49 30 2' }], latest);
    expect(modified).toHaveLength(1);
    expect(modified[0]?.tags).toEqual({ phone: '+49 30 1', fax: '+49 30 2' });
  });

  it('reports a conflict if the tag was changed in the meantime', () => {
    const latest = current({ type: 'node', id: 1, version: 6, tags: { phone: '+49 30 9' } });
    const { modified, conflicts } = applyChanges([change], latest);
    expect(modified).toEqual([]);
    expect(conflicts[0]?.reason).toMatch(/geändert/);
  });

  describe('moving a value to another key', () => {
    const add: TagChange = { type: 'node', id: 1, key: 'website:menu', newValue: 'https://a.de/karte', movedFrom: 'menu:url' };
    const remove: TagChange = {
      type: 'node',
      id: 1,
      key: 'menu:url',
      oldValue: 'https://a.de/karte',
      movedTo: { key: 'website:menu', value: 'https://a.de/karte' },
    };

    it('adds the new key and removes the old one', () => {
      const latest = current({ type: 'node', id: 1, version: 2, tags: { 'menu:url': 'https://a.de/karte' } });
      const { modified, conflicts } = applyChanges([remove, add], latest);
      expect(conflicts).toEqual([]);
      expect(modified[0]?.tags).toEqual({ 'website:menu': 'https://a.de/karte' });
    });

    it('keeps the old key if the new one could not be set', () => {
      const latest = current({
        type: 'node',
        id: 1,
        version: 3,
        tags: { 'menu:url': 'https://a.de/karte', 'website:menu': 'https://b.de/' },
      });
      const { modified, conflicts } = applyChanges([remove, add], latest);
      expect(modified).toEqual([]);
      expect(conflicts.map((c) => c.change.key).sort()).toEqual(['menu:url', 'website:menu']);
    });
  });

  describe('new tags and check_date', () => {
    const website: TagChange = { type: 'node', id: 1, key: 'website', oldValue: 'http://a.de/', newValue: 'https://a.de/' };
    const checkDate: TagChange = {
      type: 'node',
      id: 1,
      key: 'check_date:website',
      newValue: '2026-10-31',
      verifies: { key: 'website', value: 'https://a.de/' },
    };

    it('adds a tag that is still missing', () => {
      const latest = current({ type: 'node', id: 1, version: 2, tags: { website: 'http://a.de/' } });
      const { modified, conflicts } = applyChanges([checkDate, website], latest);
      expect(conflicts).toEqual([]);
      expect(modified[0]?.tags).toEqual({ website: 'https://a.de/', 'check_date:website': '2026-10-31' });
    });

    it('reports a conflict if the new tag was set in the meantime', () => {
      const latest = current({ type: 'node', id: 1, version: 3, tags: { website: 'https://a.de/', 'check_date:website': '2026-10-01' } });
      const { conflicts } = applyChanges([{ ...checkDate }], latest);
      expect(conflicts[0]?.reason).toMatch(/inzwischen gesetzt/);
    });

    it('drops the check_date together with a conflicting correction', () => {
      const latest = current({ type: 'node', id: 1, version: 3, tags: { website: 'https://b.de/' } });
      const { modified, conflicts } = applyChanges([checkDate, website], latest);
      expect(modified).toEqual([]);
      expect(conflicts.map((c) => c.change.key)).toEqual(['website', 'check_date:website']);
    });

    it('drops a confirmation if the confirmed value was changed in the meantime', () => {
      const confirm: TagChange = { ...checkDate, verifies: { key: 'website', value: 'http://a.de/' } };
      const latest = current({ type: 'node', id: 1, version: 3, tags: { website: 'https://other.de/' } });
      expect(applyChanges([confirm], latest).conflicts[0]?.reason).toMatch(/geprüfte Wert/);
    });
  });

  it('removes tags, but only if they still have the old value', () => {
    const removal: TagChange = { type: 'node', id: 1, key: 'website', oldValue: 'https://a.de/' };
    const latest = current({ type: 'node', id: 1, version: 2, tags: { website: 'https://a.de/', name: 'A' } });
    expect(applyChanges([removal], latest).modified[0]?.tags).toEqual({ name: 'A' });
    const changed = current({ type: 'node', id: 1, version: 3, tags: { website: 'https://b.de/' } });
    expect(applyChanges([removal], changed).conflicts[0]?.reason).toMatch(/geändert/);
  });

  it('reports a conflict for deleted elements', () => {
    expect(applyChanges([change], current()).conflicts).toHaveLength(1);
    expect(applyChanges([change], current({ type: 'node', id: 1, version: 7, visible: false })).conflicts).toHaveLength(1);
  });
});

describe('splitDeletions', () => {
  it('deletes nodes without tags that are not used, keeps vertices and ways', async () => {
    const inUse = async (id: number) => id === 2;
    const { modify, remove } = await splitDeletions(
      [
        { type: 'node', id: 1, version: 1, lat: 0, lon: 0, tags: {} },
        { type: 'node', id: 2, version: 1, lat: 0, lon: 0, tags: {} },
        { type: 'node', id: 3, version: 1, lat: 0, lon: 0, tags: { name: 'A' } },
        { type: 'way', id: 4, version: 1, nodes: [], tags: {} },
      ],
      inUse,
    );
    expect(remove.map((el) => el.id)).toEqual([1]);
    expect(modify.map((el) => el.id)).toEqual([2, 3, 4]);
  });
});

describe('XML', () => {
  it('escapes attribute values', () => {
    expect(escapeXml(`a&b<c>"d"'e'\nf`)).toBe('a&amp;b&lt;c&gt;&quot;d&quot;&apos;e&apos;&#10;f');
  });

  it('builds the changeset document', () => {
    expect(changesetXml({ created_by: 'osmCorrection 0.1.0', comment: 'a & b' })).toBe(
      '<osm><changeset><tag k="created_by" v="osmCorrection 0.1.0"/><tag k="comment" v="a &amp; b"/></changeset></osm>',
    );
  });

  it('builds an osmChange document for all element types', () => {
    const xml = osmChangeXml(
      [
        { type: 'node', id: 1, version: 2, lat: 50.1, lon: 10.2, tags: { phone: '+49 30 1' } },
        { type: 'way', id: 2, version: 3, nodes: [1, 3], tags: { website: 'https://a.de' } },
        { type: 'relation', id: 4, version: 1, members: [{ type: 'way', ref: 2, role: 'outer' }], tags: { type: 'multipolygon' } },
      ],
      99,
      'osmCorrection 0.1.0',
    );
    expect(xml).toBe(
      '<osmChange version="0.6" generator="osmCorrection 0.1.0"><modify>' +
        '<node id="1" version="2" changeset="99" lat="50.1" lon="10.2"><tag k="phone" v="+49 30 1"/></node>' +
        '<way id="2" version="3" changeset="99"><nd ref="1"/><nd ref="3"/><tag k="website" v="https://a.de"/></way>' +
        '<relation id="4" version="1" changeset="99"><member type="way" ref="2" role="outer"/><tag k="type" v="multipolygon"/></relation>' +
        '</modify></osmChange>',
    );
  });

  it('adds deleted nodes with if-unused', () => {
    const xml = osmChangeXml([], 99, 'g', [{ type: 'node', id: 1, version: 4, lat: 50.1, lon: 10.2, tags: {} }]);
    expect(xml).toBe(
      '<osmChange version="0.6" generator="g"><delete if-unused="true">' +
        '<node id="1" version="4" changeset="99" lat="50.1" lon="10.2"/></delete></osmChange>',
    );
  });
});

describe('upload', () => {
  function fakeAuth(uploadStatus: number): { auth: AuthFetch; calls: string[] } {
    const calls: string[] = [];
    const auth: AuthFetch = {
      fetch: async (resource, options) => {
        const path = resource.replace(/^.*\/api\/0\.6/, '');
        calls.push(`${options.method} ${path}`);
        if (path === '/changeset/create') {
          return new Response('42');
        }
        if (path.endsWith('/upload')) {
          return new Response('Version mismatch', { status: uploadStatus });
        }
        return new Response('');
      },
    };
    return { auth, calls };
  }

  const elements: ApiElement[] = [{ type: 'node', id: 1, version: 2, lat: 0, lon: 0, tags: {} }];

  it('opens, uploads and closes the changeset', async () => {
    const { auth, calls } = fakeAuth(200);
    await expect(upload(auth, elements, { comment: 'x' }, 'test')).resolves.toBe(42);
    expect(calls).toEqual(['PUT /changeset/create', 'POST /changeset/42/upload', 'PUT /changeset/42/close']);
  });

  it('closes the changeset and reports the error if the upload fails', async () => {
    const { auth, calls } = fakeAuth(409);
    await expect(upload(auth, elements, { comment: 'x' }, 'test')).rejects.toThrow(/409 Version mismatch/);
    expect(calls.at(-1)).toBe('PUT /changeset/42/close');
  });
});
