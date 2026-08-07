/**
 * Project detail view model -- the highest-content-value screen, and the one with
 * no counterpart in the reference report.
 *
 * The reference Gantt can tell you a bar is red. It cannot tell you WHY. This page
 * exists to answer that, from three sources in descending authority:
 *   1. the site-authored SPOT narrative (59% of items now carry one);
 *   2. the resolved risk reasons, each carrying a concrete fact;
 *   3. the provenance of the status itself, so nobody mistakes an inferred signal
 *      for a reported one.
 *
 * `risk.score` is deliberately NOT exposed. It orders the attention list and
 * nothing else; a false-precision number invites arguments about the arithmetic
 * instead of about the project.
 */

import type { Initiative, RoadmapItem, SiteSummary, Snapshot } from '@/types/domain.js';
import { NOT_REPORTED_PLACEHOLDER, SUMMARY_SOURCE_LABELS } from '@config/narrative.js';
import { PHASE_LABELS } from '@config/status-map.js';
import { daysBetween } from '@/lib/fiscal-year.js';

export interface DetailRow {
  label: string;
  value: string;
  /** Rendered in a muted tone -- signals "not reported" rather than a real value. */
  absent?: boolean;
}

export interface ProjectModel {
  item: RoadmapItem;
  site?: SiteSummary;
  initiative?: Initiative;
  /** True when the project is site-led. Not a defect; an expected delivery model. */
  isLocal: boolean;
  summarySourceLabel: string;
  /** Non-empty only when a SPOT narrative exists. */
  narrativeRows: DetailRow[];
  scheduleRows: DetailRow[];
  detailRows: DetailRow[];
  overdueDays?: number;
  daysToGoLive?: number;
  hasNarrative: boolean;
}

function present(label: string, value: string | undefined): DetailRow {
  return value ? { label, value } : { label, value: NOT_REPORTED_PLACEHOLDER, absent: true };
}

function formatDate(iso: string | undefined): string | undefined {
  if (!iso) return undefined;
  const [y, m, d] = iso.split('-');
  if (!y || !m || !d) return iso;
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  return `${Number(d)} ${months[Number(m) - 1] ?? m} ${y}`;
}

export function buildProjectModel(
  snapshot: Snapshot,
  key: string,
): ProjectModel | undefined {
  const item = snapshot.items.find((i) => i.key === key);
  if (!item) return undefined;

  const site = snapshot.sites.find((s) => s.key === item.siteKey);
  const initiative = item.initiativeKey
    ? snapshot.initiatives.find((i) => i.key === item.initiativeKey)
    : undefined;

  const n = item.narrative;
  const narrativeRows: DetailRow[] = [];
  if (n.phase) narrativeRows.push({ label: 'Project phase', value: n.phase });
  if (n.state) narrativeRows.push({ label: 'Project state', value: n.state });
  if (n.statusDescription) narrativeRows.push({ label: 'Status', value: n.statusDescription });
  if (n.recentAccomplishments) narrativeRows.push({ label: 'Recent', value: n.recentAccomplishments });
  if (n.nextPriorities) narrativeRows.push({ label: 'Next', value: n.nextPriorities });

  const overdue =
    item.end && item.risk.level !== 'complete' && item.risk.level !== 'cancelled'
      ? daysBetween(item.end, snapshot.asOf)
      : 0;
  const toGoLive = item.goLive ? daysBetween(snapshot.asOf, item.goLive) : undefined;

  const scheduleRows: DetailRow[] = [
    present('Start', formatDate(item.start)),
    present('Go-live', formatDate(item.goLive)),
    present('Fiscal years', item.fiscalYears.length > 0 ? item.fiscalYears.join(' · ') : undefined),
    present('Declared FY', item.declaredFiscalYear),
  ];

  const detailRows: DetailRow[] = [
    {
      label: 'Programme',
      value: initiative
        ? initiative.summary
        : 'Site-led — not linked to a global programme',
      ...(initiative ? {} : { absent: false }),
    },
    { label: 'Site', value: `${item.siteName} (${item.siteCode}) · ${item.region}` },
    { label: 'Phase', value: `${PHASE_LABELS[item.status.phase]} (Jira: "${item.status.raw}")` },
    present(
      'Owners',
      item.owners.length > 0 ? item.owners.map((o) => `${o.name} (${o.role})`).join(' · ') : undefined,
    ),
    present('SPOT ID', item.spotId ? `${item.spotId}${item.spotIdSource === 'summary' ? ' (parsed from title)' : ''}` : undefined),
    {
      label: 'Child items',
      value:
        item.childCount.total > 0
          ? `${item.childCount.done} of ${item.childCount.total} complete`
          : NOT_REPORTED_PLACEHOLDER,
      absent: item.childCount.total === 0,
    },
    { label: 'Last updated', value: `${formatDate(item.updatedAt.slice(0, 10))} (${item.daysSinceUpdate} days ago)` },
  ];

  return {
    item,
    ...(site ? { site } : {}),
    ...(initiative ? { initiative } : {}),
    isLocal: item.alignment === 'local',
    summarySourceLabel: SUMMARY_SOURCE_LABELS[n.summarySource],
    narrativeRows,
    scheduleRows,
    detailRows,
    ...(overdue > 0 ? { overdueDays: overdue } : {}),
    ...(toGoLive !== undefined && toGoLive >= 0 ? { daysToGoLive: toGoLive } : {}),
    hasNarrative: narrativeRows.length > 0,
  };
}
