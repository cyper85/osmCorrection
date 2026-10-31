import { ChangeStore, type TagChange } from './changes.js';
import { elementLabel, type OsmElement } from './osm.js';

/*
 * Marking a shop or other feature as no longer existing: the user decides for
 * each tag whether it is kept, removed, or kept with a lifecycle prefix
 * (https://wiki.openstreetmap.org/wiki/Lifecycle_prefix), e.g.
 * shop=bakery → disused:shop=bakery. Tags of the building stay.
 */

export type TagAction = 'keep' | 'delete' | 'disused' | 'was';

export const TAG_ACTIONS: { action: TagAction; label: string }[] = [
  { action: 'keep', label: 'behalten' },
  { action: 'delete', label: 'löschen' },
  { action: 'disused', label: 'disused: (leer stehend)' },
  { action: 'was', label: 'was: (ehemals)' },
];

const PREFIXES = ['disused', 'was'] as const;

/** The keys that say what the feature is; they get a lifecycle prefix by default. */
const MAIN_KEYS = /^(shop|amenity|craft|office|healthcare|tourism|leisure|club)$/;
/** Tags of the building or structure, which outlives the shop. */
const STRUCTURE_KEYS =
  /^(building(:.*)?|roof:.*|height|min_height|entrance|level|layer|indoor|area|wall|man_made|(disused|was|abandoned|demolished|removed|razed):.*)$/;

/** The tag that says what the feature is, e.g. `shop=bakery`. */
export function mainTag(tags: Record<string, string>): string | undefined {
  const key = Object.keys(tags).find((k) => MAIN_KEYS.test(k));
  return key === undefined ? undefined : `${key}=${tags[key]}`;
}

export function defaultAction(key: string, tags: Record<string, string>): TagAction {
  if (MAIN_KEYS.test(key)) {
    return 'disused';
  }
  if (STRUCTURE_KEYS.test(key)) {
    return 'keep';
  }
  // the address belongs to the building if there is one
  if (key.startsWith('addr:') && tags.building !== undefined) {
    return 'keep';
  }
  return 'delete';
}

export function defaultActions(element: OsmElement): Record<string, TagAction> {
  return Object.fromEntries(Object.keys(element.tags).map((key) => [key, defaultAction(key, element.tags)]));
}

/** Whether the element has been marked as no longer existing. */
export function isClosed(changes: TagChange[]): boolean {
  return changes.some((change) => change.closed === true);
}

/** The actions of an earlier closure, to show it again; `keep` for untouched tags. */
export function currentActions(element: OsmElement, changes: TagChange[]): Record<string, TagAction> {
  const byKey = new Map(changes.map((change) => [change.key, change]));
  return Object.fromEntries(
    Object.entries(element.tags).map(([key, value]): [string, TagAction] => {
      if (byKey.get(key)?.newValue !== undefined || !byKey.has(key)) {
        return [key, 'keep'];
      }
      const prefix = PREFIXES.find((p) => byKey.get(`${p}:${key}`)?.newValue === value);
      return [key, prefix ?? 'delete'];
    }),
  );
}

/** The tags of the element after the changes. */
export function remainingTags(tags: Record<string, string>, changes: TagChange[]): Record<string, string> {
  const result = { ...tags };
  for (const change of changes) {
    if (change.newValue === undefined) {
      delete result[change.key];
    } else {
      result[change.key] = change.newValue;
    }
  }
  return result;
}

/**
 * Marks the removals of a node with `deleteIfUnused` exactly if no tag would
 * remain. Call after every change of the element.
 */
export function updateDeletion(store: ChangeStore, element: OsmElement): void {
  const list = store.forElement(element);
  const empty = element.type === 'node' && Object.keys(remainingTags(element.tags, list)).length === 0;
  for (const change of list) {
    if (change.newValue === undefined && (change.deleteIfUnused === true) !== empty) {
      const { deleteIfUnused: _, ...rest } = change;
      store.set(empty ? { ...rest, deleteIfUnused: true } : rest);
    }
  }
}

function ref(element: OsmElement) {
  return { type: element.type, id: element.id, label: elementLabel(element) };
}

/** Drops check_dates that confirm a tag that is removed now. */
function dropConfirmations(store: ChangeStore, element: OsmElement, key: string): void {
  for (const change of store.forElement(element)) {
    if (change.verifies?.key === key) {
      store.delete(element, change.key);
    }
  }
}

/** Removes a single tag. */
export function removeTag(store: ChangeStore, element: OsmElement, key: string): void {
  const value = element.tags[key];
  if (value === undefined) {
    return;
  }
  store.set({ ...ref(element), key, oldValue: value });
  dropConfirmations(store, element, key);
  updateDeletion(store, element);
}

/**
 * Records the closure of the element. Corrections of kept tags stay, removals
 * of kept tags are undone; applying it again with other actions replaces the
 * earlier closure.
 */
export function applyClosure(store: ChangeStore, element: OsmElement, actions: Record<string, TagAction>): void {
  for (const [key, value] of Object.entries(element.tags)) {
    const action = actions[key] ?? 'keep';
    for (const prefix of PREFIXES) {
      if (store.get(element, `${prefix}:${key}`)?.closed === true) {
        store.delete(element, `${prefix}:${key}`);
      }
    }
    const pending = store.get(element, key);
    if (action === 'keep') {
      // undo a removal, keep a correction
      if (pending !== undefined && pending.newValue === undefined) {
        store.delete(element, key);
      }
      continue;
    }
    store.set({ ...ref(element), key, oldValue: value, closed: true });
    dropConfirmations(store, element, key);
    if (action === 'disused' || action === 'was') {
      const prefixed = `${action}:${key}`;
      store.set({ ...ref(element), key: prefixed, oldValue: element.tags[prefixed], newValue: value, closed: true });
    }
  }
  updateDeletion(store, element);
}

/** The tags that would remain with these actions, without changing the store. */
export function previewClosure(
  element: OsmElement,
  actions: Record<string, TagAction>,
  changes: TagChange[],
): Record<string, string> {
  const store = new ChangeStore();
  for (const change of changes) {
    store.set(change);
  }
  applyClosure(store, element, actions);
  return remainingTags(element.tags, store.forElement(element));
}
