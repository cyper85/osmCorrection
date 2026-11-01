import type { TagChange } from './changes.js';
import { CHECKS, coversKey } from './checks.js';
import { elementKey } from './osm.js';

/** The OSM API rejects longer tag values, including the changeset comment. */
export const MAX_COMMENT = 255;

/** Length as the OSM API counts it (characters, not UTF-16 units). */
export function commentLength(text: string): number {
  return [...text].length;
}

/** The AI models whose suggestions are in the changes. */
export function aiModels(list: TagChange[]): string[] {
  return [...new Set(list.flatMap((c) => (c.ai === undefined ? [] : [c.ai])))];
}

/**
 * How much detail the comment has: every check, the social networks as one
 * group, or only the kinds of changes.
 */
type Detail = 'checks' | 'groups' | 'kinds';

function build(list: TagChange[], detail: Detail): string {
  // the label of the check, or the key itself (e.g. lunch:menu:url)
  const label = (key: string) => {
    const check = CHECKS.find((c) => coversKey(c, key));
    return detail === 'groups' && check?.group === 'social' ? 'soziale Netze' : (check?.label ?? key);
  };
  const labels = (keys: string[]) => [...new Set(keys.map(label))];
  const part = (title: string, items: string[]) => (detail === 'kinds' ? title : `${title}: ${items.join(', ')}`);

  const own = list.filter(
    (c) =>
      c.verifies === undefined &&
      c.closed === undefined &&
      c.movedTo === undefined &&
      c.movedFrom === undefined &&
      c.ai === undefined,
  );
  const fromWebsite = labels(list.filter((c) => c.ai !== undefined && c.verifies === undefined).map((c) => c.key));
  const moved = [...new Set(list.flatMap((c) => (c.movedFrom === undefined ? [] : [`${c.movedFrom} → ${c.key}`])))];
  const corrected = labels(own.filter((c) => c.newValue !== undefined).map((c) => c.key));
  const removed = labels(own.filter((c) => c.newValue === undefined && c.duplicateOf === undefined).map((c) => c.key));
  const duplicates = labels(own.filter((c) => c.duplicateOf !== undefined).map((c) => c.key));
  const verified = labels(list.flatMap((c) => (c.verifies === undefined || c.ai !== undefined ? [] : [c.verifies.key])));
  const closed = new Set(list.filter((c) => c.closed === true).map((c) => elementKey(c))).size;

  const parts: string[] = [];
  if (closed > 0) {
    parts.push(`existiert nicht mehr: ${closed === 1 ? '1 Objekt' : `${closed} Objekte`}`);
  }
  if (corrected.length > 0) {
    parts.push(part('Formatierung korrigiert', corrected));
  }
  if (removed.length > 0) {
    parts.push(part(detail === 'kinds' ? 'Tags entfernt' : 'entfernt', removed));
  }
  if (duplicates.length > 0) {
    parts.push(part('doppelte Angaben entfernt', duplicates));
  }
  if (moved.length > 0) {
    parts.push(part(detail === 'kinds' ? 'Tags umbenannt' : 'umbenannt', moved));
  }
  if (fromWebsite.length > 0) {
    // the AI is always named, also in the shortest form
    parts.push(part(`von der Website übernommen, ausgewertet mit KI-Unterstützung (${aiModels(list).join(', ')})`, fromWebsite));
  }
  if (verified.length > 0) {
    parts.push(part('online geprüft (check_date)', verified));
  }
  return parts.join('; ');
}

/**
 * The suggested changeset comment, at most MAX_COMMENT characters: as
 * detailed as fits, cut off only as a last resort.
 */
export function changesetComment(list: TagChange[]): string {
  for (const detail of ['checks', 'groups', 'kinds'] as const) {
    const comment = build(list, detail);
    if (commentLength(comment) <= MAX_COMMENT) {
      return comment;
    }
  }
  return `${[...build(list, 'kinds')].slice(0, MAX_COMMENT - 1).join('')}…`;
}
