/**
 * Data & coverage view model -- where the project's honesty about its own data
 * lives.
 *
 * This page has no counterpart in the reference report, and its absence there is
 * the point: a Gantt with no coverage disclosure lets a bar with no authored status
 * look exactly like one a site reported. Every figure below is a count of what is
 * NOT known, given the same prominence as what is.
 *
 * TWO FRESHNESS FACTS, NOT ONE. `syncedAt` is when we read the source; the newest
 * item update is how current the source data itself was. The feed is same-day
 * rather than live (D6 in design-002 §11), so reporting only `syncedAt` would imply
 * the data is more current than it is.
 *
 * EVERYTHING HERE IS UNFILTERED. Coverage describes the dataset, not a view of it;
 * a filtered coverage figure would be a different and much less useful claim, and
 * it would break the anti-drift agreement with verify-snapshot.
 */

import type { Coverage, RiskLevel, SiteSummary, Snapshot } from '@/types/domain.js';
import {
  PROVENANCE_LABELS,
  REASON_LABELS,
  RISK_LEVELS,
  RISK_LEVEL_LABELS,
  SUMMARY_SOURCE_LABELS,
  type ReasonCode,
} from '@config/narrative.js';
import type { RiskProvenance, SummarySource } from '@/types/domain.js';
import { daysBetween } from '@/lib/fiscal-year.js';

export interface CoverageRow {
  label: string;
  /** What the count means when it is LOW -- shown so a number implies an action. */
  note: string;
  known: number;
  total: number;
  pct: number;
}

export interface DistributionRow {
  key: string;
  label: string;
  count: number;
  pct: number;
}

/** Carries the level itself so the page can render a HealthMark without a cast. */
export interface HealthDistributionRow extends DistributionRow {
  level: RiskLevel;
}

export interface SiteCoverageRow {
  site: SiteSummary;
  itemCount: number;
  authored: number;
  authoredPct: number;
  narrative: number;
  narrativePct: number;
  bothDates: number;
  bothDatesPct: number;
  /** Snapshot count minus the discovery baseline. Non-zero is drift to explain. */
  drift: number;
  href: string;
}

export interface DataModel {
  asOf: string;
  syncedAt: string;
  /** Newest `updatedAt` across all items -- how current the source data itself is. */
  newestUpdate?: string;
  /** Age of that newest update, in days at `asOf`. */
  dataAgeDays?: number;
  coverage: Coverage;
  coverageRows: CoverageRow[];
  provenance: DistributionRow[];
  summarySource: DistributionRow[];
  riskLevels: HealthDistributionRow[];
  /** Why derived statuses landed where they did. Authored statuses carry no reason. */
  reasons: DistributionRow[];
  sites: SiteCoverageRow[];
  /** Sites present in config but carrying no items -- the gate's hard failure. */
  emptySites: SiteSummary[];
  provisionalRegionSites: SiteSummary[];
  driftingSites: SiteCoverageRow[];
  warnings: string[];
  itemsTotal: number;
  itemsActive: number;
  initiativeCount: number;
  /** Initiatives with no plottable span -- an invisible gap made visible. */
  initiativesWithoutDates: { key: string; summary: string; itemCount: number }[];
}

function pct(n: number, total: number): number {
  return total === 0 ? 0 : Math.round((n / total) * 100);
}

function distribution(
  tally: Readonly<Record<string, number>>,
  order: readonly string[],
  labels: Readonly<Record<string, string>>,
): DistributionRow[] {
  const total = Object.values(tally).reduce((sum, n) => sum + n, 0);

  return order
    .map((key) => ({
      key,
      label: labels[key] ?? key,
      count: tally[key] ?? 0,
      pct: pct(tally[key] ?? 0, total),
    }))
    .filter((row) => row.count > 0);
}

const PROVENANCE_ORDER: readonly RiskProvenance[] = ['spot', 'reported', 'inferred', 'none'];
const SUMMARY_SOURCE_ORDER: readonly SummarySource[] = ['spot', 'jira-description', 'generated'];

export function buildDataModel(snapshot: Snapshot): DataModel {
  const { coverage, items } = snapshot;

  const active = items.filter(
    (i) => i.risk.level !== 'complete' && i.risk.level !== 'cancelled',
  );

  const newestUpdate = items.reduce<string | undefined>(
    (newest, item) => (!newest || item.updatedAt > newest ? item.updatedAt : newest),
    undefined,
  );

  // Coverage rows read as "known of total", never as a bare percentage: 83% of
  // what matters more than 83%.
  const coverageRows: CoverageRow[] = [
    {
      label: 'Authored a status',
      note: 'The remainder carry a status derived from schedule and activity, always labelled as inferred.',
      known: coverage.withAnyRag,
      total: coverage.itemsActive,
      pct: pct(coverage.withAnyRag, coverage.itemsActive),
    },
    {
      label: 'Reported through SPOT',
      note: 'The strongest evidence available: a status the site authored in its own SPOT field.',
      known: coverage.withSpotStatus,
      total: coverage.itemsActive,
      pct: pct(coverage.withSpotStatus, coverage.itemsActive),
    },
    {
      label: 'Explain their status',
      note: 'A site-authored narrative. Where this is absent, no source states why the status is what it is.',
      known: coverage.withNarrative,
      total: coverage.itemsActive,
      pct: pct(coverage.withNarrative, coverage.itemsActive),
    },
    {
      label: 'Both start and go-live',
      note: 'Only these can render as a span. One date renders as a milestone; neither renders in the no-dates group.',
      known: coverage.withBothDates,
      total: coverage.itemsActive,
      pct: pct(coverage.withBothDates, coverage.itemsActive),
    },
    {
      label: 'A go-live date',
      note: 'Go-live is the Jira due date — there is no dedicated go-live field anywhere in the schema.',
      known: coverage.withEnd,
      total: coverage.itemsActive,
      pct: pct(coverage.withEnd, coverage.itemsActive),
    },
    {
      label: 'A SPOT ID',
      note: `${coverage.spotIdFromField} from the dedicated field, ${coverage.spotIdFromSummary} recovered from the project title.`,
      known: coverage.spotIdFromField + coverage.spotIdFromSummary,
      total: coverage.itemsActive,
      pct: pct(coverage.spotIdFromField + coverage.spotIdFromSummary, coverage.itemsActive),
    },
  ];

  const reasonTally: Record<string, number> = {};
  for (const item of items) {
    for (const reason of item.risk.reasons) {
      reasonTally[reason.code] = (reasonTally[reason.code] ?? 0) + 1;
    }
  }

  const sites: SiteCoverageRow[] = snapshot.sites.map((site) => {
    const siteItems = active.filter((i) => i.siteKey === site.key);
    const authored = siteItems.filter(
      (i) => i.risk.provenance === 'spot' || i.risk.provenance === 'reported',
    ).length;
    const narrative = siteItems.filter((i) => i.narrative.summarySource === 'spot').length;
    const bothDates = siteItems.filter((i) => i.start && i.end).length;

    return {
      site,
      itemCount: siteItems.length,
      authored,
      authoredPct: pct(authored, siteItems.length),
      narrative,
      narrativePct: pct(narrative, siteItems.length),
      bothDates,
      bothDatesPct: pct(bothDates, siteItems.length),
      drift: siteItems.length - site.expectedActiveCount,
      href: `/sites/${site.key}`,
    };
  });

  return {
    asOf: snapshot.asOf,
    syncedAt: snapshot.syncedAt,
    ...(newestUpdate ? { newestUpdate } : {}),
    ...(newestUpdate
      ? { dataAgeDays: Math.max(0, daysBetween(newestUpdate.slice(0, 10), snapshot.asOf)) }
      : {}),
    coverage,
    coverageRows,
    provenance: distribution(coverage.byProvenance, PROVENANCE_ORDER, PROVENANCE_LABELS),
    summarySource: distribution(coverage.bySummarySource, SUMMARY_SOURCE_ORDER, SUMMARY_SOURCE_LABELS),
    // Wording comes from RISK_LEVEL_LABELS like every other surface, so this page
    // cannot develop its own vocabulary for the same seven states.
    riskLevels: distribution(coverage.byRiskLevel, RISK_LEVELS, RISK_LEVEL_LABELS).map((row) => ({
      ...row,
      level: row.key as RiskLevel,
    })),
    reasons: distribution(
      reasonTally,
      Object.keys(REASON_LABELS) as ReasonCode[],
      REASON_LABELS,
    ),
    sites,
    emptySites: snapshot.sites.filter((s) => s.activeCount === 0),
    provisionalRegionSites: snapshot.sites.filter((s) => s.regionProvisional),
    driftingSites: sites.filter((row) => row.drift !== 0),
    warnings: snapshot.warnings,
    itemsTotal: coverage.itemsTotal,
    itemsActive: coverage.itemsActive,
    initiativeCount: snapshot.initiatives.filter((i) => i.portfolioKey !== '').length,
    initiativesWithoutDates: snapshot.initiatives
      .filter((i) => !i.hasDates)
      .map((i) => ({ key: i.key, summary: i.summary, itemCount: i.itemKeys.length })),
  };
}
