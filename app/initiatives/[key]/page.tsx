/**
 * Initiative drill-down — projects grouped by site, plus the rollout sequence.
 *
 * THE DISCLOSURE THAT MUST NOT BE SOFTENED: every initiative's RAG is rolled up
 * from its projects, because no feed exposes customfield_11199 and DDTGMPORT
 * carries no authored RAG of any kind. If the Power BI report shows an authored
 * initiative RAG, this page will visibly differ — so the reason is stated on screen
 * rather than left to look like a defect.
 */

import type { ReactElement } from 'react';
import { notFound } from 'next/navigation';

import { loadSnapshot } from '@/lib/snapshot.js';
import { buildInitiativeModel } from '@/lib/view-models/initiative.js';
import { fiscalYearOptions, parseFilters, type RawSearchParams } from '@/lib/view-models/filters.js';
import { HEALTH_DISTRIBUTION_ORDER } from '@/lib/view-models/health.js';
import { HealthLegend, HealthMark } from '@/components/HealthMark.js';
import { Card, EmptyState, Notice, ProvenanceChip, StatTile } from '@/components/Primitives.js';
import { FilterBar, Shell, SiteHeader } from '@/components/Shell.js';
import { MilestoneMarker, SpanBar, TimelineFrame, TimelineGroupHeader, TimelineRow } from '@/components/Timeline.js';

export default async function InitiativePage({
  params,
  searchParams,
}: {
  params: Promise<{ key: string }>;
  searchParams: Promise<RawSearchParams>;
}): Promise<ReactElement> {
  const { key } = await params;
  const decoded = decodeURIComponent(key);
  const filters = parseFilters(await searchParams);
  const { snapshot, source } = loadSnapshot();
  const model = buildInitiativeModel(snapshot, decoded, filters);

  if (!model) notFound();

  const { initiative } = model;
  const basePath = `/initiatives/${encodeURIComponent(decoded)}`;

  return (
    <Shell>
      <SiteHeader source={source} syncedAt={snapshot.syncedAt} asOf={snapshot.asOf} current="/initiatives" />
      <FilterBar
        basePath={basePath}
        filters={filters}
        sites={snapshot.sites}
        fiscalYears={fiscalYearOptions(snapshot.items)}
      />

      <div className="stack">
        <div>
          <div className="crumb">
            <a href="/initiatives">Initiatives</a>
            {model.isLocalLane ? '' : ` / ${initiative.portfolioKey}`}
          </div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.5rem 1rem', alignItems: 'baseline' }}>
            <h2 style={{ fontSize: '1.25rem' }}>{initiative.summary}</h2>
            <HealthMark level={initiative.risk.level} />
            <ProvenanceChip provenance={initiative.risk.provenance} />
            {initiative.jiraUrl ? (
              <a className="muted" href={initiative.jiraUrl} target="_blank" rel="noreferrer">
                Open in Jira ↗
              </a>
            ) : undefined}
          </div>
          {initiative.description ? (
            <p className="secondary" style={{ maxWidth: '48rem', fontSize: '0.875rem' }}>
              {initiative.description}
            </p>
          ) : undefined}
        </div>

        {model.statusIsRolledUp ? (
          <Notice title="This status is rolled up, not authored">
            No source feed exposes an initiative-level RAG field, so this programme&rsquo;s status is
            derived from the worst status across its {model.itemCount} projects. The Power BI report may
            show an authored value here; a difference is definitional, not a defect.
          </Notice>
        ) : undefined}

        <div className="grid grid-4">
          <StatTile label="Projects" value={model.itemCount} />
          <StatTile label="Sites" value={model.siteCount} />
          <StatTile label="At risk" value={model.atRiskCount} />
          <StatTile
            label="Span"
            value={initiative.hasDates ? `${initiative.start} → ${initiative.end}` : 'No dates'}
            note={initiative.datesDerived ? 'rolled up from projects' : 'authored'}
          />
        </div>

        {model.siteRollup.length > 0 ? (
          <Card title="Rollout sequence" subtitle="Earliest go-live per site, worst status per site">
            <div className="rows">
              {model.siteRollup.map((site) => (
                <div className="row" key={site.siteKey}>
                  <div className="row-main">
                    <div className="row-title">
                      <HealthMark level={site.risk} labelled={false} context={site.siteName} />{' '}
                      <a href={site.href}>
                        {site.siteName} ({site.siteCode})
                      </a>
                    </div>
                    <div className="row-meta">
                      {site.itemCount} {site.itemCount === 1 ? 'project' : 'projects'}
                      {site.atRiskCount > 0 ? ` · ${site.atRiskCount} at risk` : ''}
                    </div>
                  </div>
                  <div className="row-side tnum">{site.goLive ?? 'No go-live date'}</div>
                </div>
              ))}
            </div>
          </Card>
        ) : undefined}

        <HealthLegend levels={HEALTH_DISTRIBUTION_ORDER} />

        {model.siteGroups.length === 0 ? (
          <EmptyState message="No projects in this programme match the current filters." />
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
            {model.siteGroups.map((group) => (
              <div key={group.siteKey}>
                <TimelineGroupHeader
                  label={`${group.siteName} (${group.siteCode})`}
                  itemCount={group.rows.length}
                  level={group.level}
                  href={`/sites/${group.siteKey}`}
                  scale={model.scale}
                />
                {group.rows.map((row) => (
                  <TimelineRow key={row.key} label={row.title} level={row.level} href={row.href} scale={model.scale} sub>
                    {row.bar ? (
                      <SpanBar bar={row.bar} level={row.level} title={`${row.title}: ${row.start ?? '?'} to ${row.end ?? '?'}`} />
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
      </div>
    </Shell>
  );
}
