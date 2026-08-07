/**
 * Executive Overview.
 *
 * The screen the reference Power BI report has no equivalent of. Its four pages are
 * all Gantt charts with no aggregate numbers anywhere, so "how much is at risk" can
 * only be answered by counting bars. Everything here answers that directly, and
 * every figure is read from a view model rather than computed in this component.
 */

import type { ReactElement } from 'react';

import { loadSnapshot } from '@/lib/snapshot.js';
import { buildOverviewModel } from '@/lib/view-models/overview.js';
import { fiscalYearOptions, parseFilters, serialiseFilters, type RawSearchParams } from '@/lib/view-models/filters.js';
import { HEALTH_DISPLAY } from '@/lib/view-models/health.js';
import { HealthMark } from '@/components/HealthMark.js';
import { Card, EmptyState, HeroFigure, ProvenanceChip, StatTile } from '@/components/Primitives.js';
import { FilterBar, Shell, SiteHeader } from '@/components/Shell.js';

export default async function OverviewPage({
  searchParams,
}: {
  searchParams: Promise<RawSearchParams>;
}): Promise<ReactElement> {
  const params = await searchParams;
  const filters = parseFilters(params);
  const { snapshot, source } = loadSnapshot();
  const model = buildOverviewModel(snapshot, filters);
  const query = serialiseFilters(filters);

  return (
    <Shell>
      <SiteHeader source={source} syncedAt={snapshot.syncedAt} asOf={snapshot.asOf} current="/" />
      <FilterBar
        basePath="/"
        filters={filters}
        sites={snapshot.sites}
        fiscalYears={fiscalYearOptions(snapshot.items)}
      />

      <div className="stack">
        {/* Hero + distribution. The hero answers the 30-second question. */}
        <div className="grid grid-2">
          <Card>
            <HeroFigure
              value={model.atRiskCount}
              label={`projects need attention, of ${model.activeCount} active`}
            />
          </Card>

          <Card title="Portfolio health" subtitle={`${model.alignment.total} projects in view`}>
            {model.health.length === 0 ? (
              <EmptyState message="No projects match the current filters." />
            ) : (
              <>
                <div className="dist" role="img" aria-label="Health distribution">
                  {model.health.map((slice) => (
                    <span
                      key={slice.level}
                      className={HEALTH_DISPLAY[slice.level].hatched ? 'tl-hatch' : undefined}
                      style={{
                        background: HEALTH_DISPLAY[slice.level].cssVar,
                        width: `${Math.max(slice.pct, 1)}%`,
                      }}
                      title={`${HEALTH_DISPLAY[slice.level].label}: ${slice.count}`}
                    />
                  ))}
                </div>
                <div className="legend">
                  {model.health.map((slice) => (
                    <span className="legend-item" key={slice.level}>
                      <span aria-hidden="true" style={{ color: HEALTH_DISPLAY[slice.level].cssVar }}>
                        {HEALTH_DISPLAY[slice.level].glyph}
                      </span>
                      {HEALTH_DISPLAY[slice.level].label}
                      <span className="tnum" style={{ fontWeight: 600 }}>
                        {slice.count}
                      </span>
                    </span>
                  ))}
                </div>
              </>
            )}
          </Card>
        </div>

        {/* Alignment is a first-class figure, not a hidden bucket: 51% of the
            portfolio is site-led, which is a delivery model rather than a gap. */}
        <div className="grid grid-4">
          <StatTile
            label="Aligned to a programme"
            value={model.alignment.aligned}
            note={`${100 - model.alignment.localPct}% of projects in view`}
          />
          <StatTile
            label="Site-led"
            value={model.alignment.local}
            note={`${model.alignment.localPct}% — delivered outside global programmes`}
          />
          <StatTile
            label="Authored status"
            value={`${model.coverage.authoredPct}%`}
            note={`${model.coverage.authored} of ${model.alignment.total} report a RAG`}
            meterPct={model.coverage.authoredPct}
          />
          <StatTile
            label="Site narrative"
            value={`${model.coverage.narrativePct}%`}
            note={`${model.coverage.narrative} explain their status`}
            meterPct={model.coverage.narrativePct}
          />
        </div>

        <Card
          title="Needs leadership attention"
          subtitle={
            model.attentionTotal > model.attention.length
              ? `Showing ${model.attention.length} of ${model.attentionTotal}, worst first`
              : 'Worst first'
          }
        >
          {model.attention.length === 0 ? (
            <EmptyState message="No projects are currently at risk in this view." />
          ) : (
            <div className="rows">
              {model.attention.map((row) => (
                <div className="row" key={row.key}>
                  <div className="row-main">
                    <div className="row-title">
                      <HealthMark level={row.risk.level} labelled={false} context={row.title} />{' '}
                      <a href={`/projects/${row.key}`}>{row.title}</a>
                    </div>
                    {row.primaryReason ? (
                      <div className="row-meta">
                        <strong>{row.primaryReason.label}</strong> · {row.primaryReason.detail}
                      </div>
                    ) : undefined}
                    <div className="row-meta" style={{ marginTop: '0.2rem' }}>
                      <ProvenanceChip provenance={row.risk.provenance} />
                    </div>
                  </div>
                  <div className="row-side">
                    <a href={`/sites/${row.key.split('-')[0]}`}>{row.siteName}</a>
                    <div className="muted">{row.region}</div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </Card>

        <div className="grid grid-2">
          <Card title="By region" subtitle="Projects in view, with the at-risk share">
            {model.regions.length === 0 ? (
              <EmptyState message="No regions match the current filters." />
            ) : (
              <div className="bars">
                {model.regions.map((region) => (
                  <div className="bar-row" key={region.region}>
                    <span>
                      <a href={`/${query ? query + '&' : '?'}region=${encodeURIComponent(region.region)}`}>
                        {region.region}
                      </a>
                    </span>
                    <span style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                      <span className="bar-track" style={{ flex: 1 }}>
                        <span className="bar-fill" style={{ width: `${region.atRiskPct}%` }} />
                      </span>
                      <span className="tnum muted" style={{ minWidth: '5.5rem', textAlign: 'right' }}>
                        {region.atRisk} of {region.total}
                      </span>
                    </span>
                  </div>
                ))}
              </div>
            )}
          </Card>

          <Card
            title="Go-lives, next two quarters"
            subtitle={
              model.upcomingTotal > model.upcoming.length
                ? `Showing ${model.upcoming.length} of ${model.upcomingTotal}`
                : 'Chronological'
            }
          >
            {model.upcoming.length === 0 ? (
              <EmptyState message="No go-lives fall in the next two quarters." />
            ) : (
              <div className="rows">
                {model.upcoming.map((row) => (
                  <div className="row" key={row.key}>
                    <div className="row-side tnum" style={{ minWidth: '5.5rem', textAlign: 'left' }}>
                      {row.goLive}
                    </div>
                    <div className="row-main">
                      <div className="row-title">
                        <HealthMark level={row.level} labelled={false} context={row.title} />{' '}
                        <a href={`/projects/${row.key}`}>{row.title}</a>
                      </div>
                    </div>
                    <div className="row-side">{row.siteCode}</div>
                  </div>
                ))}
              </div>
            )}
          </Card>
        </div>

        <Card
          title="Programme health"
          subtitle={`${model.initiativeCount} initiatives. Every initiative status is rolled up from its projects — no feed exposes an authored initiative RAG.`}
        >
          <div className="legend">
            {Object.entries(model.initiativeHealth)
              .filter(([, count]) => count > 0)
              .map(([level, count]) => {
                const display = HEALTH_DISPLAY[level as keyof typeof HEALTH_DISPLAY];
                return (
                  <span className="legend-item" key={level}>
                    <span aria-hidden="true" style={{ color: display.cssVar }}>
                      {display.glyph}
                    </span>
                    {display.label}
                    <span className="tnum" style={{ fontWeight: 600 }}>
                      {count}
                    </span>
                  </span>
                );
              })}
          </div>
        </Card>
      </div>
    </Shell>
  );
}
