/**
 * One complete read of Feed #3: entity sets in, `Feed3Payload` out.
 *
 * This is the join between transport and translation. `odata-client.ts` knows HTTP and
 * nothing about Jira; the WP4 adapter knows records and nothing about HTTP. This module
 * is the only place that knows which entity sets matter, and it learns their NAMES from
 * the service document rather than assuming them.
 *
 * WHY DISCOVERY RATHER THAN ASSUMPTION. The three Alpha Serve sources sit on one host
 * and differ only by export token, so a URL cannot tell you which one you reached. They
 * expose 4, 13 and 11 entity sets respectively. Reading a hard-coded list of names
 * against the wrong source produces a stream of 404s; reading the service document first
 * produces an accurate statement of what is actually there. The cost is one request.
 *
 * DEGRADE PER CAPABILITY, NEVER PER PORTFOLIO. Only `Issues` is required, because
 * without it there is no portfolio to serve. Every other entity set maps to a specific,
 * named capability -- links to alignment, labels to the `FY\d{2}` fallback, the owner
 * side tables to owner resolution -- and an absent one costs exactly that capability and
 * says so. A missing side table must never mean an empty dashboard.
 *
 * NOTHING IS NORMALISED HERE. Rows are handed to the adapter as they arrive. Every
 * decision about a value -- dates, statuses, hierarchy level, custom-field columns --
 * belongs to `normalise.ts`, and duplicating any of it here would create a second place
 * for the two paths to disagree.
 */

import { FEED_ENTITY_SETS, FEED_NAME, FEED_OWNER_SIDE_TABLES } from '@config/feed.js';

import type {
  Feed3Payload,
  FeedIssueLinkRow,
  FeedIssueRow,
  FeedIssueTypeRow,
  FeedLabelRow,
  FeedOwnerRow,
} from './dto.js';
import type { ODataClient } from './odata-client.js';
import { diagnostic, type Diagnostic } from './outcomes.js';

// ---------------------------------------------------------------------------
// Expected shape -- the "feed reconfigured without notice" guard
// ---------------------------------------------------------------------------

/**
 * Entity sets Feed #3 carried when it was surveyed, 2026-08-07.
 *
 * WHY THIS IS CHECKED AT RUNTIME. Project and field selection are Alpha Serve connector
 * SETTINGS, and E6 is open: there is no named data owner and no change-notification
 * path, so a reconfiguration arrives as a change in the data rather than as a message.
 * ADR-001 lists this as a live risk and asks for an entity-set presence check in the
 * client. This is that check.
 *
 * It is a WARNING, not a failure. The feed changing shape is a fact to report, and the
 * adapter degrades per capability, so a reshaped feed still renders. Failing the run
 * would turn a reportable change into an outage.
 */
const EXPECTED_ENTITY_SETS: readonly string[] = [
  'Issues',
  'IssueTypes',
  'IssueLinks',
  'Labels',
  'Projects',
  'Business_Owner_10489',
  'Business_Application_Owner_11209',
] as const;

/**
 * Entity sets whose ABSENCE from Feed #3 is load-bearing for the adapter's behaviour.
 *
 * `IssueStatuses` is the one that matters. Its absence is why `normaliseFeedStatus`
 * derives the status category from the canonical phase and treats an unmapped status
 * name as fatal (config/feed.ts, design-001 §3). If the feed owner grants ask #1 and
 * adds it, that reasoning is stale and the asymmetry with the REST path should be
 * revisited -- so its APPEARANCE is reported, not silently ignored.
 */
const EXPECTED_ABSENT_ENTITY_SETS: readonly string[] = ['IssueStatuses'] as const;

/** `Issues` column count when surveyed. A material change means a reconfigured export. */
const EXPECTED_ISSUE_COLUMN_COUNT = 119;

/** Tolerance before a column-count change is worth a warning. */
const COLUMN_COUNT_TOLERANCE = 5;

// ---------------------------------------------------------------------------
// Result
// ---------------------------------------------------------------------------

export interface Feed3Read {
  payload: Feed3Payload;
  /** Findings about the READ -- absent entity sets, shape drift. Not about the records. */
  diagnostics: readonly Diagnostic[];
  /** Entity sets the service advertised, verbatim. */
  entitySets: readonly string[];
  /** Every distinct `Issues` column seen, for the census in the validation report. */
  issueColumns: readonly string[];
}

export interface ReadFeed3Options {
  /** Reports progress so a multi-page pull is not a silent wait. */
  onProgress?: (message: string) => void;
}

// ---------------------------------------------------------------------------
// Row handling
// ---------------------------------------------------------------------------

/**
 * OData response annotations are metadata about the payload, not columns of it.
 *
 * Stripped because `mapCustomFieldColumns` walks every key on the row, and the census in
 * the validation report counts them. Neither would be wrong with annotations present --
 * no annotation matches the custom-field suffix pattern -- but "119 columns" should mean
 * 119 columns of data.
 */
function stripAnnotations(row: Record<string, unknown>): Record<string, unknown> {
  let hasAnnotation = false;
  for (const key in row) {
    if (key.startsWith('@')) {
      hasAnnotation = true;
      break;
    }
  }
  if (!hasAnnotation) return row;

  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(row)) {
    if (!key.startsWith('@')) out[key] = value;
  }
  return out;
}

/**
 * Presents raw rows as DTOs.
 *
 * A CAST IS CORRECT HERE, and it is not laziness. The DTOs are deliberately open --
 * `[column: string]: unknown` with every field optional except the one that identifies a
 * row -- precisely so that an unmodelled or absent column is data to be carried rather
 * than a parse failure. Validating here would duplicate the adapter's job and, worse,
 * would have to decide what to do with a bad row at a layer that cannot report it: the
 * adapter raises `unsupported-value` for a row with no `ISSUE_KEY` and keeps going,
 * whereas a filter here would drop it silently.
 */
function asRows<T>(rows: readonly Record<string, unknown>[]): T[] {
  return rows.map(stripAnnotations) as T[];
}

function columnsOf(rows: readonly Record<string, unknown>[]): string[] {
  const seen = new Set<string>();
  for (const row of rows) {
    for (const key in row) {
      if (!key.startsWith('@')) seen.add(key);
    }
  }
  return [...seen];
}

// ---------------------------------------------------------------------------
// Shape inspection
// ---------------------------------------------------------------------------

/**
 * Compares the connected feed against the surveyed Feed #3 and reports every divergence.
 *
 * Runs before any interpretation of the records, because "you are not talking to the
 * feed you think you are talking to" explains every downstream symptom at once and is
 * cheap to state. Reaching Feed #1 with a Feed #3 configuration, for instance, yields
 * four entity sets and 69 columns -- and without this check it would present as an
 * unexplained collapse in item counts.
 */
export function inspectFeedShape(
  entitySets: readonly string[],
  issueColumns: readonly string[],
  feedLabel: string,
): Diagnostic[] {
  const diagnostics: Diagnostic[] = [];
  const present = new Set(entitySets);

  const missing = EXPECTED_ENTITY_SETS.filter((name) => !present.has(name));
  if (missing.length > 0) {
    diagnostics.push(
      diagnostic(
        'warning',
        'missing-entity-set',
        missing.join(', '),
        `${feedLabel} advertises ${entitySets.length} entity sets and does not include ` +
          `${missing.join(', ')}, which ${missing.length === 1 ? 'was' : 'were'} present when the ` +
          `feed was surveyed on 2026-08-07. Either the export was reconfigured or this URL points ` +
          `at a different data source.`,
        'Confirm the export configuration with the feed owner, and that ODATA_FEED_URL is the intended source.',
      ),
    );
  }

  for (const name of EXPECTED_ABSENT_ENTITY_SETS) {
    if (!present.has(name)) continue;
    diagnostics.push(
      diagnostic(
        'warning',
        'missing-entity-set',
        name,
        `${feedLabel} now exports ${name}, which it did not when surveyed. The adapter DERIVES the ` +
          `status category from the canonical phase precisely because this entity set was absent, ` +
          `and treats an unmapped status name as fatal for the same reason. A real status category ` +
          `is now available and is being ignored.`,
        'Revisit STATUS_CATEGORY_KEYS and UNMAPPED_STATUS_IS_FATAL in config/feed.ts; see design-001 §3.',
      ),
    );
  }

  // A restored capability is as much a reconfiguration as a lost one, and this one is an
  // outstanding ask of the feed owner -- so it must not sit unnoticed behind a
  // FEED_KNOWN_LOSSES entry that has become untrue.
  const parentColumns = issueColumns.filter((column) => column.startsWith('PARENT_ISSUE_'));
  if (parentColumns.length > 0) {
    diagnostics.push(
      diagnostic(
        'warning',
        'known-loss',
        'PARENT_ISSUE_*',
        `${feedLabel} now exports ${parentColumns.length} PARENT_ISSUE_* column(s), so childCount is ` +
          `no longer unavailable. The adapter still reports {0,0} for every item and FEED_KNOWN_LOSSES ` +
          `still declares this a permanent loss.`,
        'Remove the childCount entry from FEED_KNOWN_LOSSES and map parent in the adapter.',
      ),
    );
  }

  if (
    issueColumns.length > 0 &&
    Math.abs(issueColumns.length - EXPECTED_ISSUE_COLUMN_COUNT) > COLUMN_COUNT_TOLERANCE
  ) {
    diagnostics.push(
      diagnostic(
        'warning',
        'missing-entity-set',
        'Issues (column census)',
        `Issues returned ${issueColumns.length} columns; ${EXPECTED_ISSUE_COLUMN_COUNT} were present ` +
          `when the feed was surveyed. Field selection is a connector setting, so a change of this ` +
          `size means the export was reconfigured -- which can silently remove a per-site SPOT field.`,
        'Compare the column census in the validation report against config/fields.ts.',
      ),
    );
  }

  return diagnostics;
}

// ---------------------------------------------------------------------------
// The read
// ---------------------------------------------------------------------------

/**
 * Reads every entity set the adapter consumes and assembles one payload.
 *
 * SEQUENTIAL, NOT CONCURRENT. Six entity sets could be pulled in parallel, and are not:
 * this is an undocumented third-party export with no published rate limit, no named
 * owner to ask about one, and an entitlement question still open (E4). One request at a
 * time is the polite shape for a read against someone else's system, and the whole pull
 * is a few thousand rows -- the wall-clock saving would be seconds, against a risk of
 * being throttled or noticed as abusive.
 *
 * NO FILTERING, DELIBERATELY. Everything the feed returns is passed through. The adapter
 * may not pre-filter to hierarchy levels 1-2 (level-0 rows supply link counterpart
 * status) and may not scope links to in-scope projects (alignment works by SEEING an
 * out-of-scope counterpart and rejecting it). Filtering here would defeat both, and the
 * same observable output would then have an entirely wrong cause.
 */
export async function readFeed3(
  client: ODataClient,
  options: ReadFeed3Options = {},
): Promise<Feed3Read> {
  const report = options.onProgress ?? ((): void => {});
  const diagnostics: Diagnostic[] = [];
  const rowCounts: Record<string, number> = {};

  const entitySets = await client.listEntitySets();
  const present = new Set(entitySets);
  report(`${entitySets.length} entity sets advertised: ${entitySets.join(', ')}`);

  /** Reads a set if the service advertises it; reports the absence otherwise. */
  async function readIfPresent(
    name: string,
    capabilityLost: string,
    remedy: string,
  ): Promise<Record<string, unknown>[] | undefined> {
    if (!present.has(name)) {
      diagnostics.push(
        diagnostic('warning', 'missing-entity-set', name, `${name} is not exported, so ${capabilityLost}`, remedy),
      );
      return undefined;
    }

    const rows = await client.readEntitySet(name);
    rowCounts[name] = rows.length;
    report(`  ${name}: ${rows.length} rows`);
    return rows;
  }

  // --- Issues: the only entity set without which there is nothing to serve ---
  if (!present.has(FEED_ENTITY_SETS.issues)) {
    throw new Error(
      `The feed does not export ${FEED_ENTITY_SETS.issues}, so there is no portfolio to read. ` +
        `It advertises: ${entitySets.join(', ') || '(nothing)'}. ` +
        `Confirm ODATA_FEED_URL points at the intended data source.`,
    );
  }

  const issueRows = await client.readEntitySet(FEED_ENTITY_SETS.issues);
  rowCounts[FEED_ENTITY_SETS.issues] = issueRows.length;
  report(`  ${FEED_ENTITY_SETS.issues}: ${issueRows.length} rows`);

  const issueColumns = columnsOf(issueRows);

  // --- Shape guard, before anything is interpreted ---
  diagnostics.push(...inspectFeedShape(entitySets, issueColumns, client.feedLabel));

  // --- Side tables, each losing one named capability if absent ---
  const issueTypeRows = await readIfPresent(
    FEED_ENTITY_SETS.issueTypes,
    'an unregistered issue type cannot be reported with its name and scope, which is exactly the ' +
      'information needed to extend ISSUE_TYPE_LEVELS.',
    'Confirm the IssueTypes entity set is included in the export.',
  );

  const issueLinkRows = await readIfPresent(
    FEED_ENTITY_SETS.issueLinks,
    'no item can be aligned to an initiative and every item will be classified site-led -- ' +
      'indistinguishable on screen from a portfolio genuinely running no global programmes.',
    'Confirm the IssueLinks entity set is included in the export.',
  );

  const labelRows = await readIfPresent(
    FEED_ENTITY_SETS.labels,
    'the FY-label fallback for fiscal year is unavailable. Dates still resolve, so this degrades ' +
      'fiscal-year attribution for items that carry no start or go-live date.',
    'Confirm the Labels entity set is included in the export.',
  );

  // Owner side tables. Each declared table is probed individually against the
  // advertised list -- never inferred from the naming pattern the two happen to share,
  // because a pattern that looks regular is exactly how a table gets silently skipped.
  const owners: Record<string, FeedOwnerRow[]> = {};
  for (const table of FEED_OWNER_SIDE_TABLES) {
    const rows = await readIfPresent(
      table.entitySet,
      `owner resolution cannot read ${table.fieldId}. Owners fall back to the remaining ` +
        `candidates in OWNER_FIELD_CANDIDATES.`,
      `Confirm the ${table.entitySet} entity set is included in the export.`,
    );
    if (rows) owners[table.entitySet] = asRows<FeedOwnerRow>(rows);
  }

  const payload: Feed3Payload = {
    metadata: {
      name: client.feedLabel,
      // When the feed was READ. Not how current the data is: Feed #3 is same-day rather
      // than live, and the UI derives data age from the newest item update instead.
      retrievedAt: new Date().toISOString(),
      origin: client.origin,
      rowCounts,
    },
    issues: asRows<FeedIssueRow>(issueRows),
    ...(issueTypeRows ? { issueTypes: asRows<FeedIssueTypeRow>(issueTypeRows) } : {}),
    ...(issueLinkRows ? { issueLinks: asRows<FeedIssueLinkRow>(issueLinkRows) } : {}),
    ...(labelRows ? { labels: asRows<FeedLabelRow>(labelRows) } : {}),
    ...(Object.keys(owners).length > 0 ? { owners } : {}),
  };

  return { payload, diagnostics, entitySets, issueColumns };
}

/** Feed identity for callers that need it before a read. */
export const DEFAULT_FEED_LABEL = FEED_NAME;
