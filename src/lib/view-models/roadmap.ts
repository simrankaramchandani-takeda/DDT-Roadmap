/**
 * Global Roadmap view model -- one lane per initiative, matching reference page 1.
 *
 * Two things the reference report does that are worth copying, and two it does that
 * are worth fixing.
 *
 * COPY: a collapsed initiative lane carries per-site go-live markers labelled with
 * the 3-letter site code. It is the most effective device in the whole report,
 * because it communicates rollout sequencing without expanding anything. That is
 * exactly what `Initiative.siteRollup` holds, already sorted chronologically.
 *
 * COPY: the site-local grouping. Its site page already has a `Local (26 items)`
 * group, so this is established vocabulary rather than something we invented.
 *
 * FIX: initiatives with no dates render as silently empty lanes there. Here they go
 * into a named group with a count, so an invisible data gap becomes a visible one.
 *
 * FIX: colliding milestones collapse to an undifferentiated `✳` glyph. Here they
 * collapse to a marker carrying a COUNT, which is strictly more informative for the
 * same pixels.
 */

import { UNALIGNED_INITIATIVE_KEY, type Initiative, type RiskLevel, type RoadmapItem, type Snapshot } from '@/types/domain.js';
import { worstRisk } from '@/lib/rollup.js';
import { buildTimelineScale, type BarGeometry, type TimelineScale } from './timeline.js';
import { applyFilters, type Filters } from './filters.js';

export interface LaneMarker {
  siteCode: string;
  siteName: string;
  goLive: string;
  level: RiskLevel;
  xPct: number;
  /** >1 when several site markers collapsed into this position. */
  count: number;
}

export interface RoadmapLane {
  key: string;
  summary: string;
  itemCount: number;
  siteCount: number;
  level: RiskLevel;
  bar?: BarGeometry;
  datesDerived: boolean;
  markers: LaneMarker[];
  /** True for the shared site-local lane, which renders collapsed with sub-lanes. */
  isLocal: boolean;
  subLanes?: RoadmapLane[];
  href?: string;
}

export interface GlobalRoadmapModel {
  scale: TimelineScale;
  lanes: RoadmapLane[];
  noDates: { key: string; summary: string; itemCount: number; isLocal: boolean }[];
  initiativeCount: number;
  itemCount: number;
  atRiskCount: number;
}

/**
 * Collapses markers that would overlap.
 *
 * Threshold is a percentage of total width rather than a pixel distance, because
 * the scale is percentage-based. 1.2% of a seven-year domain is about a month --
 * close enough that two markers would visually merge anyway, so merging them
 * deliberately and showing a count beats letting them silently overlap.
 */
function collapseMarkers(markers: LaneMarker[], thresholdPct = 1.2): LaneMarker[] {
  const sorted = [...markers].sort((a, b) => a.xPct - b.xPct);
  const out: LaneMarker[] = [];

  for (const marker of sorted) {
    const last = out[out.length - 1];
    if (last && marker.xPct - last.xPct < thresholdPct) {
      last.count += marker.count;
      // The collapsed marker takes the worst health of its constituents: a single
      // red site inside a cluster must not be hidden by a green one.
      last.level = worstRisk([last.level, marker.level]);
      continue;
    }
    out.push({ ...marker });
  }

  return out;
}

function markersFor(initiative: Initiative, scale: TimelineScale): LaneMarker[] {
  const markers: LaneMarker[] = [];

  for (const site of initiative.siteRollup) {
    const xPct = scale.pointFor(site.goLive);
    if (xPct === undefined) continue;
    markers.push({
      siteCode: site.siteCode,
      siteName: site.siteName,
      goLive: site.goLive!,
      level: site.risk,
      xPct,
      count: 1,
    });
  }

  return collapseMarkers(markers);
}

/** Per-site sub-lanes for the shared site-local lane. */
function localSubLanes(items: readonly RoadmapItem[], scale: TimelineScale): RoadmapLane[] {
  const bySite = new Map<string, RoadmapItem[]>();
  for (const item of items) {
    const list = bySite.get(item.siteKey);
    if (list) list.push(item);
    else bySite.set(item.siteKey, [item]);
  }

  const lanes: RoadmapLane[] = [];

  for (const [siteKey, siteItems] of bySite) {
    const first = siteItems[0]!;
    const starts = siteItems.map((i) => i.start).filter((d): d is string => Boolean(d));
    const ends = siteItems.map((i) => i.end).filter((d): d is string => Boolean(d));
    const start = starts.length > 0 ? starts.reduce((a, b) => (a < b ? a : b)) : undefined;
    const end = ends.length > 0 ? ends.reduce((a, b) => (a > b ? a : b)) : undefined;

    const markers = collapseMarkers(
      siteItems.flatMap((item) => {
        const xPct = scale.pointFor(item.goLive);
        if (xPct === undefined) return [];
        return [
          {
            siteCode: item.siteCode,
            siteName: item.siteName,
            goLive: item.goLive!,
            level: item.risk.level,
            xPct,
            count: 1,
          },
        ];
      }),
    );

    const bar = scale.barFor(start, end);

    lanes.push({
      key: `local:${siteKey}`,
      summary: first.siteName,
      itemCount: siteItems.length,
      siteCount: 1,
      level: worstRisk(siteItems.map((i) => i.risk.level)),
      ...(bar ? { bar } : {}),
      datesDerived: true,
      markers,
      isLocal: true,
      href: `/sites/${siteKey}`,
    });
  }

  return lanes.sort((a, b) => b.itemCount - a.itemCount);
}

export function buildGlobalRoadmapModel(snapshot: Snapshot, filters: Filters): GlobalRoadmapModel {
  const items = applyFilters(snapshot.items, filters);
  const visibleKeys = new Set(items.map((i) => i.key));

  // The scale spans the FILTERED items plus the initiatives that survive, so
  // narrowing to one site rescales the chart to that site's horizon.
  const scale = buildTimelineScale(
    [...items.map((i) => ({ start: i.start, end: i.end })), ...snapshot.initiatives.map((i) => ({ start: i.start, end: i.end }))],
    snapshot.asOf,
  );

  const lanes: RoadmapLane[] = [];
  const noDates: GlobalRoadmapModel['noDates'] = [];

  for (const initiative of snapshot.initiatives) {
    const isLocal = initiative.key === UNALIGNED_INITIATIVE_KEY;
    const laneItems = items.filter((i) =>
      isLocal ? i.alignment === 'local' : i.initiativeKey === initiative.key,
    );

    // An initiative whose every item was filtered out drops off the chart entirely,
    // rather than lingering as an empty lane. An initiative with NO items at all
    // (MetrIQ in the fixture) is a real data finding and belongs in `noDates`.
    const hasVisibleItems = laneItems.length > 0;
    const hasAnyItems = initiative.itemKeys.some((k) => visibleKeys.has(k)) || hasVisibleItems;
    if (!hasVisibleItems && hasAnyItems) continue;

    const bar = scale.barFor(initiative.start, initiative.end);

    if (!bar) {
      // No plottable span: name it rather than rendering an empty lane.
      if (hasVisibleItems || initiative.itemKeys.length === 0) {
        noDates.push({
          key: initiative.key,
          summary: initiative.summary,
          itemCount: laneItems.length,
          isLocal,
        });
      }
      continue;
    }

    if (!hasVisibleItems && initiative.itemKeys.length > 0) continue;

    lanes.push({
      key: initiative.key,
      summary: initiative.summary,
      itemCount: laneItems.length,
      siteCount: isLocal
        ? new Set(laneItems.map((i) => i.siteKey)).size
        : initiative.siteRollup.length,
      level: initiative.risk.level,
      bar,
      datesDerived: initiative.datesDerived,
      markers: isLocal ? [] : markersFor(initiative, scale),
      isLocal,
      ...(isLocal ? { subLanes: localSubLanes(laneItems, scale) } : {}),
      ...(isLocal ? {} : { href: `/initiatives/${initiative.key}` }),
    });
  }

  // Site-local lane last: it is the largest lane and reads as a footer to the
  // programme lanes rather than competing with them.
  lanes.sort((a, b) => {
    if (a.isLocal !== b.isLocal) return a.isLocal ? 1 : -1;
    return b.itemCount - a.itemCount;
  });

  return {
    scale,
    lanes,
    noDates,
    initiativeCount: lanes.filter((l) => !l.isLocal).length,
    itemCount: items.length,
    atRiskCount: items.filter((i) => i.risk.atRisk).length,
  };
}
