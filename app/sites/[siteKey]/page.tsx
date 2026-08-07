/**
 * Site view — projects grouped by programme, matching reference page 4 including
 * its `Local (n items)` group.
 *
 * THE CASE THIS PAGE EXISTS TO GET RIGHT is a site with no programme alignment at
 * all. Yaroslavl is 17 of 17 site-led, confirmed in two independent feeds. Such a
 * site must read as a legitimate delivery model, never as "no programmes found".
 */

import type { ReactElement } from 'react';
import { notFound } from 'next/navigation';

import { loadSnapshot } from '@/lib/snapshot.js';
import { buildSiteModel } from '@/lib/view-models/site.js';
import { fiscalYearOptions, parseFilters, type RawSearchParams } from '@/lib/view-models/filters.js';
import { HEALTH_DISTRIBUTION_ORDER } from '@/lib/view-models/health.js';
import { HealthLegend } from '@/components/HealthMark.js';
import { Card, EmptyState, Notice, ProvenanceChip, StatTile } from '@/components/Primitives.js';
import { FilterBar, Shell, SiteHeader } from '@/components/Shell.js';
import { MilestoneMarker, SpanBar, TimelineFrame, TimelineGroupHeader, TimelineRow } from '@/components/Timeline.js';

export default async function SitePage({
  params,
  searchParams,
}: {
  params: Promise<{ siteKey: string }>;
  searchParams: Promise<RawSearchParams>;
}): Promise<ReactElement> {
  const { siteKey } = await params;
  const filters = parseFilters(await searchParams);
  const { snapshot, source } = loadSnapshot();
  const model = buildSiteModel(snapshot, siteKey, filters);

  if (!model) notFound();

  const basePath = `/sites/${siteKey}`;

  return (
    <Shell>
      <SiteHeader source={source} syncedAt={snapshot.syncedAt} asOf={snapshot.asOf} current="/sites" />
      <FilterBar
        basePath={basePath}
        filters={filters}
        sites={snapshot.sites}
        fiscalYears={fiscalYearOptions(snapshot.items)}
        showSite={false}
      />

      <div className="stack">
        <div>
          <div className="crumb">
            <a href="/sites">Sites</a> / {model.site.region}
          </div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.5rem 1rem', alignItems: 'baseline' }}>
            <h2 style={{ fontSize: '1.25rem' }}>
              {model.site.name} ({model.site.code})
            </h2>
            {model.site.regionProvisional ? (
              <span className="chip chip-warning">Region assigned provisionally</span>
            ) : undefined}
          </div>
        </div>

        <div className="grid grid-4">
          <StatTile label="Projects in view" value={model.itemCount} note={`${model.site.expectedActiveCount} expected at discovery`} />
          <StatTile label="At risk" value={model.atRiskCount} />
          <StatTile
            label="Authored a status"
            value={model.authoredCount}
            note={`of ${model.itemCount}`}
            meterPct={model.itemCount === 0 ? 0 : Math.round((model.authoredCount / model.itemCount) * 100)}
          />
          <StatTile label="Next go-live" value={model.nextGoLive ?? '—'} />
        </div>

        {/* The DDTYAR path. Conditional on data, so any future unlinked site gets it
            with no code or config change. */}
        {model.isFullyLocal ? (
          <Notice title={`All ${model.itemCount} projects at this site are site-led`}>
            {model.site.name} has no work linked to a global programme. This is an expected delivery
            model, not missing data — confirmed independently in two source feeds. Site-led projects
            carry the same status, dates and risk treatment as programme-aligned work.
          </Notice>
        ) : undefined}

        <HealthLegend levels={HEALTH_DISTRIBUTION_ORDER} />

        {model.groups.length === 0 ? (
          <EmptyState message="No projects at this site match the current filters." />
        ) : (
          <TimelineFrame
            scale={model.scale}
            footer={
              model.noDates.length > 0 ? (
                <>
                  <strong>No dates reported ({model.noDates.length}):</strong>{' '}
                  {model.noDates.map((row, index) => (
                    <span key={row.key}>
                      {index > 0 ? ' · ' : ''}
                      <a href={row.href}>{row.title}</a>
                    </span>
                  ))}
                </>
              ) : undefined
            }
          >
            {model.groups.map((group) => (
              <div key={group.key}>
                <TimelineGroupHeader
                  label={group.isLocal ? 'Site-led' : group.label}
                  itemCount={group.itemCount}
                  level={group.level}
                  scale={model.scale}
                  {...(group.href ? { href: group.href } : {})}
                  {...(group.isLocal ? { note: 'delivered outside global programmes' } : {})}
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
        )}

        <Card title="Alignment" subtitle="How this site's work rolls up">
          <div className="legend">
            <span className="legend-item">
              Linked to a programme <strong className="tnum">{model.alignedCount}</strong>
            </span>
            <span className="legend-item">
              Site-led <strong className="tnum">{model.localCount}</strong>
            </span>
          </div>
        </Card>
      </div>
    </Shell>
  );
}
