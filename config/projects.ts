/**
 * The DDT project registry -- the single source of truth for what is in scope.
 *
 * Every project here was validated individually against Jira during discovery.
 * Projects are NEVER included or excluded on an inferred naming convention:
 * `NEUCHDDT` and `DDTJG` do not match `DDT [Site]` but are in scope, while
 * `MBODDT`, `PLASMADDT`, `DDTGCPT` and others do contain "DDT" but are not.
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

  // --- active in Jira but absent from the current Power BI report ---
  { key: 'DDTLA',    name: 'Los Angeles',    code: 'LA',  codeObserved: false, inCurrentPowerBiScope: false, expectedActiveItems: 86 },
  { key: 'DDTLESS',  name: 'Lessines',       code: 'LES', codeObserved: false, inCurrentPowerBiScope: true,  expectedActiveItems: 75 },
  { key: 'DDTCOV',   name: 'Covington',      code: 'COV', codeObserved: false, inCurrentPowerBiScope: false, expectedActiveItems: 37 },
  { key: 'DDTJG',    name: 'Jaguariuna',     code: 'JAG', codeObserved: false, inCurrentPowerBiScope: false, expectedActiveItems: 18 },
] as const;

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

/** Discovery totals, used by verify-snapshot as the acceptance baseline. */
export const DISCOVERY_BASELINE = {
  asOf: '2026-08-05',
  projectCount: ALL_PROJECT_KEYS.length, // 23
  initiatives: 36,
  activeItems: 645,
  itemsWithBothDates: 472,
  itemsWithAnyRag: 84,
  itemsWithSpotNarrative: 8,
  itemsWithSpotIdField: 8,
  overdueActive: 67,
  staleActive90d: 17,
  byRegion: { Americas: 278, Europe: 264, 'Asia-Pacific': 103 },
} as const;
