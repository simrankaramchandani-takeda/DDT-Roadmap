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
 * PER-SITE SPOT FIELDS -- the most important table in this file.
 *
 * Every site has its OWN custom field for the same three business attributes,
 * because each site's SPOT integration was provisioned separately. They are not
 * three attributes times eighteen; they are three attributes whose SOURCE FIELD
 * VARIES BY SITE. The roadmap model exposes exactly one normalised
 * `OverallStatus` and one `OverallStatusDescription`, resolved by coalescing the
 * candidate lists below (src/lib/normalise.ts, src/lib/transform.ts).
 *
 * Measured from the OData feed on 2026-08-07 over the 510 in-scope
 * hierarchy-level-1 items:
 *
 *   - Exactly ONE of these fields is populated per item. Zero items carry two
 *     populated `Overall Status`, `Overall Status Description` or `SPOT ID`
 *     fields, so coalescing is unambiguous and the candidate ORDER below does not
 *     change any resolved value. This invariant is not observable from a snapshot
 *     (only the resolved field is recorded), so it is re-checked by the feed
 *     probe, not by verify-snapshot. What verify-snapshot does check is that each
 *     site's RAG resolves through the field mapped below and no other.
 *   - Authored RAG resolves on 424 of 510 items (83%), every site non-zero.
 *   - A SPOT narrative resolves on 299 of 510 (59%), every site except DDTYAR.
 *
 * Before this table existed, config knew only Singapore's `24266`/`24265`/`19886`
 * and so measured 84 items with a RAG and 8 with a narrative. That was a gap in
 * THIS FILE, not a data-quality finding about the sites -- and it applied equally
 * to the Jira REST pipeline, because `SYNC_FIELDS` never requested the other IDs.
 *
 * THESE IDS ARE TRANSCRIBED FROM EVIDENCE, NOT DERIVED FROM A PATTERN. The
 * tempting pattern `rag = description + 1` holds for only 13 of the 18 sites --
 * `DDTOSA`, `DDTHIK`, `DDTBEK`, `DDTLNZ` and `DDTSNG` all break it, and `DDTLNZ`
 * and `DDTSNG` sit in an entirely different ID range. A formula would therefore
 * mis-map five sites while looking plausible. Do not "tidy" this into one, and do
 * not add a site here without probing it individually.
 */
export interface SiteSpotFields {
  /** Jira project key, matching config/projects.ts. */
  siteKey: string;
  /** Display name, used to build the audit label on a resolved RAG. */
  siteName: string;
  /** Custom field ID (numeric part) holding SPOT `Overall Status` -- the RAG. */
  rag: string;
  /** SPOT `Overall Status Description` -- the executive narrative. */
  description?: string;
  /** Site's SPOT ID field. */
  spotId?: string;
  /** Items with `rag` populated, measured 2026-08-07. Drift is informational. */
  observedRagItems: number;
}

export const SITE_SPOT_FIELDS: readonly SiteSpotFields[] = [
  { siteKey: 'DDTGC',    siteName: 'Grange Castle', rag: '24262', description: '24261', spotId: '18795', observedRagItems: 72 },
  { siteKey: 'DDTMBO',   siteName: 'Lexington',     rag: '24270', description: '24269', spotId: '18803', observedRagItems: 47 },
  { siteKey: 'DDTTO',    siteName: 'Thousand Oaks', rag: '24272', description: '24271', spotId: '18804', observedRagItems: 36 },
  { siteKey: 'DDTBP',    siteName: 'Brooklyn Park', rag: '24268', description: '24267', spotId: '18883', observedRagItems: 40 },
  // Linz breaks the adjacent-ID pattern: its description and SPOT ID sit in the
  // 186xx range while its RAG is 24246. Verified individually.
  { siteKey: 'DDTLNZ',   siteName: 'Linz',          rag: '24246', description: '18608', spotId: '18606', observedRagItems: 10 },
  { siteKey: 'DDTOSA',   siteName: 'Osaka',         rag: '23829', description: '24251', spotId: '23828', observedRagItems: 28 },
  { siteKey: 'DDTHIK',   siteName: 'Hikari',        rag: '23822', description: '24250', spotId: '23825', observedRagItems: 21 },
  { siteKey: 'DDTSG',    siteName: 'Singapore',     rag: '24266', description: '24265', spotId: '19886', observedRagItems: 20 },
  { siteKey: 'NEUCHDDT', siteName: 'Neuchatel',     rag: '24543', description: '24542', spotId: '24541', observedRagItems: 17 },
  { siteKey: 'DDTBRY',   siteName: 'Bray',          rag: '24264', description: '24263', spotId: '18798', observedRagItems: 18 },
  // Singen also breaks the pattern across all three fields.
  { siteKey: 'DDTSNG',   siteName: 'Singen',        rag: '23341', description: '24104', spotId: '18813', observedRagItems: 16 },
  { siteKey: 'DDTTJ',    siteName: 'Tianjin',       rag: '24256', description: '24255', spotId: '18786', observedRagItems: 23 },
  { siteKey: 'DDTORA',   siteName: 'Oranienburg',   rag: '24258', description: '24257', spotId: '18789', observedRagItems: 22 },
  { siteKey: 'DDTVAS',   siteName: 'Vashi',         rag: '24254', description: '24253', spotId: '18781', observedRagItems: 14 },
  // Yaroslavl has a RAG field only -- no SPOT description or SPOT ID field is
  // populated on any item. Confirmed independently in two feeds.
  { siteKey: 'DDTYAR',   siteName: 'Yaroslavl',     rag: '25432',                                       observedRagItems: 16 },
  { siteKey: 'DDTBA',    siteName: 'Buenos Aires',  rag: '26614', description: '26613', spotId: '26617', observedRagItems: 7  },
  { siteKey: 'DDTNAU',   siteName: 'Naucalpan',     rag: '24260', description: '24259', spotId: '18792', observedRagItems: 11 },
  { siteKey: 'DDTBEK',   siteName: 'Bekasi',        rag: '23816', description: '24249', spotId: '23819', observedRagItems: 6  },
] as const;

/**
 * RAG / health, in resolution priority order.
 *
 * The per-site SPOT `Overall Status` fields come first: they are the primary
 * source per the approved decision, and they are mutually exclusive so their
 * relative order is immaterial. The trailing entries are non-site-specific
 * authored sources kept for the deferred projects (Lessines authors `15784`) and
 * so a site adopting one is still read rather than silently ignored.
 *
 * Resolution is still "first populated candidate wins" -- see
 * `normaliseAuthoredRag` in src/lib/normalise.ts. src/lib/risk.ts derives a
 * signal for the ~17% of items with no authored value.
 */
export const RAG_FIELD_CANDIDATES: readonly { id: string; label: string; isSpot: boolean }[] = [
  ...SITE_SPOT_FIELDS.map((s) => ({
    id: `customfield_${s.rag}`,
    label: `Overall Status (SPOT, ${s.siteName})`,
    isSpot: true,
  })),
  { id: 'customfield_18427', label: 'Spot status', isSpot: true },
  { id: 'customfield_15784', label: 'Health', isSpot: false }, // Lessines (deferred)
  { id: 'customfield_15785', label: 'Health', isSpot: false }, // sparse
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
 * The executive narrative -- the single most valuable content in the dataset,
 * because it is the only place a site explains WHY a project is amber or red.
 *
 * An ADF table whose rows are:
 *   Project Phase | Project State | Project URL |
 *   Overall Status Description | Recent Accomplishments | Next Priorities
 * Synced from SPOT (tospot.azurewebsites.net). Parsed by src/lib/adf.ts.
 *
 * The source field varies by site (see SITE_SPOT_FIELDS). Coalescing across the
 * candidates resolves a narrative on 299 of 510 in-scope level-1 items (59%),
 * against the 8 items (~1%) reachable when only Singapore's `24265` was known.
 *
 * Order is immaterial -- at most one candidate is ever populated per item.
 */
export const SPOT_DESCRIPTION_FIELD_CANDIDATES: readonly string[] = SITE_SPOT_FIELDS.flatMap((s) =>
  s.description ? [`customfield_${s.description}`] : [],
);

/**
 * SPOT identifiers, one field per site plus the portfolio's own.
 * Resolves on 312 of 510 in-scope level-1 items (61%), against 8 when only
 * Singapore's `19886` was known. The summary parser (src/lib/summary-parse.ts)
 * still runs as a fallback and recovers IDs from titles where no field is set.
 */
export const SPOT_ID_FIELD_CANDIDATES: readonly string[] = [
  ...SITE_SPOT_FIELDS.flatMap((s) => (s.spotId ? [`customfield_${s.spotId}`] : [])),
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
  ...SPOT_DESCRIPTION_FIELD_CANDIDATES,
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
