import { elementKey, type ElementRef, type ElementType } from './osm.js';

export interface TagChange {
  type: ElementType;
  id: number;
  key: string;
  /** undefined: the tag is added */
  oldValue?: string;
  /** undefined: the tag is removed */
  newValue?: string;
  /** name of the element, for the list before the upload */
  label?: string;
  /**
   * For a check_date: the tag and value the user has verified. The change is
   * only applied if the tag has this value when uploading.
   */
  verifies?: { key: string; value: string };
  /** part of marking the element as no longer existing (see closure.ts) */
  closed?: true;
  /** removed because the same value is in this key, e.g. contact:website */
  duplicateOf?: string;
  /**
   * removed because the value moves to another key (e.g. menu:url →
   * website:menu); only applied if that key has the value when uploading
   */
  movedTo?: { key: string; value: string };
  /** added with the value of this key, which is removed */
  movedFrom?: string;
  /** suggested by this AI model (e.g. "Anthropic Claude Sonnet 5.5"), for the changeset */
  ai?: string;
  /** all tags of the node are removed: it is deleted if it is not part of a way or relation */
  deleteIfUnused?: true;
}

function isTagChange(value: unknown): value is TagChange {
  if (typeof value !== 'object' || value === null) {
    return false;
  }
  const change = value as Record<string, unknown>;
  const verifies = change.verifies as Record<string, unknown> | undefined;
  const movedTo = change.movedTo as Record<string, unknown> | undefined;
  return (
    (change.type === 'node' || change.type === 'way' || change.type === 'relation') &&
    typeof change.id === 'number' &&
    typeof change.key === 'string' &&
    (change.oldValue === undefined || typeof change.oldValue === 'string') &&
    (change.newValue === undefined || typeof change.newValue === 'string') &&
    (change.oldValue !== undefined || change.newValue !== undefined) &&
    (change.label === undefined || typeof change.label === 'string') &&
    (change.closed === undefined || change.closed === true) &&
    (change.duplicateOf === undefined || typeof change.duplicateOf === 'string') &&
    (change.movedFrom === undefined || typeof change.movedFrom === 'string') &&
    (change.ai === undefined || typeof change.ai === 'string') &&
    (movedTo === undefined ||
      (typeof movedTo === 'object' && movedTo !== null && typeof movedTo.key === 'string' && typeof movedTo.value === 'string')) &&
    (change.deleteIfUnused === undefined || change.deleteIfUnused === true) &&
    (verifies === undefined ||
      (typeof verifies === 'object' && verifies !== null && typeof verifies.key === 'string' && typeof verifies.value === 'string'))
  );
}

/**
 * The tag changes the user has accepted, at most one per element and key.
 * With a storage key, the changes survive a reload of the page (and the
 * redirect of the OSM login).
 */
export class ChangeStore {
  private readonly changes = new Map<string, TagChange>();

  constructor(private readonly storageKey?: string) {
    for (const change of this.load()) {
      this.changes.set(ChangeStore.id(change, change.key), change);
    }
  }

  private static id(ref: ElementRef, key: string): string {
    return `${elementKey(ref)}/${key}`;
  }

  /** Records a change; setting the old value again removes it. */
  set(change: TagChange): void {
    const id = ChangeStore.id(change, change.key);
    if (change.newValue === change.oldValue) {
      this.changes.delete(id);
    } else {
      this.changes.set(id, change);
    }
    this.save();
  }

  get(ref: ElementRef, key: string): TagChange | undefined {
    return this.changes.get(ChangeStore.id(ref, key));
  }

  delete(ref: ElementRef, key: string): void {
    this.changes.delete(ChangeStore.id(ref, key));
    this.save();
  }

  /** All changes of one element. */
  forElement(ref: ElementRef): TagChange[] {
    const prefix = `${elementKey(ref)}/`;
    return [...this.changes.entries()].filter(([id]) => id.startsWith(prefix)).map(([, change]) => change);
  }

  clear(): void {
    this.changes.clear();
    this.save();
  }

  get size(): number {
    return this.changes.size;
  }

  list(): TagChange[] {
    return [...this.changes.values()];
  }

  private load(): TagChange[] {
    if (this.storageKey === undefined) {
      return [];
    }
    try {
      const stored = JSON.parse(localStorage.getItem(this.storageKey) ?? '[]') as unknown;
      return Array.isArray(stored) ? stored.filter(isTagChange) : [];
    } catch {
      return [];
    }
  }

  private save(): void {
    if (this.storageKey === undefined) {
      return;
    }
    try {
      if (this.changes.size === 0) {
        localStorage.removeItem(this.storageKey);
      } else {
        localStorage.setItem(this.storageKey, JSON.stringify(this.list()));
      }
    } catch {
      // no storage: the changes only live until the page is closed
    }
  }
}
