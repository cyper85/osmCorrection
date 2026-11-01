import { describe, expect, it } from 'vitest';
import type { TagChange } from '../src/changes.js';
import { changesetComment, commentLength, MAX_COMMENT } from '../src/comment.js';

const node = (id: number) => ({ type: 'node' as const, id });
const fix = (id: number, key: string): TagChange => ({ ...node(id), key, oldValue: 'a', newValue: 'b' });
const remove = (id: number, key: string): TagChange => ({ ...node(id), key, oldValue: 'a' });
const confirm = (id: number, key: string): TagChange => ({
  ...node(id),
  key: `check_date:${key}`,
  newValue: '2026-11-01',
  verifies: { key, value: 'b' },
});
const close = (id: number): TagChange => ({ ...node(id), key: 'shop', oldValue: 'bakery', closed: true });

describe('changesetComment', () => {
  it('names every check when it fits', () => {
    expect(changesetComment([fix(1, 'website'), remove(2, 'contact:xing')])).toBe(
      'Formatierung korrigiert: Websites; entfernt: XING',
    );
  });

  // the changeset that failed with HTTP 400 (2026-11-01)
  const long = [
    close(1),
    close(2),
    close(3),
    ...['website', 'contact:mastodon', 'contact:twitter', 'contact:facebook', 'contact:linkedin', 'contact:xing'].map((key, i) =>
      fix(10 + i, key),
    ),
    ...['website', 'contact:xing', 'contact:instagram', 'contact:facebook'].map((key, i) => remove(20 + i, key)),
    ...['website', 'contact:mastodon', 'contact:facebook', 'contact:twitter', 'contact:linkedin', 'contact:xing', 'contact:instagram'].map(
      (key, i) => confirm(30 + i, key),
    ),
  ];

  it('groups the social networks when the list is too long', () => {
    const comment = changesetComment(long);
    expect(commentLength(comment)).toBeLessThanOrEqual(MAX_COMMENT);
    expect(comment).toBe(
      'existiert nicht mehr: 3 Objekte; Formatierung korrigiert: Websites, soziale Netze; entfernt: Websites, soziale Netze; ' +
        'online geprüft (check_date): Websites, soziale Netze',
    );
  });

  it('keeps only the kinds of changes, but always names the AI', () => {
    const ai = (id: number, key: string): TagChange => ({ ...fix(id, key), ai: 'Anthropic Claude Sonnet 5.5' });
    const keys = Array.from({ length: 40 }, (_, i) => `ref:unknown_${i}`);
    const comment = changesetComment([...keys.map((key, i) => fix(100 + i, key)), ai(200, 'opening_hours')]);
    expect(commentLength(comment)).toBeLessThanOrEqual(MAX_COMMENT);
    expect(comment).toBe(
      'Formatierung korrigiert; von der Website übernommen, ausgewertet mit KI-Unterstützung (Anthropic Claude Sonnet 5.5)',
    );
  });

  it('counts characters like the OSM API', () => {
    expect(commentLength('Straße → 🏪')).toBe(10);
  });
});
