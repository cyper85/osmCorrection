import { elementKey, type ElementRef, type ElementType } from './osm.js';

export interface TagChange {
  type: ElementType;
  id: number;
  key: string;
  /** undefined: the tag is added */
  oldValue?: string;
  newValue: string;
  /** name of the element, for the list before the upload */
  label?: string;
  /**
   * For a check_date: the tag and value the user has verified. The change is
   * only applied if the tag has this value when uploading.
   */
  verifies?: { key: string; value: string };
}

function isTagChange(value: unknown): value is TagChange {
  if (typeof value !== 'object' || value === null) {
    return false;
  }
  const change = value as Record<string, unknown>;
  const verifies = change.verifies as Record<string, unknown> | undefined;
  return (
    (change.type === 'node' || change.type === 'way' || change.type === 'relation') &&
    typeof change.id === 'number' &&
    typeof change.key === 'string' &&
    (change.oldValue === undefined || typeof change.oldValue === 'string') &&
    typeof change.newValue === 'string' &&
    (change.label === undefined || typeof change.label === 'string') &&
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
