/**
 * Every decision the feed layer makes about a raw value, in one file.
 *
 * WHY CENTRALISED. Each of these rules is a place where a plausible guess produces
 * confidently wrong executive output: a status filed as in-flight because its name was
 * unrecognised, a site silently dropped because its key had trailing whitespace, a
 * column mapped to the wrong custom field because two columns claimed the same ID.
 * Scattered across the adapter they would each be re-decided at the next call site.
 * Here they are decided once, tested once, and every one of them reports rather than
 * guesses.
 *
 * WHAT THIS FILE DOES NOT DO. It does not assess risk, resolve regions or compute
 * coverage. Those are the existing, tested rules in `risk.ts`, `config/regions.ts` and
 * `rollup.ts`, and the feed path reaches the canonical model by REUSING them, not by
 * reimplementing them against a different input. That reuse is what makes "no business
 * rule changes" a structural fact rather than a review promise.
 */

import {
  CUSTOM_FIELD_COLUMN_PATTERN,
  FEED_LABEL_VALUE_COLUMNS,
  ISSUE_TYPE_LEVELS,
  ISSUE_TYPE_LEVELS_ARE_COMPLETE,
  NON_CUSTOM_FIELD_COLUMNS,
  SITE_KEY_ALIASES,
  STATUS_CATEGORY_KEYS,
} from '@config/feed.js';
import { PHASE_TO_CATEGORY, STATUS_NAME_TO_PHASE } from '@config/status-map.js';
import {
  ALL_PROJECT_KEYS,
  DEFERRED_SITES,
  EXCLUDED_PROJECTS,
  PORTFOLIO_KEYS,
  resolveSite,
  type ResolvedSite,
} from '@config/projects.js';
import { stripStatusSuffix } from '@/lib/normalise.js';
import type { ItemStatus } from '@/types/domain.js';

import type { FeedIssueRow, FeedLabelRow, FeedServiceMetadata } from './dto.js';
import { diagnostic, error, valid, warning, type Outcome } from './outcomes.js';

// ---------------------------------------------------------------------------
// Scalars and dates
// ---------------------------------------------------------------------------

/** A feed cell as a trimmed string, or undefined for null/empty/non-scalar. */
export function feedText(raw: unknown): string | undefined {
  if (raw == null) return undefined;
  if (typeof raw === 'string') return raw.trim() || undefined;
  if (typeof raw === 'number' || typeof raw === 'boolean') return String(raw);
  return undefined;
}

/**
 * A date column as `YYYY-MM-DD`.
 *
 * The feed mixes date-only columns (`DUE_DATE: '2029-03-31'`) with full timestamps
 * (`UPDATED: '2026-08-07T05:02:16Z'`), and the domain model is date-only throughout
 * because Jira's date fields carry no meaningful timezone. Truncating rather than
 * parsing is deliberate: constructing a `Date` here would reintroduce the local-time
 * shift that turns a 1 April go-live into 31 March for anyone west of UTC.
 */
export function parseFeedDate(raw: unknown): string | undefined {
  const value = feedText(raw);
  if (!value) return undefined;
  const match = /^(\d{4}-\d{2}-\d{2})/.exec(value);
  return match ? match[1] : undefined;
}

/**
 * A timestamp column, preserved at full precision.
 *
 * `updatedAt` drives staleness, so the time of day is not noise. Anything that is not
 * recognisably a timestamp is rejected rather than coerced -- an unparseable value
 * silently becoming "now" would make a stale item look fresh.
 */
export function parseFeedTimestamp(raw: unknown): string | undefined {
  const value = feedText(raw);
  if (!value) return undefined;
  if (!/^\d{4}-\d{2}-\d{2}([T ]\d{2}:\d{2}(:\d{2})?)?/.test(value)) return undefined;
  return value;
}

// ---------------------------------------------------------------------------
// Status and phase
// ---------------------------------------------------------------------------

export interface FeedStatus extends ItemStatus {
  /** The Jira `statusCategory.key` the adapter will synthesise for this status. */
  jiraCategoryKey: string;
}

/**
 * Status name -> canonical phase -> category.
 *
 * THE ASYMMETRY WITH REST, STATED ONCE. Under REST an unmapped name falls back to the
 * real `statusCategory`. Feed #3 has no `IssueStatuses` entity set, so there is no
 * category to fall back to, and `STATUS_CATEGORY_TO_PHASE`'s `?? 'execute'` would file
 * an unknown status as work in flight -- reporting it, in the common case, as on
 * track. So an unmapped name is an ERROR here and a warning there. Both are the safe
 * behaviour for the evidence each source actually provides.
 *
 * Suffix stripping is shared with the REST path (`To Do - Epic`), so a site that
 * suffixes its statuses resolves identically through either source.
 */
export function normaliseFeedStatus(raw: unknown, subject: string): Outcome<FeedStatus> {
  const name = feedText(raw);

  if (!name) {
    return error([
      diagnostic(
        'error',
        'unknown-status',
        subject,
        'no ISSUE_STATUS_NAME on the row, and Feed #3 exports no status category to fall back to.',
        'Confirm the Issues export still includes ISSUE_STATUS_NAME.',
      ),
    ]);
  }

  const phase = STATUS_NAME_TO_PHASE[stripStatusSuffix(name).toLowerCase().trim()];

  if (!phase) {
    return error([
      diagnostic(
        'error',
        'unknown-status',
        subject,
        `status "${name}" has no canonical phase, and Feed #3 carries no status category ` +
          `to fall back to, so filing it would mean guessing whether the work is in flight.`,
        'Add it to STATUS_NAME_TO_PHASE in config/status-map.ts.',
      ),
    ]);
  }

  const category = PHASE_TO_CATEGORY[phase];

  return valid({
    raw: name,
    phase,
    category,
    jiraCategoryKey: STATUS_CATEGORY_KEYS[category],
  });
}

// ---------------------------------------------------------------------------
// Sites and portfolios
// ---------------------------------------------------------------------------

/** Feed project key -> config key: trimmed, upper-cased, then alias-resolved. */
export function canonicalProjectKey(raw: unknown): string | undefined {
  const value = feedText(raw)?.toUpperCase();
  if (!value) return undefined;
  return SITE_KEY_ALIASES[value] ?? value;
}

export type FeedProjectScope =
  | { kind: 'site'; site: ResolvedSite }
  | { kind: 'portfolio'; key: string }
  | { kind: 'out-of-scope'; key: string; reason: string }
  | { kind: 'unknown'; key: string };

/**
 * Classifies a project key against the registry.
 *
 * Four outcomes rather than two, because "not a configured site" covers three very
 * different situations and collapsing them would bury the one that matters:
 *
 *   - a portfolio project, which is in scope but holds initiatives rather than items;
 *   - a project deliberately deferred or excluded during discovery, which is expected
 *     noise in a feed configured for someone else's requirements;
 *   - a key nobody has seen before, which is the only one that needs a human.
 *
 * Feed #3 carries all of these -- it exports projects this application does not cover
 * -- so a single "unmapped site" bucket would be permanently full of expected entries
 * and permanently ignored.
 */
export function classifyFeedProject(raw: unknown): FeedProjectScope {
  const key = canonicalProjectKey(raw);
  if (!key) return { kind: 'unknown', key: '(missing PROJECT_KEY)' };

  if (PORTFOLIO_KEYS.includes(key)) return { kind: 'portfolio', key };

  const site = resolveSite(key);
  if (site) return { kind: 'site', site };

  const deferred = DEFERRED_SITES[key];
  if (deferred) return { kind: 'out-of-scope', key, reason: deferred };

  const excluded = EXCLUDED_PROJECTS[key];
  if (excluded) return { kind: 'out-of-scope', key, reason: excluded };

  return { kind: 'unknown', key };
}

/** True when the key is one this application syncs. */
export function isInScopeProject(raw: unknown): boolean {
  const key = canonicalProjectKey(raw);
  return key !== undefined && ALL_PROJECT_KEYS.includes(key);
}

/**
 * Resolves a site, reporting anything that is not one.
 *
 * Region comes from `resolveSite`, which reads `config/regions.ts` -- the feed layer
 * has no region logic of its own and must never acquire any.
 */
export function resolveFeedSite(raw: unknown, subject: string): Outcome<ResolvedSite> {
  const scope = classifyFeedProject(raw);

  switch (scope.kind) {
    case 'site':
      return valid(scope.site);

    case 'portfolio':
      return error([
        diagnostic(
          'error',
          'unmapped-site',
          subject,
          `project ${scope.key} is a portfolio project, not a site; its issues are initiatives.`,
        ),
      ]);

    case 'out-of-scope':
      return error([
        diagnostic(
          'warning',
          'out-of-scope',
          scope.key,
          `the feed exports project ${scope.key}, which is outside MVP scope (${scope.reason}). Rows ignored.`,
        ),
      ]);

    case 'unknown':
      return error([
        diagnostic(
          'warning',
          'unmapped-site',
          scope.key,
          `project ${scope.key} is not in the site registry, so its items have no site, region or ` +
            `expected-count baseline. Rows ignored.`,
          'Add it to config/projects.ts if it should be in scope.',
        ),
      ]);
  }
}

// ---------------------------------------------------------------------------
// Hierarchy level
// ---------------------------------------------------------------------------

export interface IssueTypeContext {
  typeName?: string | undefined;
  scopeType?: string | undefined;
  scopeId?: string | undefined;
}

/**
 * `ISSUE_TYPE_ID` -> hierarchy level, from the registry.
 *
 * AN UNKNOWN ID IS AN ERROR, NOT A DEFAULT. `classifyIssues` drops an issue whose level
 * is `undefined` without a word, which means an unregistered type makes a site's work
 * vanish while every count still looks plausible. Defaulting to 1 would be worse
 * again: level-0 detail would flood the roadmap. So the row is skipped and named.
 *
 * The diagnostic carries the type name and its scope because that is exactly what
 * whoever extends the registry needs, and it is only available here.
 */
export function resolveIssueTypeLevel(
  raw: unknown,
  subject: string,
  context: IssueTypeContext = {},
  registry: Readonly<Record<string, number>> = ISSUE_TYPE_LEVELS,
): Outcome<number> {
  const id = feedText(raw);

  if (!id) {
    return error([
      diagnostic(
        'error',
        'unknown-issue-type',
        subject,
        'no ISSUE_TYPE_ID on the row, so its hierarchy level cannot be resolved.',
        'Confirm the Issues export still includes ISSUE_TYPE_ID.',
      ),
    ]);
  }

  const level = registry[id];
  if (level === undefined) {
    const named = context.typeName ? ` ("${context.typeName}")` : '';
    const scope =
      context.scopeType || context.scopeId
        ? ` scope ${context.scopeType ?? '?'}/${context.scopeId ?? '?'}`
        : '';
    const incomplete = ISSUE_TYPE_LEVELS_ARE_COMPLETE
      ? ''
      : ' The registry is known to be incomplete and awaits a capture from Jira REST.';

    return error([
      diagnostic(
        'error',
        'unknown-issue-type',
        subject,
        `issue type ${id}${named}${scope} is not in ISSUE_TYPE_LEVELS, so its hierarchy level is ` +
          `unknown. Skipped rather than guessed: a wrong level either hides a site's work or ` +
          `floods the roadmap with operational detail.${incomplete}`,
        'Add it to ISSUE_TYPE_LEVELS in config/feed.ts.',
      ),
    ]);
  }

  return valid(level);
}

// ---------------------------------------------------------------------------
// Source mapping: feed columns -> Jira field IDs
// ---------------------------------------------------------------------------

/**
 * Maps every `<Label>_<fieldId>` column onto `customfield_<fieldId>`.
 *
 * One rule, not eighteen special cases. It covers all per-site SPOT fields and any
 * field added later, and it keeps `config/fields.ts` the only place a field ID is
 * declared -- so no OData-specific duplicate of `SITE_SPOT_FIELDS` can drift.
 *
 * A COLLISION IS AN ERROR. If two columns yield the same ID the mapping is ambiguous,
 * and last-write-wins would resolve a site's RAG from whichever column the feed
 * happened to emit second. Not observed; detected anyway, because the cost of the check
 * is nil and the cost of the failure is a wrong status on an executive screen.
 */
export function mapCustomFieldColumns(row: FeedIssueRow, subject: string): Outcome<Record<string, unknown>> {
  const fields: Record<string, unknown> = {};
  const sourceColumn = new Map<string, string>();
  const collisions: ReturnType<typeof diagnostic>[] = [];

  for (const [column, value] of Object.entries(row)) {
    if (NON_CUSTOM_FIELD_COLUMNS.includes(column)) continue;

    const match = CUSTOM_FIELD_COLUMN_PATTERN.exec(column);
    if (!match?.[1]) continue;

    const fieldId = `customfield_${match[1]}`;
    const previous = sourceColumn.get(fieldId);

    if (previous !== undefined && previous !== column) {
      collisions.push(
        diagnostic(
          'error',
          'field-collision',
          subject,
          `columns "${previous}" and "${column}" both map to ${fieldId}; the value is ambiguous.`,
          'Rename one column at the feed, or add it to NON_CUSTOM_FIELD_COLUMNS in config/feed.ts.',
        ),
      );
      continue;
    }

    sourceColumn.set(fieldId, column);
    if (value !== null && value !== '') fields[fieldId] = value;
  }

  return collisions.length > 0 ? error(collisions) : valid(fields);
}

/** The text of a `Labels` row, coalesced over the candidate column names. */
export function readLabelValue(row: FeedLabelRow): string | undefined {
  for (const column of FEED_LABEL_VALUE_COLUMNS) {
    const value = feedText(row[column]);
    if (value) return value;
  }
  return undefined;
}

// ---------------------------------------------------------------------------
// Source mapping: feed identity -> provenance
// ---------------------------------------------------------------------------

export interface FeedSourceMetadata {
  /** Reported to the UI exactly as a live snapshot is. Feed data is never "sample". */
  kind: 'live';
  name: string;
  /** When the feed was read -- becomes `snapshot.syncedAt`. */
  syncedAt: string;
  /** The date risk was evaluated against -- becomes `snapshot.asOf`. */
  asOf: string;
  origin?: string;
  rowCounts?: Readonly<Record<string, number>>;
}

/**
 * Feed identity -> the provenance the snapshot carries.
 *
 * `syncedAt` is when the feed was READ, which is not how current the data is: Feed #3
 * is same-day rather than live. The UI already separates those two facts by deriving
 * data age from the newest item update, so this must not be dressed up as freshness.
 */
export function mapFeedSource(metadata: FeedServiceMetadata, asOf: string): FeedSourceMetadata {
  return {
    kind: 'live',
    name: metadata.name,
    syncedAt: metadata.retrievedAt,
    asOf,
    ...(metadata.origin ? { origin: metadata.origin } : {}),
    ...(metadata.rowCounts ? { rowCounts: metadata.rowCounts } : {}),
  };
}

// ---------------------------------------------------------------------------
// Duplicates
// ---------------------------------------------------------------------------

/**
 * Keeps the first record per identity and reports the rest.
 *
 * FIRST WINS, DELIBERATELY. A feed with no ordering guarantee gives no basis for
 * preferring a later row, so "last wins" would make the resolved value depend on
 * export order -- non-deterministic output from identical data. First-wins is at least
 * stable, and the duplicate is reported either way.
 */
export function dedupeByIdentity<T>(
  records: readonly T[],
  identityOf: (record: T) => string | undefined,
  code: 'duplicate-record',
  describe: (identity: string, count: number) => string,
): { kept: T[]; diagnostics: ReturnType<typeof diagnostic>[] } {
  const kept: T[] = [];
  const counts = new Map<string, number>();

  for (const record of records) {
    const identity = identityOf(record);
    if (identity === undefined) continue;

    const seen = counts.get(identity) ?? 0;
    counts.set(identity, seen + 1);
    if (seen === 0) kept.push(record);
  }

  const diagnostics = [...counts.entries()]
    .filter(([, count]) => count > 1)
    .map(([identity, count]) =>
      diagnostic('warning', code, identity, describe(identity, count), 'The first occurrence was kept.'),
    );

  return { kept, diagnostics };
}

/** Re-exported so the adapter has one import for every normalisation decision. */
export { warning as warningOutcome };
