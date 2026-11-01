import { CHECKS, type Check, type Issue } from './checks.js';
import { sameValue } from './duplicates.js';
import type { OsmElement } from './osm.js';

/*
 * Keys used instead of an established key, e.g. menu:url instead of
 * website:menu (https://wiki.openstreetmap.org/wiki/Key:website:menu). If they
 * contain a URL, the value moves to the established key.
 */

interface Synonyms {
  target: string;
  keys: string[];
}

const SYNONYMS: Synonyms[] = [
  { target: 'website:menu', keys: ['menu:url', 'url:menu', 'menu', 'lunch:menu:url', 'image:menu', 'image:menu:0'] },
];

/** For the Overpass query, together with the website check. */
export const SYNONYM_KEYS = `^(${SYNONYMS.flatMap(({ keys }) => keys).join('|')})$`;

const URL_VALUE = /^(https?:\/\/|www\.)\S+$/i;

function urlCheck(): Check {
  const check = CHECKS.find((c) => c.id === 'url');
  if (check === undefined) {
    throw new Error('check url missing');
  }
  return check;
}

/**
 * Synonymous keys with a URL. The first one moves to the target key if that
 * is free. Another one with the same value as the key that keeps the value
 * (the target, or the first synonym) is a duplicate; one with a different
 * value is only reported.
 */
export function synonymIssues(elements: OsmElement[]): Issue[] {
  const check = urlCheck();
  const issues: Issue[] = [];
  for (const element of elements) {
    for (const { target, keys } of SYNONYMS) {
      let kept = element.tags[target] === undefined ? undefined : target;
      for (const key of keys) {
        const value = element.tags[key];
        if (value === undefined || !URL_VALUE.test(value.trim())) {
          continue;
        }
        const base = { element, key, value, check, valid: false };
        const keptValue = kept === undefined ? undefined : element.tags[kept];
        if (kept === undefined || keptValue === undefined) {
          issues.push({
            ...base,
            kind: 'move',
            moveTo: target,
            message: `Statt ${key} ist ${target} üblich. Übernehmen verschiebt den Wert nach ${target}.`,
          });
          kept = key;
        } else if (sameValue(check, value, keptValue)) {
          issues.push({ ...base, kind: 'duplicate', duplicateOf: kept, message: `Doppelt: derselbe Wert steht in ${kept}.` });
        } else {
          issues.push({
            ...base,
            message: `Statt ${key} ist ${target} üblich, aber ${kept} hat schon einen anderen Wert (${keptValue}). Löschen oder überspringen.`,
          });
        }
      }
    }
  }
  return issues;
}
