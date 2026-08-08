/**
 * Project detail — the screen that answers WHY a project is amber or red.
 *
 * The reference Gantt can only tell you a bar is red. This page carries the
 * site-authored SPOT narrative (59% of items have one), the resolved risk reasons
 * with their concrete facts, and the provenance of the status itself.
 *
 * `risk.score` is deliberately absent. It orders the attention list and nothing
 * else; showing it invites arguments about the arithmetic instead of the project.
 */

import type { ReactElement } from 'react';
import { notFound } from 'next/navigation';

import { loadRoadmapView } from '@/lib/repositories/index.js';
import { buildProjectModel } from '@/lib/view-models/project.js';
import { HealthMark } from '@/components/HealthMark.js';
import { Card, EmptyState, Notice, ProvenanceChip } from '@/components/Primitives.js';
import { Shell, SiteHeader } from '@/components/Shell.js';

export default async function ProjectPage({
  params,
}: {
  params: Promise<{ key: string }>;
}): Promise<ReactElement> {
  const { key } = await params;
  const decoded = decodeURIComponent(key);
  const { snapshot, source } = await loadRoadmapView();
  const model = buildProjectModel(snapshot, decoded);

  if (!model) notFound();

  const { item } = model;
  const authored = item.risk.authored;

  return (
    <Shell>
      <SiteHeader source={source} syncedAt={snapshot.syncedAt} asOf={snapshot.asOf} current="/projects" />

      <div className="stack">
        <div>
          <div className="crumb">
            <a href={`/sites/${item.siteKey}`}>{item.siteName}</a>
            {model.initiative ? (
              <>
                {' / '}
                <a href={`/initiatives/${encodeURIComponent(model.initiative.key)}`}>{model.initiative.summary}</a>
              </>
            ) : (
              ' / Site-led'
            )}
          </div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.5rem 1rem', alignItems: 'baseline' }}>
            <h2 style={{ fontSize: '1.25rem' }}>{item.summary.cleanTitle}</h2>
            <span className="muted tnum">{item.key}</span>
            <a className="muted" href={item.jiraUrl} target="_blank" rel="noreferrer">
              Jira ↗
            </a>
            {item.spotUrl ? (
              <a className="muted" href={item.spotUrl} target="_blank" rel="noreferrer">
                SPOT ↗
              </a>
            ) : undefined}
          </div>
          {item.summary.raw !== item.summary.cleanTitle ? (
            <div className="muted" style={{ marginTop: '0.15rem' }}>
              Jira summary: {item.summary.raw}
            </div>
          ) : undefined}
        </div>

        {/* Status band: level + provenance + the authored value if there is one. */}
        <div className="card" style={{ display: 'flex', flexWrap: 'wrap', gap: '0.6rem 1.5rem', alignItems: 'center' }}>
          <span style={{ fontSize: '1rem', fontWeight: 600 }}>
            <HealthMark level={item.risk.level} />
          </span>
          <ProvenanceChip provenance={item.risk.provenance} />
          {authored ? (
            <span className="muted">
              Site reported &ldquo;{authored.value}&rdquo; via {authored.sourceLabel}
              {authored.asOf ? ` as at ${authored.asOf.slice(0, 10)}` : ''}
            </span>
          ) : (
            <span className="muted">No status authored in Jira — the level shown is derived.</span>
          )}
          {model.overdueDays ? (
            <span className="chip chip-warning">Overdue by {model.overdueDays} days</span>
          ) : undefined}
          {model.daysToGoLive !== undefined ? (
            <span className="chip">Go-live in {model.daysToGoLive} days</span>
          ) : undefined}
        </div>

        <Card title="Why" subtitle="Each line is a fact from the data, never an inferred cause">
          {item.risk.reasons.length === 0 ? (
            <EmptyState message="No risk reasons were recorded for this project." />
          ) : (
            <div className="reasons">
              {item.risk.reasons.map((reason) => (
                <div className="reason" key={`${reason.code}-${reason.detail}`}>
                  <span className="reason-label">
                    <HealthMark level={item.risk.level} labelled={false} context={reason.label} /> {reason.label}
                  </span>
                  <span className="secondary">{reason.detail}</span>
                </div>
              ))}
            </div>
          )}
        </Card>

        {model.hasNarrative ? (
          <Card title="Site-authored status" subtitle={model.summarySourceLabel}>
            <dl className="dl">
              {model.narrativeRows.map((row) => (
                <div key={row.label} style={{ display: 'contents' }}>
                  <dt>{row.label}</dt>
                  <dd>{row.value}</dd>
                </div>
              ))}
            </dl>
            {item.narrative.sourceUrl ? (
              <p style={{ marginBottom: 0, marginTop: '0.75rem' }}>
                <a className="muted" href={item.narrative.sourceUrl} target="_blank" rel="noreferrer">
                  Open the SPOT record ↗
                </a>
              </p>
            ) : undefined}
          </Card>
        ) : (
          <Notice title="No site-authored narrative">
            This project has no SPOT status description, so the summary shown across the app is{' '}
            {model.summarySourceLabel.toLowerCase()}. Around 41% of projects are in this position — the
            executive summary is generated from dates and status rather than written by the site.
          </Notice>
        )}

        <Card title="Executive summary" subtitle={model.summarySourceLabel}>
          <p style={{ margin: 0 }}>{item.narrative.executiveSummary}</p>
          {item.narrative.summaryBasis && item.narrative.summaryBasis.length > 0 ? (
            <p className="muted" style={{ marginBottom: 0 }}>
              Composed from: {item.narrative.summaryBasis.join(', ')}
            </p>
          ) : undefined}
        </Card>

        <div className="grid grid-2">
          <Card title="Schedule">
            <dl className="dl">
              {model.scheduleRows.map((row) => (
                <div key={row.label} style={{ display: 'contents' }}>
                  <dt>{row.label}</dt>
                  <dd className={row.absent ? 'absent' : undefined}>{row.value}</dd>
                </div>
              ))}
            </dl>
          </Card>

          <Card title="Detail">
            <dl className="dl">
              {model.detailRows.map((row) => (
                <div key={row.label} style={{ display: 'contents' }}>
                  <dt>{row.label}</dt>
                  <dd className={row.absent ? 'absent' : undefined}>{row.value}</dd>
                </div>
              ))}
            </dl>
          </Card>
        </div>

        {item.blockers.length > 0 ? (
          <Card title="Blockers" subtitle="From issue links — Jira's Flagged field is unused portfolio-wide">
            <div className="rows">
              {item.blockers.map((blocker) => (
                <div className="row" key={blocker.key}>
                  <div className="row-main">
                    <div className="row-title">
                      {blocker.key} — {blocker.summary}
                    </div>
                    <div className="row-meta">{blocker.type}</div>
                  </div>
                  <div className="row-side">{blocker.open ? 'Open' : 'Resolved'}</div>
                </div>
              ))}
            </div>
          </Card>
        ) : undefined}
      </div>
    </Shell>
  );
}
