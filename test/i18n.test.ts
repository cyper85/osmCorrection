import { afterEach, describe, expect, it } from 'vitest';
import { changesetComment } from '../src/comment.js';
import type { TagChange } from '../src/changes.js';
import { language, setLanguage, t, type Key, type Text } from '../src/i18n.js';
import { de } from '../src/locales/de.js';
import { en } from '../src/locales/en.js';
import { localMessage } from '../src/messages.js';

const placeholders = (text: Text) =>
  [...new Set([...(typeof text === 'string' ? [text] : [text.one, text.other])].flatMap((s) => [...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1])))].sort();

describe('i18n', () => {
  afterEach(() => setLanguage('de', false));

  it('has the same placeholders in every language', () => {
    for (const key of Object.keys(de) as Key[]) {
      expect(placeholders(en[key]), key).toEqual(placeholders(de[key]));
    }
  });

  it('has the same kind of text (plural or not) in every language', () => {
    for (const key of Object.keys(de) as Key[]) {
      expect(typeof en[key], key).toBe(typeof de[key]);
    }
  });

  it('fills in placeholders and chooses the plural form', () => {
    expect(language()).toBe('de');
    expect(t('select.pendingCount', { count: 1 })).toBe('1 Änderung');
    expect(t('select.pendingCount', { count: 3 })).toBe('3 Änderungen');
    expect(t('review.progress', { current: 2, total: 1200 })).toBe('Fund 2 von 1.200');
    setLanguage('en', false);
    expect(t('select.pendingCount', { count: 1 })).toBe('1 change');
    expect(t('review.progress', { current: 2, total: 1200 })).toBe('Finding 2 of 1,200');
  });

  it('leaves unknown placeholders as they are', () => {
    expect(t('review.verifySets', { key: 'check_date' })).toBe('Setzt check_date={date}.');
  });

  it('shows osmValidation messages in German, or in their English original', () => {
    const result = { code: 'PHONE_IDD_PREFIX', message: 'Use "+" instead of "00" before the country code' };
    expect(localMessage(result)).toBe('Vor der Ländervorwahl „+“ statt „00“ verwenden');
    setLanguage('en', false);
    expect(localMessage(result)).toBe(result.message);
  });

  it('writes the changeset comment in the language of the page', () => {
    const change: TagChange = { type: 'node', id: 1, key: 'phone', oldValue: '0049 30 1234', newValue: '+49 30 1234' };
    expect(changesetComment([change])).toBe('Formatierung korrigiert: Telefon- und Faxnummern');
    setLanguage('en', false);
    // the check labels are built at start-up, in the language of the page load
    expect(changesetComment([change])).toMatch(/^formatting corrected: /);
  });
});
