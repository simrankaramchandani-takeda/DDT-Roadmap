/**
 * Executive Overview view model.
 *
 * This is the screen the reference Power BI report has no equivalent of: four Gantt
 * pages with no aggregate numbers anywhere. Everything here answers a question a
 * reader currently has to answer by counting bars.
 *
 * Reuses the four functions in src/lib/rollup.ts that were written for this UI and
 * had no caller until now: buildPortfolioHealth, buildRegionRollup, upcomingGoLives
 * and leadershipAttentionItems.
 */

import {
  buildPortfolioHealth,
  buildRegionRollup,
  leadershipAttentionItems,
  upcomingGoLives,
} from '@/lib/rollup.js';
import { AT_RISK_LEVELS } from '@config/narrative.js';
import type { Initiative, RiskLevel, RoadmapItem, Snapshot } from '@/types/domain.js';
import { HEALTH_DISTRIBUTION_ORDER } from './health.js';
import { applyFilters, type Filters } from './filters.js';

export interface HealthSlice {
  level: RiskLevel;
  count: number;
  pct: number;
}

export interface AttentionRow {
  key: string;
  title: string;
  siteName: string;
  siteCode: string;
  region: string;
  risk: RoadmapItem['risk'];
  /** The single most important reason, already resolved for display. */
  primaryReason?: { label: string; detail: string };
  goLive?: string;
}

export interface GoLiveRow {
  key: string;
  title: string;
  siteCode: string;
  goLive: string;
  level: RiskLevel;
}

export interface OverviewModel {
  asOf: string;
  atRiskCount: number;
  activeCount: number;
  health: HealthSlice[];
  initiativeHealth: Record<RiskLevel, number>;
  initiativeCount: number;
  alignment: { aligned: number; local: number; total: number; localPct: number };
  coverage: {
    authored: number;
    authoredPct: number;
    narrative: number;
    narrativePct: number;
    bothDates: number;
    bothDatesPct: number;
  };
  attention: AttentionRow[];
  attentionTotal: number;
  regions: { region: string; total: number; atRisk: number; atRiskPct: number }[];
  upcoming: GoLiveRow[];
  upcomingTotal: number;
}

function pct(n: number, total: number): number {
  return total === 0 ? 0 : Math.round((n / total) * 100);
}

/** Highest-severity reason, or the first available. Never invents one. */
function primaryReason(item: RoadmapItem): { label: string; detail: string } | undefined {
  const reason = item.risk.reasons.find((r) => r.code !== 'no-immediate-action') ?? item.risk.reasons[0];
  return reason ? { label: reason.label, detail: reason.detail } : undefined;
}

export function buildOverviewModel(
  snapshot: Snapshot,
  filters: Filters,
  options: { attentionLimit?: number; upcomingLimit?: number } = {},
): OverviewModel {
  const attentionLimit = options.attentionLimit ?? 6;
  const upcomingLimit = options.upcomingLimit ?? 6;

  const items = applyFilters(snapshot.items, filters);

  // "Active" for the headline figures always means non-terminal, regardless of the
  // scope filter -- otherwise the Completed view would report "0 need attention",
  // which is true but useless as a headline.
  const active = items.filter((i) => i.risk.level !== 'complete' && i.risk.level !== 'cancelled');
  const atRisk = items.filter((i) => i.risk.atRisk);

  const counts = new Map<RiskLevel, number>();
  for (const item of items) counts.set(item.risk.level, (counts.get(item.risk.level) ?? 0) + 1);

  const health: HealthSlice[] = HEALTH_DISTRIBUTION_ORDER.map((level) => ({
    level,
    count: counts.get(level) ?? 0,
    pct: pct(counts.get(level) ?? 0, items.length),
  })).filter((slice) => slice.count > 0);

  const aligned = items.filter((i) => i.alignment === 'initiative').length;
  const local = items.length - aligned;

  const authored = items.filter(
    (i) => i.risk.provenance === 'spot' || i.risk.provenance === 'reported',
  ).length;
  const narrative = items.filter((i) => i.narrative.summarySource === 'spot').length;
  const bothDates = items.filter((i) => i.start && i.end).length;

  const ranked = leadershipAttentionItems(items);
  const upcomingItems = upcomingGoLives(items, snapshot.asOf, 2);

  // Real initiatives only -- the synthetic site-local lane is not a programme and
  // would distort the portfolio-health count.
  const realInitiatives: Initiative[] = snapshot.initiatives.filter((i) => i.portfolioKey !== '');

  return {
    asOf: snapshot.asOf,
    atRiskCount: atRisk.length,
    activeCount: active.length,
    health,
    initiativeHealth: buildPortfolioHealth(realInitiatives),
    initiativeCount: realInitiatives.length,
    alignment: { aligned, local, total: items.length, localPct: pct(local, items.length) },
    coverage: {
      authored,
      authoredPct: pct(authored, items.length),
      narrative,
      narrativePct: pct(narrative, items.length),
      bothDates,
      bothDatesPct: pct(bothDates, items.length),
    },
    attention: ranked.slice(0, attentionLimit).map((item) => ({
      key: item.key,
      title: item.summary.cleanTitle,
      siteName: item.siteName,
      siteCode: item.siteCode,
      region: item.region,
      risk: item.risk,
      ...(primaryReason(item) ? { primaryReason: primaryReason(item)! } : {}),
      ...(item.goLive ? { goLive: item.goLive } : {}),
    })),
    attentionTotal: ranked.length,
    regions: buildRegionRollup(items).map((r) => ({ ...r, atRiskPct: pct(r.atRisk, r.total) })),
    upcoming: upcomingItems.slice(0, upcomingLimit).map((item) => ({
      key: item.key,
      title: item.summary.cleanTitle,
      siteCode: item.siteCode,
      goLive: item.goLive!,
      level: item.risk.level,
    })),
    upcomingTotal: upcomingItems.length,
  };
}

/** Risk levels counted as at-risk, re-exported so the UI never redefines them. */
export { AT_RISK_LEVELS };
