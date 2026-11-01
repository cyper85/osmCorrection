import {
  bluesky,
  diaspora,
  facebook,
  flickr,
  gnusocial,
  instagram,
  linkedin,
  mail,
  mastodon,
  matrix,
  mobilizon,
  phone,
  pinterest,
  telegram,
  tiktok,
  tripadvisor,
  twitter,
  url,
  validateEach,
  vimeo,
  vk,
  whatsapp,
  wikidata,
  wikipedia,
  xing,
  youtube,
  type CountryCode,
  type ValidationResult,
} from 'osmvalidation';
import { germanMessage } from './messages.js';
import type { OsmElement } from './osm.js';

export interface CheckContext {
  /** ISO 3166-1 alpha-2 code of the country the element is in */
  country?: CountryCode;
}

export interface Check {
  id: string;
  label: string;
  /**
   * Regular expression for the keys this check covers. It is used both in
   * JavaScript and in the Overpass query, so keep to POSIX ERE syntax.
   */
  keyPattern: string;
  /** Values may contain several parts separated by `;`. */
  multiValue: boolean;
  /** keys matching `keyPattern` that are not covered (only in JavaScript, Overpass loads them anyway) */
  excludeKeys?: string;
  validate(value: string, context: CheckContext): ValidationResult;
  /** shown and switched together under „Soziale Netze“ */
  group?: 'social';
  /** the value is a page or profile the user can open and confirm (check_date) */
  verifiable?: true;
}

/**
 * Keys with a website: the main website and the pages for booking, the menu,
 * opening hours … (https://wiki.openstreetmap.org/wiki/Key:website:menu etc.)
 */
export const WEBSITE_KEYS = '^(contact:)?website$|^url$|^reservation:website$|^opening_hours:url$|^website:.+$';
/** `website:note` is a text; `website:1` is left out on purpose (decided with Andreas). */
const NOT_WEBSITE_KEYS = '^website:(1|note)$';

/** Whether the check covers the key. */
export function coversKey(check: Check, key: string): boolean {
  return new RegExp(check.keyPattern).test(key) && (check.excludeKeys === undefined || !new RegExp(check.excludeKeys).test(key));
}

const withCountry = (country: CountryCode | undefined) => (country === undefined ? {} : { country });

/** A social network or messenger with its key `contact:<id>` (or plain `<id>`). */
function social(
  id: string,
  label: string,
  validate: Check['validate'],
  options: { verifiable?: boolean; multiValue?: boolean; keys?: string } = {},
): Check {
  return {
    id,
    label,
    keyPattern: `^(contact:)?(${options.keys ?? id})$`,
    multiValue: options.multiValue ?? false,
    validate,
    group: 'social',
    ...(options.verifiable === false ? {} : { verifiable: true as const }),
  };
}

export const CHECKS: Check[] = [
  {
    id: 'phone',
    label: 'Telefon- und Faxnummern',
    keyPattern: '^(contact:)?(phone|fax|mobile)$',
    multiValue: true,
    validate: (value, { country }) => (country === undefined ? phone(value) : phone(value, { country })),
  },
  {
    id: 'mail',
    label: 'E-Mail-Adressen',
    keyPattern: '^(contact:)?email$',
    multiValue: true,
    validate: (value) => mail(value),
  },
  {
    id: 'url',
    label: 'Websites',
    keyPattern: WEBSITE_KEYS,
    excludeKeys: NOT_WEBSITE_KEYS,
    multiValue: false,
    validate: (value) => url(value),
    verifiable: true,
  },
  {
    id: 'wikipedia',
    label: 'Wikipedia',
    keyPattern: '^(.+:)?wikipedia$',
    multiValue: false,
    validate: (value) => wikipedia(value),
  },
  {
    id: 'wikidata',
    label: 'Wikidata',
    keyPattern: '^(.+:)?wikidata$',
    multiValue: true,
    validate: (value) => wikidata(value),
  },
  social('facebook', 'Facebook', (value) => facebook(value)),
  social('twitter', 'X / Twitter', (value) => twitter(value), { keys: 'twitter|x' }),
  social('instagram', 'Instagram', (value) => instagram(value)),
  social('tiktok', 'TikTok', (value) => tiktok(value)),
  social('youtube', 'YouTube', (value) => youtube(value)),
  social('linkedin', 'LinkedIn', (value) => linkedin(value)),
  social('xing', 'XING', (value) => xing(value)),
  social('pinterest', 'Pinterest', (value) => pinterest(value)),
  social('vimeo', 'Vimeo', (value) => vimeo(value)),
  social('flickr', 'Flickr', (value) => flickr(value)),
  social('vk', 'VK', (value) => vk(value)),
  social('mastodon', 'Mastodon', (value) => mastodon(value)),
  social('bluesky', 'Bluesky', (value) => bluesky(value)),
  social('mobilizon', 'Mobilizon', (value) => mobilizon(value)),
  social('diaspora', 'diaspora*', (value) => diaspora(value)),
  social('gnusocial', 'GNU social', (value) => gnusocial(value)),
  social('telegram', 'Telegram', (value, { country }) => telegram(value, withCountry(country))),
  social('whatsapp', 'WhatsApp', (value, { country }) => whatsapp(value, withCountry(country)), {
    verifiable: false,
    multiValue: true,
  }),
  social('matrix', 'Matrix', (value) => matrix(value), { verifiable: false }),
  social('tripadvisor', 'Tripadvisor', (value) => tripadvisor(value), { verifiable: false }),
];

export interface Evaluation {
  valid: boolean;
  message: string;
  suggestion?: string;
}

export interface Issue extends Evaluation {
  element: OsmElement;
  key: string;
  value: string;
  check: Check;
  /**
   * 'confirm': the value is fine, the user is only asked to verify it online;
   * 'duplicate': the same value is in `duplicateOf`, the tag is to be removed;
   * 'move': the value belongs in the key `moveTo` (e.g. menu:url → website:menu);
   * 'assist': the website can be analyzed by the AI (assist.ts);
   * 'proposal', 'signal': a suggestion or a signal of the AI, with `assist`
   */
  kind?: 'confirm' | 'duplicate' | 'move' | 'assist' | 'proposal' | 'signal';
  /** where the AI found it, and which model */
  assist?: { quote: string; sourceUrl: string; model: string };
  duplicateOf?: string;
  moveTo?: string;
}

export function evaluate(check: Check, value: string, context: CheckContext): Evaluation {
  const validate = (part: string): ValidationResult => {
    let result: ValidationResult;
    try {
      result = check.validate(part, context);
    } catch {
      // e.g. a country code libphonenumber does not know
      result = check.validate(part, {});
    }
    return { ...result, message: germanMessage(result) };
  };

  if (!check.multiValue) {
    const { valid, message, suggestion } = validate(value);
    return suggestion === undefined ? { valid, message } : { valid, message, suggestion };
  }

  const multi = validateEach(value, validate);
  const notes = multi.results
    .filter(({ result }) => !result.valid || result.suggestion !== undefined)
    .map(({ value: part, result }) => `${part}: ${result.message}`);
  const message = notes.length > 0 ? notes.join('\n') : 'Wert enthält leere Teile („;;“ oder „;“ am Ende)';
  return multi.suggestion === undefined
    ? { valid: multi.valid, message }
    : { valid: multi.valid, message, suggestion: multi.suggestion };
}

/** Country of an element from `addr:country`, otherwise the fallback. */
export function elementCountry(element: OsmElement, fallback?: CountryCode): CountryCode | undefined {
  const country = element.tags['addr:country'];
  if (country !== undefined && /^[A-Z]{2}$/.test(country)) {
    return country as CountryCode;
  }
  return fallback;
}

/**
 * Runs the checks on all elements. A value is reported if it is invalid or if
 * there is a preferred form of it.
 */
export function findIssues(elements: OsmElement[], checks: Check[], fallbackCountry?: CountryCode): Issue[] {
  const issues: Issue[] = [];
  for (const element of elements) {
    const country = elementCountry(element, fallbackCountry);
    const context: CheckContext = country === undefined ? {} : { country };
    for (const [key, value] of Object.entries(element.tags)) {
      const check = checks.find((c) => coversKey(c, key));
      if (check === undefined) {
        continue;
      }
      const result = evaluate(check, value, context);
      if (!result.valid || (result.suggestion !== undefined && result.suggestion !== value)) {
        issues.push({ ...result, element, key, value, check });
      }
    }
  }
  return issues;
}
