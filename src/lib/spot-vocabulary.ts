/**
 * The SPOT narrative table's vocabulary, shared by both parsers.
 *
 * The same table reaches this application through two transports -- ADF from Jira REST
 * (`adf.ts`) and wiki markup from Feed #3 (`spot-wiki.ts`). They must agree on which
 * rows exist, how labels are matched, and what counts as an empty value, or the two
 * sources will silently surface different narratives for the same item.
 *
 * This file exists to make that agreement structural. Duplicating the map in each
 * parser would drift on the first label added, and the drift would be invisible: one
 * source would just stop showing a row.
 */

export interface SpotNarrative {
  phase?: string;
  state?: string;
  statusDescription?: string;
  recentAccomplishments?: string;
  nextPriorities?: string;
  sourceUrl?: string;
  /** Labels found in the table that neither parser maps, for warnings. */
  unmappedLabels: string[];
}

/**
 * Canonical key for loose label matching: lowercased, non-alphanumerics collapsed.
 * Punctuation or casing drift in the SPOT sync must not silently drop content.
 */
export function labelKey(label: string): string {
  return label.toLowerCase().replace(/[^a-z0-9]+/g, '');
}

/**
 * Values that mean "nothing here".
 *
 * Rejected so an empty SPOT row does not masquerade as content. A narrative reading
 * "n/a" is worse than no narrative: it would count towards narrative coverage on the
 * Data & coverage page, which is the one figure that must never be flattered.
 */
export const SPOT_PLACEHOLDER_PATTERN = /^(n\/?a|none|tbd|-)$/i;

export const LABEL_TO_FIELD: Readonly<Record<string, keyof Omit<SpotNarrative, 'unmappedLabels'>>> = {
  projectphase: 'phase',
  phase: 'phase',
  projectstate: 'state',
  state: 'state',
  projecturl: 'sourceUrl',
  url: 'sourceUrl',
  overallstatusdescription: 'statusDescription',
  overallstatus: 'statusDescription',
  statusdescription: 'statusDescription',
  recentaccomplishments: 'recentAccomplishments',
  accomplishments: 'recentAccomplishments',
  nextpriorities: 'nextPriorities',
  priorities: 'nextPriorities',
  nextsteps: 'nextPriorities',
};
