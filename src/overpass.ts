import type { Bounds, ElementType, LatLon, OsmElement } from './osm.js';

/** Tried in order; the next one is used if a server is busy. */
export const OVERPASS_URLS = [
  'https://overpass-api.de/api/interpreter',
  'https://overpass.private.coffee/api/interpreter',
];

/** Status codes Overpass uses for "too many requests" and "at capacity". */
const BUSY_STATUS = new Set([429, 502, 503, 504]);

export interface BBox {
  south: number;
  west: number;
  north: number;
  east: number;
}

/**
 * Builds one Overpass query for all elements in the bounding box that have a
 * key matching one of the patterns. Nodes and ways come with their geometry,
 * relations only with their bounding box (their full geometry can be huge).
 */
export function buildQuery(keyPatterns: string[], bbox: BBox): string {
  if (keyPatterns.length === 0) {
    throw new Error('no key patterns');
  }
  const keys = keyPatterns.map((pattern) => `(${pattern})`).join('|');
  const box = [bbox.south, bbox.west, bbox.north, bbox.east].map((n) => n.toFixed(6)).join(',');
  const filter = `[~"${keys.replace(/["\\]/g, '\\$&')}"~"."](${box})`;
  return [
    '[out:json][timeout:90];',
    `nw${filter};`,
    'out meta geom;',
    `rel${filter};`,
    'out meta bb;',
  ].join('\n');
}

interface OverpassElement {
  type: ElementType;
  id: number;
  version?: number;
  tags?: Record<string, string>;
  lat?: number;
  lon?: number;
  geometry?: (LatLon | null)[];
  bounds?: Bounds;
}

interface OverpassResponse {
  elements: OverpassElement[];
  remark?: string;
}

export function parseResponse(response: OverpassResponse): OsmElement[] {
  // Overpass reports runtime errors (timeout, out of memory) as a remark
  if (response.remark !== undefined && /error/i.test(response.remark)) {
    throw new Error(`Overpass: ${response.remark}`);
  }
  const elements: OsmElement[] = [];
  for (const el of response.elements) {
    if (el.version === undefined || el.tags === undefined) {
      continue;
    }
    const element: OsmElement = { type: el.type, id: el.id, version: el.version, tags: el.tags };
    if (el.lat !== undefined && el.lon !== undefined) {
      element.lat = el.lat;
      element.lon = el.lon;
    }
    if (el.geometry !== undefined) {
      element.geometry = el.geometry;
    }
    if (el.bounds !== undefined) {
      element.bounds = el.bounds;
    }
    elements.push(element);
  }
  return elements;
}

export async function download(query: string, signal?: AbortSignal): Promise<OsmElement[]> {
  let lastError: Error | undefined;
  for (const url of OVERPASS_URLS) {
    let response: Response;
    try {
      response = await fetch(url, { method: 'POST', body: new URLSearchParams({ data: query }), signal: signal ?? null });
    } catch (error) {
      if (signal?.aborted) {
        throw error;
      }
      lastError = error instanceof Error ? error : new Error(String(error));
      continue;
    }
    if (response.ok) {
      return parseResponse((await response.json()) as OverpassResponse);
    }
    lastError = new Error(`Overpass: HTTP ${response.status} ${(await response.text()).slice(0, 200)}`);
    if (!BUSY_STATUS.has(response.status)) {
      break;
    }
  }
  throw lastError ?? new Error('Overpass: no server');
}
