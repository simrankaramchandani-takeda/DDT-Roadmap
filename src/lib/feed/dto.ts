/**
 * Feed #3 record shapes -- what arrives, before anything is decided about it.
 *
 * These are DTOs in the strict sense: they describe the wire format and nothing else.
 * No defaults, no derived values, no domain vocabulary. Everything optional except the
 * two columns that identify a row, because a feed is entitled to omit a column and the
 * adapter is not entitled to crash when it does.
 *
 * COLUMNS ARE OPEN. `Issues` carries 119 columns of which the adapter models about
 * fifteen by name; the rest are custom-field columns resolved generically by suffix
 * (see config/feed.ts). Hence the index signature: an unmodelled column is data to be
 * carried, not an error.
 *
 * VALUES ARE LOOSELY TYPED ON PURPOSE. `ISSUE_ID` is a JSON number in the probe
 * captures but arrives as a string through some OData clients, and a date column is a
 * string, `null`, or absent. Widening here is honest; narrowing would push a parse
 * failure into whichever call site happened to read the column first.
 */

/** A row from the `Issues` entity set. */
export interface FeedIssueRow {
  ISSUE_ID?: number | string | null;
  /** The only genuinely required column: without it a row cannot be identified. */
  ISSUE_KEY: string;

  ISSUE_TYPE_ID?: number | string | null;
  ISSUE_TYPE_NAME?: string | null;
  ISSUE_STATUS_ID?: number | string | null;
  ISSUE_STATUS_NAME?: string | null;

  SUMMARY?: string | null;
  DESCRIPTION?: string | null;

  PROJECT_ID?: number | string | null;
  PROJECT_KEY?: string | null;

  CURRENT_ASSIGNEE_NAME?: string | null;
  CURRENT_ASSIGNEE_ACCOUNT_ID?: string | null;

  CREATED?: string | null;
  UPDATED?: string | null;
  DUE_DATE?: string | null;
  RESOLUTION_DATE?: string | null;

  /** Custom-field and unmodelled system columns. */
  [column: string]: unknown;
}

/**
 * A row from `IssueTypes`.
 *
 * Carries no hierarchy level -- no OData feed does. `SCOPE_TYPE`/`SCOPE_ID` are
 * reported in the unknown-type diagnostic so a project-local type is immediately
 * identifiable by whoever has to extend the registry.
 */
export interface FeedIssueTypeRow {
  ISSUE_TYPE_ID?: number | string | null;
  ISSUE_TYPE_NAME?: string | null;
  IS_SUBTASK?: boolean | null;
  SCOPE_TYPE?: string | null;
  SCOPE_ID?: number | string | null;
  [column: string]: unknown;
}

/**
 * A row from `IssueLinks`.
 *
 * ONE ROW PER ORDERED PAIR: a link is exported once from each endpoint inside the
 * export's scope, so an in-scope<->in-scope link yields two rows and an
 * in-scope<->out-of-scope link yields one. Grouping by `ISSUE_KEY` makes the
 * duplication irrelevant -- each issue sees only its own rows.
 */
export interface FeedIssueLinkRow {
  ISSUE_ID?: number | string | null;
  ISSUE_KEY: string;
  ISSUE_CREATED?: string | null;
  /** e.g. `Polaris work item link`, `Blocks`, `Cloners`. */
  TYPE?: string | null;
  /** `Inward` | `Outward`. See BLOCKS_DIRECTION_MEANING before trusting it. */
  DIRECTION?: string | null;
  LINKED_ISSUE_ID?: number | string | null;
  LINKED_ISSUE_KEY?: string | null;
  [column: string]: unknown;
}

/** A row from `Labels`. The value column name is unverified; see FEED_LABEL_VALUE_COLUMNS. */
export interface FeedLabelRow {
  ISSUE_KEY: string;
  [column: string]: unknown;
}

/** A row from one of the multi-user owner side tables. */
export interface FeedOwnerRow {
  ISSUE_KEY: string;
  USER_NAME?: string | null;
  USER_ACCOUNT_ID?: string | null;
  [column: string]: unknown;
}

/**
 * What the feed says about itself.
 *
 * NO CREDENTIAL EVER LANDS HERE. `origin` is the service document URL with its token
 * segment already removed by the caller -- it exists so a snapshot can state where its
 * data came from, which is the same honesty requirement the fixture chip serves.
 */
export interface FeedServiceMetadata {
  /** Display identity, e.g. `Feed #3`. */
  name: string;
  /** When the feed was read, full ISO timestamp. */
  retrievedAt: string;
  /** Redacted service URL, for the audit trail. */
  origin?: string;
  /** Rows returned per entity set. Reported in diagnostics, never load-bearing. */
  rowCounts?: Readonly<Record<string, number>>;
}

/**
 * One complete read of the feed.
 *
 * Only `issues` is required. A missing side table degrades a specific, named capability
 * (no links means no alignment; no labels means no `FY\d{2}` fallback) and the adapter
 * says so rather than producing a quietly thinner snapshot.
 */
export interface Feed3Payload {
  metadata: FeedServiceMetadata;
  issues: readonly FeedIssueRow[];
  issueTypes?: readonly FeedIssueTypeRow[];
  issueLinks?: readonly FeedIssueLinkRow[];
  labels?: readonly FeedLabelRow[];
  /** Keyed by entity-set name, matching FEED_OWNER_SIDE_TABLES. */
  owners?: Readonly<Record<string, readonly FeedOwnerRow[]>>;
}
