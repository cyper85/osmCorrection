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
  fetch(resource: string, options: { method: 'GET' | 'POST' | 'PUT'; body?: string; headers?: object }): Promise<Response>;}

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
 * only applied if the tag still has the value the user saw (or is still
 * missing, for a new tag); otherwise someone else edited it in the meantime
 * and it becomes a conflict.
 *
 * A check_date (`verifies`) is applied after the other changes and only if
 * the verified tag then has the verified value. So it is dropped together
 * with a conflicting correction of that tag.
 */
export function applyChanges(
  changes: TagChange[],
  current: Map<string, ApiElement>,
): { modified: ApiElement[]; conflicts: Conflict[] } {
  const modified = new Map<string, ApiElement>();
  const conflicts: Conflict[] = [];
  const ordered = [...changes.filter((c) => c.verifies === undefined), ...changes.filter((c) => c.verifies !== undefined)];
  for (const change of ordered) {
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
        reason:
          value === undefined
            ? 'Tag wurde inzwischen entfernt'
            : change.oldValue === undefined
              ? `Tag wurde inzwischen gesetzt auf „${value}“`
              : `Tag wurde inzwischen geändert auf „${value}“`,
      });
      continue;
    }
    if (change.verifies !== undefined && element.tags?.[change.verifies.key] !== change.verifies.value) {
      conflicts.push({ change, reason: `Der geprüfte Wert von ${change.verifies.key} wird nicht hochgeladen` });
      continue;
    }
    const tags = { ...element.tags };
    if (change.newValue === undefined) {
      delete tags[change.key];
    } else {
      tags[change.key] = change.newValue;
    }
    modified.set(key, { ...element, tags });
  }
  return { modified: [...modified.values()], conflicts };
}

/** Whether a node is part of a way or relation (no login needed). */
export async function nodeInUse(id: number): Promise<boolean> {
  for (const parents of ['ways', 'relations']) {
    const response = await fetch(`${API_URL}/node/${id}/${parents}.json`);
    if (!response.ok) {
      throw new Error(`OSM-API: HTTP ${response.status} ${await response.text()}`);
    }
    const data = (await response.json()) as { elements: unknown[] };
    if (data.elements.length > 0) {
      return true;
    }
  }
  return false;
}

/**
 * Nodes without tags that are not part of a way or relation are deleted
 * instead of being left behind empty. Nodes in a way stay as vertices.
 */
export async function splitDeletions(
  elements: ApiElement[],
  inUse: (id: number) => Promise<boolean> = nodeInUse,
): Promise<{ modify: ApiElement[]; remove: ApiElement[] }> {
  const modify: ApiElement[] = [];
  const remove: ApiElement[] = [];
  for (const element of elements) {
    const empty = element.type === 'node' && Object.keys(element.tags ?? {}).length === 0;
    (empty && !(await inUse(element.id)) ? remove : modify).push(element);
  }
  return { modify, remove };
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

export function osmChangeXml(
  elements: ApiElement[],
  changesetId: number,
  generator: string,
  deleted: ApiElement[] = [],
): string {
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
  const modify = elements.length === 0 ? '' : `<modify>${body}</modify>`;
  // if-unused: should a node have become part of a way in the meantime, it is kept instead of failing the upload
  const remove =
    deleted.length === 0
      ? ''
      : `<delete if-unused="true">${deleted
          .map((el) => `<${el.type} id="${el.id}" version="${el.version}" changeset="${changesetId}"${el.type === 'node' ? ` lat="${el.lat}" lon="${el.lon}"` : ''}/>`)
          .join('')}</delete>`;
  return `<osmChange version="0.6" generator="${escapeXml(generator)}">${modify}${remove}</osmChange>`;
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
 * Opens a changeset, uploads the modified (and deleted) elements and closes
 * the changeset again, even if the upload fails. Returns the changeset ID.
 */
export async function upload(
  auth: AuthFetch,
  elements: ApiElement[],
  changesetTags: Record<string, string>,
  generator: string,
  deleted: ApiElement[] = [],
): Promise<number> {
  const changesetId = Number(await request(auth, 'PUT', '/changeset/create', changesetXml(changesetTags)));
  if (!Number.isInteger(changesetId)) {
    throw new Error('OSM-API: keine Changeset-ID erhalten');
  }
  try {
    await request(auth, 'POST', `/changeset/${changesetId}/upload`, osmChangeXml(elements, changesetId, generator, deleted));
  } finally {
    await request(auth, 'PUT', `/changeset/${changesetId}/close`).catch(() => undefined);
  }
  return changesetId;
}
