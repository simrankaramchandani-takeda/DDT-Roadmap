/**
 * Feed #3 records -> the canonical domain model.
 *
 * THE GOVERNING DECISION, FROM design-001 §1: the adapter's output is `JiraIssue[]`.
 * It synthesises Jira-shaped issues from the feed's relational model and then runs the
 * EXISTING, UNMODIFIED transformation layer over them -- `classifyIssues`,
 * `transformItem`, `transformInitiative`, `buildSiteSummaries`, `buildCoverage`.
 *
 * That is not a shortcut, it is the mechanism by which "no business-rule change" is a
 * structural fact rather than a promise. Risk, region and coverage are not
 * reimplemented against a feed-shaped input and then checked for agreement; they are
 * the same function calls, on the same contract, producing the same objects. The
 * alternative -- a neutral intermediate model with `transform.ts` rewritten against it
 * -- would put the only validated business logic in the repo at risk in order to avoid
 * one translation module, and would destroy the snapshot-diff parity gate that is the
 * entire safety net for the migration.
 *
 * So this file is deliberately a shim that fakes a Jira payload. That is the point.
 * It is a translation boundary, not a model.
 *
 * WHAT IT REFUSES TO DO. Three values here cannot be inferred from the feed, and each
 * one is reported rather than guessed, because a guess would be invisible and wrong:
 * hierarchy level (registry, config/feed.ts), status phase for an unmapped name, and
 * blocker direction (unresolved -- see BLOCKS_DIRECTION_MEANING).
 */

import {
  BLOCKS_DIRECTION_MEANING,
  FEED_BLOCKING_LINK_TYPES,
  FEED_KNOWN_LOSSES,
  FEED_OWNER_SIDE_TABLES,
  ISSUE_TYPE_LEVELS,
  type BlocksDirectionMeaning,
} from '@config/feed.js';
import { PORTFOLIOS, PORTFOLIO_KEYS } from '@config/projects.js';
import {
  buildUnalignedInitiative,
  classifyIssues,
  findInitiativeKey,
  todayIso,
  transformInitiative,
  transformItem,
  type TransformContext,
} from '@/lib/transform.js';
import { buildCoverage, buildSiteSummaries } from '@/lib/rollup.js';
import type { JiraIssue } from '@/lib/jira-client.js';
import type {
  Coverage,
  Initiative,
  RoadmapItem,
  SiteSummary,
  Snapshot,
} from '@/types/domain.js';

import type {
  Feed3Payload,
  FeedIssueLinkRow,
  FeedIssueRow,
  FeedIssueTypeRow,
  FeedServiceMetadata,
} from './dto.js';
import {
  canonicalProjectKey,
  classifyFeedProject,
  dedupeByIdentity,
  feedText,
  isInScopeProject,
  mapCustomFieldColumns,
  mapFeedSource,
  normaliseFeedStatus,
  parseFeedDate,
  parseFeedTimestamp,
  readLabelValue,
  resolveIssueTypeLevel,
  type FeedSourceMetadata,
} from './normalise.js';
import {
  DiagnosticCollector,
  diagnostic,
  isUsable,
  type Diagnostic,
  type ValidationSeverity,
} from './outcomes.js';

// ---------------------------------------------------------------------------
// Options and results
// ---------------------------------------------------------------------------

export interface FeedAdapterOptions {
  /** Snapshot date risk is evaluated against. Defaults to today, UTC. */
  asOf?: string;
  /** Used only to build `jiraUrl` links. Not a credentialed dependency. */
  baseUrl?: string;
  /** Hierarchy-level registry. Injectable so a capture can be supplied without a config edit. */
  issueTypeLevels?: Readonly<Record<string, number>>;
  /** Overrides the unresolved default once the `Blocks` semantics are established. */
  blocksDirection?: BlocksDirectionMeaning;
}

export interface FeedAdaptation {
  snapshot: Snapshot;
  source: FeedSourceMetadata;
  diagnostics: readonly Diagnostic[];
  severity: ValidationSeverity;
  /** Count per diagnostic code -- for the sync log and for assertions. */
  tally: Record<string, number>;
}

interface ResolvedOptions {
  asOf: string;
  baseUrl: string;
  issueTypeLevels: Readonly<Record<string, number>>;
  blocksDirection: BlocksDirectionMeaning;
}

function resolveOptions(options: FeedAdapterOptions): ResolvedOptions {
  return {
    asOf: options.asOf ?? todayIso(),
    // No Jira token is required to run a feed sync; this is a plain non-secret value
    // used only for link construction, because Feed #3 exposes no browse URL.
    baseUrl: options.baseUrl ?? 'https://takeda.atlassian.net',
    issueTypeLevels: options.issueTypeLevels ?? ISSUE_TYPE_LEVELS,
    blocksDirection: options.blocksDirection ?? BLOCKS_DIRECTION_MEANING,
  };
}

// ---------------------------------------------------------------------------
// Side tables
// ---------------------------------------------------------------------------

interface SideTables {
  labelsByIssue: Map<string, string[]>;
  linksByIssue: Map<string, FeedIssueLinkRow[]>;
  ownersByIssue: Map<string, Map<string, { displayName: string }[]>>;
  typesById: Map<string, FeedIssueTypeRow>;
}

function indexSideTables(payload: Feed3Payload, collector: DiagnosticCollector): SideTables {
  const labelsByIssue = new Map<string, string[]>();
  for (const row of payload.labels ?? []) {
    const value = readLabelValue(row);
    if (!row.ISSUE_KEY || !value) continue;
    const list = labelsByIssue.get(row.ISSUE_KEY);
    if (list) list.push(value);
    else labelsByIssue.set(row.ISSUE_KEY, [value]);
  }

  // Links are NOT scoped to in-scope projects. Alignment works by seeing an
  // out-of-scope counterpart and rejecting it; pre-filtering would convert a
  // correctly-rejected link into no link at all -- the same observable result for
  // entirely the wrong reason.
  const rawLinks = payload.issueLinks ?? [];
  const { kept: links, diagnostics: linkDuplicates } = dedupeByIdentity(
    rawLinks,
    (row) =>
      row.ISSUE_KEY && row.LINKED_ISSUE_KEY
        ? `${row.ISSUE_KEY}|${row.TYPE ?? ''}|${row.DIRECTION ?? ''}|${row.LINKED_ISSUE_KEY}`
        : undefined,
    'duplicate-record',
    (identity, count) => `link row repeated ${count} times in IssueLinks (${identity}).`,
  );
  collector.addAll(linkDuplicates);

  const linksByIssue = new Map<string, FeedIssueLinkRow[]>();
  for (const row of links) {
    const list = linksByIssue.get(row.ISSUE_KEY);
    if (list) list.push(row);
    else linksByIssue.set(row.ISSUE_KEY, [row]);
  }

  const ownersByIssue = new Map<string, Map<string, { displayName: string }[]>>();
  for (const table of FEED_OWNER_SIDE_TABLES) {
    for (const row of payload.owners?.[table.entitySet] ?? []) {
      const name = feedText(row.USER_NAME);
      if (!row.ISSUE_KEY || !name) continue;
      const byField = ownersByIssue.get(row.ISSUE_KEY) ?? new Map<string, { displayName: string }[]>();
      const list = byField.get(table.fieldId) ?? [];
      list.push({ displayName: name });
      byField.set(table.fieldId, list);
      ownersByIssue.set(row.ISSUE_KEY, byField);
    }
  }

  const typesById = new Map<string, FeedIssueTypeRow>();
  for (const row of payload.issueTypes ?? []) {
    const id = feedText(row.ISSUE_TYPE_ID);
    if (id) typesById.set(id, row);
  }

  if (!payload.issueLinks) {
    collector.add(
      diagnostic(
        'warning',
        'missing-entity-set',
        'IssueLinks',
        'the payload carried no IssueLinks, so no item can be aligned to an initiative and every ' +
          'item will be classified site-led. That is indistinguishable on screen from a portfolio ' +
          'genuinely running no global programmes.',
        'Confirm the IssueLinks entity set is included in the export.',
      ),
    );
  }

  return { labelsByIssue, linksByIssue, ownersByIssue, typesById };
}

// ---------------------------------------------------------------------------
// Links -> synthesised `issuelinks`
// ---------------------------------------------------------------------------

interface SynthesisedLink {
  type: { name: string; inward?: string; outward?: string };
  inwardIssue?: { key: string; fields: Record<string, unknown> };
  outwardIssue?: { key: string; fields: Record<string, unknown> };
}

function isBlockingType(type: string | undefined): boolean {
  const value = type?.toLowerCase().trim() ?? '';
  return FEED_BLOCKING_LINK_TYPES.some((t) => value.includes(t));
}

/**
 * Turns feed link rows into the `issuelinks` shape `findInitiativeKey` and
 * `findBlockers` expect.
 *
 * ALIGNMENT IS DIRECTION-INDEPENDENT AND THEREFORE SAFE. `findInitiativeKey` inspects
 * both endpoint slots and takes the first counterpart in a portfolio project;
 * re-confirmed against the feed, where Polaris rows split near-evenly between
 * `Inward` and `Outward`, so honouring direction would drop about half of them. The
 * counterpart is placed in the slot the feed's `DIRECTION` names, which is faithful
 * and, for alignment, immaterial.
 *
 * BLOCKERS ARE NOT. `findBlockers` reads `inwardIssue` as "this issue is blocked by
 * that one", and the feed's `DIRECTION` semantics for `Blocks` are unestablished.
 * While unresolved this function emits no inward/outward descriptions on blocking
 * links, so no blocker is attributed at all -- a visible gap rather than an invisible
 * inversion that would make blocking items look blocked.
 */
function synthesiseLinks(
  rows: readonly FeedIssueLinkRow[],
  issuesByKey: ReadonlyMap<string, FeedIssueRow>,
  blocksDirection: BlocksDirectionMeaning,
  statusFor: (row: FeedIssueRow) => Record<string, unknown> | undefined,
): SynthesisedLink[] {
  const links: SynthesisedLink[] = [];

  for (const row of rows) {
    const counterpartKey = feedText(row.LINKED_ISSUE_KEY);
    if (!counterpartKey) continue;

    const typeName = feedText(row.TYPE) ?? '';
    const counterpart = issuesByKey.get(counterpartKey);

    // A counterpart outside the export has no row: emit the key alone. `findBlockers`
    // then treats it as open, which is the conservative direction.
    const counterpartFields: Record<string, unknown> = {
      summary: counterpart ? feedText(counterpart.SUMMARY) ?? counterpartKey : counterpartKey,
      ...(counterpart ? { status: statusFor(counterpart) } : {}),
    };
    const endpoint = { key: counterpartKey, fields: counterpartFields };

    const blocking = isBlockingType(typeName);
    const direction = feedText(row.DIRECTION)?.toLowerCase();

    if (blocking && blocksDirection === 'unresolved') {
      // Carried through with no description, so neither matcher fires on it.
      links.push({ type: { name: typeName }, outwardIssue: endpoint });
      continue;
    }

    if (blocking) {
      const thisIssueIsBlocked =
        blocksDirection === 'inward-is-blocked' ? direction === 'inward' : direction === 'outward';

      links.push(
        thisIssueIsBlocked
          ? { type: { name: typeName, inward: 'is blocked by' }, inwardIssue: endpoint }
          : { type: { name: typeName, outward: 'blocks' }, outwardIssue: endpoint },
      );
      continue;
    }

    links.push(
      direction === 'inward'
        ? { type: { name: typeName }, inwardIssue: endpoint }
        : { type: { name: typeName }, outwardIssue: endpoint },
    );
  }

  return links;
}

// ---------------------------------------------------------------------------
// DTO -> JiraIssue
// ---------------------------------------------------------------------------

/**
 * Builds the internal `JiraIssue` contract from one feed row.
 *
 * Every value the transformation layer reads is placed exactly where it reads it, so
 * that layer stays entirely unaware that OData exists.
 */
function adaptIssueRow(
  row: FeedIssueRow,
  side: SideTables,
  issuesByKey: ReadonlyMap<string, FeedIssueRow>,
  options: ResolvedOptions,
  collector: DiagnosticCollector,
): JiraIssue | undefined {
  const key = feedText(row.ISSUE_KEY);
  if (!key) {
    collector.add(
      diagnostic(
        'error',
        'unsupported-value',
        '(row with no ISSUE_KEY)',
        'a row carried no ISSUE_KEY, so it cannot be identified, linked or displayed.',
      ),
    );
    return undefined;
  }

  const typeId = feedText(row.ISSUE_TYPE_ID);
  const typeRow = typeId ? side.typesById.get(typeId) : undefined;

  const levelOutcome = resolveIssueTypeLevel(
    row.ISSUE_TYPE_ID,
    key,
    {
      typeName: feedText(row.ISSUE_TYPE_NAME) ?? feedText(typeRow?.ISSUE_TYPE_NAME),
      scopeType: feedText(typeRow?.SCOPE_TYPE),
      scopeId: feedText(typeRow?.SCOPE_ID),
    },
    options.issueTypeLevels,
  );
  const hierarchyLevel = collector.absorb(levelOutcome);
  if (hierarchyLevel === undefined) return undefined;

  const statusOutcome = normaliseFeedStatus(row.ISSUE_STATUS_NAME, key);
  const status = collector.absorb(statusOutcome);
  if (!status) return undefined;

  const customFields = collector.absorb(mapCustomFieldColumns(row, key));
  if (!customFields) return undefined;

  const projectKey = canonicalProjectKey(row.PROJECT_KEY) ?? key.split('-')[0]!;
  const labels = side.labelsByIssue.get(key) ?? [];
  const owners = side.ownersByIssue.get(key);

  const statusFor = (other: FeedIssueRow): Record<string, unknown> | undefined => {
    const otherStatus = normaliseFeedStatus(other.ISSUE_STATUS_NAME, feedText(other.ISSUE_KEY) ?? '');
    if (!isUsable(otherStatus)) return undefined;
    return {
      name: otherStatus.value.raw,
      statusCategory: { key: otherStatus.value.jiraCategoryKey },
    };
  };

  const links = synthesiseLinks(
    side.linksByIssue.get(key) ?? [],
    issuesByKey,
    options.blocksDirection,
    statusFor,
  );

  const fields: Record<string, unknown> = {
    ...customFields,
    summary: feedText(row.SUMMARY) ?? key,
    // Plain text rather than ADF. `flattenToText` handles strings already.
    description: feedText(row.DESCRIPTION),
    issuetype: {
      ...(typeId ? { id: typeId } : {}),
      name: feedText(row.ISSUE_TYPE_NAME) ?? feedText(typeRow?.ISSUE_TYPE_NAME) ?? 'Unknown',
      hierarchyLevel,
    },
    // Category is DERIVED from the canonical phase, because Feed #3 has no
    // IssueStatuses entity set. See STATUS_CATEGORY_KEYS in config/feed.ts.
    status: { name: status.raw, statusCategory: { key: status.jiraCategoryKey } },
    project: { key: projectKey },
    ...(feedText(row.CURRENT_ASSIGNEE_NAME)
      ? { assignee: { displayName: feedText(row.CURRENT_ASSIGNEE_NAME) } }
      : {}),
    ...(labels.length > 0 ? { labels } : {}),
    ...(parseFeedTimestamp(row.UPDATED) ? { updated: parseFeedTimestamp(row.UPDATED) } : {}),
    ...(parseFeedTimestamp(row.CREATED) ? { created: parseFeedTimestamp(row.CREATED) } : {}),
    ...(parseFeedDate(row.RESOLUTION_DATE) ? { resolutiondate: parseFeedDate(row.RESOLUTION_DATE) } : {}),
    ...(parseFeedDate(row.DUE_DATE) ? { duedate: parseFeedDate(row.DUE_DATE) } : {}),
    ...(links.length > 0 ? { issuelinks: links } : {}),
    // `parent` is unavailable: Feed #3 exports no PARENT_ISSUE_* columns, so
    // childCount stays {0,0}. Declared in FEED_KNOWN_LOSSES.
  };

  for (const [fieldId, users] of owners ?? []) fields[fieldId] = users;

  return { id: feedText(row.ISSUE_ID) ?? key, key, fields };
}

/**
 * DTO -> `JiraIssue[]`, the internal contract every downstream consumer already reads.
 *
 * Exported in its own right because it is the seam a future `SourceAdapter` plugs
 * into: `sync.ts` step 1 becomes adapter selection plus this call, and nothing else in
 * the pipeline changes.
 */
export function adaptFeedIssues(
  payload: Feed3Payload,
  options: FeedAdapterOptions = {},
  collector: DiagnosticCollector = new DiagnosticCollector(),
): { issues: JiraIssue[]; collector: DiagnosticCollector } {
  const resolved = resolveOptions(options);
  const side = indexSideTables(payload, collector);

  const { kept: rows, diagnostics: duplicates } = dedupeByIdentity(
    payload.issues,
    (row) => feedText(row.ISSUE_KEY),
    'duplicate-record',
    (identity, count) =>
      `issue ${identity} appears ${count} times in the Issues export; only one row can describe it.`,
  );
  collector.addAll(duplicates);

  // Every row, in scope or not: link counterparts are joined against this map, and
  // rejecting an out-of-scope counterpart requires being able to see it.
  const issuesByKey = new Map<string, FeedIssueRow>();
  for (const row of rows) {
    const key = feedText(row.ISSUE_KEY);
    if (key) issuesByKey.set(key, row);
  }

  const issues: JiraIssue[] = [];

  for (const row of rows) {
    // Scope diagnostics are raised once per project, not once per row: a feed
    // configured for someone else's requirements carries whole projects this
    // application does not cover, and a per-row warning would bury everything else.
    if (!isInScopeProject(row.PROJECT_KEY)) {
      const scope = classifyFeedProject(row.PROJECT_KEY);

      // `site` and `portfolio` are unreachable here -- both are in scope by
      // definition -- but the switch keeps the two reportable cases explicit rather
      // than lumping everything unknown into an `else`.
      if (scope.kind === 'out-of-scope') {
        collector.add(
          diagnostic(
            'warning',
            'out-of-scope',
            scope.key,
            `the feed exports project ${scope.key}, which is outside MVP scope (${scope.reason}). Rows ignored.`,
          ),
        );
      } else if (scope.kind === 'unknown') {
        collector.add(
          diagnostic(
            'warning',
            'unmapped-site',
            scope.key,
            `the feed exports project ${scope.key}, which is in neither the site registry nor the ` +
              `recorded exclusions, so its work has no site, region or expected-count baseline. Rows ignored.`,
            'Add it to config/projects.ts if it should be in scope.',
          ),
        );
      }
      continue;
    }

    const issue = adaptIssueRow(row, side, issuesByKey, resolved, collector);
    if (issue) issues.push(issue);
  }

  if (resolved.blocksDirection === 'unresolved') {
    collector.add(
      diagnostic(
        'warning',
        'unsupported-value',
        'IssueLinks.DIRECTION',
        'the meaning of DIRECTION on a Blocks row is not established, so no blocker is attributed ' +
          'from this feed and no project can reach the "Blocked" status through a dependency. ' +
          'Reporting the gap is preferable to a guess, which would invert every attribution.',
        'Compare one Blocks pair against Jira, then set BLOCKS_DIRECTION_MEANING in config/feed.ts.',
      ),
    );
  }

  for (const loss of FEED_KNOWN_LOSSES) {
    collector.add(diagnostic('warning', 'known-loss', loss.subject, loss.detail));
  }

  return { issues, collector };
}

// ---------------------------------------------------------------------------
// Canonical model
// ---------------------------------------------------------------------------

/**
 * Roadmap items, via the unmodified `transformItem`.
 *
 * `initiativeIndex` gives an item its rollout context (which programme, how many
 * sites) for the generated narrative, exactly as `sync.ts` builds it under REST.
 */
export function adaptRoadmapItems(
  itemIssues: readonly JiraIssue[],
  initiativeIssues: readonly JiraIssue[],
  context: TransformContext,
): RoadmapItem[] {
  const siteKeysByInitiative = new Map<string, Set<string>>();
  for (const issue of itemIssues) {
    const initiativeKey = findInitiativeKey(issue);
    if (!initiativeKey) continue;
    const projectKey = (issue.fields['project'] as { key?: string } | undefined)?.key;
    if (!projectKey) continue;
    const set = siteKeysByInitiative.get(initiativeKey) ?? new Set<string>();
    set.add(projectKey);
    siteKeysByInitiative.set(initiativeKey, set);
  }

  const index = new Map<string, { summary: string; siteCount: number }>();
  for (const issue of initiativeIssues) {
    index.set(issue.key, {
      summary: (issue.fields['summary'] as string | undefined) ?? issue.key,
      siteCount: siteKeysByInitiative.get(issue.key)?.size ?? 0,
    });
  }

  const items: RoadmapItem[] = [];
  for (const issue of itemIssues) {
    const item = transformItem(issue, context, index);
    if (item) items.push(item);
  }
  return items;
}

/**
 * Initiatives, via the unmodified `transformInitiative`, plus the synthetic site-local
 * lane.
 *
 * Every initiative's status is rolled up from its items because no feed exposes
 * `customfield_11199`. The UI already states this on screen, so the difference from
 * the Power BI report is definitional rather than a defect.
 */
export function adaptInitiatives(
  initiativeIssues: readonly JiraIssue[],
  items: readonly RoadmapItem[],
  context: TransformContext,
): Initiative[] {
  const itemsByInitiative = new Map<string, RoadmapItem[]>();
  for (const item of items) {
    if (!item.initiativeKey) continue;
    const list = itemsByInitiative.get(item.initiativeKey) ?? [];
    list.push(item);
    itemsByInitiative.set(item.initiativeKey, list);
  }

  const initiatives = initiativeIssues.map((issue) =>
    transformInitiative(issue, itemsByInitiative.get(issue.key) ?? [], context),
  );

  // `alignment: 'local'` is an expected delivery model, not a data gap -- 51% of
  // level-1 work, and DDTYAR is 17 of 17.
  const local = items.filter((i) => i.alignment === 'local');
  if (local.length > 0) initiatives.push(buildUnalignedInitiative(local, context));

  return initiatives;
}

/** Site summaries, via the unmodified `buildSiteSummaries`. Regions come from config. */
export function adaptSites(activeItems: readonly RoadmapItem[]): SiteSummary[] {
  return buildSiteSummaries(activeItems);
}

/**
 * Coverage, via the unmodified `buildCoverage`.
 *
 * `flaggedFieldPopulated` is hard-zero and that is a KNOWN LOSS, not a measurement:
 * Feed #3 does not export `customfield_10387`, so the canary is vacuous here. Declared
 * in FEED_KNOWN_LOSSES so it is never read as evidence.
 */
export function adaptCoverage(
  allItems: readonly RoadmapItem[],
  activeItems: readonly RoadmapItem[],
  asOf: string,
): Coverage {
  return buildCoverage(allItems, activeItems, asOf, 0);
}

/** Feed identity -> the provenance the snapshot and the UI carry. */
export function adaptSourceMetadata(metadata: FeedServiceMetadata, asOf: string): FeedSourceMetadata {
  return mapFeedSource(metadata, asOf);
}

// ---------------------------------------------------------------------------
// The whole adaptation
// ---------------------------------------------------------------------------

/**
 * Feed payload -> a complete, schema-shaped `Snapshot`.
 *
 * NEVER THROWS AND NEVER RETURNS A HALF-SNAPSHOT. Records that cannot be constructed
 * are skipped and named; everything else is transformed. The result is always
 * renderable, which is the requirement that keeps a feed problem from becoming a blank
 * dashboard.
 *
 * Warnings reach the user through `snapshot.warnings[]` -- the existing data-quality
 * model, no schema change -- collapsed per code so a systemic failure cannot flood the
 * page it is being reported on.
 */
export function adaptFeedSnapshot(
  payload: Feed3Payload,
  options: FeedAdapterOptions = {},
): FeedAdaptation {
  const resolved = resolveOptions(options);
  const collector = new DiagnosticCollector();

  const { issues } = adaptFeedIssues(payload, options, collector);

  // `warnings` here is the transformation layer's own channel, unchanged. Its strings
  // and the feed diagnostics are merged below, so a reader sees one list.
  const transformWarnings: string[] = [];
  const context: TransformContext = {
    baseUrl: resolved.baseUrl,
    asOf: resolved.asOf,
    warnings: transformWarnings,
  };

  const { items: itemIssues, initiatives: initiativeIssues } = classifyIssues(issues, transformWarnings);

  const items = adaptRoadmapItems(itemIssues, initiativeIssues, context);
  const initiatives = adaptInitiatives(initiativeIssues, items, context);

  // A roadmap item with no dates at all cannot be plotted anywhere. It still belongs
  // in the snapshot -- the UI has a named "No dates reported" group precisely so this
  // is visible -- but it is a coverage finding and is reported as one.
  for (const item of items) {
    if (!item.start && !item.end) {
      collector.add(
        diagnostic(
          'warning',
          'missing-dates',
          item.key,
          `no start and no go-live date, so it cannot appear on any timeline and is listed only in ` +
            `the "No dates reported" group.`,
        ),
      );
    }
  }

  const danglingInitiatives = new Set<string>();
  const knownInitiativeKeys = new Set(initiativeIssues.map((i) => i.key));
  for (const item of items) {
    if (item.initiativeKey && !knownInitiativeKeys.has(item.initiativeKey)) {
      danglingInitiatives.add(item.initiativeKey);
    }
  }
  for (const key of danglingInitiatives) {
    collector.add(
      diagnostic(
        'warning',
        'unmapped-site',
        key,
        `items link to initiative ${key}, which the feed did not return. Its portfolio project may ` +
          `be missing from config/projects.ts, or the export may be scoped more narrowly than the app.`,
      ),
    );
  }

  const activeItems = items.filter(
    (i) => i.risk.level !== 'complete' && i.risk.level !== 'cancelled',
  );

  const source = adaptSourceMetadata(payload.metadata, resolved.asOf);

  const snapshot: Snapshot = {
    schemaVersion: 1,
    syncedAt: source.syncedAt,
    asOf: resolved.asOf,
    portfolios: PORTFOLIOS.filter((p) => PORTFOLIO_KEYS.includes(p.key)).map((p) => ({
      key: p.key,
      name: p.name,
    })),
    sites: adaptSites(activeItems),
    initiatives,
    items,
    coverage: adaptCoverage(items, activeItems, resolved.asOf),
    warnings: [...transformWarnings, ...collector.toSnapshotWarnings()],
  };

  return {
    snapshot,
    source,
    diagnostics: collector.all,
    severity: collector.severity,
    tally: collector.tally(),
  };
}
