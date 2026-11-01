import { CHECKS, coversKey, evaluate, type Check, type CheckContext, type Issue } from './checks.js';
import type { OsmElement } from './osm.js';

/*
 * The same value under `website` and `contact:website` (or `phone` and
 * `contact:phone` …): the plain key is removed, `contact:*` is kept.
 */

export const DUPLICATES = {
  id: 'duplicates',
  label: 'Doppelte Angaben (z. B. website und contact:website)',
  keyPattern: '^contact:',
} as const;

/** The check of a key that exists with and without `contact:`, e.g. website. */
function contactCheck(key: string): Check | undefined {
  return CHECKS.find((check) => coversKey(check, key) && coversKey(check, `contact:${key}`));
}

/** The value in its preferred form, so that formatting differences do not count. */
function canonical(check: Check, value: string, context: CheckContext): string {
  const preferred = (part: string) => {
    let result = part.trim();
    try {
      result = evaluate(check, result, context).suggestion ?? result;
    } catch {
      // keep the value as it is
    }
    if (check.id === 'url') {
      result = result.replace(/\/$/, '');
    } else if (check.id === 'mail') {
      result = result.toLowerCase();
    }
    return result;
  };
  if (!check.multiValue) {
    return preferred(value);
  }
  const parts = value
    .split(';')
    .map((part) => part.trim())
    .filter((part) => part !== '')
    .map(preferred);
  return [...new Set(parts)].sort().join(';');
}

export function sameValue(check: Check, a: string, b: string, context: CheckContext = {}): boolean {
  return a.trim() === b.trim() || canonical(check, a, context) === canonical(check, b, context);
}

/**
 * Plain keys with the same value as their `contact:` key. The issue is on the
 * plain key, which is to be removed.
 */
export function duplicateIssues(elements: OsmElement[], contextOf: (element: OsmElement) => CheckContext = () => ({})): Issue[] {
  const issues: Issue[] = [];
  for (const element of elements) {
    for (const [contactKey, contactValue] of Object.entries(element.tags)) {
      const key = contactKey.replace(/^contact:/, '');
      const value = element.tags[key];
      if (key === contactKey || value === undefined) {
        continue;
      }
      const check = contactCheck(key);
      if (check === undefined || !sameValue(check, value, contactValue, contextOf(element))) {
        continue;
      }
      issues.push({
        element,
        key,
        value,
        check,
        kind: 'duplicate',
        duplicateOf: contactKey,
        valid: false,
        message:
          value === contactValue
            ? `Doppelt: derselbe Wert steht in ${contactKey}.`
            : `Doppelt: derselbe Wert steht in ${contactKey} (${contactValue}).`,
      });
    }
  }
  return issues;
}
