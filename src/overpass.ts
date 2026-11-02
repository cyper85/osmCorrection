import type { Bounds, ElementType, LatLon, OsmElement } from './osm.js';
import { t } from './i18n.js';

/**
 * Public Overpass instances that allow requests from other sites (CORS),
 * tried in order; the next one is used if a server is busy or does not answer.
 * Only servers in the EU/EEA, see datenschutz.html (maps.mail.ru in Russia was
 * removed for that reason).
 */
export const OVERPASS_URLS = [
  'https://overpass-api.de/api/interpreter',
  'https://overpass.private.coffee/api/interpreter',
];

/** Status codes Overpass uses for "too many requests" and "at capacity". */
const BUSY_STATUS = new Set([429, 502, 503, 504]);

/** A bit more than the query timeout, so a server that hangs does not block the others. */
const REQUEST_TIMEOUT_MS = 100_000;

/**
 * With a fallback (the OSM API), the first round waits less: a small frame
 * usually takes a few seconds, a server that hangs longer is likely overloaded.
 */
const FIRST_ROUND_TIMEOUT_MS = 30_000;

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
  /**
   * Asked after the first round over all servers failed, before the second
   * round (e.g. the OSM API). If it fails as well, the second round follows.
   */
  fallback?: {
    /** for the error message, e.g. api.openstreetmap.org */
    host: string;
    run: (signal?: AbortSignal) => Promise<OsmElement[]>;
    /** Called before the fallback is asked, e.g. to tell the user. */
    onStart?: () => void;
  };
  /** for tests */
  roundDelaysMs?: number[];
  timeoutMs?: number;
  firstRoundTimeoutMs?: number;
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
 * HTTP 400) is reported at once. After the first round the fallback is asked,
 * if there is one.
 */
export async function download(query: string, options: DownloadOptions = {}): Promise<OsmElement[]> {
  const {
    signal,
    onAttempt,
    fallback,
    roundDelaysMs = ROUND_DELAYS_MS,
    timeoutMs = REQUEST_TIMEOUT_MS,
    firstRoundTimeoutMs = FIRST_ROUND_TIMEOUT_MS,
  } = options;
  const errors: string[] = [];
  for (const [round, delay] of roundDelaysMs.entries()) {
    if (round === 1 && fallback !== undefined) {
      fallback.onStart?.();
      try {
        return await fallback.run(signal);
      } catch (error) {
        if (signal?.aborted) {
          throw error;
        }
        errors.push(`${fallback.host}: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
    await sleep(delay, signal);
    for (const url of OVERPASS_URLS) {
      const host = new URL(url).host;
      onAttempt?.(url, round + 1);
      const timeout = AbortSignal.timeout(round === 0 && fallback !== undefined ? firstRoundTimeoutMs : timeoutMs);
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
        errors.push(`${host}: ${timeout.aborted ? t('overpass.noAnswer') : t('overpass.unreachable')}`);
        continue;
      }
      if (response.ok) {
        return parseResponse((await response.json()) as OverpassResponse);
      }
      const detail = `HTTP ${response.status} ${(await response.text()).slice(0, 200)}`.trim();
      if (!BUSY_STATUS.has(response.status)) {
        throw new Error(`Overpass (${host}): ${detail}`);
      }
      errors.push(`${host}: ${t('overpass.busy', { status: String(response.status) })}`);
    }
  }
  throw new Error(t('overpass.failed', { errors: errors.join('; ') }));
}
