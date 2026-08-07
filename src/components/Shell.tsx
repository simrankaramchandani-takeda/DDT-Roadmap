/**
 * App shell: header, nav, and the single filter bar.
 *
 * The filter bar is ONE instance above everything it scopes -- never inside a card
 * and never per-chart. Its state lives entirely in the URL, so every view is
 * shareable and bookmarkable. That is implemented with plain links rather than
 * client-side state, which keeps these Server Components and means the filters work
 * with JavaScript disabled.
 */

import type { ReactElement, ReactNode } from 'react';

import { REGIONS } from '@config/regions.js';
import type { SiteSummary } from '@/types/domain.js';
import { serialiseFilters, withFilter, type Filters, type RiskFilter, type ScopeFilter } from '@/lib/view-models/filters.js';
import { SourceIndicator } from './SourceIndicator.js';
import type { SnapshotSource } from '@/lib/snapshot.js';

const NAV = [
  { href: '/', label: 'Overview' },
  { href: '/roadmap', label: 'Global Roadmap' },
  { href: '/initiatives', label: 'Initiatives' },
  { href: '/sites', label: 'Sites' },
];

export function SiteHeader({
  source,
  syncedAt,
  asOf,
  current,
}: {
  source: SnapshotSource;
  syncedAt: string;
  asOf: string;
  current: string;
}): ReactElement {
  return (
    <>
      <header className="site-header">
        <h1 style={{ marginRight: 'auto' }}>
          <a href="/">DD&amp;T Roadmap</a>
        </h1>
        <SourceIndicator source={source} syncedAt={syncedAt} asOf={asOf} />
      </header>
      <nav className="nav">
        {NAV.map((entry) => {
          const active =
            entry.href === '/' ? current === '/' : current.startsWith(entry.href);
          return (
            <a key={entry.href} href={entry.href} {...(active ? { 'aria-current': 'page' as const } : {})}>
              {entry.label}
            </a>
          );
        })}
      </nav>
    </>
  );
}

/** A segmented control rendered as links, so it needs no client JavaScript. */
function Segmented<T extends string>({
  basePath,
  filters,
  field,
  options,
}: {
  basePath: string;
  filters: Filters;
  field: 'risk' | 'scope';
  options: readonly { value: T; label: string }[];
}): ReactElement {
  return (
    <span className="seg">
      {options.map((option) => {
        const next = withFilter(filters, field, option.value as never);
        const selected = filters[field] === option.value;
        return (
          <a
            key={option.value}
            href={`${basePath}${serialiseFilters(next)}`}
            aria-current={selected ? 'true' : undefined}
          >
            {option.label}
          </a>
        );
      })}
    </span>
  );
}

/** A dropdown-equivalent rendered as a list of links inside a <details>. */
function LinkSelect({
  basePath,
  filters,
  field,
  label,
  options,
}: {
  basePath: string;
  filters: Filters;
  field: 'region' | 'site' | 'fy';
  label: string;
  options: readonly { value: string; label: string }[];
}): ReactElement {
  const selected = filters[field];
  const selectedLabel = options.find((o) => o.value === selected)?.label ?? 'All';

  return (
    <details className="filter-group" style={{ position: 'relative' }}>
      <summary style={{ cursor: 'pointer', listStyle: 'none' }}>
        <span className="filter-label">{label}: </span>
        <span style={{ fontWeight: 600 }}>{selectedLabel} ▾</span>
      </summary>
      <div
        className="card"
        style={{
          position: 'absolute',
          top: '1.6rem',
          left: 0,
          zIndex: 10,
          padding: '0.4rem',
          minWidth: '12rem',
          maxHeight: '18rem',
          overflowY: 'auto',
        }}
      >
        <a
          href={`${basePath}${serialiseFilters(withFilter(filters, field, undefined))}`}
          style={{ display: 'block', padding: '0.2rem 0.4rem' }}
        >
          {selected ? 'All' : '✓ All'}
        </a>
        {options.map((option) => (
          <a
            key={option.value}
            href={`${basePath}${serialiseFilters(withFilter(filters, field, option.value))}`}
            style={{ display: 'block', padding: '0.2rem 0.4rem' }}
          >
            {selected === option.value ? `✓ ${option.label}` : option.label}
          </a>
        ))}
      </div>
    </details>
  );
}

const RISK_OPTIONS: readonly { value: RiskFilter; label: string }[] = [
  { value: 'all', label: 'All' },
  { value: 'at-risk', label: 'At Risk' },
  { value: 'not-at-risk', label: 'Not At Risk' },
];

const SCOPE_OPTIONS: readonly { value: ScopeFilter; label: string }[] = [
  { value: 'ongoing', label: 'Ongoing' },
  { value: 'completed', label: 'Completed' },
  { value: 'all', label: 'All' },
];

export function FilterBar({
  basePath,
  filters,
  sites,
  fiscalYears,
  showSite = true,
}: {
  basePath: string;
  filters: Filters;
  sites: readonly SiteSummary[];
  fiscalYears: readonly string[];
  showSite?: boolean;
}): ReactElement {
  const isDefault = serialiseFilters(filters) === '';

  return (
    <div className="filters">
      {/* "Risk Indicator" and the Completed/Ongoing toggle are both carried over
          from the reference report, so the vocabulary is already familiar. */}
      <span className="filter-group">
        <span className="filter-label">Risk:</span>
        <Segmented basePath={basePath} filters={filters} field="risk" options={RISK_OPTIONS} />
      </span>
      <span className="filter-group">
        <span className="filter-label">Scope:</span>
        <Segmented basePath={basePath} filters={filters} field="scope" options={SCOPE_OPTIONS} />
      </span>

      <LinkSelect
        basePath={basePath}
        filters={filters}
        field="region"
        label="Region"
        options={REGIONS.map((r) => ({ value: r, label: r }))}
      />

      {showSite ? (
        <LinkSelect
          basePath={basePath}
          filters={filters}
          field="site"
          label="Site"
          options={sites
            .filter((s) => s.activeCount > 0)
            .map((s) => ({ value: s.key, label: `${s.name} (${s.code})` }))}
        />
      ) : undefined}

      <LinkSelect
        basePath={basePath}
        filters={filters}
        field="fy"
        label="FY"
        options={fiscalYears.map((fy) => ({ value: fy, label: fy }))}
      />

      {!isDefault ? (
        <a href={basePath} className="muted" style={{ marginLeft: 'auto' }}>
          Clear all filters
        </a>
      ) : undefined}
    </div>
  );
}

export function Shell({ children }: { children: ReactNode }): ReactElement {
  return <div className="shell">{children}</div>;
}
