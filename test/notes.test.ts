import { afterEach, describe, expect, it, vi } from 'vitest';
import { createNote, noteFor, noteText, rememberNote } from '../src/notes.js';
import type { OsmElement } from '../src/osm.js';
import type { AuthFetch } from '../src/osmApi.js';

const bakery: OsmElement = { type: 'node', id: 5, version: 1, lat: 50.68, lon: 10.92, tags: { shop: 'bakery', name: 'Krume' } };

function fakeAuth(response: Response): { auth: AuthFetch; calls: string[] } {
  const calls: string[] = [];
  return {
    calls,
    auth: {
      fetch: async (resource, options) => {
        calls.push(`${options.method} ${resource}`);
        return response;
      },
    },
  };
}

describe('noteText', () => {
  it('names the object, its main tag and links it', () => {
    const text = noteText(bakery);
    expect(text).toContain('„Krume“ (shop=bakery)');
    expect(text).toContain('https://www.openstreetmap.org/node/5');
  });
});

describe('createNote', () => {
  it('posts the note at the position of the element', async () => {
    const { auth, calls } = fakeAuth(Response.json({ type: 'Feature', properties: { id: 4711 } }));
    await expect(createNote(auth, bakery, 'Gibt es das noch?')).resolves.toBe(4711);
    const url = new URL(calls[0]?.replace(/^POST /, '') ?? '');
    expect(url.pathname).toBe('/api/0.6/notes.json');
    expect(Object.fromEntries(url.searchParams)).toEqual({ lat: '50.6800000', lon: '10.9200000', text: 'Gibt es das noch?' });
  });

  it('asks to log in again without the notes permission', async () => {
    const { auth } = fakeAuth(new Response('', { status: 403 }));
    await expect(createNote(auth, bakery, 'x')).rejects.toThrow(/wieder anmelden/);
  });
});

describe('noteFor', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('remembers created notes per element', () => {
    const data = new Map<string, string>();
    vi.stubGlobal('localStorage', {
      getItem: (key: string) => data.get(key) ?? null,
      setItem: (key: string, value: string) => void data.set(key, value),
    });
    expect(noteFor(bakery)).toBeUndefined();
    rememberNote(bakery, 4711);
    expect(noteFor(bakery)).toBe(4711);
    expect(noteFor({ type: 'way', id: 5 })).toBeUndefined();
  });
});
