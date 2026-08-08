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
 *
 * MEASURED POPULATION, live read 2026-08-08. Both tables are exported and both are
 * nearly empty: `Business_Owner_10489` carries 10 rows over 10 issues, and
 * `Business_Application_Owner_11209` carries ZERO. None of the remaining six
 * `OWNER_FIELD_CANDIDATES` is exported as an `Issues` column either. So owner attribution
 * on this feed rests almost entirely on `CURRENT_ASSIGNEE_NAME`.
 *
 * Both entries are retained deliberately. An exported-but-empty table is a fact about
 * today's data, not about the schema: removing `11209` would mean re-deriving it the day
 * the field starts being populated, and the join costs one request against a table with
 * no rows in it.
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
 * VERIFIED 2026-08-08 against the live feed: `Labels` carries exactly
 * `ISSUE_ID, ISSUE_KEY, NAME` over 395 rows, so `NAME` resolves. The other candidates are
 * retained because coalescing costs nothing and fails soft -- a miss loses the `FY\d{2}`
 * label fallback, which `transform.ts` already treats as optional, rather than aborting.
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
 * TYPE IDs ARE PER-PROJECT in team-managed projects. `Epic` alone appears as 18380
 * (DDTORA), 18329 (DDTGC), 19568 (DDTSG), 21576 (DDTHIK) and fifteen more. There is no
 * arithmetic and no naming rule connecting them, so this map can only ever be captured,
 * never derived -- and a name-based guess is worse than useless, because a project-local
 * level-1 type NOT called `Epic` is exactly the case this model exists to catch.
 *
 * CAPTURED IN FULL FOR ALL 19 IN-SCOPE PROJECTS, 2026-08-08, from Jira REST via the
 * Atlassian MCP channel -- `getJiraProjectIssueTypesMetadata` for 18 projects, and for
 * `NEUCHDDT` (which denies `createmeta` to this identity) from the `issuetype` block of
 * three live issues. `hierarchyLevel` is returned verbatim by both; nothing below is
 * inferred. `SCOPE_ID` was cross-checked against the feed's own `IssueTypes` rows and
 * matched on every entry.
 *
 * Before this capture, 36 in-scope type IDs were unregistered, which blocked 918 of 1371
 * rows and left 17 of 18 sites showing no roadmap items at all. That was the registry
 * working as designed -- loudly -- and it is what made the gap measurable.
 *
 * PROVENANCE TAGS. Every entry says where its level was seen:
 *   - `capture` -- the 2026-08-08 Jira REST capture described above. Authoritative.
 *   - `probe`   -- the OData probe samples under `data/probe-feed*`.
 *   - `REST`    -- Jira REST payloads transcribed during discovery on 2026-08-05 and
 *                  retained in `tests/fixtures/jira-issues.ts`.
 * Where tags disagree they are listed together; no conflict was found.
 *
 * Re-capture with `npm run capture-issue-types` (needs a `JIRA_API_TOKEN`), which reads
 * `/rest/api/3/issuetype` and prints a pasteable replacement for this block. Re-run it
 * when a site is added or a project is migrated between team- and company-managed, since
 * either mints new type IDs.
 *
 * IDs are stable; names are not. Never key this on a name.
 */
export const ISSUE_TYPE_LEVELS: Readonly<Record<string, number>> = {
  // ---- level 2: portfolio initiative -------------------------------------
  '10269': 2, // Initiative      DDTGMPORT GLOBAL        -- capture, probe, REST

  // ---- level 1: roadmap item ---------------------------------------------
  // One per in-scope site. These are the entries the roadmap is built from: an
  // omission here makes a site look like it has no work at all.
  '14270': 1, // Epic            NEUCHDDT  PROJECT/14494 -- capture
  '18233': 1, // Epic            DDTTO     PROJECT/16059 -- capture
  '18319': 1, // Epic            DDTLNZ    PROJECT/19188 -- capture
  '18316': 1, // Epic            DDTMBO    PROJECT/19186 -- capture
  '18322': 1, // Epic            DDTTJ     PROJECT/19189 -- capture
  '18329': 1, // Epic            DDTGC     PROJECT/19191 -- capture, REST
  '18334': 1, // Epic            DDTBRY    PROJECT/19192 -- capture
  '18377': 1, // Epic            DDTNAU    PROJECT/19262 -- capture
  '18380': 1, // Epic            DDTORA    PROJECT/19295 -- capture, probe
  '18457': 1, // Epic            DDTVAS    PROJECT/19331 -- capture
  '18483': 1, // Epic            DDTSNG    PROJECT/19399 -- capture
  '18567': 1, // Epic            DDTBP     PROJECT/19504 -- capture
  '19568': 1, // Epic            DDTSG     PROJECT/20539 -- capture, REST
  '21310': 1, // Epic            DDTOSA    PROJECT/22226 -- capture
  '21576': 1, // Epic            DDTHIK    PROJECT/22472 -- capture, REST
  '21583': 1, // Epic            DDTBEK    PROJECT/22505 -- capture
  '22042': 1, // Epic            DDTYAR    PROJECT/23071 -- capture
  '23861': 1, // Epic            DDTBA     PROJECT/24642 -- capture
  // Out of scope or unconfirmed project, retained because the level is observed and a
  // registered ID costs nothing. `Digital Project` is the level-1 type that is not an
  // Epic, kept as standing evidence that name-based selection would be wrong.
  '14598': 1, // Epic            (out of scope)          -- probe, REST
  '12048': 1, // Digital Project DDTJG (deferred)        -- REST. The only project-local
  //          level-1 type not named "Epic"; see NON_DRIVING_DEFERRED_KEYS.

  // ---- level 0: operational detail, expected to be dropped ---------------
  '10229': 0, // Risk            DDTGMPORT GLOBAL        -- capture
  '10246': 0, // Impediment      DDTGMPORT GLOBAL        -- capture
  '10493': 0, // Decision        DDTGMPORT GLOBAL        -- capture
  '14267': 0, // Task            NEUCHDDT  PROJECT/14494 -- capture
  '14268': 0, // Bug             NEUCHDDT  PROJECT/14494 -- capture
  '14269': 0, // Story           NEUCHDDT  PROJECT/14494 -- probe
  '15327': 0, // Task            DDTTO     PROJECT/16059 -- capture
  '18232': 0, // Story           DDTTO     PROJECT/16059 -- capture
  '18234': 0, // Bug             DDTTO     PROJECT/16059 -- capture
  '18315': 0, // Task            DDTMBO    PROJECT/19186 -- capture
  '18318': 0, // Task            DDTLNZ    PROJECT/19188 -- capture
  '18321': 0, // Task            DDTTJ     PROJECT/19189 -- capture
  '18328': 0, // Task            DDTGC     PROJECT/19191 -- capture
  '18331': 0, // Bug             DDTLNZ    PROJECT/19188 -- capture
  '18332': 0, // Story           DDTLNZ    PROJECT/19188 -- capture
  '18333': 0, // Task            DDTBRY    PROJECT/19192 -- capture
  '18376': 0, // Task            DDTNAU    PROJECT/19262 -- capture
  '18379': 0, // Task            DDTORA    PROJECT/19295 -- capture
  '18456': 0, // Task            DDTVAS    PROJECT/19331 -- capture
  '18466': 0, // Story           DDTVAS    PROJECT/19331 -- capture
  '18467': 0, // Bug             DDTVAS    PROJECT/19331 -- capture
  '18468': 0, // Bug             DDTTJ     PROJECT/19189 -- capture
  '18469': 0, // Story           DDTTJ     PROJECT/19189 -- capture
  '18470': 0, // Bug             DDTORA    PROJECT/19295 -- capture
  '18471': 0, // Story           DDTORA    PROJECT/19295 -- capture
  '18472': 0, // Bug             DDTNAU    PROJECT/19262 -- capture
  '18473': 0, // Story           DDTNAU    PROJECT/19262 -- capture
  '18474': 0, // Bug             DDTGC     PROJECT/19191 -- capture
  '18475': 0, // Story           DDTGC     PROJECT/19191 -- capture
  '18476': 0, // Bug             DDTBRY    PROJECT/19192 -- capture
  '18477': 0, // Story           DDTBRY    PROJECT/19192 -- capture
  '18478': 0, // Bug             DDTMBO    PROJECT/19186 -- capture
  '18479': 0, // Story           DDTMBO    PROJECT/19186 -- capture
  '18482': 0, // Task            DDTSNG    PROJECT/19399 -- capture
  '18490': 0, // Bug             DDTSNG    PROJECT/19399 -- capture
  '18491': 0, // Story           DDTSNG    PROJECT/19399 -- capture
  '18566': 0, // Task            DDTBP     PROJECT/19504 -- capture
  '18569': 0, // Bug             DDTBP     PROJECT/19504 -- capture
  '18570': 0, // Story           DDTBP     PROJECT/19504 -- capture
  '19567': 0, // Task            DDTSG     PROJECT/20539 -- capture
  '19602': 0, // Bug             DDTSG     PROJECT/20539 -- capture
  '19603': 0, // Story           DDTSG     PROJECT/20539 -- capture
  '21309': 0, // Task            DDTOSA    PROJECT/22226 -- capture
  '21575': 0, // Task            DDTHIK    PROJECT/22472 -- capture
  '21582': 0, // Task            DDTBEK    PROJECT/22505 -- capture
  '21724': 0, // Story           DDTBEK    PROJECT/22505 -- capture
  '21725': 0, // Bug             DDTBEK    PROJECT/22505 -- capture
  '21726': 0, // Bug             DDTHIK    PROJECT/22472 -- capture
  '21727': 0, // Story           DDTHIK    PROJECT/22472 -- capture
  '21728': 0, // Bug             DDTOSA    PROJECT/22226 -- capture, probe
  '21729': 0, // Story           DDTOSA    PROJECT/22226 -- capture
  '22041': 0, // Task            DDTYAR    PROJECT/23071 -- capture
  '22420': 0, // Bug             DDTYAR    PROJECT/23071 -- capture
  '22421': 0, // Story           DDTYAR    PROJECT/23071 -- capture
  '23860': 0, // Task            DDTBA     PROJECT/24642 -- capture
  '23872': 0, // Bug             DDTBA     PROJECT/24642 -- capture
  '23873': 0, // Story           DDTBA     PROJECT/24642 -- capture
  // Out of scope or unconfirmed project.
  '12158': 0, // Bug                                     -- probe
  '12493': 0, // Task                                    -- probe
  '13182': 0, // Story                                   -- probe
  '13206': 0, // Story                                   -- probe
  '13268': 0, // Task                                    -- probe
  '13290': 0, // Technical Story                         -- probe
  '13370': 0, // Task                                    -- probe
  '13480': 0, // Story                                   -- probe
  '13568': 0, // Bug                                     -- probe
  '19570': 0, // Story           (project unconfirmed)   -- REST

  // ---- level -1: subtask -------------------------------------------------
  '10102': -1, // Sub-task       DDTGMPORT GLOBAL        -- capture
  '10263': -1, // DoD            DDTGMPORT GLOBAL        -- capture
  '14271': -1, // Subtask        NEUCHDDT  PROJECT/14494 -- probe
  '15328': -1, // Sub-task       DDTTO     PROJECT/16059 -- capture
  '18317': -1, // Subtask        DDTMBO    PROJECT/19186 -- capture
  '18320': -1, // Subtask        DDTLNZ    PROJECT/19188 -- capture
  '18323': -1, // Subtask        DDTTJ     PROJECT/19189 -- capture
  '18330': -1, // Subtask        DDTGC     PROJECT/19191 -- capture
  '18335': -1, // Subtask        DDTBRY    PROJECT/19192 -- capture
  '18378': -1, // Subtask        DDTNAU    PROJECT/19262 -- capture
  '18381': -1, // Subtask        DDTORA    PROJECT/19295 -- capture
  '18458': -1, // Subtask        DDTVAS    PROJECT/19331 -- capture
  '18484': -1, // Subtask        DDTSNG    PROJECT/19399 -- capture
  '18568': -1, // Subtask        DDTBP     PROJECT/19504 -- capture
  '19569': -1, // Subtask        DDTSG     PROJECT/20539 -- capture
  '21311': -1, // Subtask        DDTOSA    PROJECT/22226 -- capture
  '21577': -1, // Subtask        DDTHIK    PROJECT/22472 -- capture
  '21584': -1, // Subtask        DDTBEK    PROJECT/22505 -- capture
  '22043': -1, // Subtask        DDTYAR    PROJECT/23071 -- capture, probe
  '23862': -1, // Subtask        DDTBA     PROJECT/24642 -- capture
  // Out of scope or unconfirmed project.
  '11095': -1, // Subtask                                -- probe
  '13416': -1, // Subtask                                -- probe
  '13766': -1, // Subtask                                -- probe
  '19571': -1, // Subtask       (project unconfirmed)    -- REST
} as const;

/**
 * Whether the registry covers everything the adapter can be asked about.
 *
 * TRUE AS OF THE 2026-08-08 CAPTURE, and the claim is precisely bounded: every issue type
 * present in the 19 in-scope projects is registered, verified by
 * `npm run validate-feed3` reporting zero unknown in-scope types over all 1371 rows.
 *
 * It does NOT claim to cover the whole Jira instance. It does not need to: the adapter
 * tests `isInScopeProject` and skips out-of-scope rows BEFORE resolving a level, so
 * `DDTJG`'s types are never looked up. If a project is ever brought into scope, this flag
 * is a lie until the capture is re-run -- so move it back to `false` in the same commit
 * that widens `config/projects.ts`.
 *
 * Only affects diagnostic wording. An unknown ID stays blocking either way.
 */
export const ISSUE_TYPE_LEVELS_ARE_COMPLETE = true;

// ---------------------------------------------------------------------------
// Links
// ---------------------------------------------------------------------------

/**
 * What `DIRECTION` means on a `Blocks` row.
 *
 * RESOLVED 2026-08-08 BY OBSERVATION, not by reasoning. `findBlockers` treats the
 * presence of `inwardIssue` as "this issue is blocked by that one". Feed #3 gives
 * `TYPE: 'Blocks'` plus `DIRECTION: Inward|Outward` and no inward/outward description
 * strings, so the adapter has to synthesise them -- and inverting the mapping would
 * silently reverse every attribution, making blocking items look blocked and vice versa.
 * `dependency-risk` feeds executive output, so a wrong direction is confidently wrong
 * rather than visibly wrong. Hence: two independent pairs, checked against Jira.
 *
 *   Feed row                                   Jira, from that issue's own perspective
 *   -----------------------------------------  ----------------------------------------
 *   DDTBP-8  --[Blocks/Inward]-->  DDTBP-27    issuelinks[].inwardIssue  = DDTBP-27,
 *                                              type.inward = "is blocked by"
 *                                              => DDTBP-8 IS BLOCKED BY DDTBP-27
 *   DDTSG-24 --[Blocks/Outward]--> DDTSG-23    issuelinks[].outwardIssue = DDTSG-23,
 *                                              type.outward = "blocks"
 *                                              => DDTSG-24 BLOCKS DDTSG-23
 *
 * Both land the same way: `Inward` fills REST's `inwardIssue` slot, `Outward` fills
 * `outwardIssue`. So DIRECTION is relative to the row's own `ISSUE_KEY`, and
 * `Inward` means THAT ISSUE IS THE BLOCKED ONE.
 *
 * Cross-checked for internal consistency across all 28 `Blocks` rows: every reciprocal
 * pair carries exactly one `Inward` and one `Outward` row, so no pair contradicts
 * another. `DDTBP-8 [Inward] <-> DDTBP-27 [Outward]` reads correctly from both ends.
 *
 * ONE TRAP WORTH RECORDING, because it points the other way. Jira's `createIssueLink`
 * API documents `inwardIssue` as the BLOCKER and `outwardIssue` as the BLOCKED for the
 * link as an object. Reading an issue's `issuelinks` is the opposite framing: the slot
 * names are relative to the issue you fetched, and Jira omits the slot that issue
 * occupies. Both framings agree on the facts above -- but taking the create-API wording
 * as the read semantics is exactly how this gets inverted. Verify, do not read the docs.
 */
export type BlocksDirectionMeaning = 'inward-is-blocked' | 'outward-is-blocked' | 'unresolved';

export const BLOCKS_DIRECTION_MEANING: BlocksDirectionMeaning = 'inward-is-blocked';

/** Link `TYPE` values that indicate a blocking relationship. */
export const FEED_BLOCKING_LINK_TYPES: readonly string[] = ['blocks', 'is blocked by'] as const;

// ---------------------------------------------------------------------------
// Site aliases
// ---------------------------------------------------------------------------

/**
 * Feed `PROJECT_KEY` -> the key used in config/projects.ts.
 *
 * Empty, because the probe found the feed's keys identical to Jira's. RE-VERIFIED
 * 2026-08-08 over all 1371 live rows: every exported `PROJECT_KEY` matched a config key
 * verbatim, with no trimming or case correction required. Kept as the single declared
 * place for a divergence so that if the feed ever exports a renamed or legacy key, the
 * fix is one entry here rather than a special case in the adapter.
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
