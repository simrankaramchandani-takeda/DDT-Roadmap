/**
 * The executive vocabulary. ALL leadership-facing wording lives here -- never in
 * components and never inline in logic -- so the language can be reviewed and
 * revised in one place by people who care about how it reads.
 *
 * Rule that governs every string below: describe what the data says, never
 * assert a cause the data does not support. `Resource Constraint` and
 * `Scope Risk` are defined because they are part of the requested vocabulary,
 * but nothing infers them today -- no field in the Jira schema evidences either.
 * They are reachable only from an authored status.
 */

export const RISK_LEVELS = [
  'on-track',
  'monitor',
  'attention',
  'blocked',
  'complete',
  'cancelled',
  'unreported',
] as const;

export type RiskLevel = (typeof RISK_LEVELS)[number];

/** Leadership-facing label per risk level. */
export const RISK_LEVEL_LABELS: Readonly<Record<RiskLevel, string>> = {
  'on-track': 'On Track',
  monitor: 'Monitor Closely',
  attention: 'Leadership Attention Required',
  blocked: 'Blocked Pending Dependency',
  complete: 'Complete',
  cancelled: 'Cancelled',
  unreported: 'No Status Reported',
} as const;

/**
 * Maps to the five-token palette already established by the Power BI report, so
 * the visual vocabulary carries over. `Unassigned` (grey) is a first-class state
 * there and stays one here.
 */
export const RISK_LEVEL_PALETTE_TOKEN: Readonly<Record<RiskLevel, string>> = {
  'on-track': 'green',
  monitor: 'amber',
  attention: 'red',
  blocked: 'red',
  complete: 'blue',
  cancelled: 'grey',
  unreported: 'grey',
} as const;

export const REASON_CODES = [
  'delayed-milestone',
  'schedule-risk',
  'go-live-risk',
  'dependency-risk',
  'resource-constraint',
  'scope-risk',
  'reporting-gap',
  'no-immediate-action',
] as const;

export type ReasonCode = (typeof REASON_CODES)[number];

export const REASON_LABELS: Readonly<Record<ReasonCode, string>> = {
  'delayed-milestone': 'Delayed Milestone',
  'schedule-risk': 'Schedule Risk',
  'go-live-risk': 'Go-Live Risk',
  'dependency-risk': 'Dependency Risk',
  'resource-constraint': 'Resource Constraint',
  'scope-risk': 'Scope Risk',
  'reporting-gap': 'Reporting Gap',
  'no-immediate-action': 'No Immediate Action Required',
} as const;

/** Provenance of a status, shown so leadership knows how much to trust it. */
export const PROVENANCE_LABELS = {
  spot: 'Reported by site (SPOT)',
  reported: 'Reported in Jira',
  inferred: 'Inferred from schedule',
  none: 'Not reported',
} as const;

export type RiskProvenance = keyof typeof PROVENANCE_LABELS;

/** Where the executive summary text came from. Always surfaced in the UI. */
export const SUMMARY_SOURCE_LABELS = {
  spot: 'Site-authored status (SPOT)',
  'jira-description': 'Source: Jira description — not an authored status',
  generated: 'System-generated from Jira data',
} as const;

export type SummarySource = keyof typeof SUMMARY_SOURCE_LABELS;

/** Shown wherever a field is absent, instead of an empty label. */
export const NOT_REPORTED_PLACEHOLDER = 'Not reported in Jira';

/**
 * Thresholds for derived risk, in days. Surfaced as config because an open
 * question asks whether these match how DDT leadership already talks about risk.
 */
export const RISK_THRESHOLDS = {
  /** Overdue by more than this -> Leadership Attention Required. */
  overdueAttentionDays: 90,
  /** Overdue by at least one day and up to the above -> Monitor Closely. */
  overdueMonitorDays: 1,
  /** Go-live within this window while still not started -> Go-Live Risk. */
  goLiveHorizonDays: 60,
  /** No update in this long (and not complete) -> Reporting Gap. */
  staleDays: 90,
} as const;

/**
 * Normalisation of authored RAG values to risk levels. Keys are lowercased.
 * Values observed: Green, Amber, Red, Completed, Unassigned (Power BI legend);
 * the DDTGMPORT text field holds "Green" / "Amber" / "Red".
 */
export const RAG_VALUE_TO_RISK_LEVEL: Readonly<Record<string, RiskLevel>> = {
  green: 'on-track',
  'on track': 'on-track',
  amber: 'monitor',
  yellow: 'monitor',
  'at risk': 'monitor',
  red: 'attention',
  blocked: 'blocked',
  blue: 'complete',
  complete: 'complete',
  completed: 'complete',
  done: 'complete',
  grey: 'unreported',
  gray: 'unreported',
  unassigned: 'unreported',
  'not set': 'unreported',
  tbd: 'unreported',
} as const;

/** Risk levels that count as "At Risk" for the binary executive filter. */
export const AT_RISK_LEVELS: readonly RiskLevel[] = ['monitor', 'attention', 'blocked'] as const;
