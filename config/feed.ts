/**
 * Feed #3 shape facts: entity sets, column conventions, and the registries the
 * adapter needs because the feed does not carry them.
 *
 * SHAPE ONLY, NEVER CONNECTION. There is no URL, credential or transport setting in
 * this file and there must not be one. WP4 builds the transformation layer against
 * records; connecting to OData is later work, and keeping the two apart means the
 * adapter is testable today with no governance sign-off (E4/E6/E8 are still open --
 * see reference/adr-001-data-source.md).
 *
 * Everything here is transcribed from probe evidence under `data/probe-feed*` and from
 * reference/design-001-odata-adapter.md. Nothing is inferred from a naming pattern:
 * that rule cost this project once already (config/projects.ts) and the same trap is
 * live here, because the custom-field columns look far more regular than they are.
 */

import type { CanonicalPhase } from './status-map.js';

// ---------------------------------------------------------------------------
// Identity and entity sets
// ---------------------------------------------------------------------------

/** How the feed identifies itself in provenance strings shown to users. */
export const FEED_NAME = 'Feed #3';

/**
 * Entity sets the adapter reads. Names are verbatim from the service document.
 *
 * `IssueStatuses` is absent from Feed #3 -- the reason status category has to be
 * derived rather than read (see STATUS_CATEGORY_KEYS below). `Worklogs`,
 * `Components`, `Versions` and `ProjectProperties` exist but are not consumed.
 */
export const FEED_ENTITY_SETS = {
  issues: 'Issues',
  issueTypes: 'IssueTypes',
  issueLinks: 'IssueLinks',
  labels: 'Labels',
  projects: 'Projects',
} as const;

/**
 * Multi-user custom fields, exported as side tables rather than columns.
 *
 * Each becomes `fields['customfield_<id>'] = [{ displayName }, ...]`, which is the
 * shape `extractScalar` already walks -- so `normaliseOwners` needs no feed
 * awareness.
 */
export const FEED_OWNER_SIDE_TABLES: readonly { entitySet: string; fieldId: string }[] = [
  { entitySet: 'Business_Owner_10489', fieldId: 'customfield_10489' },
  { entitySet: 'Business_Application_Owner_11209', fieldId: 'customfield_11209' },
] as const;

// ---------------------------------------------------------------------------
// Column conventions
// ---------------------------------------------------------------------------

/**
 * Custom-field columns are named `<Sanitised_Label>_<fieldId>`, and the numeric
 * suffix IS the Jira custom field ID -- confirmed by `Start_date_10412`,
 * `SPOT_Description_24265`, `Overall_Status_24266` and `Spot_ID_19886` all matching
 * config/fields.ts exactly.
 *
 * One general rule rather than eighteen special cases: it covers every per-site SPOT
 * field and any field added later, and it keeps config/fields.ts the only place a
 * field ID is declared.
 *
 * `SPOT_Description__24271` has a doubled underscore; matching on trailing digits is
 * unaffected. No system column ends in 4-6 digits, verified against the 119-column
 * census in `data/probe-feed2/columns.json`.
 */
export const CUSTOM_FIELD_COLUMN_PATTERN = /_(\d{4,6})$/;

/**
 * Escape hatch for a system column that ever collides with the pattern above.
 * Empty today, and deliberately present: discovering the collision later should be a
 * one-line config edit, not an adapter change.
 */
export const NON_CUSTOM_FIELD_COLUMNS: readonly string[] = [] as const;

/**
 * Column candidates for a label's text in the `Labels` side table.
 *
 * UNVERIFIED: the probe captured `Issues` columns only, so the label column's name is
 * not directly evidenced. Coalescing over candidates costs nothing and fails soft --
 * a miss loses the `FY\d{2}` label fallback, which `transform.ts` already treats as
 * optional, rather than aborting.
 */
export const FEED_LABEL_VALUE_COLUMNS: readonly string[] = ['LABEL', 'LABEL_NAME', 'NAME', 'VALUE'] as const;

// ---------------------------------------------------------------------------
// Status category, derived rather than read
// ---------------------------------------------------------------------------

/**
 * Canonical category -> the Jira `statusCategory.key` the adapter synthesises.
 *
 * Feed #3 has no `IssueStatuses` entity set, so there is no real status category to
 * carry across. Category is therefore derived from the canonical phase via
 * `PHASE_TO_CATEGORY` and re-expressed in Jira's vocabulary here, so that the
 * UNMODIFIED `normaliseStatus` reproduces exactly the same `ItemStatus` it would
 * produce from a REST payload.
 *
 * This is safe because `risk.ts` tests `phase === 'cancelled'` BEFORE
 * `category === 'done'`: the "abandoned work must never report as delivered" rule is
 * resolved from the phase and does not depend on the category at all.
 */
export const STATUS_CATEGORY_KEYS: Readonly<Record<'todo' | 'in-progress' | 'done', string>> = {
  todo: 'new',
  'in-progress': 'indeterminate',
  done: 'done',
} as const;

/**
 * Phases whose category the feed path must never guess at.
 *
 * Under REST an unmapped status name falls back to the real `statusCategory`. Feed #3
 * has no such fallback, and `STATUS_CATEGORY_TO_PHASE`'s `?? 'execute'` would quietly
 * file an unknown status as work in flight. An unmapped status name is therefore an
 * ERROR on the feed path, not a warning -- a deliberate asymmetry with REST, which
 * keeps warn-and-fall-back because it has something real to fall back to.
 */
export const UNMAPPED_STATUS_IS_FATAL = true;

// ---------------------------------------------------------------------------
// Hierarchy level registry
// ---------------------------------------------------------------------------

/**
 * `ISSUE_TYPE_ID` -> Jira hierarchy level.
 *
 * WHY THIS EXISTS. `classifyIssues` selects roadmap items by
 * `issuetype.hierarchyLevel`, and no OData feed exposes it. An issue whose level is
 * `undefined` is SILENTLY DROPPED -- the worst failure mode available to this
 * application, because a site then looks like it has no work. The registry makes an
 * unknown type ID a loud, blocking error instead.
 *
 * THIS MAP IS INCOMPLETE AND KNOWN TO BE. The entries below are transcribed from the
 * probe samples under `data/probe-feed*`, which cover five projects out of nineteen.
 * Type IDs are PER-PROJECT in team-managed projects -- `Epic` alone appears as 18380
 * (DDTORA) and 14598 (another project) -- so this cannot be completed by reasoning,
 * only by capture. Seed the full map from Jira REST `/rest/api/3/issuetype`, which
 * does return `hierarchyLevel`, before the feed is connected.
 *
 * Until then the adapter reports every unknown ID with its name and scope, so the
 * capture list writes itself on the first run.
 *
 * IDs are stable; names are not. Never key this on a name.
 */
export const ISSUE_TYPE_LEVELS: Readonly<Record<string, number>> = {
  // --- level 2: portfolio initiative ---
  '10269': 2, // Initiative (DDTGMPORT)
  // --- level 1: roadmap item ---
  '18380': 1, // Epic (DDTORA)
  '14598': 1, // Epic
  // --- level 0: operational detail, expected to be dropped ---
  '14269': 0, // Story (NEUCHDDT)
  '13182': 0, // Story
  '13206': 0, // Story
  '13480': 0, // Story
  '13290': 0, // Technical Story
  '12493': 0, // Task
  '13268': 0, // Task
  '13370': 0, // Task
  '12158': 0, // Bug
  '13568': 0, // Bug
  '21728': 0, // Bug
  // --- level -1: subtask ---
  '14271': -1, // Subtask (NEUCHDDT)
  '11095': -1, // Subtask
  '13416': -1, // Subtask
  '13766': -1, // Subtask
  '22043': -1, // Subtask
} as const;

/** Stated in diagnostics so an incomplete registry is never mistaken for a complete one. */
export const ISSUE_TYPE_LEVELS_ARE_COMPLETE = false;

// ---------------------------------------------------------------------------
// Links
// ---------------------------------------------------------------------------

/**
 * What `DIRECTION` means on a `Blocks` row.
 *
 * UNRESOLVED, AND MUST NOT BE GUESSED. `findBlockers` treats the presence of
 * `inwardIssue` as "this issue is blocked by that one". Feed #3 gives `TYPE: 'Blocks'`
 * plus `DIRECTION: Inward|Outward` and no inward/outward description strings, so the
 * adapter has to synthesise them -- and inverting the mapping would silently reverse
 * every blocker attribution, making blocking items look blocked and vice versa.
 * `dependency-risk` feeds executive output, so a wrong direction is confidently wrong
 * rather than visibly wrong.
 *
 * While this is `'unresolved'` the adapter emits NO blocker attributions from the
 * feed and records one warning saying so. A visible gap beats an invisible inversion.
 *
 * To resolve: take one `Blocks` pair from the feed, compare it against the same link
 * in Jira REST or the Jira UI, set this constant, and pin it with a test. One
 * observation settles it. Sizing: 28 `Blocks` rows in the feed.
 */
export type BlocksDirectionMeaning = 'inward-is-blocked' | 'outward-is-blocked' | 'unresolved';

export const BLOCKS_DIRECTION_MEANING: BlocksDirectionMeaning = 'unresolved';

/** Link `TYPE` values that indicate a blocking relationship. */
export const FEED_BLOCKING_LINK_TYPES: readonly string[] = ['blocks', 'is blocked by'] as const;

// ---------------------------------------------------------------------------
// Site aliases
// ---------------------------------------------------------------------------

/**
 * Feed `PROJECT_KEY` -> the key used in config/projects.ts.
 *
 * Empty, because the probe found the feed's keys identical to Jira's. Kept as the
 * single declared place for a divergence so that if the feed ever exports a renamed
 * or legacy key, the fix is one entry here rather than a special case in the adapter.
 *
 * Resolution also trims and upper-cases, which is real tolerance rather than
 * speculation: OData exports have been seen to pad fixed-width string columns.
 */
export const SITE_KEY_ALIASES: Readonly<Record<string, string>> = {} as const;

// ---------------------------------------------------------------------------
// Known losses
// ---------------------------------------------------------------------------

/**
 * Facts the feed cannot supply, recorded so each degradation is a stated decision
 * rather than a silent absence. Surfaced once per adaptation as informational
 * warnings, which is what keeps them from being rediscovered as bugs.
 */
export const FEED_KNOWN_LOSSES: readonly { subject: string; detail: string }[] = [
  {
    subject: 'childCount',
    detail:
      'Feed #3 exports no PARENT_ISSUE_* columns, so child progress cannot be counted. ' +
      'Every item carries childCount {0,0} and the progress clause is omitted from its ' +
      'summary. Request PARENT_ISSUE_* from the feed owner; it exists in Feed #2.',
  },
  {
    subject: 'customfield_10387 (Flagged)',
    detail:
      'The Flagged canary is VACUOUS on this feed: the column is absent, so a zero count ' +
      'means "not exported", not "not populated". Do not read it as evidence.',
  },
  {
    subject: 'customfield_11199 (Initiative RAG)',
    detail:
      'No feed exposes an authored initiative RAG, so every initiative status is rolled up ' +
      'from its linked projects with provenance "inferred". The UI already states this.',
  },
] as const;

/** Phases the feed can produce. Exported so a test can assert the registry covers them. */
export type FeedPhase = CanonicalPhase;
