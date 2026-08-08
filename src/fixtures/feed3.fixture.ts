/**
 * Representative Feed #3 records.
 *
 * Transcribed from the shapes evidenced under `data/probe-feed*` -- the same column
 * names, the same value formats (`DUE_DATE` date-only, `UPDATED` a full timestamp,
 * `ISSUE_ID` a JSON number), the same `<Label>_<fieldId>` custom-field convention, and
 * SPOT narratives as wiki markup rather than ADF.
 *
 * EVERY RECORD HERE EARNS ITS PLACE by exercising a branch that would otherwise only
 * be discovered in production:
 *
 *   | Record            | What it covers                                              |
 *   |-------------------|-------------------------------------------------------------|
 *   | DDTGMPORT-1       | active initiative, linked from three sites                   |
 *   | DDTGMPORT-2       | completed initiative (`Done` -> complete, terminal)          |
 *   | DDTGMPORT-3       | held initiative (`ON HOLD` -> the `hold` phase and its floor)|
 *   | DDTGC-1           | authored SPOT RAG + wiki-markup narrative, aligned           |
 *   | DDTGC-2           | go-live but no start -- milestone-only rendering             |
 *   | DDTMBO-1          | aligned to the completed initiative, `Discarded` -> cancelled|
 *   | DDTYAR-1/2        | a site that is 100% site-led, the DDTYAR banner branch       |
 *   | DDTLNZ-1          | held item + authored Green -- the `monitor` hold floor       |
 *   | DDTSG-1           | no dates at all -- the `missing-dates` finding               |
 *   | DDTBP-1           | duplicate ISSUE_KEY -- the `duplicate-record` finding        |
 *   | DDTLA-1           | a knowingly deferred project -- `out-of-scope`, not an error |
 *   | DDTZZZ-1          | an unregistered project -- `unmapped-site`                   |
 *   | DDTGC-9           | an unmapped status name -- `unknown-status`, record skipped  |
 *   | DDTGC-8           | an unregistered issue type -- `unknown-issue-type`, skipped  |
 *   | NEUCHDDT-1        | a level-0 row, correctly dropped by hierarchy selection      |
 *
 * The invalid records are the point of the fixture, not an afterthought: an adapter is
 * only trustworthy if what it refuses is as well specified as what it accepts.
 */

import type {
  Feed3Payload,
  FeedIssueLinkRow,
  FeedIssueRow,
  FeedIssueTypeRow,
  FeedLabelRow,
  FeedOwnerRow,
} from '@/lib/feed/dto.js';

/**
 * A captured hierarchy-level registry.
 *
 * Stands in for the Jira REST capture that must seed `ISSUE_TYPE_LEVELS` before the
 * feed is connected. Supplied explicitly to the adapter so tests exercise the real
 * lookup path rather than a permissive default -- and so the fixture keeps working
 * when the shipped registry is completed.
 */
export const FIXTURE_ISSUE_TYPE_LEVELS: Readonly<Record<string, number>> = {
  '10269': 2, // Initiative (DDTGMPORT)
  '18380': 1, // Epic
  '14269': 0, // Story
  '14271': -1, // Subtask
} as const;

/** A real SPOT narrative in the wiki markup Feed #3 returns, pipes and all. */
export const FIXTURE_SPOT_WIKI = [
  '|Project Phase|Execute|',
  '|Project State|Active|',
  '|Project URL|[Project URL|https://tospot.azurewebsites.net/project-hub?projectId=8260112]|',
  '|Overall Status Description|27/07/2026:',
  '-confirming next waves with MAN Ops',
  '\\\\',
  '21/05/2026:',
  'The Automation folder was migrated to SharePoint|',
  '|Recent Accomplishments|Pilot migration wave is complete|',
  '|Next Priorities|MAN Ops P1, Engineering folder would be next|',
].join('\n');

const ISSUE_TYPES: FeedIssueTypeRow[] = [
  { ISSUE_TYPE_ID: 10269, ISSUE_TYPE_NAME: 'Initiative', IS_SUBTASK: false, SCOPE_TYPE: 'GLOBAL', SCOPE_ID: null },
  { ISSUE_TYPE_ID: 18380, ISSUE_TYPE_NAME: 'Epic', IS_SUBTASK: false, SCOPE_TYPE: 'PROJECT', SCOPE_ID: 21994 },
  { ISSUE_TYPE_ID: 14269, ISSUE_TYPE_NAME: 'Story', IS_SUBTASK: false, SCOPE_TYPE: 'PROJECT', SCOPE_ID: 14924 },
  { ISSUE_TYPE_ID: 14271, ISSUE_TYPE_NAME: 'Subtask', IS_SUBTASK: true, SCOPE_TYPE: 'PROJECT', SCOPE_ID: 14924 },
  // Present in IssueTypes but absent from the registry -- the capture-gap case. The
  // diagnostic must name it, its scope, and what to do about it.
  { ISSUE_TYPE_ID: 22801, ISSUE_TYPE_NAME: 'Digital Project', IS_SUBTASK: false, SCOPE_TYPE: 'PROJECT', SCOPE_ID: 23330 },
];

const ISSUES: FeedIssueRow[] = [
  // ---- initiatives -------------------------------------------------------
  {
    ISSUE_ID: 18107597,
    ISSUE_KEY: 'DDTGMPORT-1',
    ISSUE_TYPE_ID: 10269,
    ISSUE_TYPE_NAME: 'Initiative',
    ISSUE_STATUS_NAME: 'Execute',
    SUMMARY: 'MES',
    DESCRIPTION: 'Manufacturing Execution System rollout across global manufacturing sites.',
    PROJECT_KEY: 'DDTGMPORT',
    CURRENT_ASSIGNEE_NAME: 'Alexander Fritz',
    CREATED: '2026-04-03T08:08:35Z',
    UPDATED: '2026-08-07T05:02:16Z',
    DUE_DATE: '2029-03-31',
    Start_date_10412: '2024-10-01',
    // The "Asset ID" anomaly: the column renders under that label but holds a RAG.
    Asset_ID_11199: 'Amber',
  },
  {
    ISSUE_ID: 18107598,
    ISSUE_KEY: 'DDTGMPORT-2',
    ISSUE_TYPE_ID: 10269,
    ISSUE_TYPE_NAME: 'Initiative',
    ISSUE_STATUS_NAME: 'Done',
    SUMMARY: 'Legacy label printing retirement',
    PROJECT_KEY: 'DDTGMPORT',
    CREATED: '2024-01-15T09:00:00Z',
    UPDATED: '2026-02-11T10:31:00Z',
    Start_date_10412: '2024-02-01',
    DUE_DATE: '2026-02-01',
  },
  {
    ISSUE_ID: 18107599,
    ISSUE_KEY: 'DDTGMPORT-3',
    ISSUE_TYPE_ID: 10269,
    ISSUE_TYPE_NAME: 'Initiative',
    // Both spellings of the held status exist in the source; this is the shouted one.
    ISSUE_STATUS_NAME: 'ON HOLD',
    SUMMARY: 'Paperless batch record phase 2',
    PROJECT_KEY: 'DDTGMPORT',
    CREATED: '2025-06-02T09:00:00Z',
    UPDATED: '2026-07-30T14:12:00Z',
    Start_date_10412: '2026-01-05',
    DUE_DATE: '2027-06-30',
    // Authored Green on a held programme. The hold floor must still pull it to
    // `monitor` -- the precise false reassurance the floor exists to prevent.
    Asset_ID_11199: 'Green',
  },

  // ---- roadmap items -----------------------------------------------------
  {
    ISSUE_ID: 16688120,
    ISSUE_KEY: 'DDTGC-1',
    ISSUE_TYPE_ID: 18380,
    ISSUE_TYPE_NAME: 'Epic',
    ISSUE_STATUS_NAME: 'Execute',
    SUMMARY: '[FY26] MES Wave 1 (GRA)',
    DESCRIPTION: 'Wave 1 of the MES rollout at Grange Castle.',
    PROJECT_KEY: 'DDTGC',
    CURRENT_ASSIGNEE_NAME: 'Aoife Byrne',
    CREATED: '2025-01-08T09:15:28Z',
    UPDATED: '2026-08-05T11:02:00Z',
    DUE_DATE: '2026-11-30',
    Start_date_10412: '2025-02-03',
    // Grange Castle's per-site SPOT fields: RAG 24262, description 24261, ID 18795.
    Overall_Status_24262: 'Amber',
    SPOT_Description_24261: FIXTURE_SPOT_WIKI,
    SPOT_ID_18795: '8260112',
  },
  {
    ISSUE_ID: 16688121,
    ISSUE_KEY: 'DDTGC-2',
    ISSUE_TYPE_ID: 18380,
    ISSUE_TYPE_NAME: 'Epic',
    ISSUE_STATUS_NAME: 'Define',
    SUMMARY: 'Serialisation line 4 go-live',
    PROJECT_KEY: 'DDTGC',
    CREATED: '2025-09-01T09:00:00Z',
    UPDATED: '2026-07-20T08:00:00Z',
    // Go-live with no start: renders as a milestone marker, not a span.
    DUE_DATE: '2027-01-29',
    Overall_Status_24262: 'Green',
  },
  {
    ISSUE_ID: 16688200,
    ISSUE_KEY: 'DDTMBO-1',
    ISSUE_TYPE_ID: 18380,
    ISSUE_TYPE_NAME: 'Epic',
    // Abandoned work. Must never present as delivered, whatever the RAG says.
    ISSUE_STATUS_NAME: 'Discarded',
    SUMMARY: 'Label printing decommission (LEX)',
    PROJECT_KEY: 'DDTMBO',
    CREATED: '2024-03-01T09:00:00Z',
    UPDATED: '2026-01-09T09:00:00Z',
    Start_date_10412: '2024-04-01',
    DUE_DATE: '2025-12-31',
    Overall_Status_24270: 'Green',
  },
  {
    ISSUE_ID: 16688300,
    ISSUE_KEY: 'DDTYAR-1',
    ISSUE_TYPE_ID: 18380,
    ISSUE_TYPE_NAME: 'Epic',
    ISSUE_STATUS_NAME: 'In Progress',
    SUMMARY: 'Warehouse scanning refresh',
    PROJECT_KEY: 'DDTYAR',
    CREATED: '2025-04-01T09:00:00Z',
    UPDATED: '2026-08-01T09:00:00Z',
    Start_date_10412: '2025-05-01',
    DUE_DATE: '2026-12-15',
    // Yaroslavl has a RAG field only -- no SPOT description or ID on any item.
    Overall_Status_25432: 'Green',
  },
  {
    ISSUE_ID: 16688301,
    ISSUE_KEY: 'DDTYAR-2',
    ISSUE_TYPE_ID: 18380,
    ISSUE_TYPE_NAME: 'Epic',
    ISSUE_STATUS_NAME: 'Assessment',
    SUMMARY: 'QC instrument integration',
    PROJECT_KEY: 'DDTYAR',
    CREATED: '2026-02-01T09:00:00Z',
    UPDATED: '2026-06-01T09:00:00Z',
    Start_date_10412: '2026-09-01',
    DUE_DATE: '2027-09-30',
  },
  {
    ISSUE_ID: 16688350,
    ISSUE_KEY: 'DDTLNZ-1',
    ISSUE_TYPE_ID: 18380,
    ISSUE_TYPE_NAME: 'Epic',
    // Held work with an authored Green and a future go-live. Without the hold floor
    // this derives as ON TRACK, which is the exact false reassurance the phase exists
    // to prevent -- so it is the case that proves the rule survived the source change.
    ISSUE_STATUS_NAME: 'Hold',
    SUMMARY: 'Batch record digitisation phase 2 (LIN)',
    PROJECT_KEY: 'DDTLNZ',
    CREATED: '2025-11-01T09:00:00Z',
    UPDATED: '2026-08-04T09:00:00Z',
    Start_date_10412: '2026-03-01',
    DUE_DATE: '2027-03-31',
    Overall_Status_24246: 'Green',
  },
  {
    ISSUE_ID: 16688400,
    ISSUE_KEY: 'DDTSG-1',
    ISSUE_TYPE_ID: 18380,
    ISSUE_TYPE_NAME: 'Epic',
    ISSUE_STATUS_NAME: 'Open',
    SUMMARY: 'Digital logbook evaluation',
    PROJECT_KEY: 'DDTSG',
    CREATED: '2026-05-01T09:00:00Z',
    UPDATED: '2026-05-02T09:00:00Z',
    // Neither date. Plottable nowhere; belongs in "No dates reported".
    Overall_Status_24266: 'Green',
  },

  // ---- duplicate ---------------------------------------------------------
  {
    ISSUE_ID: 16688500,
    ISSUE_KEY: 'DDTBP-1',
    ISSUE_TYPE_ID: 18380,
    ISSUE_TYPE_NAME: 'Epic',
    ISSUE_STATUS_NAME: 'Execute',
    SUMMARY: 'Cleanroom monitoring upgrade',
    PROJECT_KEY: 'DDTBP',
    UPDATED: '2026-07-01T09:00:00Z',
    Start_date_10412: '2026-01-01',
    DUE_DATE: '2026-10-01',
  },
  {
    // Same key, later export position, different summary. First wins; both reported.
    ISSUE_ID: 16688500,
    ISSUE_KEY: 'DDTBP-1',
    ISSUE_TYPE_ID: 18380,
    ISSUE_TYPE_NAME: 'Epic',
    ISSUE_STATUS_NAME: 'Execute',
    SUMMARY: 'Cleanroom monitoring upgrade (duplicate export row)',
    PROJECT_KEY: 'DDTBP',
    UPDATED: '2026-07-01T09:00:00Z',
  },

  // ---- out of scope ------------------------------------------------------
  {
    ISSUE_ID: 16688600,
    ISSUE_KEY: 'DDTLA-1',
    ISSUE_TYPE_ID: 18380,
    ISSUE_TYPE_NAME: 'Epic',
    ISSUE_STATUS_NAME: 'Execute',
    SUMMARY: 'Los Angeles work, deferred from MVP scope',
    PROJECT_KEY: 'DDTLA',
    UPDATED: '2026-07-01T09:00:00Z',
  },
  {
    ISSUE_ID: 16688700,
    ISSUE_KEY: 'DDTZZZ-1',
    ISSUE_TYPE_ID: 18380,
    ISSUE_TYPE_NAME: 'Epic',
    ISSUE_STATUS_NAME: 'Execute',
    SUMMARY: 'A project nobody has registered',
    PROJECT_KEY: 'DDTZZZ',
    UPDATED: '2026-07-01T09:00:00Z',
  },

  // ---- invalid -----------------------------------------------------------
  {
    ISSUE_ID: 16688800,
    ISSUE_KEY: 'DDTGC-9',
    ISSUE_TYPE_ID: 18380,
    ISSUE_TYPE_NAME: 'Epic',
    // No mapping, and no status category to fall back to. Skipped, not guessed.
    ISSUE_STATUS_NAME: 'Awaiting Steerco',
    SUMMARY: 'Status the map has never seen',
    PROJECT_KEY: 'DDTGC',
    UPDATED: '2026-07-01T09:00:00Z',
  },
  {
    ISSUE_ID: 16688900,
    ISSUE_KEY: 'DDTGC-8',
    // Not in the captured registry: hierarchy level unknown, so selection is unsafe.
    ISSUE_TYPE_ID: 22801,
    ISSUE_TYPE_NAME: 'Digital Project',
    ISSUE_STATUS_NAME: 'Execute',
    SUMMARY: 'A project-local issue type not yet captured',
    PROJECT_KEY: 'DDTGC',
    UPDATED: '2026-07-01T09:00:00Z',
  },

  // ---- operational detail, correctly dropped -----------------------------
  {
    ISSUE_ID: 17026734,
    ISSUE_KEY: 'NEUCHDDT-1',
    ISSUE_TYPE_ID: 14269,
    ISSUE_TYPE_NAME: 'Story',
    ISSUE_STATUS_NAME: 'Done',
    SUMMARY: 'Operational detail below the roadmap grain',
    PROJECT_KEY: 'NEUCHDDT',
    UPDATED: '2026-06-18T08:55:52Z',
  },
];

const ISSUE_LINKS: FeedIssueLinkRow[] = [
  // Alignment. Direction is not consistently curated, so both are represented --
  // matching must be undirected or roughly half of these would be lost.
  {
    ISSUE_ID: 16688120,
    ISSUE_KEY: 'DDTGC-1',
    TYPE: 'Polaris work item link',
    DIRECTION: 'Outward',
    LINKED_ISSUE_ID: 18107597,
    LINKED_ISSUE_KEY: 'DDTGMPORT-1',
  },
  {
    ISSUE_ID: 16688300,
    ISSUE_KEY: 'DDTYAR-1',
    TYPE: 'Relates',
    DIRECTION: 'Outward',
    LINKED_ISSUE_ID: 16688301,
    LINKED_ISSUE_KEY: 'DDTYAR-2',
  },
  {
    ISSUE_ID: 16688200,
    ISSUE_KEY: 'DDTMBO-1',
    TYPE: 'Polaris work item link',
    DIRECTION: 'Inward',
    LINKED_ISSUE_ID: 18107598,
    LINKED_ISSUE_KEY: 'DDTGMPORT-2',
  },
  {
    ISSUE_ID: 16688350,
    ISSUE_KEY: 'DDTLNZ-1',
    TYPE: 'Polaris work item link',
    DIRECTION: 'Outward',
    LINKED_ISSUE_ID: 18107599,
    LINKED_ISSUE_KEY: 'DDTGMPORT-3',
  },
  // A counterpart outside the export's scope. Must be REJECTED for alignment rather
  // than pre-filtered away -- the two look identical downstream but mean different
  // things, and only one of them is correct.
  {
    ISSUE_ID: 16688121,
    ISSUE_KEY: 'DDTGC-2',
    TYPE: 'Polaris work item link',
    DIRECTION: 'Outward',
    LINKED_ISSUE_ID: 99999999,
    LINKED_ISSUE_KEY: 'LESOPS-77',
  },
  // A blocker. While BLOCKS_DIRECTION_MEANING is unresolved this must attribute
  // nothing at all rather than attribute it backwards.
  {
    ISSUE_ID: 16688400,
    ISSUE_KEY: 'DDTSG-1',
    TYPE: 'Blocks',
    DIRECTION: 'Inward',
    LINKED_ISSUE_ID: 16688120,
    LINKED_ISSUE_KEY: 'DDTGC-1',
  },
  // Exact repeat of the first row: the per-ordered-pair export duplicating itself.
  {
    ISSUE_ID: 16688120,
    ISSUE_KEY: 'DDTGC-1',
    TYPE: 'Polaris work item link',
    DIRECTION: 'Outward',
    LINKED_ISSUE_ID: 18107597,
    LINKED_ISSUE_KEY: 'DDTGMPORT-1',
  },
];

const LABELS: FeedLabelRow[] = [
  { ISSUE_KEY: 'DDTGC-2', LABEL: 'FY27' },
  { ISSUE_KEY: 'DDTGC-2', LABEL: 'serialisation' },
];

const BUSINESS_OWNERS: FeedOwnerRow[] = [
  { ISSUE_KEY: 'DDTGC-1', USER_NAME: 'Sean Murphy', USER_ACCOUNT_ID: '5f1a' },
  { ISSUE_KEY: 'DDTGC-1', USER_NAME: 'Marta Kowalska', USER_ACCOUNT_ID: '5f1b' },
];

const APPLICATION_OWNERS: FeedOwnerRow[] = [
  { ISSUE_KEY: 'DDTGC-1', USER_NAME: 'Priya Raman', USER_ACCOUNT_ID: '5f1c' },
];

/** One complete, representative read of Feed #3. */
export const FEED3_FIXTURE: Feed3Payload = {
  metadata: {
    name: 'Feed #3',
    retrievedAt: '2026-08-08T06:15:00.000Z',
    // Token segment already redacted by the caller. A credential must never reach here.
    origin: 'https://powerbi-cloud-prod.alphaservesp.com/api/export/power-bi/<redacted>/',
    rowCounts: { Issues: ISSUES.length, IssueLinks: ISSUE_LINKS.length, Labels: LABELS.length },
  },
  issues: ISSUES,
  issueTypes: ISSUE_TYPES,
  issueLinks: ISSUE_LINKS,
  labels: LABELS,
  owners: {
    Business_Owner_10489: BUSINESS_OWNERS,
    Business_Application_Owner_11209: APPLICATION_OWNERS,
  },
};

/** The `asOf` the fixture's dates were authored against. Keeps risk assertions stable. */
export const FEED3_FIXTURE_AS_OF = '2026-08-08';
