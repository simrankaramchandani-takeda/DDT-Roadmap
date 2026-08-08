/**
 * WP2 acceptance. These are the tests that matter most in the UI build, because the
 * view models hold every number that appears on screen -- and they are pure, so
 * they can be verified without rendering anything.
 */

import { describe, expect, it } from 'vitest';

import { FIXTURE_SNAPSHOT } from '@/fixtures/snapshot.fixture.js';
import { buildCoverage } from '@/lib/rollup.js';
import { applyFilters, DEFAULT_FILTERS, parseFilters, serialiseFilters, withFilter, fiscalYearOptions } from '@/lib/view-models/filters.js';
import { buildTimelineScale } from '@/lib/view-models/timeline.js';
import { buildOverviewModel } from '@/lib/view-models/overview.js';
import { buildGlobalRoadmapModel } from '@/lib/view-models/roadmap.js';
import { buildSiteModel, buildSiteIndex } from '@/lib/view-models/site.js';
import { buildInitiativeModel, buildInitiativeIndex } from '@/lib/view-models/initiative.js';
import { buildProjectModel } from '@/lib/view-models/project.js';
import { buildRegionModel, buildRegionIndex } from '@/lib/view-models/region.js';
import { buildDataModel } from '@/lib/view-models/data.js';
import { HEALTH_DISPLAY } from '@/lib/view-models/health.js';
import { UNALIGNED_INITIATIVE_KEY } from '@/types/domain.js';
import { REASON_LABELS, RISK_LEVELS, RISK_LEVEL_LABELS } from '@config/narrative.js';

const S = FIXTURE_SNAPSHOT;
const ALL = { risk: 'all', scope: 'all' } as const;

describe('filters', () => {
  it('defaults to all risk / ongoing scope', () => {
    expect(parseFilters({})).toEqual(DEFAULT_FILTERS);
  });

  it('round-trips through a query string, omitting defaults', () => {
    expect(serialiseFilters(DEFAULT_FILTERS)).toBe('');
    const filters = { risk: 'at-risk', scope: 'all', site: 'DDTGC', fy: 'FY26' } as const;
    expect(parseFilters(Object.fromEntries(new URLSearchParams(serialiseFilters(filters))))).toEqual(filters);
  });

  it('treats "all" as clearing a dimension', () => {
    expect(parseFilters({ site: 'all' }).site).toBeUndefined();
    expect(withFilter(DEFAULT_FILTERS, 'site', 'all').site).toBeUndefined();
  });

  it('ignores an unknown value rather than filtering to nothing', () => {
    expect(parseFilters({ risk: 'nonsense' }).risk).toBe('all');
  });

  it('ongoing scope excludes BOTH complete and cancelled', () => {
    const ongoing = applyFilters(S.items, DEFAULT_FILTERS);
    expect(ongoing.some((i) => i.risk.level === 'complete')).toBe(false);
    expect(ongoing.some((i) => i.risk.level === 'cancelled')).toBe(false);
    // Cancelled must not be counted as delivered, so `completed` excludes it too.
    const completed = applyFilters(S.items, { risk: 'all', scope: 'completed' });
    expect(completed.every((i) => i.risk.level === 'complete')).toBe(true);
  });

  it('filters by risk, site, region and fiscal year', () => {
    expect(applyFilters(S.items, { ...ALL, risk: 'at-risk' }).every((i) => i.risk.atRisk)).toBe(true);
    expect(applyFilters(S.items, { ...ALL, site: 'DDTYAR' }).every((i) => i.siteKey === 'DDTYAR')).toBe(true);
    expect(applyFilters(S.items, { ...ALL, region: 'Europe' }).every((i) => i.region === 'Europe')).toBe(true);
    expect(applyFilters(S.items, { ...ALL, fy: 'FY26' }).every((i) => i.fiscalYears.includes('FY26'))).toBe(true);
  });

  it('offers only fiscal years present in the data', () => {
    const options = fiscalYearOptions(S.items);
    expect(options.length).toBeGreaterThan(0);
    expect(new Set(options).size).toBe(options.length);
  });
});

describe('timeline scale', () => {
  const scale = buildTimelineScale(S.items.map((i) => ({ start: i.start, end: i.end })), S.asOf);

  it('starts quarters on the fiscal year boundary, not the calendar one', () => {
    for (const q of scale.quarters) {
      const [, month, day] = q.start.split('-');
      // Fiscal quarters begin on the 1st of Apr/Jul/Oct/Jan.
      expect(day).toBe('01');
      expect(['01', '04', '07', '10']).toContain(month);
    }
    expect(scale.quarters[0]!.start.slice(5)).toBe('04-01');
  });

  it('tiles the domain exactly, with four quarters per year', () => {
    expect(scale.quarters.length).toBe(scale.years.length * 4);
    expect(scale.quarters[0]!.xPct).toBeCloseTo(0, 5);
    const last = scale.quarters[scale.quarters.length - 1]!;
    expect(last.xPct + last.wPct).toBeCloseTo(100, 5);
  });

  it('places today inside the domain', () => {
    expect(scale.todayPct).toBeGreaterThan(0);
    expect(scale.todayPct).toBeLessThan(100);
  });

  it('clamps the domain so one far-future item cannot compress everything', () => {
    const wide = buildTimelineScale([{ start: '2015-04-01', end: '2050-03-31' }], S.asOf);
    // Window is [FY-2, FY+4] => 7 fiscal years, not 35.
    expect(wide.years.length).toBe(7);
  });

  it('marks a bar as clipped when the span leaves the window', () => {
    const bar = scale.barFor('2010-01-01', '2040-01-01');
    expect(bar).toBeDefined();
    expect(bar!.clippedStart).toBe(true);
    expect(bar!.clippedEnd).toBe(true);
    expect(bar!.xPct).toBeCloseTo(0, 5);
    expect(bar!.wPct).toBeCloseTo(100, 5);
  });

  it('returns no bar for a span with no overlap, and none for a single endpoint', () => {
    expect(scale.barFor('1990-01-01', '1991-01-01')).toBeUndefined();
    expect(scale.barFor('2026-01-01', undefined)).toBeUndefined();
    expect(scale.barFor(undefined, undefined)).toBeUndefined();
  });

  it('gives a single-day span a positive width', () => {
    const bar = scale.barFor('2026-09-15', '2026-09-15');
    expect(bar).toBeDefined();
    expect(bar!.wPct).toBeGreaterThan(0);
  });

  it('tolerates an inverted range rather than dropping the item', () => {
    const inverted = scale.barFor('2026-12-31', '2026-01-01');
    const normal = scale.barFor('2026-01-01', '2026-12-31');
    expect(inverted).toEqual(normal);
  });

  it('still produces a scale when nothing has dates', () => {
    const empty = buildTimelineScale([{ start: undefined, end: undefined }], S.asOf);
    expect(empty.quarters).toHaveLength(4);
  });
});

describe('overview model', () => {
  it('agrees with buildCoverage on the unfiltered portfolio', () => {
    // THE ANTI-DRIFT TEST. If a number on the Overview ever disagrees with what
    // verify-snapshot reports, these fail together instead of diverging quietly.
    const model = buildOverviewModel(S, ALL);
    const active = S.items.filter((i) => i.risk.level !== 'complete' && i.risk.level !== 'cancelled');
    const coverage = buildCoverage(S.items, active, S.asOf, 0);

    expect(model.activeCount).toBe(coverage.itemsActive);
    expect(model.alignment.total).toBe(coverage.itemsTotal);
    expect(model.coverage.bothDates).toBe(S.items.filter((i) => i.start && i.end).length);

    const authoredActive = active.filter(
      (i) => i.risk.provenance === 'spot' || i.risk.provenance === 'reported',
    ).length;
    expect(coverage.withAnyRag).toBe(authoredActive);
  });

  it('splits alignment so site-led work is a first-class figure', () => {
    const model = buildOverviewModel(S, ALL);
    expect(model.alignment.aligned + model.alignment.local).toBe(model.alignment.total);
    expect(model.alignment.local).toBe(S.items.filter((i) => i.alignment === 'local').length);
  });

  it('keeps the headline "needs attention" figure meaningful under a Completed filter', () => {
    // Scoping to completed work must not report "0 active" as the headline.
    const model = buildOverviewModel(S, { risk: 'all', scope: 'completed' });
    expect(model.activeCount).toBe(0);
    expect(model.alignment.total).toBeGreaterThan(0);
  });

  it('ranks the attention list worst-first and never lists healthy work', () => {
    const model = buildOverviewModel(S, ALL, { attentionLimit: 50 });
    expect(model.attention.every((row) => row.risk.atRisk)).toBe(true);
    const scores = model.attention.map((r) => r.risk.score);
    expect([...scores].sort((a, b) => b - a)).toEqual(scores);
  });

  it('excludes the synthetic site-local lane from programme health', () => {
    const model = buildOverviewModel(S, ALL);
    expect(model.initiativeCount).toBe(S.initiatives.filter((i) => i.portfolioKey !== '').length);
  });

  it('reports every health level present, and none that is absent', () => {
    const model = buildOverviewModel(S, ALL);
    const total = model.health.reduce((sum, slice) => sum + slice.count, 0);
    expect(total).toBe(model.alignment.total);
    expect(model.health.every((slice) => slice.count > 0)).toBe(true);
  });
});

describe('global roadmap model', () => {
  it('produces a lane per initiative plus the site-led lane', () => {
    const model = buildGlobalRoadmapModel(S, ALL);
    const keys = [...model.lanes.map((l) => l.key), ...model.noDates.map((n) => n.key)];
    expect(keys).toContain(UNALIGNED_INITIATIVE_KEY);
  });

  it('sorts the site-led lane last and gives it per-site sub-lanes', () => {
    const model = buildGlobalRoadmapModel(S, ALL);
    const local = model.lanes.find((l) => l.isLocal);
    expect(local).toBeDefined();
    expect(model.lanes[model.lanes.length - 1]!.isLocal).toBe(true);
    expect(local!.subLanes!.length).toBeGreaterThan(1);
    // Sub-lane counts must reconcile with the lane total.
    expect(local!.subLanes!.reduce((sum, s) => sum + s.itemCount, 0)).toBe(local!.itemCount);
  });

  it('names initiatives with no plottable span instead of rendering empty lanes', () => {
    const model = buildGlobalRoadmapModel(S, ALL);
    expect(model.noDates.some((n) => n.summary === 'MetrIQ')).toBe(true);
    expect(model.lanes.some((l) => l.summary === 'MetrIQ')).toBe(false);
  });

  it('collapses markers from different sites that would overlap', () => {
    const model = buildGlobalRoadmapModel(S, ALL);
    const markers = model.lanes.flatMap((l) => l.markers);
    const collapsed = markers.filter((m) => m.count > 1);

    // A lane's markers come from `siteRollup`, which is already one entry per site,
    // so several go-lives at ONE site never reach the chart as separate markers.
    // Collapsing is about two DIFFERENT sites landing close: the fixture puts
    // Singen at 20 Nov 2026 and Grange Castle at 10 Nov 2026.
    expect(collapsed.length).toBeGreaterThan(0);

    // Markers must never be lost by collapsing -- the counts have to reconcile.
    const mes = model.lanes.find((l) => l.summary === 'MES')!;
    const initiative = S.initiatives.find((i) => i.summary === 'MES')!;
    const plottableSites = initiative.siteRollup.filter(
      (s) => model.scale.pointFor(s.goLive) !== undefined,
    ).length;
    expect(mes.markers.reduce((sum, m) => sum + m.count, 0)).toBe(plottableSites);
  });

  it('never renders more markers on a lane than it has sites', () => {
    const model = buildGlobalRoadmapModel(S, ALL);
    for (const lane of model.lanes.filter((l) => !l.isLocal)) {
      expect(lane.markers.length).toBeLessThanOrEqual(lane.siteCount);
    }
  });

  it('rescales when filtered to a single site', () => {
    const model = buildGlobalRoadmapModel(S, { ...ALL, site: 'DDTYAR' });
    expect(model.itemCount).toBe(S.items.filter((i) => i.siteKey === 'DDTYAR').length);
  });
});

describe('site model', () => {
  it('returns undefined for an unknown site rather than throwing', () => {
    expect(buildSiteModel(S, 'NOPE', ALL)).toBeUndefined();
  });

  it('flags a fully site-led site, which is the DDTYAR banner condition', () => {
    const yar = buildSiteModel(S, 'DDTYAR', ALL)!;
    expect(yar.isFullyLocal).toBe(true);
    expect(yar.alignedCount).toBe(0);
    expect(yar.localCount).toBe(yar.itemCount);
    // And it must still have content -- never an empty state.
    expect(yar.groups.length).toBeGreaterThan(0);
  });

  it('does not flag a site that has any programme-aligned work', () => {
    const mbo = buildSiteModel(S, 'DDTMBO', ALL)!;
    expect(mbo.isFullyLocal).toBe(false);
    expect(mbo.alignedCount).toBeGreaterThan(0);
    expect(mbo.localCount).toBeGreaterThan(0);
  });

  it('always orders the site-led group last', () => {
    const mbo = buildSiteModel(S, 'DDTMBO', ALL)!;
    expect(mbo.groups[mbo.groups.length - 1]!.isLocal).toBe(true);
    expect(mbo.groups.filter((g) => g.isLocal)).toHaveLength(1);
  });

  it('moves unplottable items out of the lanes and into the no-dates group', () => {
    const mbo = buildSiteModel(S, 'DDTMBO', ALL)!;
    const plotted = mbo.groups.flatMap((g) => g.rows);
    expect(plotted.every((r) => r.bar || r.pointPct !== undefined)).toBe(true);
    expect(mbo.noDates.length).toBeGreaterThan(0);
    expect(plotted.length + mbo.noDates.length).toBe(mbo.itemCount);
  });

  it('keeps the programme on a no-dates item, which the chart cannot show', () => {
    // A no-dates item has no timeline row, so the table twin is the only surface
    // that can state which programme it belongs to.
    const mbo = buildSiteModel(S, 'DDTMBO', ALL)!;
    const labels = new Set(mbo.groups.map((g) => (g.isLocal ? 'Site-led' : g.label)));

    expect(mbo.noDates.length).toBeGreaterThan(0);
    for (const row of mbo.noDates) {
      expect(row.groupLabel).toBeTruthy();
      expect(labels.has(row.groupLabel)).toBe(true);
    }
  });

  it('renders a go-live-only item as a point rather than a bar', () => {
    const hik = buildSiteModel(S, 'DDTHIK', ALL)!;
    const rows = hik.groups.flatMap((g) => g.rows);
    expect(rows.some((r) => r.pointPct !== undefined && !r.bar)).toBe(true);
  });

  it('lists every site in the index, including empty ones', () => {
    const index = buildSiteIndex(S);
    expect(index).toHaveLength(S.sites.length);
    expect(index.some((row) => row.aligned + row.local === 0)).toBe(true);
  });
});

describe('initiative model', () => {
  it('marks the status as rolled up, because no feed exposes an initiative RAG', () => {
    for (const initiative of S.initiatives) {
      const model = buildInitiativeModel(S, initiative.key, ALL)!;
      expect(model.statusIsRolledUp).toBe(true);
    }
  });

  it('groups projects by site and reconciles the counts', () => {
    const model = buildInitiativeModel(S, 'DDTGMPORT-12', ALL)!;
    const rows = model.siteGroups.flatMap((g) => g.rows);
    expect(rows.length + model.noDates.length).toBe(model.itemCount);
    expect(model.siteCount).toBe(model.siteGroups.length);

    // A group header counts EVERY item at the site, not just the plottable ones --
    // otherwise a lane with two no-dates items reports itself as smaller than it is
    // and the data gap disappears from the count.
    expect(model.siteGroups.reduce((sum, g) => sum + g.itemCount, 0)).toBe(model.itemCount);
    expect(model.siteGroups.every((g) => g.rows.length <= g.itemCount)).toBe(true);
  });

  it('resolves the site-local lane as an initiative view', () => {
    const model = buildInitiativeModel(S, UNALIGNED_INITIATIVE_KEY, ALL)!;
    expect(model.isLocalLane).toBe(true);
    expect(model.itemCount).toBe(S.items.filter((i) => i.alignment === 'local').length);
  });

  it('sorts the index worst-health first with the local lane last', () => {
    const index = buildInitiativeIndex(S);
    expect(index[index.length - 1]!.isLocalLane).toBe(true);
  });

  it('returns undefined for an unknown key', () => {
    expect(buildInitiativeModel(S, 'DDTGMPORT-999', ALL)).toBeUndefined();
  });
});

describe('project model', () => {
  it('never exposes the risk score', () => {
    const model = buildProjectModel(S, 'DDTTO-41')!;
    const serialised = JSON.stringify({
      narrativeRows: model.narrativeRows,
      scheduleRows: model.scheduleRows,
      detailRows: model.detailRows,
    });
    expect(serialised).not.toContain(String(model.item.risk.score));
  });

  it('surfaces the SPOT narrative when present', () => {
    const model = buildProjectModel(S, 'DDTTO-41')!;
    expect(model.hasNarrative).toBe(true);
    expect(model.narrativeRows.some((r) => r.label === 'Status')).toBe(true);
    expect(model.overdueDays).toBeGreaterThan(0);
  });

  it('labels a site-led project as a delivery model, not a gap', () => {
    const model = buildProjectModel(S, 'DDTYAR-1')!;
    expect(model.isLocal).toBe(true);
    expect(model.initiative).toBeUndefined();
    const programme = model.detailRows.find((r) => r.label === 'Programme');
    expect(programme!.value).toMatch(/Site-led/);
  });

  it('marks absent fields rather than rendering blanks', () => {
    const model = buildProjectModel(S, 'DDTYAR-6')!;
    expect(model.scheduleRows.some((r) => r.absent)).toBe(true);
    expect(model.hasNarrative).toBe(false);
  });

  it('returns undefined for an unknown key', () => {
    expect(buildProjectModel(S, 'DDTGC-99999')).toBeUndefined();
  });
});

describe('region model', () => {
  // Derived from the data rather than hardcoded, so the tests survive a fixture
  // change that adds or moves a site.
  const REGION = S.items[0]!.region;

  it('returns undefined for an unknown region but not for a filtered-empty one', () => {
    expect(buildRegionModel(S, 'Atlantis', ALL)).toBeUndefined();

    // A region that exists but whose items are all filtered out must still resolve,
    // so the page can say "nothing matches" rather than 404.
    const narrowed = buildRegionModel(S, REGION, { risk: 'at-risk', scope: 'completed' })!;
    expect(narrowed).toBeDefined();
    expect(narrowed.itemCount).toBe(0);
    expect(narrowed.groups).toHaveLength(0);
  });

  it('groups by site and reconciles every item into a lane or the no-dates group', () => {
    const model = buildRegionModel(S, REGION, ALL)!;
    const plotted = model.groups.flatMap((g) => g.rows);

    expect(model.itemCount).toBe(S.items.filter((i) => i.region === REGION).length);
    expect(plotted.length + model.noDates.length).toBe(model.itemCount);
    expect(model.siteCount).toBe(model.groups.length);
    expect(model.groups.reduce((sum, g) => sum + g.itemCount, 0)).toBe(model.itemCount);
    expect(plotted.every((r) => r.bar || r.pointPct !== undefined)).toBe(true);
  });

  it('gives site-led work no separate treatment at this grain', () => {
    // Region groups are per SITE. A local item sits in its site's group like any
    // other -- unlike the site and roadmap views, which lane it separately.
    const model = buildRegionModel(S, REGION, ALL)!;
    expect(model.alignedCount + model.localCount).toBe(model.itemCount);
    expect(model.groups.some((g) => g.siteCode === 'site-led')).toBe(false);

    for (const group of model.groups) {
      const siteItems = S.items.filter((i) => i.siteKey === group.siteKey && i.region === REGION);
      expect(group.itemCount).toBe(siteItems.length);
    }
  });

  it('orders sites by volume and never reports more at-risk than items', () => {
    const model = buildRegionModel(S, REGION, ALL)!;
    const counts = model.groups.map((g) => g.itemCount);
    expect([...counts].sort((a, b) => b - a)).toEqual(counts);
    expect(model.groups.every((g) => g.atRiskCount <= g.itemCount)).toBe(true);
    expect(model.atRiskCount).toBe(
      S.items.filter((i) => i.region === REGION && i.risk.atRisk).length,
    );
  });

  it('reports the next go-live as a future, non-terminal date', () => {
    const model = buildRegionModel(S, REGION, ALL)!;
    if (model.nextGoLive !== undefined) {
      expect(model.nextGoLive >= S.asOf).toBe(true);
    }
  });

  it('lists every region, including any with no projects', () => {
    const index = buildRegionIndex(S);
    const regions = new Set([...S.sites.map((s) => s.region), ...S.items.map((i) => i.region)]);

    expect(index).toHaveLength(regions.size);
    for (const row of index) expect(regions.has(row.region as never)).toBe(true);

    // Largest first, and the percentage must reconcile with the counts.
    const counts = index.map((r) => r.itemCount);
    expect([...counts].sort((a, b) => b - a)).toEqual(counts);
    for (const row of index) {
      expect(row.atRiskCount).toBeLessThanOrEqual(row.itemCount);
      expect(row.atRiskPct).toBe(
        row.itemCount === 0 ? 0 : Math.round((row.atRiskCount / row.itemCount) * 100),
      );
    }
  });

  it('counts only active work in the index, matching the site index', () => {
    const index = buildRegionIndex(S);
    const total = index.reduce((sum, row) => sum + row.itemCount, 0);
    const active = S.items.filter(
      (i) => i.risk.level !== 'complete' && i.risk.level !== 'cancelled',
    );
    expect(total).toBe(active.length);
  });
});

describe('data model', () => {
  const model = buildDataModel(S);

  it('reports coverage straight from the snapshot, never recomputed', () => {
    // THE SECOND ANTI-DRIFT GUARD. This page is what a reader consults to check the
    // numbers elsewhere, so it must not be capable of disagreeing with the snapshot
    // that verify-snapshot gates on.
    expect(model.coverage).toBe(S.coverage);
    expect(model.itemsTotal).toBe(S.coverage.itemsTotal);
    expect(model.itemsActive).toBe(S.coverage.itemsActive);

    const byLabel = new Map(model.coverageRows.map((r) => [r.label, r]));
    expect(byLabel.get('Authored a status')!.known).toBe(S.coverage.withAnyRag);
    expect(byLabel.get('Reported through SPOT')!.known).toBe(S.coverage.withSpotStatus);
    expect(byLabel.get('Explain their status')!.known).toBe(S.coverage.withNarrative);
    expect(byLabel.get('Both start and go-live')!.known).toBe(S.coverage.withBothDates);
    expect(model.coverageRows.every((r) => r.total === S.coverage.itemsActive)).toBe(true);
    expect(model.coverageRows.every((r) => r.known <= r.total)).toBe(true);
  });

  it('states two distinct freshness facts, because the feed is not live', () => {
    // `syncedAt` is when we read the source; `newestUpdate` is how current the
    // source data itself was. Reporting only the former would imply the data is
    // fresher than it is.
    const newest = S.items.map((i) => i.updatedAt).sort().at(-1);
    expect(model.newestUpdate).toBe(newest);
    expect(model.syncedAt).toBe(S.syncedAt);
    expect(model.dataAgeDays).toBeGreaterThanOrEqual(0);
  });

  it('shows every distribution over the same denominator the snapshot used', () => {
    const provenanceTotal = model.provenance.reduce((sum, r) => sum + r.count, 0);
    const summaryTotal = model.summarySource.reduce((sum, r) => sum + r.count, 0);
    const riskTotal = model.riskLevels.reduce((sum, r) => sum + r.count, 0);

    expect(provenanceTotal).toBe(S.coverage.itemsActive);
    expect(summaryTotal).toBe(S.coverage.itemsActive);
    expect(riskTotal).toBe(S.coverage.itemsActive);

    // Zero-count classes are dropped rather than rendered as empty rows.
    expect(model.provenance.every((r) => r.count > 0)).toBe(true);
  });

  it('takes its status wording from RISK_LEVEL_LABELS rather than inventing any', () => {
    for (const row of model.riskLevels) {
      expect(row.label).toBe(RISK_LEVEL_LABELS[row.level]);
      expect(row.key).toBe(row.level);
    }
  });

  it('counts risk reasons across items, not items, since one item can carry several', () => {
    const expected = S.items.flatMap((i) => i.risk.reasons).length;
    expect(model.reasons.reduce((sum, r) => sum + r.count, 0)).toBe(expected);
    for (const row of model.reasons) {
      expect(row.label).toBe(REASON_LABELS[row.key as keyof typeof REASON_LABELS]);
    }
  });

  it('gives per-site coverage for every configured site, including empty ones', () => {
    expect(model.sites).toHaveLength(S.sites.length);

    for (const row of model.sites) {
      expect(row.authored).toBeLessThanOrEqual(row.itemCount);
      expect(row.narrative).toBeLessThanOrEqual(row.itemCount);
      expect(row.bothDates).toBeLessThanOrEqual(row.itemCount);
      expect(row.drift).toBe(row.itemCount - row.site.expectedActiveCount);
      // A site with no items must report 0%, never NaN.
      if (row.itemCount === 0) expect(row.authoredPct).toBe(0);
    }

    // Per-site active counts must sum to the portfolio active count.
    expect(model.sites.reduce((sum, r) => sum + r.itemCount, 0)).toBe(S.coverage.itemsActive);
  });

  it('surfaces an empty site, which is the gate’s hard failure', () => {
    // A site whose level-1 issue type is unrecognised returns nothing and reports no
    // error -- it renders as a site with no work. The fixture includes that case.
    expect(model.emptySites.length).toBeGreaterThan(0);
    expect(model.emptySites.every((s) => s.activeCount === 0)).toBe(true);
  });

  it('names programmes with no dates instead of leaving them invisible', () => {
    expect(model.initiativesWithoutDates.map((i) => i.key).sort()).toEqual(
      S.initiatives.filter((i) => !i.hasDates).map((i) => i.key).sort(),
    );
  });

  it('passes warnings through verbatim', () => {
    // Warnings are expected findings, not defects, and must not be reworded or
    // filtered on the way to the page.
    expect(model.warnings).toEqual(S.warnings);
  });

  it('excludes the synthetic site-local lane from the programme count', () => {
    expect(model.initiativeCount).toBe(S.initiatives.filter((i) => i.portfolioKey !== '').length);
  });
});

describe('health display vocabulary', () => {
  it('covers every risk level with a distinct glyph', () => {
    const glyphs = RISK_LEVELS.map((level) => HEALTH_DISPLAY[level].glyph);
    expect(new Set(glyphs).size).toBe(RISK_LEVELS.length);
  });

  it('gives attention and blocked the same token but different glyphs', () => {
    // Both are "red" in the reference report's vocabulary; the glyph and label are
    // what separate them, which is why colour alone is never sufficient.
    expect(HEALTH_DISPLAY.attention.token).toBe(HEALTH_DISPLAY.blocked.token);
    expect(HEALTH_DISPLAY.attention.glyph).not.toBe(HEALTH_DISPLAY.blocked.glyph);
  });

  it('separates cancelled from unreported by hatch, since they share grey', () => {
    expect(HEALTH_DISPLAY.cancelled.token).toBe(HEALTH_DISPLAY.unreported.token);
    expect(HEALTH_DISPLAY.cancelled.hatched).toBe(true);
    expect(HEALTH_DISPLAY.unreported.hatched).toBe(false);
  });
});
