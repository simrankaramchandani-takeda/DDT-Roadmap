/**
 * Small shared presentational pieces. No aggregation, no wording of their own --
 * every leadership-facing string arrives as a prop from config/narrative.ts.
 */

import type { ReactElement, ReactNode } from 'react';

import { PROVENANCE_DISPLAY } from '@/lib/view-models/health.js';
import type { RiskLevel, RiskProvenance } from '@/types/domain.js';
import { HealthMark } from './HealthMark.js';

/**
 * Provenance sits beside every status. An inferred signal must never be mistakable
 * for one a site reported -- that distinction is the project's central honesty
 * mechanism, since only 83% of items carry an authored RAG at all.
 */
export function ProvenanceChip({ provenance }: { provenance: RiskProvenance }): ReactElement {
  const display = PROVENANCE_DISPLAY[provenance];
  return (
    <span className="chip" title={display.label}>
      <span aria-hidden="true" style={{ color: display.cssVar }}>
        {display.glyph}
      </span>
      <span className="secondary">{display.label}</span>
    </span>
  );
}

/** The one number a page leads with. Proportional figures, never tabular. */
export function HeroFigure({ value, label }: { value: number | string; label: string }): ReactElement {
  return (
    <div className="hero">
      <span className="hero-value">{value}</span>
      <span className="hero-label">{label}</span>
    </div>
  );
}

export interface StatTileProps {
  label: string;
  value: number | string;
  note?: string;
  /** 0-100. Renders a meter — a ratio against a limit, not a two-slice pie. */
  meterPct?: number;
  href?: string;
}

export function StatTile({ label, value, note, meterPct, href }: StatTileProps): ReactElement {
  const body = (
    <>
      <div className="tile-label">{label}</div>
      <div className="tile-value tnum">{value}</div>
      {note ? <div className="tile-note">{note}</div> : undefined}
      {meterPct !== undefined ? (
        <div className="meter" role="img" aria-label={`${meterPct}%`}>
          <span style={{ width: `${Math.max(0, Math.min(100, meterPct))}%` }} />
        </div>
      ) : undefined}
    </>
  );

  return <div className="card">{href ? <a href={href}>{body}</a> : body}</div>;
}

export function Card({
  title,
  subtitle,
  action,
  children,
}: {
  title?: string;
  subtitle?: string;
  action?: ReactNode;
  children: ReactNode;
}): ReactElement {
  return (
    <section className="card">
      {title ? (
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: '1rem' }}>
          <h2>{title}</h2>
          {action}
        </div>
      ) : undefined}
      {subtitle ? <p className="card-sub">{subtitle}</p> : undefined}
      {children}
    </section>
  );
}

/** Named, never a blank panel. An empty state is a finding, not an absence. */
export function EmptyState({ message }: { message: string }): ReactElement {
  return <p className="empty">{message}</p>;
}

export function Notice({ title, children }: { title: string; children: ReactNode }): ReactElement {
  return (
    <div className="notice">
      <div className="notice-title">{title}</div>
      <div className="secondary">{children}</div>
    </div>
  );
}

/**
 * A cell. The health and provenance variants exist so the table renders the SAME
 * marks as the chart -- a table twin that dropped to a bare word would be a second,
 * divergent vocabulary for the same state.
 */
export type TableCell =
  | string
  | number
  | { text: string; href?: string }
  | { level: RiskLevel }
  | { provenance: RiskProvenance };

export interface TableRow {
  key: string;
  cells: TableCell[];
}

function renderCell(cell: TableCell): ReactNode {
  if (typeof cell === 'string' || typeof cell === 'number') return cell;
  if ('level' in cell) return <HealthMark level={cell.level} />;
  if ('provenance' in cell) return <ProvenanceChip provenance={cell.provenance} />;
  return cell.href ? <a href={cell.href}>{cell.text}</a> : cell.text;
}

/**
 * The table twin every chart carries.
 *
 * A Gantt is not readable by a screen reader however carefully it is marked up, and
 * a percentage-positioned bar carries no value a reader can extract. So this is an
 * accessibility requirement rather than a convenience, and it is why `TimelineFrame`
 * is never the only representation of a dataset on a page.
 *
 * Collapsed by default in a `<details>`: it needs no client JavaScript, which keeps
 * these Server Components and means it works with JS disabled.
 */
export function TableView({
  summary,
  headers,
  rows,
}: {
  summary: string;
  headers: readonly string[];
  rows: readonly TableRow[];
}): ReactElement {
  return (
    <details className="tableview">
      <summary>{summary}</summary>
      {rows.length === 0 ? (
        <EmptyState message="Nothing to tabulate in this view." />
      ) : (
        <div className="tablewrap">
          <table>
            <caption className="sr-only">{summary}</caption>
            <thead>
              <tr>
                {headers.map((header) => (
                  <th key={header} scope="col">
                    {header}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.key}>
                  {row.cells.map((cell, index) => (
                    <td key={`${row.key}:${index}`}>{renderCell(cell)}</td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </details>
  );
}
