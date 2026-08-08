/**
 * Region index.
 *
 * Includes a region with zero projects rather than omitting it, on the same
 * reasoning as the site index: an absent row reads as "nothing to see here", where
 * a zero row reads as a finding. `Unassigned` appearing at all is a configuration
 * failure the snapshot gate treats as fatal, so it must be visible, not filtered.
 */

import type { ReactElement } from 'react';

import { loadRoadmapView } from '@/lib/repositories/index.js';
import { buildRegionIndex } from '@/lib/view-models/region.js';
import { HealthMark } from '@/components/HealthMark.js';
import { Card, EmptyState } from '@/components/Primitives.js';
import { Shell, SiteHeader } from '@/components/Shell.js';

export default async function RegionsPage(): Promise<ReactElement> {
  const { snapshot, source } = await loadRoadmapView();
  const rows = buildRegionIndex(snapshot);

  return (
    <Shell>
      <SiteHeader source={source} syncedAt={snapshot.syncedAt} asOf={snapshot.asOf} current="/regions" />

      <div className="stack">
        <h2>Regions</h2>
        <p className="card-sub">
          Regions reflect DD&amp;T reporting lines, not geography — Vashi reports into Europe and
          Yaroslavl into Asia-Pacific by design.
        </p>

        {rows.length === 0 ? (
          <EmptyState message="No regions in the snapshot." />
        ) : (
          <Card title="Active projects by region" subtitle="Excludes complete and cancelled work">
            <div className="rows">
              {rows.map((row) => (
                <div className="row" key={row.region}>
                  <div className="row-main">
                    <div className="row-title">
                      <HealthMark level={row.level} labelled={false} context={row.region} />{' '}
                      <a href={row.href}>{row.region}</a>
                    </div>
                    <div className="row-meta">
                      {row.siteCount} {row.siteCount === 1 ? 'site' : 'sites'}
                      {row.itemCount === 0 ? ' · no projects in the snapshot' : ''}
                      {row.region === 'Unassigned'
                        ? ' · no region assignment in config/regions.ts'
                        : ''}
                    </div>
                  </div>
                  <div className="row-side">
                    <span className="tnum">{row.itemCount}</span> active
                    <div className="muted tnum">
                      {row.atRiskCount} at risk ({row.atRiskPct}%)
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </Card>
        )}
      </div>
    </Shell>
  );
}
