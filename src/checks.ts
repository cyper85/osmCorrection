import {
  facebook,
  mail,
  phone,
  twitter,
  url,
  validateEach,
  wikidata,
  wikipedia,
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
  validate(value: string, context: CheckContext): ValidationResult;
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
    keyPattern: '^(contact:)?website$|^url$',
    multiValue: false,
    validate: (value) => url(value),
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
  {
    id: 'facebook',
    label: 'Facebook',
    keyPattern: '^(contact:)?facebook$',
    multiValue: false,
    validate: (value) => facebook(value),
  },
  {
    id: 'twitter',
    label: 'X / Twitter',
    keyPattern: '^(contact:)?(twitter|x)$',
    multiValue: false,
    validate: (value) => twitter(value),
  },
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
  /** 'confirm': the value is fine, the user is only asked to verify it online */
  kind?: 'confirm';
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
  const compiled = checks.map((check) => ({ check, keys: new RegExp(check.keyPattern) }));
  const issues: Issue[] = [];
  for (const element of elements) {
    const country = elementCountry(element, fallbackCountry);
    const context: CheckContext = country === undefined ? {} : { country };
    for (const [key, value] of Object.entries(element.tags)) {
      const match = compiled.find(({ keys }) => keys.test(key));
      if (match === undefined) {
        continue;
      }
      const result = evaluate(match.check, value, context);
      if (!result.valid || (result.suggestion !== undefined && result.suggestion !== value)) {
        issues.push({ ...result, element, key, value, check: match.check });
      }
    }
  }
  return issues;
}
