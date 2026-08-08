/**
 * The SPOT narrative table as Jira wiki markup -- the form Feed #3 returns.
 *
 * REST returns this field as ADF and `adf.ts` parses it. Feed #3 returns the same
 * table as the string Jira stores underneath:
 *
 *   |Project Phase|Execute|
 *   |Project State|Active|
 *   |Project URL|[Project URL|https://tospot.azurewebsites.net/project-hub/8260bc2f-...]|
 *   |Overall Status Description|27/07/2026:
 *   -confirming next waves
 *   \\
 *   21/05/2026:
 *   The Automation folder was migrated to SharePoint|
 *   |Recent Accomplishments|Pilot migration wave is complete|
 *   |Next Priorities|MAN Ops P1, Engineering folder would be next|
 *
 * This is the single most valuable content in the dataset -- the only place a site
 * explains WHY a project is amber or red, present on 299 of 510 items. Without this
 * parser the feed path would silently drop 59% of the narratives, and the coverage
 * page would report the loss as a data-quality finding about the sites rather than as
 * a gap in the adapter.
 *
 * THREE PROPERTIES MATTER MORE THAN ELEGANCE HERE:
 *
 *   1. The SAME `SpotNarrative` output as the ADF path, so `transform.ts` cannot tell
 *      which source it is reading. `tests/spot-wiki.test.ts` pins equivalence on a
 *      fixture pair.
 *   2. ONE shared row vocabulary, imported from `adf.ts` rather than restated.
 *   3. NEVER THROWS. A SPOT format change must degrade one field on one item, not
 *      abort a sync of 1371 rows. Every failure path returns `undefined`.
 */

import {
  labelKey,
  LABEL_TO_FIELD,
  SPOT_PLACEHOLDER_PATTERN,
  type SpotNarrative,
} from './spot-vocabulary.js';

/**
 * One table row: `|label|value|` with the value allowed to span lines.
 *
 * Line-based splitting is wrong -- `Overall Status Description` legitimately contains
 * newlines and they carry meaning, separating distinct dated updates a site made. The
 * lazy body anchored on a `|` at end-of-line also survives values containing internal
 * pipes, which the `Project URL` row does (`[Project URL|https://...]`).
 *
 * Documented limitation: a value whose internal line happens to end in `|` splits
 * early. That degrades to a truncated narrative rather than a crash, which is the
 * right trade for a field this variable.
 */
const ROW_PATTERN = /^\|([^|\n]+)\|([\s\S]*?)\|[ \t]*$/gm;

/** Jira wiki's forced line break, on a line of its own. */
const FORCED_BREAK = /^\s*\\\\\s*$/gm;

/** `[text|url]` and `[url]`. */
const WIKI_LINK = /\[([^\]|]*)\|([^\]]+)\]|\[([^\]]+)\]/g;

/**
 * Normalises whitespace exactly as `extractText` in `adf.ts` does, so equivalent
 * content from the two transports produces byte-identical strings. Anything less than
 * byte-identical would show up as noise in the Phase C snapshot diff and mask a real
 * divergence.
 */
function tidy(value: string): string {
  return value
    .replace(FORCED_BREAK, '\n')
    .replace(/\r\n/g, '\n')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/** Renders link markup as its display text, for fields that are prose. */
function renderLinksAsText(value: string): string {
  return value.replace(WIKI_LINK, (_match, text: string | undefined, url: string | undefined, bare: string | undefined) => {
    const label = text?.trim();
    if (label) return label;
    return (url ?? bare ?? '').trim();
  });
}

/** Extracts the first URL from link markup, or a bare URL. */
function extractUrl(value: string): string | undefined {
  WIKI_LINK.lastIndex = 0;
  const match = WIKI_LINK.exec(value);
  if (match) {
    const target = match[2] ?? match[3];
    if (target?.trim()) return target.trim();
  }
  const bare = /https?:\/\/\S+/.exec(value);
  return bare ? bare[0] : undefined;
}

/**
 * Parses a wiki-markup SPOT table into the same structure the ADF parser produces.
 *
 * Returns `undefined` when the value is not a table at all -- the "no narrative"
 * answer, which every caller already handles.
 */
export function parseSpotWikiTable(raw: unknown): SpotNarrative | undefined {
  if (typeof raw !== 'string') return undefined;

  const text = raw.replace(/\r\n/g, '\n');
  if (!text.includes('|')) return undefined;

  const result: SpotNarrative = { unmappedLabels: [] };
  let matched = 0;

  ROW_PATTERN.lastIndex = 0;
  let row: RegExpExecArray | null;

  while ((row = ROW_PATTERN.exec(text)) !== null) {
    const label = row[1]?.trim();
    const body = row[2];
    if (!label || body === undefined) continue;

    const field = LABEL_TO_FIELD[labelKey(label)];
    if (!field) {
      result.unmappedLabels.push(label);
      continue;
    }

    if (field === 'sourceUrl') {
      const url = extractUrl(body);
      if (url) {
        result.sourceUrl = url;
        matched++;
      }
      continue;
    }

    const value = tidy(renderLinksAsText(body));
    if (!value || SPOT_PLACEHOLDER_PATTERN.test(value)) continue;

    result[field] = value;
    matched++;
  }

  if (matched === 0 && result.unmappedLabels.length === 0) return undefined;
  return result;
}
