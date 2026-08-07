/**
 * Initiative drill-down view model.
 *
 * ONE THING MUST NOT BE SOFTENED HERE: every initiative's RAG is `inferred`,
 * because no feed exposes customfield_11199 and DDTGMPORT carries no authored RAG
 * of any kind. Initiative status is therefore ROLLED UP from linked projects. The
 * page must say so -- if the Power BI report shows an authored initiative RAG, this
 * will visibly differ, and the reason has to be on screen rather than looking like
 * a defect. `statusIsRolledUp` drives that disclosure.
 */

import type { Initiative, RiskLevel, SiteRollup, Snapshot } from '@/types/domain.js';
import { UNALIGNED_INITIATIVE_KEY } from '@/types/domain.js';
import { worstRisk } from '@/lib/rollup.js';
import { buildTimelineScale, type TimelineScale } from './timeline.js';
import { applyFilters, type Filters } from './filters.js';
import { toItemRow, type ItemRow } from './site.js';

export interface SiteRollupRow extends SiteRollup {
  xPct?: number;
  href: string;
}

export interface InitiativeModel {
  initiative: Initiative;
  scale: TimelineScale;
  /** Grouped by site, matching the reference report's Initiative-Project matrix. */
  siteGroups: { siteKey: string; siteName: string; siteCode: string; level: RiskLevel; rows: ItemRow[] }[];
  siteRollup: SiteRollupRow[];
  noDates: ItemRow[];
  itemCount: number;
  siteCount: number;
  atRiskCount: number;
  /** True whenever the displayed RAG came from a rollup rather than a field. */
  statusIsRolledUp: boolean;
  isLocalLane: boolean;
}

export function buildInitiativeModel(
  snapshot: Snapshot,
  key: string,
  filters: Filters,
): InitiativeModel | undefined {
  const initiative = snapshot.initiatives.find((i) => i.key === key);
  if (!initiative) return undefined;

  const isLocalLane = initiative.key === UNALIGNED_INITIATIVE_KEY;

  const items = applyFilters(snapshot.items, filters).filter((item) =>
    isLocalLane ? item.alignment === 'local' : item.initiativeKey === initiative.key,
  );

  const scale = buildTimelineScale(
    [...items.map((i) => ({ start: i.start, end: i.end })), { start: initiative.start, end: initiative.end }],
    snapshot.asOf,
  );

  const bySite = new Map<string, typeof items>();
  for (const item of items) {
    const list = bySite.get(item.siteKey);
    if (list) list.push(item);
    else bySite.set(item.siteKey, [item]);
  }

  const plottable = (row: ItemRow): boolean => Boolean(row.bar) || row.pointPct !== undefined;
  const noDates: ItemRow[] = [];

  const siteGroups = [...bySite.entries()]
    .map(([siteKey, siteItems]) => {
      const rows = siteItems.map((i) => toItemRow(i, scale));
      for (const row of rows) if (!plottable(row)) noDates.push(row);
      const first = siteItems[0]!;
      return {
        siteKey,
        siteName: first.siteName,
        siteCode: first.siteCode,
        level: worstRisk(siteItems.map((i) => i.risk.level)),
        rows: rows.filter(plottable),
      };
    })
    .sort((a, b) => b.rows.length - a.rows.length);

  return {
    initiative,
    scale,
    siteGroups,
    siteRollup: initiative.siteRollup.map((site) => ({
      ...site,
      ...(scale.pointFor(site.goLive) !== undefined ? { xPct: scale.pointFor(site.goLive)! } : {}),
      href: `/sites/${site.siteKey}`,
    })),
    noDates,
    itemCount: items.length,
    siteCount: bySite.size,
    atRiskCount: items.filter((i) => i.risk.atRisk).length,
    statusIsRolledUp: initiative.risk.provenance === 'inferred' || initiative.authoredRag === undefined,
    isLocalLane,
  };
}

/** Initiative list for the index, worst-health first. */
export function buildInitiativeIndex(snapshot: Snapshot): {
  key: string;
  summary: string;
  level: RiskLevel;
  itemCount: number;
  siteCount: number;
  hasDates: boolean;
  isLocalLane: boolean;
}[] {
  const order: RiskLevel[] = ['blocked', 'attention', 'monitor', 'unreported', 'on-track', 'complete', 'cancelled'];

  return snapshot.initiatives
    .map((i) => ({
      key: i.key,
      summary: i.summary,
      level: i.risk.level,
      itemCount: i.itemKeys.length,
      siteCount: i.siteRollup.length,
      hasDates: i.hasDates,
      isLocalLane: i.key === UNALIGNED_INITIATIVE_KEY,
    }))
    .sort((a, b) => {
      if (a.isLocalLane !== b.isLocalLane) return a.isLocalLane ? 1 : -1;
      const d = order.indexOf(a.level) - order.indexOf(b.level);
      return d !== 0 ? d : b.itemCount - a.itemCount;
    });
}
