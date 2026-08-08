/**
 * Initiative index, worst health first. The site-local lane sorts last: it is the
 * largest lane but is not a programme, so it reads as a footer rather than
 * competing with the real initiatives.
 */

import type { ReactElement } from 'react';

import { loadRoadmapView } from '@/lib/repositories/index.js';
import { buildInitiativeIndex } from '@/lib/view-models/initiative.js';
import { HealthMark } from '@/components/HealthMark.js';
import { Card } from '@/components/Primitives.js';
import { Shell, SiteHeader } from '@/components/Shell.js';

export default async function InitiativesPage(): Promise<ReactElement> {
  const { snapshot, source } = await loadRoadmapView();
  const rows = buildInitiativeIndex(snapshot);

  return (
    <Shell>
      <SiteHeader source={source} syncedAt={snapshot.syncedAt} asOf={snapshot.asOf} current="/initiatives" />

      <div className="stack">
        <h2>Initiatives</h2>
        <Card subtitle="Every status here is rolled up from linked projects — no feed exposes an authored initiative RAG.">
          <div className="rows">
            {rows.map((row) => (
              <div className="row" key={row.key}>
                <div className="row-main">
                  <div className="row-title">
                    <HealthMark level={row.level} labelled={false} context={row.summary} />{' '}
                    <a href={`/initiatives/${encodeURIComponent(row.key)}`}>{row.summary}</a>
                    {row.isLocalLane ? <span className="muted"> — not a programme</span> : undefined}
                  </div>
                  <div className="row-meta">
                    {row.itemCount} {row.itemCount === 1 ? 'project' : 'projects'}
                    {row.siteCount > 0 ? ` · ${row.siteCount} sites` : ''}
                    {!row.hasDates ? ' · no dates reported' : ''}
                  </div>
                </div>
                <div className="row-side">
                  <HealthMark level={row.level} />
                </div>
              </div>
            ))}
          </div>
        </Card>
      </div>
    </Shell>
  );
}
