/**
 * Jira custom field IDs, grouped by the purpose they serve.
 *
 * Custom field availability is PER-PROJECT: Singapore's screens carry
 * `customfield_24265/24266/19886` while Lessines carries `15784/23746` and a set
 * of French BSRM intake fields instead. Nothing here can be assumed present on a
 * given issue, so every purpose is a CANDIDATE LIST resolved by coalescing in
 * priority order (see src/lib/normalise.ts).
 *
 * Coverage figures are from discovery on 2026-08-05, measured over 756 all-time
 * site epics unless noted.
 */

/** Start of the timeline bar. 74% coverage. */
export const FIELD_START_DATE = 'customfield_10412'; // "Start date"

/**
 * End of the timeline bar AND the go-live date.
 * `duedate` is a system field. 83% coverage.
 * Confirmed by the Power BI report's own note: "Milestones are tied to local
 * go-live dates." There is no dedicated go-live field anywhere in the schema.
 */
export const FIELD_DUE_DATE = 'duedate';

/**
 * RAG / health, in resolution priority order.
 * SPOT `Overall Status` is primary per the approved decision; the others are
 * secondary authored sources. Combined coverage is only ~84 items (~11%), which
 * is why src/lib/risk.ts must derive a signal for the remainder.
 */
export const RAG_FIELD_CANDIDATES: readonly { id: string; label: string; isSpot: boolean }[] = [
  { id: 'customfield_24266', label: 'Overall Status (SPOT)', isSpot: true },  // 20 items
  { id: 'customfield_18427', label: 'Spot status', isSpot: true },            // few
  { id: 'customfield_15784', label: 'Health', isSpot: false },                // 63 items
  { id: 'customfield_15785', label: 'Health', isSpot: false },                // sparse
] as const;

/**
 * Portfolio-level RAG on DDTGMPORT Initiatives.
 *
 * ANOMALY: this field's name renders as "Asset ID" but it holds RAG values
 * ("Green", "Amber", "Red") on 25 of 36 Initiatives. Treated as valid RAG per
 * the approved decision. Flagged to Jira admins -- if the field is ever used for
 * its stated purpose this will silently start producing garbage, so
 * verify-snapshot reports the parsed value distribution.
 */
export const FIELD_PORTFOLIO_RAG = 'customfield_11199';

/**
 * The executive narrative. An ADF table whose rows are:
 *   Project Phase | Project State | Project URL |
 *   Overall Status Description | Recent Accomplishments | Next Priorities
 * Synced from SPOT (tospot.azurewebsites.net). Only ~8 items (~1%), but by far
 * the highest-value content when present. Parsed by src/lib/adf.ts.
 */
export const FIELD_SPOT_DESCRIPTION = 'customfield_24265';

/** SPOT identifiers. Field coverage is only 8 items; the summary parser recovers far more. */
export const SPOT_ID_FIELD_CANDIDATES: readonly string[] = [
  'customfield_19886', // "SPOT ID" (site projects)
  'customfield_10710', // "Portfolio Project ID" (DDTGMPORT)
] as const;

/** Declared fiscal year as a select field. 86 items. */
export const FIELD_FISCAL_YEAR = 'customfield_23746';

/** Owner/responsible fields, in display priority order. */
export const OWNER_FIELD_CANDIDATES: readonly { id: string; role: string }[] = [
  { id: 'customfield_16868', role: 'Digital Delivery Lead' },
  { id: 'customfield_19885', role: 'IT Lead' },
  { id: 'customfield_10487', role: 'IT Lead' },
  { id: 'customfield_19884', role: 'Business Owner' },
  { id: 'customfield_10489', role: 'Business Owner' },
  { id: 'customfield_10540', role: 'Validation Lead' },
  { id: 'customfield_15786', role: 'Sponsor' },
] as const;

/** Plain-text owner fallback ("Delivery Lead connector friendly"). */
export const FIELD_OWNER_TEXT = 'customfield_24406';

/**
 * Populated on ZERO items across all site projects -- retained only so
 * verify-snapshot can confirm it is still empty and flag it if that changes.
 */
export const FIELD_FLAGGED_UNUSABLE = 'customfield_10387';

/**
 * The explicit field whitelist sent to Jira. Requesting `*all` returns ~90
 * fields per issue, most null, and inflates the response by roughly an order of
 * magnitude for no benefit.
 */
export const SYNC_FIELDS: readonly string[] = [
  // system
  'summary',
  'description',
  'issuetype',
  'status',
  'project',
  'assignee',
  'labels',
  'updated',
  'created',
  'resolutiondate',
  'duedate',
  'issuelinks',
  'parent',
  // dates
  FIELD_START_DATE,
  'customfield_10493', // Target start (JPO baseline) -- fallback
  'customfield_10494', // Target end (JPO baseline)   -- fallback
  // status / narrative
  ...RAG_FIELD_CANDIDATES.map((c) => c.id),
  FIELD_PORTFOLIO_RAG,
  FIELD_SPOT_DESCRIPTION,
  // identifiers
  ...SPOT_ID_FIELD_CANDIDATES,
  FIELD_FISCAL_YEAR,
  // owners
  ...OWNER_FIELD_CANDIDATES.map((c) => c.id),
  FIELD_OWNER_TEXT,
  // canary
  FIELD_FLAGGED_UNUSABLE,
] as const;

/** JPO baseline date fields, used only if the primary date fields are absent. */
export const FIELD_TARGET_START = 'customfield_10493';
export const FIELD_TARGET_END = 'customfield_10494';
