import { readdirSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { germanMessage } from '../src/messages.js';

/** All `ok('CODE', 'message')` / `fail(…)` calls and `invalid('message')` helpers in osmValidation. */
function libraryMessages(): { code: string; message: string }[] {
  const dir = new URL('../libs/osmValidation/src/', import.meta.url);
  const found: { code: string; message: string }[] = [];
  for (const file of readdirSync(dir)) {
    const source = readFileSync(new URL(file, dir), 'utf8');
    for (const [, code = '', message = ''] of source.matchAll(/\b(?:ok|fail)\(\s*'([A-Z_]+)',\s*'((?:[^'\\]|\\.)*)'/g)) {
      found.push({ code, message });
    }
    const helper = /fail\('([A-Z_]+)', message\)/.exec(source)?.[1];
    if (helper !== undefined) {
      for (const [, message = ''] of source.matchAll(/\binvalid\(\s*'((?:[^'\\]|\\.)*)'/g)) {
        found.push({ code: helper, message });
      }
    }
  }
  return found;
}

/** Messages built from a template with the platform name, e.g. `Valid ${name} URL`, filled in with "Instagram". */
function templateMessages(): string[] {
  const dir = new URL('../libs/osmValidation/src/', import.meta.url);
  const found: string[] = [];
  for (const file of readdirSync(dir)) {
    const source = readFileSync(new URL(file, dir), 'utf8');
    for (const [, template = ''] of source.matchAll(/`([^`]*\$\{name\}[^`]*)`/g)) {
      found.push(template.replaceAll('${name}', 'Instagram'));
    }
  }
  return found;
}

describe('germanMessage', () => {
  const messages = libraryMessages();
  const templates = templateMessages();

  it('finds the messages of osmValidation', () => {
    expect(messages.length).toBeGreaterThan(30);
    expect(templates.length).toBeGreaterThan(10);
  });

  it.each(messages)('translates $code: $message', (result) => {
    expect(germanMessage(result)).not.toBe(result.message);
  });

  it.each(templates)('translates the template "%s"', (message) => {
    const german = germanMessage({ code: 'INSTAGRAM_X', message });
    expect(german).not.toBe(message);
    expect(german).toContain('Instagram');
  });

  it('falls back to the code, then to the original', () => {
    expect(germanMessage({ code: 'URL_INVALID', message: 'something new' })).toBe('Ungültige URL');
    expect(germanMessage({ code: 'NEW_CODE', message: 'something new' })).toBe('something new');
  });
});
