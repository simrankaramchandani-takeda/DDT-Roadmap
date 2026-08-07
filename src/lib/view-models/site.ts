/**
 * Site view model -- lanes grouped by initiative, matching reference page 4,
 * including its `Local (n items)` group.
 *
 * THE DDTYAR CASE is the reason this file has more logic than the region view. A
 * site whose every project is site-led (Yaroslavl: 17 of 17, confirmed in two
 * independent feeds) must render as a legitimate delivery model, NOT as
 * "no programmes found". `isFullyLocal` drives an explanatory banner, and the
 * condition is data-derived so any future unlinked site gets it with no config.
 */

import type { RiskLevel, RoadmapItem, SiteSummary, Snapshot } from '@/types/domain.js';
import { worstRisk } from '@/lib/rollup.js';
import { buildTimelineScale, type BarGeometry, type TimelineScale } from './timeline.js';
import { applyFilters, type Filters } from './filters.js';

export interface ItemRow {
  key: string;
  title: string;
  raw: string;
  spotId?: string;
  level: RiskLevel;
  provenance: RoadmapItem['risk']['provenance'];
  phase: string;
  statusRaw: string;
  start?: string;
  end?: string;
  bar?: BarGeometry;
  /** Set when the item has a go-live but no start, so it renders as a diamond. */
  pointPct?: number;
  href: string;
  siteCode: string;
  siteName: string;
}

export interface LaneGroup {
  key: string;
  label: string;
  itemCount: number;
  level: RiskLevel;
  rows: ItemRow[];
  /** The site-led group. Rendered last and labelled as a delivery model. */
  isLocal: boolean;
  href?: string;
}

export interface SiteModel {
  site: SiteSummary;
  scale: TimelineScale;
  groups: LaneGroup[];
  noDates: ItemRow[];
  alignedCount: number;
  localCount: number;
  /** True when the site has NO work linked to a global programme. */
  isFullyLocal: boolean;
  atRiskCount: number;
  authoredCount: number;
  itemCount: number;
  nextGoLive?: string;
}

export function toItemRow(item: RoadmapItem, scale: TimelineScale): ItemRow {
  const bar = scale.barFor(item.start, item.end);
  const point = !item.start && item.end ? scale.pointFor(item.end) : undefined;

  return {
    key: item.key,
    title: item.summary.cleanTitle,
    raw: item.summary.raw,
    ...(item.summary.spotId ? { spotId: item.summary.spotId } : {}),
    level: item.risk.level,
    provenance: item.risk.provenance,
    phase: item.status.phase,
    statusRaw: item.status.raw,
    ...(item.start ? { start: item.start } : {}),
    ...(item.end ? { end: item.end } : {}),
    ...(bar ? { bar } : {}),
    ...(point !== undefined ? { pointPct: point } : {}),
    href: `/projects/${item.key}`,
    siteCode: item.siteCode,
    siteName: item.siteName,
  };
}

export function buildSiteModel(
  snapshot: Snapshot,
  siteKey: string,
  filters: Filters,
): SiteModel | undefined {
  const site = snapshot.sites.find((s) => s.key === siteKey);
  if (!site) return undefined;

  const items = applyFilters(snapshot.items, filters).filter((i) => i.siteKey === siteKey);
  const scale = buildTimelineScale(items.map((i) => ({ start: i.start, end: i.end })), snapshot.asOf);

  const initiativeSummaries = new Map(snapshot.initiatives.map((i) => [i.key, i.summary]));

  const byInitiative = new Map<string, RoadmapItem[]>();
  const localItems: RoadmapItem[] = [];

  for (const item of items) {
    if (item.alignment === 'local' || !item.initiativeKey) {
      localItems.push(item);
      continue;
    }
    const list = byInitiative.get(item.initiativeKey);
    if (list) list.push(item);
    else byInitiative.set(item.initiativeKey, [item]);
  }

  const plottable = (row: ItemRow): boolean => Boolean(row.bar) || row.pointPct !== undefined;

  const groups: LaneGroup[] = [];
  const noDates: ItemRow[] = [];

  for (const [initiativeKey, groupItems] of byInitiative) {
    const rows = groupItems.map((i) => toItemRow(i, scale));
    for (const row of rows) if (!plottable(row)) noDates.push(row);

    groups.push({
      key: initiativeKey,
      label: initiativeSummaries.get(initiativeKey) ?? initiativeKey,
      itemCount: groupItems.length,
      level: worstRisk(groupItems.map((i) => i.risk.level)),
      rows: rows.filter(plottable),
      isLocal: false,
      href: `/initiatives/${initiativeKey}`,
    });
  }

  groups.sort((a, b) => b.itemCount - a.itemCount);

  if (localItems.length > 0) {
    const rows = localItems.map((i) => toItemRow(i, scale));
    for (const row of rows) if (!plottable(row)) noDates.push(row);

    // Always last: site-led work reads as a section of the site's own portfolio,
    // not as a competitor to the global programmes above it.
    groups.push({
      key: 'site-led',
      label: 'Site-led',
      itemCount: localItems.length,
      level: worstRisk(localItems.map((i) => i.risk.level)),
      rows: rows.filter(plottable),
      isLocal: true,
    });
  }

  const alignedCount = items.length - localItems.length;
  const goLives = items
    .filter((i) => i.goLive && i.risk.level !== 'complete' && i.risk.level !== 'cancelled')
    .map((i) => i.goLive!)
    .filter((d) => d >= snapshot.asOf)
    .sort();

  return {
    site,
    scale,
    groups,
    noDates,
    alignedCount,
    localCount: localItems.length,
    isFullyLocal: items.length > 0 && alignedCount === 0,
    atRiskCount: items.filter((i) => i.risk.atRisk).length,
    authoredCount: items.filter(
      (i) => i.risk.provenance === 'spot' || i.risk.provenance === 'reported',
    ).length,
    itemCount: items.length,
    ...(goLives[0] ? { nextGoLive: goLives[0] } : {}),
  };
}

/** Site list for the index page, richest first. */
export function buildSiteIndex(snapshot: Snapshot): {
  site: SiteSummary;
  atRisk: number;
  local: number;
  aligned: number;
}[] {
  return snapshot.sites.map((site) => {
    const items = snapshot.items.filter(
      (i) => i.siteKey === site.key && i.risk.level !== 'complete' && i.risk.level !== 'cancelled',
    );
    const local = items.filter((i) => i.alignment === 'local').length;
    return {
      site,
      atRisk: items.filter((i) => i.risk.atRisk).length,
      local,
      aligned: items.length - local,
    };
  });
}
