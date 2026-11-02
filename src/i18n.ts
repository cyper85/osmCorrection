import { de } from './locales/de.js';
import { en } from './locales/en.js';

/*
 * Translations without a framework. The texts live in locales/<lang>.ts; the
 * German file defines the keys, the other languages must have exactly the same
 * keys (the type check fails otherwise).
 *
 * A text can contain placeholders like {count}, and can have a singular and a
 * plural form, chosen by the parameter `count`.
 *
 * The language is chosen once per page load: switching reloads the page, so
 * texts built at start-up (labels of the checks, …) need no update.
 */

/** A text, or its forms by plural category (Intl.PluralRules). */
export type Text = string | { one: string; other: string };

export type Key = keyof typeof de;
export type Messages = Record<Key, Text>;

export const LANGUAGES = { de: 'Deutsch', en: 'English' } as const;
export type Lang = keyof typeof LANGUAGES;

const MESSAGES: Record<Lang, Messages> = { de, en };
const STORAGE_KEY = 'osmCorrection.lang';

function isLang(value: unknown): value is Lang {
  return typeof value === 'string' && value in LANGUAGES;
}

/** The saved language, else the first of the browser's languages we have, else English. */
function detect(): Lang {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (isLang(saved)) {
      return saved;
    }
  } catch {
    // no storage
  }
  const wanted = typeof navigator === 'undefined' ? [] : (navigator.languages ?? [navigator.language]);
  for (const tag of wanted) {
    const base = tag?.toLowerCase().split('-')[0];
    if (isLang(base)) {
      return base;
    }
  }
  return 'en';
}

let current: Lang = detect();

export function language(): Lang {
  return current;
}

/** Sets the language for this page (and saves it, unless `save` is false). */
export function setLanguage(lang: Lang, save = true): void {
  current = lang;
  if (save) {
    try {
      localStorage.setItem(STORAGE_KEY, lang);
    } catch {
      // no storage
    }
  }
}

export type Params = Record<string, string | number>;

/** The text for `key` in the current language, with the placeholders filled in. */
export function t(key: Key, params: Params = {}): string {
  const text = MESSAGES[current][key];
  const form =
    typeof text === 'string'
      ? text
      : new Intl.PluralRules(current).select(Number(params.count ?? 0)) === 'one'
        ? text.one
        : text.other;
  return form.replace(/\{(\w+)\}/g, (match, name: string) => {
    const value = params[name];
    return value === undefined ? match : typeof value === 'number' ? formatNumber(value) : value;
  });
}

export function formatNumber(value: number): string {
  return new Intl.NumberFormat(current).format(value);
}

/** A list like "a, b and c". */
export function formatList(items: string[]): string {
  return new Intl.ListFormat(current, { type: 'conjunction' }).format(items);
}

/**
 * Fills the static texts of a page: data-i18n (text), data-i18n-html (text
 * with markup, only from the locale files) and data-i18n-<attribute>, e.g.
 * data-i18n-placeholder.
 */
export function translatePage(root: ParentNode = document): void {
  if (root === document) {
    document.documentElement.lang = current;
  }
  for (const element of root.querySelectorAll<HTMLElement>('*')) {
    for (const { name, value } of [...element.attributes]) {
      if (!name.startsWith('data-i18n') || !(value in MESSAGES.de)) {
        continue;
      }
      const text = t(value as Key);
      if (name === 'data-i18n') {
        element.textContent = text;
      } else if (name === 'data-i18n-html') {
        element.innerHTML = text;
      } else {
        element.setAttribute(name.slice('data-i18n-'.length), text);
      }
    }
  }
}
