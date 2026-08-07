/**
 * Raw Jira issues -> domain model.
 *
 * The critical decision here is item identification: issues are selected by
 * `issuetype.hierarchyLevel`, never by type name. See config/hierarchy.ts for why.
 */

import {
  BLOCKING_LINK_INWARD_DESCRIPTIONS,
  INITIATIVE_LINK_TYPE_ID,
  INITIATIVE_LINK_TYPE_NAME,
  isPortfolioInitiativeLevel,
  isRoadmapItemLevel,
  isUnexpectedLevel1TypeName,
  isUnexpectedLevel2TypeName,
} from '@config/hierarchy.js';
import {
  FIELD_DUE_DATE,
  FIELD_FISCAL_YEAR,
  FIELD_FLAGGED_UNUSABLE,
  FIELD_PORTFOLIO_RAG,
  FIELD_START_DATE,
  SPOT_DESCRIPTION_FIELD_CANDIDATES,
  FIELD_TARGET_END,
  FIELD_TARGET_START,
} from '@config/fields.js';
import { PORTFOLIO_KEYS, resolveSite } from '@config/projects.js';
import type { JiraIssue } from './jira-client.js';
import {
  extractDate,
  extractScalar,
  findUnmappedRagValues,
  flattenToText,
  normaliseAuthoredRag,
  normaliseOwners,
  normaliseSpotIdFromField,
  normaliseStatus,
  spotUrlFor,
} from './normalise.js';
import { parseSpotDescription } from './adf.js';
import { parseSummary } from './summary-parse.js';
import { assessRisk, rollUpRisk } from './risk.js';
import { buildInitiativeNarrative, buildNarrative } from './summarise.js';
import { daysBetween, fiscalYearsSpanned, toIsoDate } from './fiscal-year.js';
import { buildSiteRollup, deriveInitiativeDates } from './rollup.js';
import {
  UNALIGNED_INITIATIVE_KEY,
  UNALIGNED_INITIATIVE_LABEL,
  type Blocker,
  type Initiative,
  type RoadmapItem,
} from '@/types/domain.js';

export interface TransformContext {
  baseUrl: string;
  /** Snapshot date, `YYYY-MM-DD`. */
  asOf: string;
  warnings: string[];
}

interface IssueLink {
  type?: { id?: string; name?: string; inward?: string; outward?: string };
  inwardIssue?: { key?: string; fields?: Record<string, unknown> };
  outwardIssue?: { key?: string; fields?: Record<string, unknown> };
}

// ---------------------------------------------------------------------------
// Classification
// ---------------------------------------------------------------------------

function hierarchyLevelOf(issue: JiraIssue): number | undefined {
  const issuetype = issue.fields['issuetype'] as Record<string, unknown> | undefined;
  const level = issuetype?.['hierarchyLevel'];
  return typeof level === 'number' ? level : undefined;
}

function issueTypeNameOf(issue: JiraIssue): string {
  const issuetype = issue.fields['issuetype'] as Record<string, unknown> | undefined;
  return typeof issuetype?.['name'] === 'string' ? issuetype['name'] : 'Unknown';
}

function projectKeyOf(issue: JiraIssue): string {
  const project = issue.fields['project'] as Record<string, unknown> | undefined;
  return typeof project?.['key'] === 'string' ? project['key'] : issue.key.split('-')[0]!;
}

/**
 * Splits fetched issues into roadmap items and portfolio initiatives, warning on
 * any level-1 or level-2 type name not seen during discovery. A new
 * project-local type must surface here rather than silently vanish.
 */
export function classifyIssues(
  issues: readonly JiraIssue[],
  warnings: string[],
): { items: JiraIssue[]; initiatives: JiraIssue[] } {
  const items: JiraIssue[] = [];
  const initiatives: JiraIssue[] = [];
  const reportedLevel1 = new Set<string>();
  const reportedLevel2 = new Set<string>();

  for (const issue of issues) {
    const level = hierarchyLevelOf(issue);
    const typeName = issueTypeNameOf(issue);
    const projectKey = projectKeyOf(issue);

    if (isPortfolioInitiativeLevel(level) && PORTFOLIO_KEYS.includes(projectKey)) {
      if (isUnexpectedLevel2TypeName(typeName) && !reportedLevel2.has(typeName)) {
        reportedLevel2.add(typeName);
        warnings.push(
          `Unrecognised hierarchy-level-2 issue type "${typeName}" in ${projectKey} ` +
            `(first seen on ${issue.key}). Ingested; add to KNOWN_LEVEL_2_TYPE_NAMES if expected.`,
        );
      }
      initiatives.push(issue);
      continue;
    }

    if (isRoadmapItemLevel(level)) {
      if (isUnexpectedLevel1TypeName(typeName) && !reportedLevel1.has(typeName)) {
        reportedLevel1.add(typeName);
        warnings.push(
          `Unrecognised hierarchy-level-1 issue type "${typeName}" in ${projectKey} ` +
            `(first seen on ${issue.key}). Ingested as a roadmap item; ` +
            `add to KNOWN_LEVEL_1_TYPE_NAMES if expected.`,
        );
      }
      // Level-1 issues inside a portfolio project are not site work; skip them.
      if (!PORTFOLIO_KEYS.includes(projectKey)) items.push(issue);
      continue;
    }

    // Levels -1 and 0 are operational detail and are expected to be dropped.
  }

  return { items, initiatives };
}

// ---------------------------------------------------------------------------
// Links
// ---------------------------------------------------------------------------

function linksOf(issue: JiraIssue): IssueLink[] {
  const raw = issue.fields['issuelinks'];
  return Array.isArray(raw) ? (raw as IssueLink[]) : [];
}

/**
 * Finds the portfolio Initiative an item delivers.
 *
 * Matching is UNDIRECTED: discovery confirmed the link direction is not
 * consistently curated -- for `DDTGMPORT-27`, most site items appear as
 * `inwardIssue` but `DDTHIK-38` appears as `outwardIssue`. Honouring direction
 * would drop real relationships.
 *
 * The counterpart must be in a configured portfolio project: items also link to
 * each other and to out-of-scope projects (e.g. `DDTLESS-96` -> `LESOPS-77`).
 */
export function findInitiativeKey(issue: JiraIssue): string | undefined {
  for (const link of linksOf(issue)) {
    const typeMatches =
      link.type?.id === INITIATIVE_LINK_TYPE_ID || link.type?.name === INITIATIVE_LINK_TYPE_NAME;
    if (!typeMatches) continue;

    for (const counterpart of [link.inwardIssue?.key, link.outwardIssue?.key]) {
      if (!counterpart) continue;
      const projectKey = counterpart.split('-')[0]!;
      if (PORTFOLIO_KEYS.includes(projectKey)) return counterpart;
    }
  }
  return undefined;
}

/**
 * Blocking dependencies from issue links. `Flagged` (customfield_10387) is
 * populated on zero items portfolio-wide, so links are the only available signal.
 */
export function findBlockers(issue: JiraIssue): Blocker[] {
  const blockers: Blocker[] = [];

  for (const link of linksOf(issue)) {
    const inward = link.type?.inward?.toLowerCase() ?? '';
    if (!BLOCKING_LINK_INWARD_DESCRIPTIONS.some((d) => inward.includes(d))) continue;

    // `inwardIssue` present means THIS issue is blocked by that one.
    const blocking = link.inwardIssue;
    if (!blocking?.key) continue;

    const status = blocking.fields?.['status'] as Record<string, unknown> | undefined;
    const category = status?.['statusCategory'] as Record<string, unknown> | undefined;
    const done = category?.['key'] === 'done';

    blockers.push({
      key: blocking.key,
      summary: extractScalar(blocking.fields?.['summary']) ?? blocking.key,
      type: link.type?.inward ?? 'is blocked by',
      open: !done,
    });
  }

  return blockers;
}

// ---------------------------------------------------------------------------
// Roadmap item
// ---------------------------------------------------------------------------

/** Days since an ISO timestamp, floored at zero. */
function daysSince(timestamp: string | undefined, asOf: string): number {
  if (!timestamp) return 0;
  const date = timestamp.slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return 0;
  return Math.max(0, daysBetween(date, asOf));
}

/**
 * Resolves the SPOT narrative from whichever of the per-site candidate fields is
 * populated. Returns the first candidate that actually parses, so a present but
 * empty field does not mask a populated one further down the list.
 */
function findSpotDescription(fields: JiraIssue['fields']): ReturnType<typeof parseSpotDescription> {
  for (const fieldId of SPOT_DESCRIPTION_FIELD_CANDIDATES) {
    const parsed = parseSpotDescription(fields[fieldId]);
    if (parsed) return parsed;
  }
  return undefined;
}

export function transformItem(
  issue: JiraIssue,
  context: TransformContext,
  initiativeIndex?: Map<string, { summary: string; siteCount: number }>,
): RoadmapItem | undefined {
  const fields = issue.fields;
  const projectKey = projectKeyOf(issue);
  const site = resolveSite(projectKey);

  if (!site) {
    context.warnings.push(
      `Issue ${issue.key} belongs to project ${projectKey}, which is not in the site ` +
        `registry. Skipped. Add it to config/projects.ts if it should be in scope.`,
    );
    return undefined;
  }

  const status = normaliseStatus(fields['status']);
  if (status.usedCategoryFallback) {
    context.warnings.push(
      `Unmapped status "${status.raw}" in ${projectKey} (e.g. ${issue.key}); ` +
        `fell back to statusCategory -> "${status.phase}". Add it to config/status-map.ts.`,
    );
  }

  const updatedAt = extractScalar(fields['updated']) ?? `${context.asOf}T00:00:00.000Z`;
  const daysSinceUpdate = daysSince(updatedAt, context.asOf);

  // Primary date fields, with the JPO baseline fields as a fallback.
  const start = extractDate(fields[FIELD_START_DATE]) ?? extractDate(fields[FIELD_TARGET_START]);
  const end = extractDate(fields[FIELD_DUE_DATE]) ?? extractDate(fields[FIELD_TARGET_END]);

  if (start && end && daysBetween(start, end) < 0) {
    context.warnings.push(
      `${issue.key} has a start date (${start}) after its go-live date (${end}). ` +
        `Retained, with the span normalised.`,
    );
  }

  const summary = parseSummary(extractScalar(fields['summary']) ?? issue.key);

  const authoredRag = normaliseAuthoredRag(fields, updatedAt);
  for (const unmapped of findUnmappedRagValues(fields)) {
    context.warnings.push(
      `${issue.key} has an unrecognised status value "${unmapped.value}" in ` +
        `${unmapped.fieldId}; ignored in favour of a derived signal. ` +
        `Add it to RAG_VALUE_TO_RISK_LEVEL if it is meaningful.`,
    );
  }

  const blockers = findBlockers(issue);

  const risk = assessRisk({
    status,
    start,
    end,
    daysSinceUpdate,
    blockers,
    authoredRag,
    asOf: context.asOf,
  });

  // The SPOT narrative field ID varies by site, so coalesce the candidates the
  // same way the RAG is resolved. At most one is populated per item (asserted by
  // verify-snapshot), so the first that parses is the only one that parses.
  const spot = findSpotDescription(fields);
  for (const label of spot?.unmappedLabels ?? []) {
    context.warnings.push(
      `${issue.key} SPOT Description contains an unmapped row "${label}"; ` +
        `add it to LABEL_TO_FIELD in src/lib/adf.ts if it should be surfaced.`,
    );
  }

  const initiativeKey = findInitiativeKey(issue);
  const initiativeMeta = initiativeKey ? initiativeIndex?.get(initiativeKey) : undefined;

  const narrative = buildNarrative({
    risk,
    phase: status.phase,
    statusRaw: status.raw,
    start,
    goLive: end,
    daysSinceUpdate,
    updatedAt,
    spot,
    description: flattenToText(fields['description']),
    initiativeSummary: initiativeMeta?.summary,
    initiativeSiteCount: initiativeMeta?.siteCount,
  });

  // Field first, summary second -- the field is authoritative when present.
  const spotIdFromField = normaliseSpotIdFromField(fields);
  const spotId = spotIdFromField ?? summary.spotId;
  const spotIdSource = spotIdFromField ? 'field' : summary.spotId ? 'summary' : undefined;

  const declaredFiscalYear =
    extractScalar(fields[FIELD_FISCAL_YEAR]) ??
    (Array.isArray(fields['labels'])
      ? (fields['labels'] as string[]).find((l) => /^FY\d{2}$/i.test(l))
      : undefined) ??
    summary.fyTag;

  return {
    key: issue.key,
    summary,
    siteKey: site.key,
    siteName: site.name,
    siteCode: site.code,
    region: site.region,
    regionProvisional: site.regionProvisional,
    inCurrentPowerBiScope: site.inCurrentPowerBiScope,
    issueTypeName: issueTypeNameOf(issue),
    ...(initiativeKey ? { initiativeKey } : {}),
    alignment: initiativeKey ? 'initiative' : 'local',
    status: { raw: status.raw, phase: status.phase, category: status.category },
    ...(start ? { start } : {}),
    ...(end ? { end } : {}),
    ...(end ? { goLive: end } : {}),
    fiscalYears: fiscalYearsSpanned(start, end),
    ...(declaredFiscalYear ? { declaredFiscalYear } : {}),
    risk,
    narrative,
    owners: normaliseOwners(fields),
    ...(spotId ? { spotId } : {}),
    ...(spotIdSource ? { spotIdSource } : {}),
    ...(spotId ? { spotUrl: spotUrlFor(spotId) } : {}),
    updatedAt,
    daysSinceUpdate,
    blockers,
    childCount: { total: 0, done: 0 },
    jiraUrl: `${context.baseUrl}/browse/${issue.key}`,
  };
}

// ---------------------------------------------------------------------------
// Initiative
// ---------------------------------------------------------------------------

export function transformInitiative(
  issue: JiraIssue,
  linkedItems: readonly RoadmapItem[],
  context: TransformContext,
): Initiative {
  const fields = issue.fields;
  const status = normaliseStatus(fields['status']);
  const updatedAt = extractScalar(fields['updated']) ?? `${context.asOf}T00:00:00.000Z`;
  const daysSinceUpdate = daysSince(updatedAt, context.asOf);

  // Portfolio RAG lives in a field that renders as "Asset ID" -- an anomaly
  // accepted by decision. See config/fields.ts.
  const authoredRag = normaliseAuthoredRag(fields, updatedAt, [
    { id: FIELD_PORTFOLIO_RAG, label: 'Overall Status (portfolio)', isSpot: false },
  ]);

  const authoredStart = extractDate(fields[FIELD_START_DATE]) ?? extractDate(fields[FIELD_TARGET_START]);
  const authoredEnd = extractDate(fields[FIELD_DUE_DATE]) ?? extractDate(fields[FIELD_TARGET_END]);

  const derived = deriveInitiativeDates(linkedItems);
  const start = authoredStart ?? derived.start;
  const end = authoredEnd ?? derived.end;
  const datesDerived = (!authoredStart && Boolean(derived.start)) || (!authoredEnd && Boolean(derived.end));

  const siteRollup = buildSiteRollup(linkedItems);
  const risk = rollUpRisk(
    linkedItems.map((i) => i.risk.level),
    authoredRag,
  );

  const description = flattenToText(fields['description']);

  const narrative = buildInitiativeNarrative({
    risk,
    phase: status.phase,
    statusRaw: status.raw,
    description,
    siteCount: siteRollup.length,
    atRiskCount: siteRollup.filter((s) => s.atRiskCount > 0).length,
    start,
    end,
    updatedAt,
    daysSinceUpdate,
  });

  return {
    key: issue.key,
    portfolioKey: projectKeyOf(issue),
    summary: extractScalar(fields['summary']) ?? issue.key,
    ...(description ? { description } : {}),
    status: { raw: status.raw, phase: status.phase, category: status.category },
    ...(start ? { start } : {}),
    ...(end ? { end } : {}),
    datesDerived,
    hasDates: Boolean(start && end),
    ...(authoredRag ? { authoredRag: authoredRag.authored.value } : {}),
    risk,
    narrative,
    itemKeys: linkedItems.map((i) => i.key),
    siteRollup,
    owners: normaliseOwners(fields),
    ...(normaliseSpotIdFromField(fields) ? { spotId: normaliseSpotIdFromField(fields)! } : {}),
    updatedAt,
    jiraUrl: `${context.baseUrl}/browse/${issue.key}`,
  };
}

/**
 * The lane for site-local initiatives -- items with no link to a DDTGMPORT
 * Initiative. Modelled as an initiative so the UI has one uniform lane type.
 *
 * `alignment: 'local'` IS A FIRST-CLASS, EXPECTED STATE, NOT A DATA GAP. Measured
 * on 2026-08-07, 261 of 510 in-scope level-1 items (51%) are site-local, so this
 * lane is the largest single lane in the portfolio -- it is normal for a site to
 * run work that does not roll up to a global programme. Do not report these as
 * unlinked, missing or broken, and do not exclude them from site or regional
 * totals.
 *
 * The distribution is wide and both extremes are real:
 *   - `DDTYAR` (Yaroslavl) is 17 of 17 site-local -- it has NO GMPORT linkage at
 *     all, confirmed independently in two OData feeds. A site reporting zero
 *     initiative alignment is therefore a legitimate outcome and must not be
 *     treated as a link-matching regression.
 *   - `DDTVAS` (Vashi) is the opposite: 15 of 15 aligned, zero local.
 *
 * verify-snapshot reports the per-site split and names any fully-site-local site
 * so the condition stays visible rather than being inferred from a total.
 */
export function buildUnalignedInitiative(
  items: readonly RoadmapItem[],
  context: TransformContext,
): Initiative {
  const siteRollup = buildSiteRollup(items);
  const derived = deriveInitiativeDates(items);
  const risk = rollUpRisk(items.map((i) => i.risk.level));

  return {
    key: UNALIGNED_INITIATIVE_KEY,
    portfolioKey: '',
    summary: UNALIGNED_INITIATIVE_LABEL,
    description:
      'Site-led work delivered outside the global portfolio programmes. These items ' +
      'have no Polaris work item link to a DDTGMPORT Initiative, which is an expected ' +
      'delivery model rather than missing data.',
    status: { raw: 'n/a', phase: 'execute', category: 'in-progress' },
    ...(derived.start ? { start: derived.start } : {}),
    ...(derived.end ? { end: derived.end } : {}),
    datesDerived: true,
    hasDates: Boolean(derived.start && derived.end),
    risk,
    narrative: {
      executiveSummary:
        `${items.length} site-led projects across ${siteRollup.length} sites, delivered ` +
        `outside the global portfolio programmes.`,
      summarySource: 'generated',
      summaryBasis: [`itemCount=${items.length}`, `siteCount=${siteRollup.length}`],
    },
    itemKeys: items.map((i) => i.key),
    siteRollup,
    owners: [],
    updatedAt: `${context.asOf}T00:00:00.000Z`,
    jiraUrl: '',
  };
}

// ---------------------------------------------------------------------------
// Canary
// ---------------------------------------------------------------------------

/**
 * Counts issues with the `Flagged` field populated. Discovery measured zero
 * portfolio-wide; if that ever changes, the field becomes a usable blocker signal
 * and this reports it.
 */
export function countFlaggedPopulated(issues: readonly JiraIssue[]): number {
  return issues.filter((i) => extractScalar(i.fields[FIELD_FLAGGED_UNUSABLE])).length;
}

/** Today in UTC as `YYYY-MM-DD`. */
export function todayIso(): string {
  return toIsoDate(new Date());
}
