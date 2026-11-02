import { elementKey, type Bounds, type ElementRef, type ElementType, type LatLon, type OsmElement } from './osm.js';
import { API_URL, type ApiElement } from './osmApi.js';
import type { BBox } from './overpass.js';

/*
 * Reading from the OSM API instead of Overpass: for the frame if no Overpass
 * server answers (`map` call), and for the elements of an imported AI result.
 * The API knows no filter, so the elements are chosen here, and way geometry
 * and relation bounds are put together from the nodes.
 */

const MAP_TIMEOUT_MS = 60_000;
const BATCH_SIZE = 100;

function boundsOf(points: LatLon[]): Bounds {
  const lats = points.map((p) => p.lat);
  const lons = points.map((p) => p.lon);
  return { minlat: Math.min(...lats), minlon: Math.min(...lons), maxlat: Math.max(...lats), maxlon: Math.max(...lons) };
}

/**
 * The elements with geometry like from Overpass: nodes with their position,
 * ways with the positions of their nodes, relations with the bounds of the
 * members at hand (nested relations are left out).
 */
export function withGeometry(selected: ApiElement[], all: Map<string, ApiElement>): OsmElement[] {
  const position = (id: number): LatLon | null => {
    const node = all.get(`node/${id}`);
    return node?.lat !== undefined && node.lon !== undefined ? { lat: node.lat, lon: node.lon } : null;
  };
  return selected.map((source) => {
    const element: OsmElement = { type: source.type, id: source.id, version: source.version, tags: source.tags ?? {} };
    if (source.type === 'node') {
      if (source.lat !== undefined && source.lon !== undefined) {
        element.lat = source.lat;
        element.lon = source.lon;
      }
    } else if (source.type === 'way') {
      element.geometry = (source.nodes ?? []).map(position);
    } else {
      const points = (source.members ?? [])
        .flatMap((member) =>
          member.type === 'node' ? [position(member.ref)] : member.type === 'way' ? (all.get(`way/${member.ref}`)?.nodes ?? []).map(position) : [],
        )
        .filter((point) => point !== null);
      if (points.length > 0) {
        element.bounds = boundsOf(points);
      }
    }
    return element;
  });
}

/**
 * Chooses from the answer of the `map` call what the Overpass query of
 * `buildQuery` would have returned: elements with a non-empty tag whose key
 * matches one of the patterns, nodes inside the box, ways and relations with
 * a node inside the box.
 */
export function parseMap(elements: ApiElement[], bbox: BBox, keyPatterns: string[]): OsmElement[] {
  const pattern = new RegExp(keyPatterns.map((p) => `(${p})`).join('|'));
  const all = new Map(elements.map((element) => [elementKey(element), element]));
  const inBox = (node: ApiElement | undefined) =>
    node?.lat !== undefined &&
    node.lon !== undefined &&
    node.lat >= bbox.south &&
    node.lat <= bbox.north &&
    node.lon >= bbox.west &&
    node.lon <= bbox.east;
  const wayInBox = (id: number) => (all.get(`way/${id}`)?.nodes ?? []).some((node) => inBox(all.get(`node/${node}`)));
  const wanted = (element: ApiElement) => Object.entries(element.tags ?? {}).some(([key, value]) => value !== '' && pattern.test(key));
  const selected = elements.filter((element) => {
    if (element.visible === false || !wanted(element)) {
      return false;
    }
    if (element.type === 'node') {
      return inBox(element);
    }
    if (element.type === 'way') {
      return wayInBox(element.id);
    }
    return (element.members ?? []).some((member) =>
      member.type === 'node' ? inBox(all.get(`node/${member.ref}`)) : member.type === 'way' && wayInBox(member.ref),
    );
  });
  return withGeometry(selected, all);
}

/** Downloads the box with the `map` call of the OSM API (all elements, no filter). */
export async function downloadMap(bbox: BBox, keyPatterns: string[], signal?: AbortSignal): Promise<OsmElement[]> {
  const box = [bbox.west, bbox.south, bbox.east, bbox.north].map((n) => n.toFixed(6)).join(',');
  const timeout = AbortSignal.timeout(MAP_TIMEOUT_MS);
  const response = await fetch(`${API_URL}/map.json?bbox=${box}`, {
    signal: signal === undefined ? timeout : AbortSignal.any([signal, timeout]),
  });
  if (!response.ok) {
    throw new Error(`HTTP ${response.status} ${(await response.text()).slice(0, 200)}`.trim());
  }
  const data = (await response.json()) as { elements: ApiElement[] };
  return parseMap(data.elements, bbox, keyPatterns);
}

/**
 * Fetches elements of one type. An ID that does not exist makes the API
 * answer the whole batch with 404, so such a batch is fetched one by one.
 */
async function fetchType(type: ElementType, ids: number[], into: Map<string, ApiElement>): Promise<void> {
  const fetchJson = async (url: string) => {
    const response = await fetch(url);
    if (response.status === 404 || response.status === 410) {
      return undefined;
    }
    if (!response.ok) {
      throw new Error(`OSM-API: HTTP ${response.status} ${(await response.text()).slice(0, 200)}`.trim());
    }
    return ((await response.json()) as { elements: ApiElement[] }).elements;
  };
  const unique = [...new Set(ids)].filter((id) => !into.has(`${type}/${id}`));
  for (let i = 0; i < unique.length; i += BATCH_SIZE) {
    const batch = unique.slice(i, i + BATCH_SIZE);
    let elements = await fetchJson(`${API_URL}/${type}s.json?${type}s=${batch.join(',')}`);
    if (elements === undefined) {
      elements = [];
      for (const id of batch) {
        elements.push(...((await fetchJson(`${API_URL}/${type}/${id}.json`)) ?? []));
      }
    }
    for (const element of elements) {
      into.set(elementKey(element), element);
    }
  }
}

/**
 * Fetches single elements with geometry from the OSM API (no login needed),
 * e.g. those of an imported AI result. Deleted or unknown elements are left
 * out.
 */
export async function fetchElements(refs: ElementRef[]): Promise<OsmElement[]> {
  const all = new Map<string, ApiElement>();
  const ids = (type: ElementType) => refs.filter((ref) => ref.type === type).map((ref) => ref.id);
  for (const type of ['node', 'way', 'relation'] as const) {
    await fetchType(type, ids(type), all);
  }
  const found = [...new Set(refs.map(elementKey))].flatMap((key) => {
    const element = all.get(key);
    return element === undefined || element.visible === false ? [] : [element];
  });
  const members = (type: ElementType) =>
    found.flatMap((element) => (element.members ?? []).filter((member) => member.type === type).map((member) => member.ref));
  await fetchType('way', members('way'), all);
  const nodes = [
    ...found.flatMap((element) => element.nodes ?? []),
    ...members('way').flatMap((id) => all.get(`way/${id}`)?.nodes ?? []),
    ...members('node'),
  ];
  await fetchType('node', nodes, all);
  return withGeometry(found, all);
}
