/**
 * Region view — projects grouped by site, matching reference page 3.
 *
 * The reference page is a Gantt and nothing else, so its `(36 items)` group labels
 * are the only quantities on it. The tile strip above the chart is what this page
 * adds: the region-level answer to "how much of this is at risk", which currently
 * has to be obtained by counting bars.
 */

import type { ReactElement } from 'react';
import { notFound } from 'next/navigation';

import { loadRoadmapView } from '@/lib/repositories/index.js';
import { buildRegionModel } from '@/lib/view-models/region.js';
import { fiscalYearOptions, parseFilters, serialiseFilters, type RawSearchParams } from '@/lib/view-models/filters.js';
import { HEALTH_DISTRIBUTION_ORDER } from '@/lib/view-models/health.js';
import { HealthLegend } from '@/components/HealthMark.js';
import { EmptyState, Notice, StatTile, TableView } from '@/components/Primitives.js';
import { FilterBar, Shell, SiteHeader } from '@/components/Shell.js';
import { MilestoneMarker, SpanBar, TimelineFrame, TimelineGroupHeader, TimelineRow } from '@/components/Timeline.js';

export default async function RegionPage({
  params,
  searchParams,
}: {
  params: Promise<{ region: string }>;
  searchParams: Promise<RawSearchParams>;
}): Promise<ReactElement> {
  const { region: encoded } = await params;
  const region = decodeURIComponent(encoded);
  const filters = parseFilters(await searchParams);
  const { snapshot, source } = await loadRoadmapView();
  const model = buildRegionModel(snapshot, region, filters);

  if (!model) notFound();

  const basePath = `/regions/${encodeURIComponent(region)}`;
  const query = serialiseFilters(filters);

  return (
    <Shell>
      <SiteHeader source={source} syncedAt={snapshot.syncedAt} asOf={snapshot.asOf} current="/regions" />
      <FilterBar
        basePath={basePath}
        filters={filters}
        sites={snapshot.sites}
        fiscalYears={fiscalYearOptions(snapshot.items)}
      />

      <div className="stack">
        <div>
          <div className="crumb">
            <a href="/regions">Regions</a>
          </div>
          <h2 style={{ fontSize: '1.25rem' }}>{model.region}</h2>
        </div>

        <div className="grid grid-4">
          <StatTile label="Projects in view" value={model.itemCount} note={`across ${model.siteCount} sites`} />
          <StatTile label="At risk" value={model.atRiskCount} />
          <StatTile
            label="Authored a status"
            value={model.authoredCount}
            note={`of ${model.itemCount}`}
            meterPct={model.itemCount === 0 ? 0 : Math.round((model.authoredCount / model.itemCount) * 100)}
          />
          <StatTile label="Next go-live" value={model.nextGoLive ?? '—'} />
        </div>

        {/* `Unassigned` is reachable by design: it means a site resolved through
            neither region map, which verify-snapshot treats as a hard failure.
            Hiding the route would hide the finding. */}
        {model.isUnassigned ? (
          <Notice title="These sites have no region assignment">
            Every site here resolved through neither the authoritative nor the provisional region map
            in <code>config/regions.ts</code>. That is a configuration gap rather than a delivery
            finding, and the snapshot gate fails on it.
          </Notice>
        ) : undefined}

        {model.provisionalSites.length > 0 ? (
          <Notice title={`${model.provisionalSites.length} site${model.provisionalSites.length === 1 ? '' : 's'} assigned to this region provisionally`}>
            {model.provisionalSites.map((s) => `${s.name} (${s.code})`).join(' · ')} — assigned by the
            plan rather than by the authoritative map. Regions reflect DD&amp;T reporting lines, not
            geography, so a provisional assignment needs confirming with the business.
          </Notice>
        ) : undefined}

        <HealthLegend levels={HEALTH_DISTRIBUTION_ORDER} />

        {model.groups.length === 0 ? (
          <EmptyState
            message={`No projects in ${model.region} match the current filters. Clear them to see the whole region.`}
          />
        ) : (
          <>
            <TimelineFrame
              scale={model.scale}
              footer={
                model.noDates.length > 0 ? (
                  <>
                    <strong>No dates reported ({model.noDates.length}):</strong>{' '}
                    {model.noDates.map((row, index) => (
                      <span key={row.key}>
                        {index > 0 ? ' · ' : ''}
                        <a href={row.href}>{row.title}</a> <span className="muted">{row.siteCode}</span>
                      </span>
                    ))}
                  </>
                ) : undefined
              }
            >
              {model.groups.map((group) => (
                <div key={group.siteKey}>
                  <TimelineGroupHeader
                    label={`${group.siteName} (${group.siteCode})`}
                    itemCount={group.itemCount}
                    level={group.level}
                    scale={model.scale}
                    href={`${group.href}${query}`}
                    {...(group.atRiskCount > 0 ? { note: `${group.atRiskCount} at risk` } : {})}
                  />
                  {group.rows.map((row) => (
                    <TimelineRow
                      key={row.key}
                      label={row.title}
                      level={row.level}
                      href={row.href}
                      scale={model.scale}
                      sub
                    >
                      {row.bar ? (
                        <SpanBar
                          bar={row.bar}
                          level={row.level}
                          title={`${row.title}: ${row.start ?? '?'} to ${row.end ?? '?'}`}
                        />
                      ) : undefined}
                      {row.pointPct !== undefined ? (
                        <MilestoneMarker
                          xPct={row.pointPct}
                          level={row.level}
                          title={`${row.title}: go-live ${row.end} (no start date recorded)`}
                        />
                      ) : undefined}
                    </TimelineRow>
                  ))}
                </div>
              ))}
            </TimelineFrame>

            {/* The table twin. A Gantt is unreadable to a screen reader however well
                it is marked up, so every timeline carries one. */}
            <TableView
              summary={`Table view — ${model.itemCount} projects in ${model.region}`}
              headers={['Site', 'Project', 'Status', 'Reported', 'Start', 'Go-live']}
              rows={model.groups.flatMap((group) =>
                // Includes the no-dates items, which the chart cannot show at all --
                // the table is the only surface where they carry their site.
                [...group.rows, ...model.noDates.filter((r) => r.siteCode === group.siteCode)].map((row) => ({
                  key: row.key,
                  cells: [
                    group.siteCode,
                    { text: row.title, href: row.href },
                    { level: row.level },
                    { provenance: row.provenance },
                    row.start ?? '—',
                    row.end ?? '—',
                  ],
                })),
              )}
            />
          </>
        )}
      </div>
    </Shell>
  );
}
