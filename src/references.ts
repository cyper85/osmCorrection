import { splitValues, wikidata, wikipedia } from 'osmvalidation';
import { CHECKS, type Check, type Issue } from './checks.js';
import { elementKey, type OsmElement } from './osm.js';

const WIKIDATA_API = 'https://www.wikidata.org/w/api.php';
const BATCH_SIZE = 50;
const WIKIDATA_KEY = /^(.+:)?wikidata$/;

/** Online check of the Wikidata references (not part of osmValidation, which works offline). */
export const WIKIDATA_ONLINE = {
  id: 'wikidata-online',
  label: 'Wikidata-Verweise online prüfen',
  keyPattern: WIKIDATA_KEY.source,
} as const;

export interface WikidataItem {
  /** ID after following a redirect */
  id: string;
  missing: boolean;
  /** site (e.g. "dewiki") → article title */
  sitelinks: Record<string, string>;
}

interface ApiEntity {
  id: string;
  missing?: string;
  redirects?: { from: string; to: string };
  sitelinks?: Record<string, { title: string }>;
}

interface ApiResponse {
  entities?: Record<string, ApiEntity>;
  error?: { code: string; id?: string; info?: string };
}

/** "de" → "dewiki", "zh-yue" → "zh_yuewiki" */
export function wikiSite(language: string): string {
  return `${language.replace(/-/g, '_')}wiki`;
}

/**
 * Fetches the items with the sitelinks of the given Wikipedia languages. The
 * result is keyed by the requested ID.
 */
export async function fetchItems(ids: string[], languages: string[]): Promise<Map<string, WikidataItem>> {
  const items = new Map<string, WikidataItem>();
  const pending = [...new Set(ids)];
  const sites = [...new Set(languages.map(wikiSite))].join('|');

  while (pending.length > 0) {
    const batch = pending.splice(0, BATCH_SIZE);
    const params = new URLSearchParams({
      action: 'wbgetentities',
      ids: batch.join('|'),
      props: 'sitelinks',
      format: 'json',
      origin: '*',
    });
    if (sites !== '') {
      params.set('sitefilter', sites);
    }
    const response = await fetch(`${WIKIDATA_API}?${params}`);
    if (!response.ok) {
      throw new Error(`Wikidata: HTTP ${response.status}`);
    }
    const data = (await response.json()) as ApiResponse;

    // an ID above the highest one ever assigned fails the whole request
    if (data.error !== undefined) {
      const failed = data.error.id;
      if (data.error.code !== 'no-such-entity' || failed === undefined || !batch.includes(failed)) {
        throw new Error(`Wikidata: ${data.error.info ?? data.error.code}`);
      }
      items.set(failed, { id: failed, missing: true, sitelinks: {} });
      pending.unshift(...batch.filter((id) => id !== failed));
      continue;
    }

    for (const [requested, entity] of Object.entries(data.entities ?? {})) {
      const sitelinks: Record<string, string> = {};
      for (const [site, link] of Object.entries(entity.sitelinks ?? {})) {
        sitelinks[site] = link.title;
      }
      items.set(requested, { id: entity.id, missing: entity.missing !== undefined, sitelinks });
    }
  }
  return items;
}

function formatCheck(id: 'wikidata' | 'wikipedia'): Check {
  const check = CHECKS.find((c) => c.id === id);
  if (check === undefined) {
    throw new Error(`check ${id} missing`);
  }
  return check;
}

/** Wikidata IDs and Wikipedia languages to fetch for the elements. */
export function referencesToFetch(elements: OsmElement[]): { ids: string[]; languages: string[] } {
  const ids = new Set<string>();
  const languages = new Set<string>();
  for (const element of elements) {
    for (const [key, value] of Object.entries(element.tags)) {
      if (WIKIDATA_KEY.test(key)) {
        for (const part of splitValues(value)) {
          if (wikidata(part).valid) {
            ids.add(part);
          }
        }
      }
    }
    const article = element.tags.wikipedia;
    if (article !== undefined && wikipedia(article).valid) {
      languages.add(article.slice(0, article.indexOf(':')));
    }
  }
  return { ids: [...ids], languages: [...languages] };
}

/** Wikipedia titles are equal apart from underscores and the case of the first letter. */
function sameTitle(a: string, b: string): boolean {
  const normalize = (title: string) => {
    const spaced = title.replace(/_/g, ' ').trim();
    return spaced.charAt(0).toUpperCase() + spaced.slice(1);
  };
  return normalize(a) === normalize(b);
}

/**
 * Finds references to deleted or redirected Wikidata items and `wikipedia`
 * tags that do not match the article linked in the `wikidata` item. Keys that
 * already have an issue (e.g. a format error) are skipped.
 */
export function referenceIssues(elements: OsmElement[], items: Map<string, WikidataItem>, existing: Issue[]): Issue[] {
  const taken = new Set(existing.map((issue) => `${elementKey(issue.element)}/${issue.key}`));
  const issues: Issue[] = [];

  for (const element of elements) {
    for (const [key, value] of Object.entries(element.tags)) {
      if (!WIKIDATA_KEY.test(key) || taken.has(`${elementKey(element)}/${key}`)) {
        continue;
      }
      const notes: string[] = [];
      let redirected = false;
      const parts = splitValues(value).map((part) => {
        const item = items.get(part);
        if (item?.missing) {
          notes.push(`Das Wikidata-Objekt ${part} gibt es nicht (mehr)`);
        } else if (item !== undefined && item.id !== part) {
          notes.push(`${part} ist eine Weiterleitung auf ${item.id}`);
          redirected = true;
          return item.id;
        }
        return part;
      });
      if (notes.length > 0) {
        const issue: Issue = { element, key, value, check: formatCheck('wikidata'), valid: false, message: notes.join('\n') };
        if (redirected) {
          issue.suggestion = parts.join(';');
        }
        issues.push(issue);
      }
    }

    // wikipedia ↔ wikidata
    const article = element.tags.wikipedia;
    const itemId = element.tags.wikidata;
    if (article === undefined || itemId === undefined || taken.has(`${elementKey(element)}/wikipedia`)) {
      continue;
    }
    const item = items.get(itemId);
    if (item === undefined || item.missing || !wikipedia(article).valid) {
      continue;
    }
    const separator = article.indexOf(':');
    const language = article.slice(0, separator);
    const title = article.slice(separator + 1);
    const linked = item.sitelinks[wikiSite(language)];
    if (linked === undefined) {
      issues.push({
        element,
        key: 'wikipedia',
        value: article,
        check: formatCheck('wikipedia'),
        valid: false,
        message: `Das Wikidata-Objekt ${item.id} hat keinen Artikel in der Wikipedia „${language}“. Einer der beiden Verweise ist vermutlich falsch.`,
      });
    } else if (!sameTitle(title, linked)) {
      issues.push({
        element,
        key: 'wikipedia',
        value: article,
        check: formatCheck('wikipedia'),
        valid: false,
        message: `Passt nicht zu wikidata=${item.id}, dort ist „${language}:${linked}“ verknüpft. Der Artikel kann eine Weiterleitung sein, oder einer der beiden Verweise ist falsch.`,
        suggestion: `${language}:${linked}`,
      });
    }
  }
  return issues;
}
