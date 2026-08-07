/**
 * Global Roadmap — one lane per initiative, reconciling with reference page 1.
 *
 * The collapsed lane plus per-site go-live markers is the most effective device in
 * the reference report and is reproduced faithfully. What is added: a totals header,
 * a named no-dates group, and the site-led lane broken out per site.
 */

import type { ReactElement } from 'react';

import { loadSnapshot } from '@/lib/snapshot.js';
import { buildGlobalRoadmapModel } from '@/lib/view-models/roadmap.js';
import { fiscalYearOptions, parseFilters, type RawSearchParams } from '@/lib/view-models/filters.js';
import { HEALTH_DISTRIBUTION_ORDER } from '@/lib/view-models/health.js';
import { HealthLegend } from '@/components/HealthMark.js';
import { Card, EmptyState } from '@/components/Primitives.js';
import { FilterBar, Shell, SiteHeader } from '@/components/Shell.js';
import { MilestoneMarker, SpanBar, TimelineFrame, TimelineGroupHeader, TimelineRow } from '@/components/Timeline.js';

export default async function GlobalRoadmapPage({
  searchParams,
}: {
  searchParams: Promise<RawSearchParams>;
}): Promise<ReactElement> {
  const params = await searchParams;
  const filters = parseFilters(params);
  const { snapshot, source } = loadSnapshot();
  const model = buildGlobalRoadmapModel(snapshot, filters);

  return (
    <Shell>
      <SiteHeader source={source} syncedAt={snapshot.syncedAt} asOf={snapshot.asOf} current="/roadmap" />
      <FilterBar
        basePath="/roadmap"
        filters={filters}
        sites={snapshot.sites}
        fiscalYears={fiscalYearOptions(snapshot.items)}
      />

      <div className="stack">
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.5rem 1.5rem', alignItems: 'baseline' }}>
          <h2>Global DDT Roadmap</h2>
          <span className="muted">
            {model.initiativeCount} programmes · {model.itemCount} projects · {model.atRiskCount} at risk
          </span>
        </div>

        <HealthLegend levels={HEALTH_DISTRIBUTION_ORDER} />

        {model.lanes.length === 0 ? (
          <EmptyState message="No programmes match the current filters." />
        ) : (
          <TimelineFrame
            scale={model.scale}
            footer={
              model.noDates.length > 0 ? (
                <>
                  <strong>No dates reported ({model.noDates.length}):</strong>{' '}
                  {model.noDates.map((entry, index) => (
                    <span key={entry.key}>
                      {index > 0 ? ' · ' : ''}
                      {entry.summary}
                      {entry.itemCount > 0 ? ` (${entry.itemCount})` : ''}
                    </span>
                  ))}
                  <div className="muted" style={{ marginTop: '0.2rem' }}>
                    These have no plottable span. The reference report renders them as empty lanes.
                  </div>
                </>
              ) : undefined
            }
          >
            {model.lanes.map((lane) =>
              lane.isLocal ? (
                <div key={lane.key}>
                  <TimelineGroupHeader
                    label="Site-led"
                    itemCount={lane.itemCount}
                    level={lane.level}
                    scale={model.scale}
                    note={`${lane.siteCount} sites · delivered outside global programmes`}
                  />
                  {(lane.subLanes ?? []).map((sub) => (
                    <TimelineRow
                      key={sub.key}
                      label={sub.summary}
                      level={sub.level}
                      href={sub.href}
                      meta={`${sub.itemCount}`}
                      scale={model.scale}
                      sub
                    >
                      {sub.bar ? (
                        <SpanBar
                          bar={sub.bar}
                          level={sub.level}
                          derived
                          title={`${sub.summary}: ${sub.itemCount} site-led projects`}
                        />
                      ) : undefined}
                      {sub.markers.map((marker) => (
                        <MilestoneMarker
                          key={`${marker.goLive}-${marker.xPct}`}
                          xPct={marker.xPct}
                          level={marker.level}
                          count={marker.count}
                          title={`${marker.siteName} go-live ${marker.goLive}${marker.count > 1 ? ` (${marker.count} projects)` : ''}`}
                        />
                      ))}
                    </TimelineRow>
                  ))}
                </div>
              ) : (
                <TimelineRow
                  key={lane.key}
                  label={lane.summary}
                  level={lane.level}
                  href={lane.href}
                  meta={`${lane.itemCount}`}
                  scale={model.scale}
                >
                  {lane.bar ? (
                    <SpanBar
                      bar={lane.bar}
                      level={lane.level}
                      derived={lane.datesDerived}
                      title={`${lane.summary}: ${lane.itemCount} projects across ${lane.siteCount} sites${lane.datesDerived ? ' (span rolled up from projects)' : ''}`}
                    />
                  ) : undefined}
                  {lane.markers.map((marker) => (
                    <MilestoneMarker
                      key={`${marker.siteCode}-${marker.goLive}-${marker.xPct}`}
                      xPct={marker.xPct}
                      level={marker.level}
                      code={marker.count > 1 ? undefined : marker.siteCode}
                      count={marker.count}
                      title={
                        marker.count > 1
                          ? `${marker.count} site go-lives around ${marker.goLive}`
                          : `${marker.siteName} go-live ${marker.goLive}`
                      }
                    />
                  ))}
                </TimelineRow>
              ),
            )}
          </TimelineFrame>
        )}

        <Card title="Reading this chart">
          <div className="muted">
            A programme bar spans its projects&rsquo; earliest start to latest go-live; most are rolled up
            rather than authored, and render slightly muted. Triangles and diamonds are per-site go-lives,
            labelled with the site code — a number instead of a code means several collapsed at that point.
            Health is shown by colour <em>and</em> glyph everywhere, because red and green are not reliably
            distinguishable for around 8% of male viewers.
          </div>
        </Card>
      </div>
    </Shell>
  );
}
