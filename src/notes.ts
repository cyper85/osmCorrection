import { mainTag } from './closure.js';
import { elementCenter, elementKey, elementLabel, osmUrl, type ElementRef, type OsmElement } from './osm.js';
import { API_URL, type AuthFetch } from './osmApi.js';

/*
 * OSM notes (https://wiki.openstreetmap.org/wiki/Notes) for objects that
 * someone has to check on site, e.g. whether a shop still exists. A note does
 * not change the data, local mappers and StreetComplete show it.
 */

const NOTE_STORAGE_KEY = 'osmCorrection.notes';

export function noteText(element: OsmElement): string {
  const tag = mainTag(element.tags);
  const what = tag === undefined ? `„${elementLabel(element)}“` : `„${elementLabel(element)}“ (${tag})`;
  return (
    `Gibt es ${what} noch? Bitte vor Ort prüfen und in OpenStreetMap aktualisieren.\n\n` +
    `${osmUrl(element)}\n\n#osmCorrection`
  );
}

export function noteUrl(id: number): string {
  return `https://www.openstreetmap.org/note/${id}`;
}

/** Creates a note at the element and returns its ID. Needs the scope `write_notes`. */
export async function createNote(auth: AuthFetch, element: OsmElement, text: string): Promise<number> {
  const center = elementCenter(element);
  if (center === undefined) {
    throw new Error('Für dieses Objekt ist keine Position bekannt.');
  }
  const params = new URLSearchParams({ lat: center.lat.toFixed(7), lon: center.lon.toFixed(7), text });
  const response = await auth.fetch(`${API_URL}/notes.json?${params}`, { method: 'POST' });
  if (response.status === 403) {
    throw new Error(
      'Keine Berechtigung für Hinweise. Bitte einmal ab- und wieder anmelden, damit die neue Berechtigung erteilt wird.',
    );
  }
  if (!response.ok) {
    throw new Error(`OSM-API: HTTP ${response.status} ${await response.text()}`);
  }
  const data = (await response.json()) as { properties?: { id?: unknown } };
  const id = data.properties?.id;
  if (typeof id !== 'number') {
    throw new Error('OSM-API: keine Hinweis-ID erhalten');
  }
  return id;
}

function savedNotes(): Record<string, number> {
  try {
    const notes = JSON.parse(localStorage.getItem(NOTE_STORAGE_KEY) ?? '{}') as unknown;
    return typeof notes === 'object' && notes !== null && !Array.isArray(notes) ? (notes as Record<string, number>) : {};
  } catch {
    return {};
  }
}

/** The note created for an element from this browser, so it is not created twice. */
export function noteFor(ref: ElementRef): number | undefined {
  const id = savedNotes()[elementKey(ref)];
  return typeof id === 'number' ? id : undefined;
}

export function rememberNote(ref: ElementRef, id: number): void {
  try {
    localStorage.setItem(NOTE_STORAGE_KEY, JSON.stringify({ ...savedNotes(), [elementKey(ref)]: id }));
  } catch {
    // no storage: only the link in the current view
  }
}
