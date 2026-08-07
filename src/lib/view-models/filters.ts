/**
 * Filter state, and the one function that applies it.
 *
 * State lives in the URL query so every view is shareable and bookmarkable -- a
 * hard requirement for executive use, and something the Power BI report cannot do.
 *
 * The three slicers preserved from the reference report are `risk` (its "Risk
 * Indicator"), `scope` (its Completed/Ongoing toggle) and `fy` (its FY Group).
 * `region` and `site` replace its code dropdowns.
 */

import type { RoadmapItem } from '@/types/domain.js';

export type RiskFilter = 'all' | 'at-risk' | 'not-at-risk';
export type ScopeFilter = 'ongoing' | 'completed' | 'all';

export interface Filters {
  risk: RiskFilter;
  /** `ongoing` excludes complete AND cancelled -- the pipeline's "active" set. */
  scope: ScopeFilter;
  region?: string;
  site?: string;
  fy?: string;
}

export const DEFAULT_FILTERS: Filters = { risk: 'all', scope: 'ongoing' };

/** Query params as Next hands them to a page. */
export type RawSearchParams = Record<string, string | string[] | undefined>;

function first(value: string | string[] | undefined): string | undefined {
  if (Array.isArray(value)) return value[0];
  return value;
}

function oneOf<T extends string>(value: string | undefined, allowed: readonly T[], fallback: T): T {
  return allowed.includes(value as T) ? (value as T) : fallback;
}

export function parseFilters(params: RawSearchParams = {}): Filters {
  const region = first(params['region']);
  const site = first(params['site']);
  const fy = first(params['fy']);

  return {
    risk: oneOf(first(params['risk']), ['all', 'at-risk', 'not-at-risk'] as const, 'all'),
    scope: oneOf(first(params['scope']), ['ongoing', 'completed', 'all'] as const, 'ongoing'),
    ...(region && region !== 'all' ? { region } : {}),
    ...(site && site !== 'all' ? { site } : {}),
    ...(fy && fy !== 'all' ? { fy } : {}),
  };
}

/** Serialises to a query string, omitting defaults so shared URLs stay short. */
export function serialiseFilters(filters: Filters): string {
  const params = new URLSearchParams();
  if (filters.risk !== DEFAULT_FILTERS.risk) params.set('risk', filters.risk);
  if (filters.scope !== DEFAULT_FILTERS.scope) params.set('scope', filters.scope);
  if (filters.region) params.set('region', filters.region);
  if (filters.site) params.set('site', filters.site);
  if (filters.fy) params.set('fy', filters.fy);
  const query = params.toString();
  return query ? `?${query}` : '';
}

export function isDefaultFilters(filters: Filters): boolean {
  return serialiseFilters(filters) === '';
}

export function withFilter<K extends keyof Filters>(
  filters: Filters,
  key: K,
  value: Filters[K] | undefined,
): Filters {
  const next: Filters = { ...filters };
  if (value === undefined || value === 'all') delete next[key];
  else next[key] = value;
  // risk and scope are non-optional; restore their defaults if cleared.
  if (next.risk === undefined) next.risk = DEFAULT_FILTERS.risk;
  if (next.scope === undefined) next.scope = DEFAULT_FILTERS.scope;
  return next;
}

function matchesScope(item: RoadmapItem, scope: ScopeFilter): boolean {
  const terminal = item.risk.level === 'complete' || item.risk.level === 'cancelled';
  if (scope === 'ongoing') return !terminal;
  if (scope === 'completed') return item.risk.level === 'complete';
  return true;
}

export function applyFilters(items: readonly RoadmapItem[], filters: Filters): RoadmapItem[] {
  return items.filter((item) => {
    if (!matchesScope(item, filters.scope)) return false;
    if (filters.risk === 'at-risk' && !item.risk.atRisk) return false;
    if (filters.risk === 'not-at-risk' && item.risk.atRisk) return false;
    if (filters.region && item.region !== filters.region) return false;
    if (filters.site && item.siteKey !== filters.site) return false;
    if (filters.fy && !item.fiscalYears.includes(filters.fy)) return false;
    return true;
  });
}

/** Fiscal years present in the data, earliest first, for the FY selector. */
export function fiscalYearOptions(items: readonly RoadmapItem[]): string[] {
  const seen = new Set<string>();
  for (const item of items) for (const fy of item.fiscalYears) seen.add(fy);
  return [...seen].sort();
}
