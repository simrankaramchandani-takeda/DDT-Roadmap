/**
 * How a "roadmap item" is identified.
 *
 * THIS IS THE MOST IMPORTANT CONFIG FILE IN THE PROJECT.
 *
 * Roadmap items are identified by Jira's `issuetype.hierarchyLevel`, NEVER by
 * issue type name. A pipeline keyed on `issuetype = Epic` returns an empty
 * result for any site using a project-local level-1 type, and reports no error
 * -- the single worst failure mode available to this application: a site that
 * looks like it has no work.
 *
 * Discovery evidenced this on a project that is now deferred from MVP scope, so
 * within the current 19-project scope every level-1 type is expected to be
 * `Epic`. The rule is retained deliberately. It costs nothing, it is the only
 * defence if a site introduces a local type, and a deferred project may return.
 * Coverage of the alternate-type path lives in tests/pipeline.test.ts rather
 * than in production data; verify-snapshot reports any non-`Epic` type it sees.
 *
 * Jira hierarchy levels:
 *   -1  subtask
 *    0  Story / Task / Bug            -- operational detail, excluded
 *    1  Epic / Digital Project / ...   -- ROADMAP ITEM
 *    2  Initiative                     -- PORTFOLIO PROGRAMME
 */

export const ROADMAP_ITEM_HIERARCHY_LEVEL = 1;
export const PORTFOLIO_INITIATIVE_HIERARCHY_LEVEL = 2;

/**
 * Level-1 type names observed during discovery. Used ONLY to decide whether to
 * emit a warning -- an unrecognised name is still ingested. The list exists so
 * a new project-local type surfaces in `warnings[]` rather than passing
 * unnoticed.
 */
export const KNOWN_LEVEL_1_TYPE_NAMES: readonly string[] = [
  'Epic',
  // Observed during discovery on a now-deferred project. Retained so that if
  // the project returns, or another site adopts the same local type, it is
  // ingested silently rather than raising a spurious warning.
  'Digital Project',
] as const;

/** Level-2 type names observed during discovery. Same warn-only semantics. */
export const KNOWN_LEVEL_2_TYPE_NAMES: readonly string[] = ['Initiative'] as const;

export function isRoadmapItemLevel(hierarchyLevel: number | undefined): boolean {
  return hierarchyLevel === ROADMAP_ITEM_HIERARCHY_LEVEL;
}

export function isPortfolioInitiativeLevel(hierarchyLevel: number | undefined): boolean {
  return hierarchyLevel === PORTFOLIO_INITIATIVE_HIERARCHY_LEVEL;
}

export function isUnexpectedLevel1TypeName(name: string): boolean {
  return !KNOWN_LEVEL_1_TYPE_NAMES.includes(name);
}

export function isUnexpectedLevel2TypeName(name: string): boolean {
  return !KNOWN_LEVEL_2_TYPE_NAMES.includes(name);
}

/**
 * Issue link type that connects a portfolio Initiative to the site items that
 * deliver it. Discovery findings:
 *   - The type is `Polaris work item link` (id 10319, implements / is implemented by).
 *   - Direction is NOT consistently curated: for a single Initiative, some site
 *     items appear as `inwardIssue` and others as `outwardIssue`. Matching must
 *     therefore be UNDIRECTED.
 *   - Links can point at projects outside scope, so the counterpart must be
 *     checked for portfolio membership. This is newly load-bearing: in-scope
 *     items link to the four projects deferred from MVP scope, and those
 *     counterparts must now be rejected.
 */
export const INITIATIVE_LINK_TYPE_ID = '10319';
export const INITIATIVE_LINK_TYPE_NAME = 'Polaris work item link';

/**
 * Link type names that indicate a genuine blocker. Jira's `Flagged` field
 * (customfield_10387) is populated on zero items across all 22 site projects,
 * so it is unusable; blockers can only come from links.
 */
export const BLOCKING_LINK_INWARD_DESCRIPTIONS: readonly string[] = [
  'is blocked by',
  'blocks',
] as const;
