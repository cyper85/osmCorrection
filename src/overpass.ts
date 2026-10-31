import type { Bounds, ElementType, LatLon, OsmElement } from './osm.js';

/**
 * Public Overpass instances that allow requests from other sites (CORS),
 * tried in order; the next one is used if a server is busy or does not answer.
 */
export const OVERPASS_URLS = [
  'https://overpass-api.de/api/interpreter',
  'https://maps.mail.ru/osm/tools/overpass/api/interpreter',
  'https://overpass.private.coffee/api/interpreter',
];

/** Status codes Overpass uses for "too many requests" and "at capacity". */
const BUSY_STATUS = new Set([429, 502, 503, 504]);

/** A bit more than the query timeout, so a server that hangs does not block the others. */
const REQUEST_TIMEOUT_MS = 100_000;

/**
 * Pause before each round over all servers. "At capacity" usually passes
 * within seconds, so a second round often succeeds.
 */
const ROUND_DELAYS_MS = [0, 5_000];

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

export interface DownloadOptions {
  signal?: AbortSignal;
  /** Called before each request, e.g. to show which server is asked. */
  onAttempt?: (url: string, round: number) => void;
  /** for tests */
  roundDelaysMs?: number[];
  timeoutMs?: number;
}

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (ms <= 0) {
      resolve();
      return;
    }
    const timer = setTimeout(resolve, ms);
    signal?.addEventListener('abort', () => {
      clearTimeout(timer);
      reject(signal.reason);
    }, { once: true });
  });
}

/**
 * Downloads from the first Overpass server that answers. Busy servers,
 * network errors and timeouts lead to the next server; a broken query (e.g.
 * HTTP 400) is reported at once.
 */
export async function download(query: string, options: DownloadOptions = {}): Promise<OsmElement[]> {
  const { signal, onAttempt, roundDelaysMs = ROUND_DELAYS_MS, timeoutMs = REQUEST_TIMEOUT_MS } = options;
  const errors: string[] = [];
  for (const [round, delay] of roundDelaysMs.entries()) {
    await sleep(delay, signal);
    for (const url of OVERPASS_URLS) {
      const host = new URL(url).host;
      onAttempt?.(url, round + 1);
      const timeout = AbortSignal.timeout(timeoutMs);
      let response: Response;
      try {
        response = await fetch(url, {
          method: 'POST',
          body: new URLSearchParams({ data: query }),
          signal: signal === undefined ? timeout : AbortSignal.any([signal, timeout]),
        });
      } catch (error) {
        if (signal?.aborted) {
          throw error;
        }
        errors.push(`${host}: ${timeout.aborted ? 'keine Antwort' : 'nicht erreichbar'}`);
        continue;
      }
      if (response.ok) {
        return parseResponse((await response.json()) as OverpassResponse);
      }
      const detail = `HTTP ${response.status} ${(await response.text()).slice(0, 200)}`.trim();
      if (!BUSY_STATUS.has(response.status)) {
        throw new Error(`Overpass (${host}): ${detail}`);
      }
      errors.push(`${host}: ausgelastet (HTTP ${response.status})`);
    }
  }
  throw new Error(`Kein Overpass-Server hat geantwortet, bitte später noch einmal versuchen. ${errors.join('; ')}`);
}
