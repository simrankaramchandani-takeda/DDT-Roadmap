/**
 * States where the data on screen came from, and how old it is.
 *
 * This is a correctness feature, not chrome. Two ways an executive roadmap can
 * mislead without being wrong:
 *   - sample data mistaken for real data;
 *   - a snapshot presented as if it were live.
 *
 * Both are prevented by showing the source and the age on every screen. The feed
 * behind the snapshot is same-day, not live, so the app can never be more current
 * than `syncedAt` -- and it must never imply otherwise (design-002 §11, D6).
 */

import type { CSSProperties, ReactElement } from 'react';

import type { DataSourceKind } from '@/lib/repositories/index.js';

export interface SourceIndicatorProps {
  source: DataSourceKind;
  /** Snapshot `syncedAt`, ISO timestamp. */
  syncedAt: string;
  /** Snapshot `asOf`, YYYY-MM-DD -- the date risk was evaluated against. */
  asOf: string;
}

function formatDate(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return date.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
}

function formatTimestamp(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return `${formatDate(iso)}, ${date.toISOString().slice(11, 16)} UTC`;
}

const chip: CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  gap: '0.4rem',
  padding: '0.15rem 0.55rem',
  borderRadius: '999px',
  border: '1px solid var(--border-hairline)',
  fontSize: '0.8125rem',
  whiteSpace: 'nowrap',
};

export function SourceIndicator({ source, syncedAt, asOf }: SourceIndicatorProps): ReactElement {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', flexWrap: 'wrap' }}>
      <span style={{ color: 'var(--text-secondary)', fontSize: '0.8125rem' }}>As of {formatDate(asOf)}</span>

      {source === 'fixture' ? (
        // Deliberately the most prominent thing in the header. A demo must never be
        // mistakable for production data.
        <span
          style={{ ...chip, borderColor: 'var(--status-warning)', color: 'var(--text-primary)' }}
          title="No data/snapshot.json present. Serving the committed fixture from src/fixtures/snapshot.fixture.ts."
        >
          <span aria-hidden="true">▲</span>
          Sample data — not a real sync
        </span>
      ) : (
        <span style={{ ...chip, color: 'var(--text-secondary)' }} title={`Snapshot written ${syncedAt}`}>
          <span aria-hidden="true" style={{ color: 'var(--status-good)' }}>
            ●
          </span>
          Live snapshot
        </span>
      )}

      <span style={{ color: 'var(--text-muted)', fontSize: '0.8125rem' }}>Data to {formatTimestamp(syncedAt)}</span>
    </div>
  );
}
