import { url as validateUrl } from 'osmvalidation';
import { CHECKS, type Check, type Issue } from './checks.js';
import { elementKey, type OsmElement } from './osm.js';
import { isRecentlyChecked } from './verification.js';

/*
 * Without a server the browser can only make "no-cors" requests to other
 * sites. Their response is opaque: a 404 looks like a 200, and redirects are
 * followed silently. What can be detected is a request that fails entirely:
 * unknown domain, invalid certificate, no answer. http URLs cannot be
 * requested from an https page at all (mixed content), so for them only the
 * https variant is tried.
 */

const TIMEOUT_MS = 15_000;
const CONCURRENCY = 8;
const WEBSITE_KEY = /^(contact:)?website$|^url$/;

/** Hosts that reject every request from other pages, also for existing pages. */
const UNCHECKABLE_HOSTS = /(^|\.)(x\.com|twitter\.com|youtube\.com|youtu\.be)$/i;

export const WEBSITE_ONLINE = {
  id: 'website-online',
  label: 'Websites online prüfen',
  keyPattern: WEBSITE_KEY.source,
} as const;

export type ProbeResult = 'reachable' | 'unreachable' | 'timeout';
export type Probe = (url: string) => Promise<ProbeResult>;

export const browserProbe: Probe = async (url) => {
  try {
    await fetch(url, {
      method: 'HEAD',
      mode: 'no-cors',
      credentials: 'omit',
      cache: 'no-store',
      referrerPolicy: 'no-referrer',
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    return 'reachable';
  } catch (error) {
    return error instanceof DOMException && error.name === 'TimeoutError' ? 'timeout' : 'unreachable';
  }
};

/** The URL to request for a website value, or undefined if it cannot be checked. */
export function probeUrl(value: string): string | undefined {
  if (!validateUrl(value).valid) {
    return undefined;
  }
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    return undefined;
  }
  if (UNCHECKABLE_HOSTS.test(parsed.hostname)) {
    return undefined;
  }
  parsed.protocol = 'https:';
  return parsed.href;
}

/** Website tags to check: not confirmed with a recent check_date. */
function needsCheck(element: OsmElement, key: string, now: Date): boolean {
  return WEBSITE_KEY.test(key) && !isRecentlyChecked(element, key, now);
}

export function websitesToProbe(elements: OsmElement[], now = new Date()): string[] {
  const urls = new Set<string>();
  for (const element of elements) {
    for (const [key, value] of Object.entries(element.tags)) {
      const target = needsCheck(element, key, now) ? probeUrl(value) : undefined;
      if (target !== undefined) {
        urls.add(target);
      }
    }
  }
  return [...urls];
}

/**
 * Requests all URLs, a few at a time. A failed request is repeated once, to
 * rule out a short network hiccup.
 */
export async function probeAll(
  urls: string[],
  probe: Probe,
  onProgress?: (done: number, total: number) => void,
): Promise<Map<string, ProbeResult>> {
  const results = new Map<string, ProbeResult>();
  let next = 0;
  const worker = async () => {
    while (next < urls.length) {
      const target = urls[next++];
      if (target === undefined) {
        break;
      }
      let result = await probe(target);
      if (result !== 'reachable') {
        result = await probe(target);
      }
      results.set(target, result);
      onProgress?.(results.size, urls.length);
    }
  };
  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, urls.length) }, worker));
  return results;
}

function urlCheck(): Check {
  const check = CHECKS.find((c) => c.id === 'url');
  if (check === undefined) {
    throw new Error('check url missing');
  }
  return check;
}

/**
 * Reports websites the browser could not connect to, and http websites that
 * are also available via https. Keys that already have an issue are skipped.
 */
export function websiteIssues(
  elements: OsmElement[],
  results: Map<string, ProbeResult>,
  existing: Issue[],
  now = new Date(),
): Issue[] {
  const taken = new Set(existing.map((issue) => `${elementKey(issue.element)}/${issue.key}`));
  const issues: Issue[] = [];
  for (const element of elements) {
    for (const [key, value] of Object.entries(element.tags)) {
      if (!needsCheck(element, key, now) || taken.has(`${elementKey(element)}/${key}`)) {
        continue;
      }
      const target = probeUrl(value);
      const result = target === undefined ? undefined : results.get(target);
      if (target === undefined || result === undefined) {
        continue;
      }
      const isHttp = value.toLowerCase().startsWith('http:');
      if (isHttp && result === 'reachable') {
        issues.push({
          element,
          key,
          value,
          check: urlCheck(),
          valid: true,
          message: 'Die Website ist auch verschlüsselt per https erreichbar. Bitte kurz prüfen, ob dort dieselbe Seite erscheint.',
          suggestion: target,
        });
      } else if (!isHttp && result !== 'reachable') {
        issues.push({
          element,
          key,
          value,
          check: urlCheck(),
          valid: false,
          message:
            result === 'timeout'
              ? `Die Website antwortet nicht (keine Antwort innerhalb von ${TIMEOUT_MS / 1000} s). Bitte über den Link selbst prüfen.`
              : 'Die Website ist möglicherweise nicht erreichbar: Domain unbekannt, Zertifikat ungültig oder Verbindung abgelehnt. Bitte über den Link selbst prüfen.',
        });
      }
    }
  }
  return issues;
}
