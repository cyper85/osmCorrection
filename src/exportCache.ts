import { elementKey, type ElementRef, type OsmElement } from './osm.js';

/*
 * The elements of a job for an AI agent, kept from the export for the import,
 * so the import needs no download. Kept for 24 hours; older ones, or ones
 * from another browser, are fetched from the OSM API. Elements that changed
 * in the meantime are caught on upload (conflicts).
 */

const STORAGE_KEY = 'osmCorrection.exported';
export const EXPORT_CACHE_MS = 24 * 60 * 60 * 1000;

type Store = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;
type Saved = Record<string, { savedAt: number; element: OsmElement }>;

function storage(): Store | null {
  try {
    return globalThis.localStorage ?? null;
  } catch {
    return null;
  }
}

/** The saved elements that are not too old. */
function load(store: Store | null, now: number): Saved {
  try {
    const saved = JSON.parse(store?.getItem(STORAGE_KEY) ?? '{}') as Saved;
    return Object.fromEntries(Object.entries(saved).filter(([, entry]) => now - entry.savedAt < EXPORT_CACHE_MS));
  } catch {
    return {};
  }
}

function save(store: Store | null, saved: Saved): void {
  try {
    if (Object.keys(saved).length === 0) {
      store?.removeItem(STORAGE_KEY);
    } else {
      store?.setItem(STORAGE_KEY, JSON.stringify(saved));
    }
  } catch {
    // no storage or full: the import fetches the elements instead
  }
}

/** Keeps the exported elements (in addition to those of earlier exports). */
export function rememberExported(elements: OsmElement[], now = Date.now(), store = storage()): void {
  const saved = load(store, now);
  for (const element of elements) {
    saved[elementKey(element)] = { savedAt: now, element };
  }
  save(store, saved);
}

/** The kept elements for the references, and the references that must be fetched. */
export function exportedElements(
  refs: ElementRef[],
  now = Date.now(),
  store = storage(),
): { found: OsmElement[]; missing: ElementRef[] } {
  const saved = load(store, now);
  // drops the expired ones
  save(store, saved);
  const found: OsmElement[] = [];
  const missing: ElementRef[] = [];
  const seen = new Set<string>();
  for (const ref of refs) {
    const key = elementKey(ref);
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    const entry = saved[key];
    if (entry === undefined) {
      missing.push({ type: ref.type, id: ref.id });
    } else {
      found.push(entry.element);
    }
  }
  return { found, missing };
}
