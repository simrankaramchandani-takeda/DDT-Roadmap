/**
 * Site index. Includes sites with ZERO projects rather than omitting them: an empty
 * site is the failure mode the hierarchy-level model exists to catch, so it must be
 * visible here as a finding rather than silently absent.
 */

import type { ReactElement } from 'react';

import { loadRoadmapView } from '@/lib/repositories/index.js';
import { buildSiteIndex } from '@/lib/view-models/site.js';
import { Card } from '@/components/Primitives.js';
import { Shell, SiteHeader } from '@/components/Shell.js';

export default async function SitesPage(): Promise<ReactElement> {
  const { snapshot, source } = await loadRoadmapView();
  const rows = buildSiteIndex(snapshot);

  const byRegion = new Map<string, typeof rows>();
  for (const row of rows) {
    const list = byRegion.get(row.site.region);
    if (list) list.push(row);
    else byRegion.set(row.site.region, [row]);
  }

  return (
    <Shell>
      <SiteHeader source={source} syncedAt={snapshot.syncedAt} asOf={snapshot.asOf} current="/sites" />

      <div className="stack">
        <h2>Sites</h2>
        {[...byRegion.entries()]
          .sort((a, b) => a[0].localeCompare(b[0]))
          .map(([region, list]) => (
            <Card key={region} title={region} subtitle={`${list.length} sites`}>
              <div className="rows">
                {list
                  .sort((a, b) => b.aligned + b.local - (a.aligned + a.local))
                  .map((row) => {
                    const total = row.aligned + row.local;
                    return (
                      <div className="row" key={row.site.key}>
                        <div className="row-main">
                          <div className="row-title">
                            <a href={`/sites/${row.site.key}`}>
                              {row.site.name} ({row.site.code})
                            </a>
                          </div>
                          <div className="row-meta">
                            {total === 0 ? (
                              <span style={{ color: 'var(--health-amber)' }}>
                                No projects in the snapshot — expected {row.site.expectedActiveCount}
                              </span>
                            ) : (
                              <>
                                {row.aligned} programme-aligned · {row.local} site-led
                                {row.aligned === 0 ? ' · no programme alignment' : ''}
                              </>
                            )}
                          </div>
                        </div>
                        <div className="row-side">
                          <span className="tnum">{total}</span> active
                          <div className="muted tnum">{row.atRisk} at risk</div>
                        </div>
                      </div>
                    );
                  })}
              </div>
            </Card>
          ))}
      </div>
    </Shell>
  );
}
