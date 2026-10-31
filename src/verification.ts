import { facebookUrl, twitterUrl } from 'osmvalidation';
import { CHECKS, evaluate, type Check, type Issue } from './checks.js';
import { elementKey, type OsmElement } from './osm.js';

/*
 * Values the user can verify by opening them in the browser get a
 * `check_date:<key>` tag (https://wiki.openstreetmap.org/wiki/Key:check_date)
 * when the user explicitly confirms them. Recently confirmed values are not
 * checked again.
 */

/** Keys whose values can be verified online, with the format check that applies. */
const VERIFIABLE: { pattern: RegExp; check: string }[] = [
  { pattern: /^(contact:)?website$|^url$/, check: 'url' },
  { pattern: /^(contact:)?facebook$/, check: 'facebook' },
  { pattern: /^(contact:)?(twitter|x)$/, check: 'twitter' },
];

export const CONFIRM_ONLINE = {
  id: 'confirm-online',
  label: 'Websites und Profile bestätigen',
  keyPattern: VERIFIABLE.map(({ pattern }) => pattern.source).join('|'),
} as const;

const DEFAULT_INTERVAL_MONTHS = 24;

/** Months after which a confirmed value is checked again (`VITE_CHECK_INTERVAL_MONTHS`). */
export const CHECK_INTERVAL_MONTHS = ((): number => {
  const configured = Number(import.meta.env.VITE_CHECK_INTERVAL_MONTHS);
  return Number.isFinite(configured) && configured > 0 ? configured : DEFAULT_INTERVAL_MONTHS;
})();

export function isVerifiable(key: string): boolean {
  return VERIFIABLE.some(({ pattern }) => pattern.test(key));
}

export function checkDateKey(key: string): string {
  return `check_date:${key}`;
}

/** Today as YYYY-MM-DD (local date). */
export function today(now = new Date()): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}

/** Parses YYYY-MM-DD, YYYY-MM or YYYY (the start of the period); undefined if invalid. */
export function parseCheckDate(value: string): Date | undefined {
  const match = /^(\d{4})(?:-(\d{2})(?:-(\d{2}))?)?$/.exec(value.trim());
  if (match === null) {
    return undefined;
  }
  const [, year = '', month = '1', day = '1'] = match;
  const date = new Date(Number(year), Number(month) - 1, Number(day));
  return Number.isNaN(date.getTime()) ? undefined : date;
}

/**
 * The check_date of a key. For `contact:website` the common
 * `check_date:website` counts as well.
 */
export function lastChecked(element: OsmElement, key: string): string | undefined {
  const own = element.tags[checkDateKey(key)];
  if (own !== undefined) {
    return own;
  }
  const plain = key.replace(/^contact:/, '');
  return plain === key ? undefined : element.tags[checkDateKey(plain)];
}

export function isRecentlyChecked(
  element: OsmElement,
  key: string,
  now = new Date(),
  months = CHECK_INTERVAL_MONTHS,
): boolean {
  const value = lastChecked(element, key);
  const date = value === undefined ? undefined : parseCheckDate(value);
  if (date === undefined) {
    return false;
  }
  const limit = new Date(now);
  limit.setMonth(limit.getMonth() - months);
  return date >= limit;
}

/** The URL to open for a value, e.g. a Facebook username becomes its page URL. */
export function openableUrl(key: string, value: string): string | undefined {
  if (/^https?:\/\//i.test(value)) {
    return value;
  }
  const check = VERIFIABLE.find(({ pattern }) => pattern.test(key))?.check;
  if (check === 'facebook' && /^[\p{L}\p{N}._-]+$/u.test(value)) {
    return facebookUrl(value);
  }
  if (check === 'twitter' && /^@?\w{1,15}$/.test(value)) {
    return twitterUrl(value);
  }
  return undefined;
}

function formatCheck(key: string): Check | undefined {
  const id = VERIFIABLE.find(({ pattern }) => pattern.test(key))?.check;
  return CHECKS.find((check) => check.id === id);
}

/**
 * Valid values of verifiable keys that have not been confirmed within the
 * interval. Keys that already have an issue are skipped, they are confirmed
 * together with their correction.
 */
export function confirmIssues(elements: OsmElement[], existing: Issue[], now = new Date()): Issue[] {
  const taken = new Set(existing.map((issue) => `${elementKey(issue.element)}/${issue.key}`));
  const issues: Issue[] = [];
  for (const element of elements) {
    for (const [key, value] of Object.entries(element.tags)) {
      const check = formatCheck(key);
      if (
        check === undefined ||
        taken.has(`${elementKey(element)}/${key}`) ||
        isRecentlyChecked(element, key, now) ||
        !evaluate(check, value, {}).valid
      ) {
        continue;
      }
      const last = lastChecked(element, key);
      issues.push({
        element,
        key,
        value,
        check,
        valid: true,
        kind: 'confirm',
        message:
          (last === undefined ? 'Noch nie online geprüft.' : `Zuletzt geprüft: ${last}.`) +
          ' Bitte öffnen und prüfen, ob die Seite noch existiert und zu diesem Objekt gehört.',
      });
    }
  }
  return issues;
}
