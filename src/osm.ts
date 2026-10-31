export type ElementType = 'node' | 'way' | 'relation';

export interface LatLon {
  lat: number;
  lon: number;
}

export interface Bounds {
  minlat: number;
  minlon: number;
  maxlat: number;
  maxlon: number;
}

/** An OSM element as downloaded from Overpass, with geometry for display. */
export interface OsmElement {
  type: ElementType;
  id: number;
  version: number;
  tags: Record<string, string>;
  /** node position */
  lat?: number;
  lon?: number;
  /** way geometry; entries may be null if Overpass could not resolve a node */
  geometry?: (LatLon | null)[];
  /** relation bounding box */
  bounds?: Bounds;
}

export interface ElementRef {
  type: ElementType;
  id: number;
}

export function elementKey(ref: ElementRef): string {
  return `${ref.type}/${ref.id}`;
}

export function osmUrl(ref: ElementRef): string {
  return `https://www.openstreetmap.org/${ref.type}/${ref.id}`;
}

const TYPE_LABELS: Record<ElementType, string> = {
  node: 'Punkt',
  way: 'Weg',
  relation: 'Relation',
};

export function elementLabel(element: OsmElement): string {
  return element.tags.name ?? `${TYPE_LABELS[element.type]} ${element.id}`;
}
