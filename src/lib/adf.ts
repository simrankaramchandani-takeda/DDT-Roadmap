/**
 * Parser for the SPOT Description field, and the dispatcher in front of it.
 *
 * `parseSpotDescription` accepts the field in either transport: an ADF document from
 * Jira REST, parsed here, or the wiki-markup string Feed #3 returns, delegated to
 * `spot-wiki.ts`. Both produce the same `SpotNarrative`, so `transform.ts` never
 * learns which source it is reading -- the reason the feed migration needs no change
 * to the transformation layer.
 *
 * The field holds an Atlassian Document Format table synced from SPOT, with one
 * label/value row per attribute. Verified shape from DDTSG-55:
 *
 *   | Project Phase              | Execute                                  |
 *   | Project State              | Active                                   |
 *   | Project URL                | <link>                                   |
 *   | Overall Status Description | PMC endorsed 18Jun26 ... (multi-line)    |
 *   | Recent Accomplishments     | ...                                      |
 *   | Next Priorities            | ...                                      |
 *
 * `Overall Status Description` is the single most valuable string in the whole
 * dataset -- it is the only place a site explains WHY a project is amber or red.
 * It is present on roughly 8 items today.
 *
 * Row labels are matched loosely (lowercased, non-alphanumerics collapsed) so
 * punctuation or casing drift in the SPOT sync does not silently drop content.
 */

import { parseSpotWikiTable } from './spot-wiki.js';
import {
  labelKey,
  LABEL_TO_FIELD,
  SPOT_PLACEHOLDER_PATTERN,
  type SpotNarrative,
} from './spot-vocabulary.js';

/** Re-exported so existing importers of `SpotNarrative` need no change. */
export type { SpotNarrative } from './spot-vocabulary.js';
export { labelKey, LABEL_TO_FIELD, SPOT_PLACEHOLDER_PATTERN } from './spot-vocabulary.js';

interface AdfNode {
  type?: string;
  text?: string;
  content?: AdfNode[];
  attrs?: Record<string, unknown>;
  marks?: { type?: string; attrs?: Record<string, unknown> }[];
}

/**
 * Extracts text from a node tree, preserving line breaks. SPOT status
 * descriptions are genuinely multi-line and the breaks carry meaning -- they
 * separate distinct points a site is making.
 */
function extractText(node: AdfNode | undefined): string {
  if (!node) return '';

  const parts: string[] = [];

  const walk = (n: AdfNode): void => {
    if (n.type === 'text' && typeof n.text === 'string') {
      parts.push(n.text);
      return;
    }
    if (n.type === 'hardBreak') {
      parts.push('\n');
      return;
    }

    if (Array.isArray(n.content)) {
      n.content.forEach((child, i) => {
        walk(child);
        // Paragraph siblings become separate lines.
        if (n.content && i < n.content.length - 1 && child.type === 'paragraph') {
          parts.push('\n');
        }
      });
    }
  };

  walk(node);

  return parts
    .join('')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/** First link href found in a node, for the Project URL row. */
function extractHref(node: AdfNode | undefined): string | undefined {
  if (!node) return undefined;

  let href: string | undefined;

  const walk = (n: AdfNode): void => {
    if (href) return;
    for (const mark of n.marks ?? []) {
      if (mark.type === 'link' && typeof mark.attrs?.['href'] === 'string') {
        href = mark.attrs['href'] as string;
        return;
      }
    }
    if (typeof n.attrs?.['url'] === 'string') {
      href = n.attrs['url'] as string;
      return;
    }
    (n.content ?? []).forEach(walk);
  };

  walk(node);
  return href;
}

/** Collects every `tableRow` node, at any depth. */
function findTableRows(root: AdfNode): AdfNode[] {
  const rows: AdfNode[] = [];

  const walk = (n: AdfNode): void => {
    if (n.type === 'tableRow') rows.push(n);
    (n.content ?? []).forEach(walk);
  };

  walk(root);
  return rows;
}

/**
 * Parses the SPOT Description field into structured narrative fields, from whichever
 * transport it arrived in.
 *
 * Returns undefined when the value is absent or contains no recognisable table -- a
 * shape change in the SPOT sync should degrade to "no narrative", never throw and
 * abort a sync of 645 items.
 */
export function parseSpotDescription(raw: unknown): SpotNarrative | undefined {
  // Feed #3 returns the table as the wiki markup Jira stores underneath. Dispatching
  // here rather than in `transform.ts` is what keeps the transformation layer
  // source-agnostic.
  if (typeof raw === 'string') return parseSpotWikiTable(raw);

  if (raw == null || typeof raw !== 'object') return undefined;

  const root = raw as AdfNode;
  const rows = findTableRows(root);
  if (rows.length === 0) return undefined;

  const result: SpotNarrative = { unmappedLabels: [] };
  let matched = 0;

  for (const row of rows) {
    const cells = (row.content ?? []).filter(
      (c) => c.type === 'tableCell' || c.type === 'tableHeader',
    );
    if (cells.length < 2) continue;

    const label = extractText(cells[0]);
    if (!label) continue;

    const field = LABEL_TO_FIELD[labelKey(label)];
    if (!field) {
      result.unmappedLabels.push(label);
      continue;
    }

    const valueCell = cells[1];

    if (field === 'sourceUrl') {
      const href = extractHref(valueCell);
      if (href) {
        result.sourceUrl = href;
        matched++;
      }
      continue;
    }

    const value = extractText(valueCell);
    // Skip placeholder values so an empty SPOT row does not masquerade as content.
    if (!value || SPOT_PLACEHOLDER_PATTERN.test(value)) continue;

    result[field] = value;
    matched++;
  }

  if (matched === 0 && result.unmappedLabels.length === 0) return undefined;
  return result;
}
