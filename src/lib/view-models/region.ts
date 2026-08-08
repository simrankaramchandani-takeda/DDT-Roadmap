/**
 * Region view model -- projects grouped by site code, matching reference page 3
 * (its "Americas" page groups by site code and labels each group `(36 items)`).
 *
 * WHAT THIS ADDS over the reference page is the aggregate strip: that page is a
 * Gantt and nothing else, so "how much of this region is at risk" can only be
 * answered by counting bars. The tiles answer it directly.
 *
 * WHAT IT DELIBERATELY DOES NOT ADD is any special treatment for site-led work.
 * At this grain alignment is not the question being asked -- a site's projects are
 * a site's projects -- so a local item sits in its site's group like any other.
 * The alignment split is a first-class figure on the Overview instead.
 *
 * REGION IS NOT A CLOSED SET AT THIS LAYER. Validity is decided by the data, not
 * by config/regions.ts: `Unassigned` is a legitimate route because it means config
 * is incomplete, and a page that 404s on it would hide exactly the finding that
 * verify-snapshot fails on.
 */

import type { RiskLevel, RoadmapItem, SiteSummary, Snapshot } from '@/types/domain.js';
import { worstRisk } from '@/lib/rollup.js';
import { buildTimelineScale, type TimelineScale } from './timeline.js';
import { applyFilters, type Filters } from './filters.js';
import { toItemRow, type ItemRow } from './site.js';

export interface RegionSiteGroup {
  siteKey: string;
  siteName: string;
  siteCode: string;
  itemCount: number;
  atRiskCount: number;
  level: RiskLevel;
  regionProvisional: boolean;
  rows: ItemRow[];
  href: string;
}

export interface RegionModel {
  region: string;
  scale: TimelineScale;
  groups: RegionSiteGroup[];
  noDates: ItemRow[];
  itemCount: number;
  atRiskCount: number;
  siteCount: number;
  authoredCount: number;
  alignedCount: number;
  localCount: number;
  nextGoLive?: string;
  /** Sites whose region assignment came from the plan rather than the map. */
  provisionalSites: SiteSummary[];
  /** True when the region name resolves through neither map -- a config finding. */
  isUnassigned: boolean;
}

/**
 * Returns undefined only when the region has no sites AND no items, which means
 * the URL is a typo rather than a finding. A region with sites but no matching
 * items renders as a named empty state, because "this filter excluded everything"
 * is information.
 */
export function buildRegionModel(
  snapshot: Snapshot,
  region: string,
  filters: Filters,
): RegionModel | undefined {
  const regionSites = snapshot.sites.filter((s) => s.region === region);
  const anyItems = snapshot.items.some((i) => i.region === region);
  if (regionSites.length === 0 && !anyItems) return undefined;

  const items = applyFilters(snapshot.items, filters).filter((i) => i.region === region);
  const scale = buildTimelineScale(
    items.map((i) => ({ start: i.start, end: i.end })),
    snapshot.asOf,
  );

  const bySite = new Map<string, RoadmapItem[]>();
  for (const item of items) {
    const list = bySite.get(item.siteKey);
    if (list) list.push(item);
    else bySite.set(item.siteKey, [item]);
  }

  const plottable = (row: ItemRow): boolean => Boolean(row.bar) || row.pointPct !== undefined;
  const noDates: ItemRow[] = [];

  const groups: RegionSiteGroup[] = [...bySite.entries()]
    .map(([siteKey, siteItems]) => {
      const rows = siteItems.map((i) => toItemRow(i, scale));
      for (const row of rows) if (!plottable(row)) noDates.push(row);
      const first = siteItems[0]!;

      return {
        siteKey,
        siteName: first.siteName,
        siteCode: first.siteCode,
        itemCount: siteItems.length,
        atRiskCount: siteItems.filter((i) => i.risk.atRisk).length,
        level: worstRisk(siteItems.map((i) => i.risk.level)),
        regionProvisional: first.regionProvisional,
        rows: rows.filter(plottable),
        href: `/sites/${siteKey}`,
      };
    })
    // Largest site first: the reference page orders by code, but volume is the
    // more useful reading order once the page carries counts.
    .sort((a, b) => b.itemCount - a.itemCount || a.siteCode.localeCompare(b.siteCode));

  const goLives = items
    .filter((i) => i.goLive && i.risk.level !== 'complete' && i.risk.level !== 'cancelled')
    .map((i) => i.goLive!)
    .filter((d) => d >= snapshot.asOf)
    .sort();

  const local = items.filter((i) => i.alignment === 'local').length;

  return {
    region,
    scale,
    groups,
    noDates,
    itemCount: items.length,
    atRiskCount: items.filter((i) => i.risk.atRisk).length,
    siteCount: bySite.size,
    authoredCount: items.filter(
      (i) => i.risk.provenance === 'spot' || i.risk.provenance === 'reported',
    ).length,
    alignedCount: items.length - local,
    localCount: local,
    ...(goLives[0] ? { nextGoLive: goLives[0] } : {}),
    provisionalSites: regionSites.filter((s) => s.regionProvisional),
    isUnassigned: region === 'Unassigned',
  };
}

export interface RegionIndexRow {
  region: string;
  itemCount: number;
  atRiskCount: number;
  atRiskPct: number;
  siteCount: number;
  level: RiskLevel;
  href: string;
}

/**
 * Region list for the index, largest first.
 *
 * Built from `sites` rather than from items so a region whose every site is empty
 * still appears. That is the same reasoning as buildSiteIndex: an absent row reads
 * as "nothing to see", where a zero row reads as a finding.
 */
export function buildRegionIndex(snapshot: Snapshot): RegionIndexRow[] {
  const regions = new Set<string>([
    ...snapshot.sites.map((s) => s.region),
    ...snapshot.items.map((i) => i.region),
  ]);

  const active = snapshot.items.filter(
    (i) => i.risk.level !== 'complete' && i.risk.level !== 'cancelled',
  );

  return [...regions]
    .map((region) => {
      const items = active.filter((i) => i.region === region);
      const atRisk = items.filter((i) => i.risk.atRisk).length;

      return {
        region,
        itemCount: items.length,
        atRiskCount: atRisk,
        atRiskPct: items.length === 0 ? 0 : Math.round((atRisk / items.length) * 100),
        siteCount: snapshot.sites.filter((s) => s.region === region).length,
        level: worstRisk(items.map((i) => i.risk.level)),
        href: `/regions/${encodeURIComponent(region)}`,
      };
    })
    .sort((a, b) => b.itemCount - a.itemCount || a.region.localeCompare(b.region));
}
