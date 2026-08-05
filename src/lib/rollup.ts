/**
 * Aggregation from items up to initiatives, sites and regions.
 *
 * The `siteRollup` produced here is what powers the per-site go-live markers on a
 * collapsed initiative lane -- the most effective device in the current Power BI
 * report, and the reason the collapsed view can communicate rollout sequencing
 * without expanding anything.
 */

import type {
  Coverage,
  Initiative,
  RiskLevel,
  RoadmapItem,
  SiteRollup,
  SiteSummary,
} from '@/types/domain.js';
import { isAtRisk, worstRisk } from './risk.js';
import { RESOLVED_SITES } from '@config/projects.js';
import { RISK_THRESHOLDS } from '@config/narrative.js';
import { daysBetween } from './fiscal-year.js';

/** Earliest of a set of dates, ignoring undefined. */
export function earliest(dates: readonly (string | undefined)[]): string | undefined {
  const present = dates.filter((d): d is string => Boolean(d));
  if (present.length === 0) return undefined;
  return present.reduce((min, d) => (d < min ? d : min));
}

/** Latest of a set of dates, ignoring undefined. */
export function latest(dates: readonly (string | undefined)[]): string | undefined {
  const present = dates.filter((d): d is string => Boolean(d));
  if (present.length === 0) return undefined;
  return present.reduce((max, d) => (d > max ? d : max));
}

/**
 * Groups an initiative's items by site.
 *
 * `goLive` per site is the EARLIEST go-live among that site's items, because the
 * marker answers "when does this programme first land here?". Risk is the WORST
 * across them, because a single red project at a site is what leadership needs to
 * see -- averaging would hide it.
 */
export function buildSiteRollup(items: readonly RoadmapItem[]): SiteRollup[] {
  const bySite = new Map<string, RoadmapItem[]>();

  for (const item of items) {
    const list = bySite.get(item.siteKey);
    if (list) list.push(item);
    else bySite.set(item.siteKey, [item]);
  }

  const rollups: SiteRollup[] = [];

  for (const [siteKey, siteItems] of bySite) {
    const first = siteItems[0]!;
    const goLive = earliest(siteItems.map((i) => i.goLive));

    rollups.push({
      siteKey,
      siteName: first.siteName,
      siteCode: first.siteCode,
      region: first.region,
      ...(goLive ? { goLive } : {}),
      risk: worstRisk(siteItems.map((i) => i.risk.level)),
      itemCount: siteItems.length,
      atRiskCount: siteItems.filter((i) => i.risk.atRisk).length,
    });
  }

  // Chronological by go-live so the collapsed lane reads as a rollout sequence;
  // sites with no date sort last rather than disappearing.
  return rollups.sort((a, b) => {
    if (a.goLive && b.goLive) return a.goLive < b.goLive ? -1 : a.goLive > b.goLive ? 1 : 0;
    if (a.goLive) return -1;
    if (b.goLive) return 1;
    return a.siteCode.localeCompare(b.siteCode);
  });
}

/**
 * Derives an initiative's span from its items when not authored.
 * Returned separately from the initiative so `datesDerived` can be recorded --
 * a derived span must not be presented as a commitment.
 */
export function deriveInitiativeDates(items: readonly RoadmapItem[]): {
  start?: string;
  end?: string;
} {
  const start = earliest(items.map((i) => i.start));
  const end = latest(items.map((i) => i.end));
  return { ...(start ? { start } : {}), ...(end ? { end } : {}) };
}

/** Per-site summary rows, including sites with zero items so an empty site is
 *  visible as a finding rather than absent from the list. */
export function buildSiteSummaries(items: readonly RoadmapItem[]): SiteSummary[] {
  const counts = new Map<string, number>();
  for (const item of items) {
    counts.set(item.siteKey, (counts.get(item.siteKey) ?? 0) + 1);
  }

  return RESOLVED_SITES.map((site) => ({
    key: site.key,
    name: site.name,
    code: site.code,
    region: site.region,
    regionProvisional: site.regionProvisional,
    inCurrentPowerBiScope: site.inCurrentPowerBiScope,
    activeCount: counts.get(site.key) ?? 0,
    expectedActiveCount: site.expectedActiveItems,
  })).sort((a, b) => b.activeCount - a.activeCount);
}

function tally<T extends string>(values: readonly T[]): Record<string, number> {
  const out: Record<string, number> = {};
  for (const v of values) out[v] = (out[v] ?? 0) + 1;
  return out;
}

/**
 * Coverage statistics. These are the numbers the Phase 1 gate is judged on, and
 * the permanent honesty mechanism in the UI: the counts of what is NOT known are
 * as prominent as what is.
 */
export function buildCoverage(
  allItems: readonly RoadmapItem[],
  activeItems: readonly RoadmapItem[],
  asOf: string,
  flaggedFieldPopulated: number,
): Coverage {
  const withStart = activeItems.filter((i) => i.start).length;
  const withEnd = activeItems.filter((i) => i.end).length;
  const withBothDates = activeItems.filter((i) => i.start && i.end).length;

  const withSpotStatus = activeItems.filter((i) => i.risk.provenance === 'spot').length;
  const withAnyRag = activeItems.filter(
    (i) => i.risk.provenance === 'spot' || i.risk.provenance === 'reported',
  ).length;
  const withNarrative = activeItems.filter((i) => i.narrative.summarySource === 'spot').length;

  const overdueActive = activeItems.filter(
    (i) => i.end && daysBetween(i.end, asOf) >= RISK_THRESHOLDS.overdueMonitorDays,
  ).length;
  const staleActive = activeItems.filter(
    (i) => i.daysSinceUpdate >= RISK_THRESHOLDS.staleDays,
  ).length;

  return {
    itemsTotal: allItems.length,
    itemsActive: activeItems.length,
    withStart,
    withEnd,
    withBothDates,
    withSpotStatus,
    withAnyRag,
    withNarrative,
    spotIdFromField: activeItems.filter((i) => i.spotIdSource === 'field').length,
    spotIdFromSummary: activeItems.filter((i) => i.spotIdSource === 'summary').length,
    overdueActive,
    staleActive,
    flaggedFieldPopulated,
    byRegion: tally(activeItems.map((i) => i.region)),
    byRiskLevel: tally(activeItems.map((i) => i.risk.level)),
    bySummarySource: tally(activeItems.map((i) => i.narrative.summarySource)),
    byProvenance: tally(activeItems.map((i) => i.risk.provenance)),
  };
}

/** Portfolio health distribution across initiatives, for the outlook bar. */
export function buildPortfolioHealth(
  initiatives: readonly Initiative[],
): Record<RiskLevel, number> {
  const out = {
    'on-track': 0,
    monitor: 0,
    attention: 0,
    blocked: 0,
    complete: 0,
    cancelled: 0,
    unreported: 0,
  } as Record<RiskLevel, number>;

  for (const initiative of initiatives) out[initiative.risk.level]++;
  return out;
}

/** Counts of at-risk items per region, for the regional rollup. */
export function buildRegionRollup(
  items: readonly RoadmapItem[],
): { region: string; total: number; atRisk: number }[] {
  const byRegion = new Map<string, { total: number; atRisk: number }>();

  for (const item of items) {
    const entry = byRegion.get(item.region) ?? { total: 0, atRisk: 0 };
    entry.total++;
    if (item.risk.atRisk) entry.atRisk++;
    byRegion.set(item.region, entry);
  }

  return [...byRegion.entries()]
    .map(([region, v]) => ({ region, ...v }))
    .sort((a, b) => b.total - a.total);
}

/** Items whose go-live falls in the next `quarters` fiscal quarters. */
export function upcomingGoLives(
  items: readonly RoadmapItem[],
  asOf: string,
  quarters = 2,
): RoadmapItem[] {
  const horizonDays = quarters * 91;

  return items
    .filter((i) => {
      if (!i.goLive) return false;
      if (i.risk.level === 'complete' || i.risk.level === 'cancelled') return false;
      const days = daysBetween(asOf, i.goLive);
      return days >= 0 && days <= horizonDays;
    })
    .sort((a, b) => (a.goLive! < b.goLive! ? -1 : a.goLive! > b.goLive! ? 1 : 0));
}

/** Items needing leadership attention, worst first. */
export function leadershipAttentionItems(
  items: readonly RoadmapItem[],
  limit?: number,
): RoadmapItem[] {
  const ranked = items
    .filter((i) => i.risk.atRisk)
    .sort((a, b) => {
      // Authored statuses outrank inferred ones at equal score: a site saying
      // "amber" is stronger evidence than the app deducing it.
      if (b.risk.score !== a.risk.score) return b.risk.score - a.risk.score;
      const rank = (p: string) => (p === 'spot' ? 0 : p === 'reported' ? 1 : 2);
      return rank(a.risk.provenance) - rank(b.risk.provenance);
    });

  return limit ? ranked.slice(0, limit) : ranked;
}

export { isAtRisk, worstRisk };
