import type { TagChange } from './changes.js';
import { elementKey, type ElementRef, type ElementType } from './osm.js';

export const API_URL = 'https://api.openstreetmap.org/api/0.6';

/** An element as returned by the OSM API, complete enough to upload it again. */
export interface ApiElement {
  type: ElementType;
  id: number;
  version: number;
  visible?: boolean;
  tags?: Record<string, string>;
  lat?: number;
  lon?: number;
  nodes?: number[];
  members?: { type: ElementType; ref: number; role: string }[];
}

/** Minimal interface of osm-auth's `fetch`, so the upload can be tested. */
export interface AuthFetch {
  fetch(resource: string, options: { method: 'GET' | 'POST' | 'PUT'; body?: string; headers?: object }): Promise<Response>;
}

const BATCH_SIZE = 100;

/** Fetches the current version of the elements (no login needed). */
export async function fetchCurrent(refs: ElementRef[]): Promise<Map<string, ApiElement>> {
  const ids: Record<ElementType, number[]> = { node: [], way: [], relation: [] };
  for (const ref of refs) {
    ids[ref.type].push(ref.id);
  }
  const current = new Map<string, ApiElement>();
  for (const type of ['node', 'way', 'relation'] as const) {
    const unique = [...new Set(ids[type])];
    for (let i = 0; i < unique.length; i += BATCH_SIZE) {
      const batch = unique.slice(i, i + BATCH_SIZE);
      const response = await fetch(`${API_URL}/${type}s.json?${type}s=${batch.join(',')}`);
      if (!response.ok) {
        throw new Error(`OSM-API: HTTP ${response.status} ${await response.text()}`);
      }
      const data = (await response.json()) as { elements: ApiElement[] };
      for (const element of data.elements) {
        current.set(elementKey(element), element);
      }
    }
  }
  return current;
}

export interface Conflict {
  change: TagChange;
  reason: string;
}

/**
 * Applies the changes to the current versions of the elements. A change is
 * only applied if the tag still has the value the user saw; otherwise someone
 * else edited it in the meantime and it becomes a conflict.
 */
export function applyChanges(
  changes: TagChange[],
  current: Map<string, ApiElement>,
): { modified: ApiElement[]; conflicts: Conflict[] } {
  const modified = new Map<string, ApiElement>();
  const conflicts: Conflict[] = [];
  for (const change of changes) {
    const key = elementKey(change);
    const element = modified.get(key) ?? current.get(key);
    if (element === undefined || element.visible === false) {
      conflicts.push({ change, reason: 'Element wurde inzwischen gelöscht' });
      continue;
    }
    const value = element.tags?.[change.key];
    if (value !== change.oldValue) {
      conflicts.push({
        change,
        reason: value === undefined ? 'Tag wurde inzwischen entfernt' : `Tag wurde inzwischen geändert auf „${value}“`,
      });
      continue;
    }
    modified.set(key, { ...element, tags: { ...element.tags, [change.key]: change.newValue } });
  }
  return { modified: [...modified.values()], conflicts };
}

export function escapeXml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;')
    .replace(/\n/g, '&#10;')
    .replace(/\r/g, '&#13;')
    .replace(/\t/g, '&#9;');
}

function tagsXml(tags: Record<string, string> | undefined): string {
  return Object.entries(tags ?? {})
    .map(([k, v]) => `<tag k="${escapeXml(k)}" v="${escapeXml(v)}"/>`)
    .join('');
}

export function changesetXml(tags: Record<string, string>): string {
  return `<osm><changeset>${tagsXml(tags)}</changeset></osm>`;
}

export function osmChangeXml(elements: ApiElement[], changesetId: number, generator: string): string {
  const body = elements
    .map((el) => {
      const attrs = `id="${el.id}" version="${el.version}" changeset="${changesetId}"`;
      const tags = tagsXml(el.tags);
      switch (el.type) {
        case 'node':
          return `<node ${attrs} lat="${el.lat}" lon="${el.lon}">${tags}</node>`;
        case 'way': {
          const nodes = (el.nodes ?? []).map((ref) => `<nd ref="${ref}"/>`).join('');
          return `<way ${attrs}>${nodes}${tags}</way>`;
        }
        case 'relation': {
          const members = (el.members ?? [])
            .map((m) => `<member type="${m.type}" ref="${m.ref}" role="${escapeXml(m.role)}"/>`)
            .join('');
          return `<relation ${attrs}>${members}${tags}</relation>`;
        }
      }
    })
    .join('');
  return `<osmChange version="0.6" generator="${escapeXml(generator)}"><modify>${body}</modify></osmChange>`;
}

async function request(auth: AuthFetch, method: 'POST' | 'PUT', path: string, body?: string): Promise<string> {
  const options = body === undefined
    ? { method, headers: { 'Content-Type': 'text/xml' } }
    : { method, body, headers: { 'Content-Type': 'text/xml' } };
  const response = await auth.fetch(`${API_URL}${path}`, options);
  const text = await response.text();
  if (!response.ok) {
    throw new Error(`OSM-API: HTTP ${response.status} ${text}`);
  }
  return text;
}

/**
 * Opens a changeset, uploads the modified elements and closes the changeset
 * again, even if the upload fails. Returns the changeset ID.
 */
export async function upload(
  auth: AuthFetch,
  elements: ApiElement[],
  changesetTags: Record<string, string>,
  generator: string,
): Promise<number> {
  const changesetId = Number(await request(auth, 'PUT', '/changeset/create', changesetXml(changesetTags)));
  if (!Number.isInteger(changesetId)) {
    throw new Error('OSM-API: keine Changeset-ID erhalten');
  }
  try {
    await request(auth, 'POST', `/changeset/${changesetId}/upload`, osmChangeXml(elements, changesetId, generator));
  } finally {
    await request(auth, 'PUT', `/changeset/${changesetId}/close`).catch(() => undefined);
  }
  return changesetId;
}
