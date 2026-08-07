/**
 * The DDT project registry -- the single source of truth for what is in scope.
 *
 * Every project here was validated individually against Jira during discovery.
 * Projects are NEVER included or excluded on an inferred naming convention:
 * `NEUCHDDT` does not match `DDT [Site]` but is in scope, while `MBODDT`,
 * `PLASMADDT`, `DDTGCPT` and others do contain "DDT" but are not.
 *
 * `expectedActiveItems` records the count observed during discovery on
 * 2026-08-05. verify-snapshot compares against it and fails on a zero count,
 * which is the canary against a Jira config change silently emptying a site
 * (see config/hierarchy.ts for how that failure mode arises).
 */

import { resolveRegion, type RegionOrUnassigned } from './regions.js';

export interface PortfolioConfig {
  /** Jira project key. */
  key: string;
  /** Display name. */
  name: string;
  /** Issue type name at hierarchy level 2 in this project. Informational only --
   *  matching is done on hierarchy level, never on this string. */
  initiativeTypeName: string;
  expectedInitiatives: number;
}

export interface SiteConfig {
  key: string;
  /** Display name. MUST match a key in the region map to resolve a region. */
  name: string;
  /** 3-letter code used by the Power BI report for compact labels. */
  code: string;
  /**
   * True when the code was observed in the reference screenshots; false when
   * proposed by the plan and awaiting confirmation from an authoritative list.
   */
  codeObserved: boolean;
  /**
   * False for sites absent from the current Power BI report. Reconciliation
   * metadata only -- NOT a scope filter (MVP v1 includes all validated projects).
   */
  inCurrentPowerBiScope: boolean;
  expectedActiveItems: number;
}

/**
 * Portfolio projects. Modelled as an array so a future portfolio is one entry,
 * not a refactor. (`DDT Bio Portfolio` was investigated and no longer exists.)
 */
export const PORTFOLIOS: readonly PortfolioConfig[] = [
  {
    key: 'DDTGMPORT',
    name: 'DDT Global Manufacturing Portfolio',
    initiativeTypeName: 'Initiative',
    expectedInitiatives: 36,
  },
] as const;

/** Site projects, ordered by discovered active item count (descending). */
export const SITES: readonly SiteConfig[] = [
  // --- codes observed in the reference screenshots ---
  { key: 'DDTGC',    name: 'Grange Castle',  code: 'GRA', codeObserved: true,  inCurrentPowerBiScope: true,  expectedActiveItems: 73 },
  { key: 'DDTMBO',   name: 'Lexington',      code: 'LEX', codeObserved: true,  inCurrentPowerBiScope: true,  expectedActiveItems: 44 },
  { key: 'DDTTO',    name: 'Thousand Oaks',  code: 'THO', codeObserved: true,  inCurrentPowerBiScope: true,  expectedActiveItems: 37 },
  { key: 'DDTBP',    name: 'Brooklyn Park',  code: 'BRP', codeObserved: true,  inCurrentPowerBiScope: true,  expectedActiveItems: 36 },
  { key: 'DDTLNZ',   name: 'Linz',           code: 'LIN', codeObserved: true,  inCurrentPowerBiScope: true,  expectedActiveItems: 29 },
  { key: 'DDTOSA',   name: 'Osaka',          code: 'OSA', codeObserved: true,  inCurrentPowerBiScope: true,  expectedActiveItems: 25 },
  { key: 'DDTHIK',   name: 'Hikari',         code: 'HIK', codeObserved: true,  inCurrentPowerBiScope: true,  expectedActiveItems: 23 },
  // NOTE: SGP = Singapore, SNG = Singen. Easily transposed; the data model keys
  // on the Jira project key and never on the 3-letter code.
  { key: 'DDTSG',    name: 'Singapore',      code: 'SGP', codeObserved: true,  inCurrentPowerBiScope: true,  expectedActiveItems: 22 },
  { key: 'NEUCHDDT', name: 'Neuchatel',      code: 'NEU', codeObserved: true,  inCurrentPowerBiScope: true,  expectedActiveItems: 19 },
  { key: 'DDTBRY',   name: 'Bray',           code: 'BRY', codeObserved: true,  inCurrentPowerBiScope: true,  expectedActiveItems: 16 },
  { key: 'DDTSNG',   name: 'Singen',         code: 'SNG', codeObserved: true,  inCurrentPowerBiScope: true,  expectedActiveItems: 15 },
  { key: 'DDTTJ',    name: 'Tianjin',        code: 'TJN', codeObserved: true,  inCurrentPowerBiScope: true,  expectedActiveItems: 15 },

  // --- codes proposed by the plan, awaiting confirmation ---
  { key: 'DDTORA',   name: 'Oranienburg',    code: 'ORA', codeObserved: false, inCurrentPowerBiScope: true,  expectedActiveItems: 24 },
  { key: 'DDTVAS',   name: 'Vashi',          code: 'VAS', codeObserved: false, inCurrentPowerBiScope: true,  expectedActiveItems: 13 },
  { key: 'DDTYAR',   name: 'Yaroslavl',      code: 'YAR', codeObserved: false, inCurrentPowerBiScope: true,  expectedActiveItems: 12 },
  { key: 'DDTBA',    name: 'Buenos Aires',   code: 'BUE', codeObserved: false, inCurrentPowerBiScope: true,  expectedActiveItems: 11 },
  { key: 'DDTNAU',   name: 'Naucalpan',      code: 'NAU', codeObserved: false, inCurrentPowerBiScope: true,  expectedActiveItems: 9  },
  { key: 'DDTBEK',   name: 'Bekasi',         code: 'BEK', codeObserved: false, inCurrentPowerBiScope: true,  expectedActiveItems: 6  },
] as const;

/**
 * Validated against Jira during discovery, then removed from MVP scope.
 * Retained so the exclusion is auditable and a future reviewer does not
 * re-derive it. Restoring one is a single entry in SITES plus a region mapping.
 *
 * All four are treated identically. Item counts are the discovery figures, kept
 * so the rebaselined totals in DISCOVERY_BASELINE can be re-derived.
 */
export const DEFERRED_SITES: Readonly<Record<string, string>> = {
  DDTLA: 'Los Angeles -- deferred from MVP (86 active items at discovery)',
  DDTLESS: 'Lessines -- deferred from MVP (75 active items at discovery)',
  DDTCOV: 'Covington -- deferred from MVP (37 active items at discovery)',
  DDTJG: 'Jaguariuna -- deferred from MVP (18 active items at discovery)',
} as const;

/**
 * DDTJG IS DEFERRED AND MUST NOT DRIVE ARCHITECTURAL DECISIONS.
 *
 * It keeps resurfacing because it is unusually visible in the source data, and
 * each appearance has previously been mistaken for a signal:
 *
 *   - It is present in all three Alpha Serve OData feeds (214 rows), even though
 *     it is out of MVP scope. That is evidence those feeds are configured for
 *     someone else's requirements — it is NOT a reason to widen scope, and NOT a
 *     reason to prefer or reject a feed.
 *   - It is the ONLY project using a project-local level-1 type
 *     (`Digital Project`, 18 items). The hierarchy-level selection rule exists
 *     because of it, and that rule is retained on its own merits regardless of
 *     DDTJG's status — see config/hierarchy.ts.
 *   - Its statuses carry suffixes (`To Do - Epic`), which is why
 *     STATUS_SUFFIXES_TO_STRIP exists. Also retained on its own merits.
 *
 * Treat its presence in a feed as noise the adapter filters out, and never as
 * input to a coverage, scope or source-selection decision.
 */
export const NON_DRIVING_DEFERRED_KEYS: readonly string[] = ['DDTJG'] as const;

/**
 * Projects investigated during discovery and deliberately excluded, with the
 * reason. Kept in code so the decision is auditable and a future reviewer does
 * not have to re-derive it.
 */
export const EXCLUDED_PROJECTS: Readonly<Record<string, string>> = {
  CEECI: 'GDDT CEE Content Innovation -- not a DDT manufacturing site',
  DDTES2PT: 'Apptio TargetProcess Portfolio Team -- tooling, not a site roadmap',
  DDTGCPT: 'DDT TILGC Paperless Transformation -- a programme, not a site',
  DDTQSLE: 'Quality MD & Technology Lessines -- quality org, not DDT site roadmap',
  DDTRIPA: 'DD&T Pisa-Rieti -- out of the manufacturing portfolio',
  DDTTA: 'DD&T TA Tech & Tools -- capability team, not a site',
  GPDDDT: 'GPD DDT Demand Triage -- intake queue, not a roadmap',
  IAUSDDT: 'US DD&T Insights and Analytics -- analytics team, not a site',
  MBODDT: 'MaBioOps DD&T -- 0 Initiative-type issues; not a portfolio or site roadmap',
  OCEANIADDT: 'Oceania DD&T Project and Demand Board -- demand board, not a roadmap',
  PDTDDTEU: 'PDT DDT EU Portfolio -- different (PDT) portfolio',
  PLASMADDT: 'Plasma DDT -- 0 Initiative-type issues; separate business unit',
  RDDTPMTEAM: 'RDDT Product Accelerator Team -- R&D DDT, not manufacturing',
  RDDTSOWORK: 'RDDT SO Work -- R&D DDT, not manufacturing',
  TSHOACR: 'RD DDT TSHO Acronis -- R&D DDT, not manufacturing',
} as const;

// ---------------------------------------------------------------------------
// Derived lookups
// ---------------------------------------------------------------------------

export const PORTFOLIO_KEYS: readonly string[] = PORTFOLIOS.map((p) => p.key);
export const SITE_KEYS: readonly string[] = SITES.map((s) => s.key);

/** Every project the sync should query. */
export const ALL_PROJECT_KEYS: readonly string[] = [...PORTFOLIO_KEYS, ...SITE_KEYS];

const SITE_BY_KEY = new Map(SITES.map((s) => [s.key, s]));

export function getSite(key: string): SiteConfig | undefined {
  return SITE_BY_KEY.get(key);
}

export function isPortfolioKey(key: string): boolean {
  return PORTFOLIO_KEYS.includes(key);
}

export interface ResolvedSite extends SiteConfig {
  region: RegionOrUnassigned;
  regionProvisional: boolean;
}

/** Site config joined to its region. */
export function resolveSite(key: string): ResolvedSite | undefined {
  const site = SITE_BY_KEY.get(key);
  if (!site) return undefined;
  const { region, provisional } = resolveRegion(site.name);
  return { ...site, region, regionProvisional: provisional };
}

export const RESOLVED_SITES: readonly ResolvedSite[] = SITES.map((s) => {
  const { region, provisional } = resolveRegion(s.name);
  return { ...s, region, regionProvisional: provisional };
});

/**
 * Discovery totals, used by verify-snapshot as the acceptance baseline.
 *
 * REBASELINED for the 19-project MVP scope (see DEFERRED_SITES). Dropping
 * DDTLA (86), DDTLESS (75), DDTCOV (37) and DDTJG (18) removes 216 expected
 * active items -- 33% of the original 645, far beyond verify-snapshot's 10%
 * drift tolerance, so the original baseline could not be left in place.
 *
 * Values below are in two classes:
 *
 *   DERIVED   -- recomputed by subtraction from the discovery figures, because
 *                the removed quantity is known per site. These double as an
 *                independent cross-check: if the first 19-project sync does not
 *                land near them, something changed beyond the scope reduction.
 *
 *   INHERITED -- cross-cutting counts whose distribution across the dropped
 *                sites was never measured, so they CANNOT be derived by
 *                subtraction. They are carried over unchanged and WILL drift
 *                (verify-snapshot records drift as WARN, not FAIL, so the gate
 *                still passes). Re-measure them from the first authenticated
 *                19-project sync and promote them to DERIVED. Guessing a
 *                proportional split here would silently weaken the gate.
 */
export const DISCOVERY_BASELINE = {
  asOf: '2026-08-05',
  rebaselinedFor: '19-project MVP scope',
  projectCount: ALL_PROJECT_KEYS.length, // DERIVED: 19 (1 portfolio + 18 sites)
  initiatives: 36,                       // DERIVED: unchanged -- level-2 issues live in DDTGMPORT
  activeItems: 429,                      // DERIVED: 645 - 216
  itemsWithBothDates: 472,               // INHERITED -- re-measure
  // The next three will now UNDER-REPORT BY DESIGN and drift hard upward.
  // They were measured when config/fields.ts knew only Singapore's SPOT fields.
  // SITE_SPOT_FIELDS now carries all 18 sites, so a census over the OData feed
  // measured 424 items with a RAG, 299 with a narrative and 312 with a SPOT ID
  // field, against 510 in-scope level-1 items. Those figures are NOT copied here:
  // the census counts all-time level-1 items, which is not the same basis as the
  // snapshot's, and inventing a baseline would silently weaken the gate. Drift is
  // a WARN, so the gate still passes -- re-measure from the first sync taken
  // after the fields.ts change and promote these to DERIVED then.
  itemsWithAnyRag: 84,                   // INHERITED -- re-measure, expect ~5x
  itemsWithSpotNarrative: 8,             // INHERITED -- re-measure, expect ~35x
  itemsWithSpotIdField: 8,               // INHERITED -- re-measure, expect ~39x
  overdueActive: 67,                     // INHERITED -- re-measure
  staleActive90d: 17,                    // INHERITED -- re-measure
  // DERIVED: Americas 278 - (LA 86 + Covington 37 + Jaguariuna 18) = 137
  //          Europe   264 - (Lessines 75)                          = 189
  //          Asia-Pacific unchanged -- no dropped site was in it.
  byRegion: { Americas: 137, Europe: 189, 'Asia-Pacific': 103 },
} as const;

/** Baseline keys still carrying pre-rebaseline values; surfaced by verify-snapshot. */
export const INHERITED_BASELINE_KEYS: readonly string[] = [
  'itemsWithBothDates',
  'itemsWithAnyRag',
  'itemsWithSpotNarrative',
  'itemsWithSpotIdField',
  'overdueActive',
  'staleActive90d',
] as const;
