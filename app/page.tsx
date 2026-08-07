/**
 * WP0/WP1 bootstrap page.
 *
 * NOT a designed screen. Its job is to prove the seam works end to end: the loader
 * resolves a source, validates against `snapshotSchema`, and the source indicator
 * reports which data is being served. The Portfolio Overview replaces this in WP6.
 *
 * Note what this component does NOT do: it computes nothing. Every number below is
 * read from `snapshot.coverage`, which the pipeline already aggregated. That rule
 * ("no component computes an aggregate") is what keeps the numbers on screen
 * testable without rendering -- see design-002 §3.
 */

import type { ReactElement } from 'react';

// Import convention, forced by Turbopack's resolver (see next.config.ts):
//   `.ts`  modules -> keep the repo's explicit `.js` suffix
//   `.tsx` components -> no extension
import { SourceIndicator } from '@/components/SourceIndicator';
import { loadSnapshot } from '@/lib/snapshot.js';

export default function BootstrapPage(): ReactElement {
  const { snapshot, source, path: snapshotPath } = loadSnapshot();
  const { coverage } = snapshot;

  const rows: { label: string; value: string }[] = [
    { label: 'Schema version', value: String(snapshot.schemaVersion) },
    { label: 'Source', value: source === 'live' ? `live — ${snapshotPath ?? ''}` : 'fixture — src/fixtures/snapshot.fixture.ts' },
    { label: 'Portfolios', value: String(snapshot.portfolios.length) },
    { label: 'Sites in registry', value: String(snapshot.sites.length) },
    { label: 'Initiatives (incl. site-local lane)', value: String(snapshot.initiatives.length) },
    { label: 'Items total', value: String(coverage.itemsTotal) },
    { label: 'Items active', value: String(coverage.itemsActive) },
    { label: 'With both dates', value: String(coverage.withBothDates) },
    { label: 'With an authored status', value: String(coverage.withAnyRag) },
    { label: 'With a SPOT narrative', value: String(coverage.withNarrative) },
    { label: 'Overdue (active)', value: String(coverage.overdueActive) },
    { label: 'Warnings', value: String(snapshot.warnings.length) },
  ];

  return (
    <main style={{ maxWidth: '54rem', margin: '0 auto', padding: '2.5rem 1.5rem' }}>
      <header style={{ borderBottom: '1px solid var(--border-hairline)', paddingBottom: '1rem', marginBottom: '1.75rem' }}>
        <h1 style={{ fontSize: '1.5rem', margin: '0 0 0.6rem' }}>DD&amp;T Roadmap</h1>
        <SourceIndicator source={source} syncedAt={snapshot.syncedAt} asOf={snapshot.asOf} />
      </header>

      <section
        style={{
          background: 'var(--surface-1)',
          border: '1px solid var(--border-hairline)',
          borderRadius: '8px',
          padding: '1.25rem 1.5rem',
        }}
      >
        <h2 style={{ fontSize: '0.9375rem', margin: '0 0 0.25rem' }}>Pipeline bootstrap</h2>
        <p style={{ color: 'var(--text-secondary)', fontSize: '0.875rem', margin: '0 0 1.25rem' }}>
          The snapshot loaded and passed schema validation. Screens are built in WP6 onward.
        </p>

        <dl style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) auto', gap: '0.5rem 1.5rem', margin: 0 }}>
          {rows.map((row) => (
            <div key={row.label} style={{ display: 'contents' }}>
              <dt style={{ color: 'var(--text-secondary)', fontSize: '0.875rem' }}>{row.label}</dt>
              <dd
                style={{
                  margin: 0,
                  textAlign: 'right',
                  fontVariantNumeric: 'tabular-nums',
                  fontSize: '0.875rem',
                }}
              >
                {row.value}
              </dd>
            </div>
          ))}
        </dl>
      </section>

      {snapshot.warnings.length > 0 && (
        <section style={{ marginTop: '1.5rem' }}>
          <h2 style={{ fontSize: '0.9375rem', margin: '0 0 0.5rem' }}>Warnings</h2>
          <ul style={{ color: 'var(--text-secondary)', fontSize: '0.875rem', margin: 0, paddingLeft: '1.25rem' }}>
            {snapshot.warnings.map((warning) => (
              <li key={warning} style={{ marginBottom: '0.35rem' }}>
                {warning}
              </li>
            ))}
          </ul>
        </section>
      )}
    </main>
  );
}
