/**
 * Data & coverage — where the project's honesty about its own data lives.
 *
 * The reference report has no page like this, and that absence is the argument for
 * building it: on a Gantt with no coverage disclosure, a bar whose status nobody
 * authored looks exactly like one a site reported. Every figure here counts what is
 * NOT known and gives it the same prominence as what is.
 *
 * NO FILTER BAR. Coverage describes the dataset, not a view of it. A filtered
 * coverage percentage would be a different and far weaker claim, and it would break
 * the agreement with `verify-snapshot` that the two report the same numbers.
 */

import type { ReactElement } from 'react';

import { loadSnapshot } from '@/lib/snapshot.js';
import { buildDataModel } from '@/lib/view-models/data.js';
import { HealthMark } from '@/components/HealthMark.js';
import { Card, EmptyState, Notice, StatTile, TableView } from '@/components/Primitives.js';
import { Shell, SiteHeader } from '@/components/Shell.js';

export default function DataPage(): ReactElement {
  const { snapshot, source } = loadSnapshot();
  const model = buildDataModel(snapshot);

  return (
    <Shell>
      <SiteHeader source={source} syncedAt={snapshot.syncedAt} asOf={snapshot.asOf} current="/data" />

      <div className="stack">
        <div>
          <h2 style={{ fontSize: '1.25rem' }}>Data &amp; coverage</h2>
          <p className="card-sub">
            What this roadmap knows, what it does not, and where each number came from. Coverage is
            reported over the whole dataset and is deliberately not filterable.
          </p>
        </div>

        <div className="grid grid-4">
          <StatTile label="Projects" value={model.itemsTotal} note={`${model.itemsActive} active`} />
          <StatTile label="Programmes" value={model.initiativeCount} note="portfolio initiatives" />
          <StatTile
            label="Source read"
            value={model.syncedAt.slice(0, 10)}
            note={`${model.syncedAt.slice(11, 16)} UTC`}
          />
          {/* Two freshness facts, not one: when we read the source, and how current
              the source data itself was. The feed is same-day rather than live. */}
          <StatTile
            label="Newest source update"
            value={model.newestUpdate ? model.newestUpdate.slice(0, 10) : '—'}
            note={
              model.dataAgeDays === undefined
                ? 'no items carry an update timestamp'
                : `${model.dataAgeDays} ${model.dataAgeDays === 1 ? 'day' : 'days'} before the as-of date`
            }
          />
        </div>

        {source === 'fixture' ? (
          <Notice title="This is sample data">
            No validated snapshot is present, so every figure on this page — and every figure
            everywhere else in the application — comes from the committed fixture in{' '}
            <code>src/fixtures/snapshot.fixture.ts</code>. It is shaped like real data and is not
            real data.
          </Notice>
        ) : undefined}

        <Card
          title="Coverage"
          subtitle="Each row is a count of active projects, not a percentage on its own. What is missing matters more than what is present."
        >
          <div className="stack" style={{ gap: '0.9rem' }}>
            {model.coverageRows.map((row) => (
              <div key={row.label}>
                <div style={{ display: 'flex', justifyContent: 'space-between', gap: '1rem', alignItems: 'baseline' }}>
                  <strong style={{ fontSize: '0.875rem' }}>{row.label}</strong>
                  <span className="tnum secondary">
                    {row.known} of {row.total} ({row.pct}%)
                  </span>
                </div>
                <div className="meter" role="img" aria-label={`${row.pct}%`}>
                  <span style={{ width: `${row.pct}%` }} />
                </div>
                <div className="tile-note">{row.note}</div>
              </div>
            ))}
          </div>
        </Card>

        <div className="grid grid-2">
          <Card
            title="Where each status came from"
            subtitle="Ordered by how much trust the status deserves. An inferred status is never presented as a reported one."
          >
            <TableView
              summary={`Table view — status provenance across ${model.itemsActive} active projects`}
              headers={['Provenance', 'Projects', 'Share']}
              rows={model.provenance.map((row) => ({
                key: row.key,
                cells: [row.label, row.count, `${row.pct}%`],
              }))}
            />
            <div className="bars" style={{ marginTop: '0.75rem' }}>
              {model.provenance.map((row) => (
                <div className="bar-row" key={row.key}>
                  <span>{row.label}</span>
                  <span style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                    <span className="bar-track" style={{ flex: 1 }}>
                      <span className="bar-fill" style={{ width: `${row.pct}%` }} />
                    </span>
                    <span className="tnum muted" style={{ minWidth: '4.5rem', textAlign: 'right' }}>
                      {row.count} ({row.pct}%)
                    </span>
                  </span>
                </div>
              ))}
            </div>
          </Card>

          <Card
            title="Where each summary came from"
            subtitle="A generated summary is composed from Jira facts by template — never by a language model — so it is reproducible and cannot invent a cause."
          >
            <div className="bars">
              {model.summarySource.map((row) => (
                <div className="bar-row" key={row.key}>
                  <span>{row.label}</span>
                  <span style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                    <span className="bar-track" style={{ flex: 1 }}>
                      <span className="bar-fill" style={{ width: `${row.pct}%` }} />
                    </span>
                    <span className="tnum muted" style={{ minWidth: '4.5rem', textAlign: 'right' }}>
                      {row.count} ({row.pct}%)
                    </span>
                  </span>
                </div>
              ))}
            </div>
          </Card>
        </div>

        <div className="grid grid-2">
          <Card title="Status distribution" subtitle="Active projects by resolved risk level">
            <div className="legend">
              {model.riskLevels.map((row) => (
                <span className="legend-item" key={row.key}>
                  <HealthMark level={row.level} />
                  <span className="tnum" style={{ fontWeight: 600 }}>
                    {row.count}
                  </span>
                  <span className="muted tnum">({row.pct}%)</span>
                </span>
              ))}
            </div>
          </Card>

          <Card
            title="Why statuses landed where they did"
            subtitle="Reasons attached across all projects. One project can carry several, so these do not sum to the project count."
          >
            {model.reasons.length === 0 ? (
              <EmptyState message="No risk reasons are recorded in this snapshot." />
            ) : (
              <div className="bars">
                {model.reasons.map((row) => (
                  <div className="bar-row" key={row.key}>
                    <span>{row.label}</span>
                    <span style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                      <span className="bar-track" style={{ flex: 1 }}>
                        <span className="bar-fill" style={{ width: `${row.pct}%` }} />
                      </span>
                      <span className="tnum muted" style={{ minWidth: '3rem', textAlign: 'right' }}>
                        {row.count}
                      </span>
                    </span>
                  </div>
                ))}
              </div>
            )}
          </Card>
        </div>

        {/* Per-site coverage is the row that identifies WHO to ask. A portfolio-level
            83% is not actionable; "this site authored 2 of 17" is. */}
        <Card
          title="Coverage by site"
          subtitle="Actual project count against the count measured at discovery, with per-site reporting coverage."
        >
          <div className="tablewrap">
            <table>
              <thead>
                <tr>
                  <th scope="col">Site</th>
                  <th scope="col">Region</th>
                  <th scope="col" className="num">Projects</th>
                  <th scope="col" className="num">Expected</th>
                  <th scope="col" className="num">Drift</th>
                  <th scope="col" className="num">Authored</th>
                  <th scope="col" className="num">Narrative</th>
                  <th scope="col" className="num">Both dates</th>
                </tr>
              </thead>
              <tbody>
                {model.sites.map((row) => (
                  <tr key={row.site.key}>
                    <td>
                      <a href={row.href}>
                        {row.site.name} ({row.site.code})
                      </a>
                    </td>
                    <td>
                      {row.site.region}
                      {row.site.regionProvisional ? <span className="muted"> · provisional</span> : undefined}
                    </td>
                    <td className="num">{row.itemCount}</td>
                    <td className="num">{row.site.expectedActiveCount}</td>
                    <td className="num">
                      {row.drift === 0 ? (
                        <span className="muted">—</span>
                      ) : (
                        <span style={{ color: 'var(--health-amber)' }}>
                          {row.drift > 0 ? `+${row.drift}` : row.drift}
                        </span>
                      )}
                    </td>
                    <td className="num">
                      {row.authored} <span className="muted">({row.authoredPct}%)</span>
                    </td>
                    <td className="num">
                      {row.narrative} <span className="muted">({row.narrativePct}%)</span>
                    </td>
                    <td className="num">
                      {row.bothDates} <span className="muted">({row.bothDatesPct}%)</span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>

        {model.emptySites.length > 0 ? (
          <Notice title={`${model.emptySites.length} configured site${model.emptySites.length === 1 ? '' : 's'} returned no projects`}>
            {model.emptySites.map((s) => `${s.name} (${s.code})`).join(' · ')} — the snapshot gate
            treats this as a hard failure, because a site whose level-1 issue type is unrecognised
            returns nothing and reports no error. It renders as a site with no work rather than as a
            defect, which is exactly why the check exists.
          </Notice>
        ) : undefined}

        {model.initiativesWithoutDates.length > 0 ? (
          <Card
            title={`Programmes with no dates (${model.initiativesWithoutDates.length})`}
            subtitle="Neither authored nor derivable from linked projects. The reference report renders these as silently empty lanes; naming them turns an invisible gap into a visible one."
          >
            <div className="rows">
              {model.initiativesWithoutDates.map((row) => (
                <div className="row" key={row.key}>
                  <div className="row-main">
                    <div className="row-title">
                      <a href={`/initiatives/${row.key}`}>{row.summary}</a>
                    </div>
                    <div className="row-meta">
                      {row.itemCount === 0
                        ? 'No linked projects — nothing to derive a span from'
                        : `${row.itemCount} linked ${row.itemCount === 1 ? 'project' : 'projects'}, none carrying dates`}
                    </div>
                  </div>
                  <div className="row-side muted">{row.key}</div>
                </div>
              ))}
            </div>
          </Card>
        ) : undefined}

        {/* Warnings are expected findings, not defects. Saying so on the page keeps a
            reader from reading a data-quality note as a broken pipeline. */}
        <Card
          title={`Warnings from the last sync (${model.warnings.length})`}
          subtitle="Data-quality findings and open questions raised while building the snapshot. These are expected observations, not failures — only the gate's hard checks block."
        >
          {model.warnings.length === 0 ? (
            <EmptyState message="The last sync raised no warnings." />
          ) : (
            <ul className="warnings">
              {model.warnings.map((warning) => (
                <li key={warning}>{warning}</li>
              ))}
            </ul>
          )}
        </Card>
      </div>
    </Shell>
  );
}
