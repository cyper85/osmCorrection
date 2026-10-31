import { elementKey, type ElementRef, type ElementType } from './osm.js';

export interface TagChange {
  type: ElementType;
  id: number;
  key: string;
  oldValue: string;
  newValue: string;
}

/** The tag changes the user has accepted, at most one per element and key. */
export class ChangeStore {
  private readonly changes = new Map<string, TagChange>();

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
  }

  get(ref: ElementRef, key: string): TagChange | undefined {
    return this.changes.get(ChangeStore.id(ref, key));
  }

  delete(ref: ElementRef, key: string): void {
    this.changes.delete(ChangeStore.id(ref, key));
  }

  clear(): void {
    this.changes.clear();
  }

  get size(): number {
    return this.changes.size;
  }

  list(): TagChange[] {
    return [...this.changes.values()];
  }
}
