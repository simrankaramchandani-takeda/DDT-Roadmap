/**
 * Authoritative region grouping for DDT sites.
 *
 * Supplied by the business and confirmed as reflecting DDT reporting lines --
 * NOT geography. Two assignments look geographically odd and are intentional:
 *   - Vashi (India)     -> Europe
 *   - Yaroslavl (Russia) -> Asia-Pacific
 * Do not "correct" these.
 *
 * Every site in the 19-project MVP scope resolves through the authoritative map
 * below. The provisional mechanism is retained but currently empty: the four
 * sites that needed it (Los Angeles, Covington, Jaguariuna, Lessines) are all
 * deferred from MVP scope (see DEFERRED_SITES in config/projects.ts). Restoring
 * any of them requires a region decision here first, otherwise it resolves to
 * `Unassigned`, which verify-snapshot treats as a FAIL.
 */

export const REGIONS = ['Americas', 'Asia-Pacific', 'Europe'] as const;
export type Region = (typeof REGIONS)[number];

/** Region assigned when a site has no mapping at all. Should never occur if config is complete. */
export const UNASSIGNED_REGION = 'Unassigned' as const;
export type RegionOrUnassigned = Region | typeof UNASSIGNED_REGION;

/**
 * The authoritative map, keyed by the site display name as supplied.
 * Resolution to Jira project keys happens in config/projects.ts.
 */
export const AUTHORITATIVE_REGION_MAP: Readonly<Record<Region, readonly string[]>> = {
  Americas: ['Brooklyn Park', 'Buenos Aires', 'Lexington', 'Naucalpan', 'Thousand Oaks'],
  'Asia-Pacific': ['Singapore', 'Osaka', 'Tianjin', 'Bekasi', 'Hikari', 'Yaroslavl'],
  Europe: ['Bray', 'Grange Castle', 'Linz', 'Oranienburg', 'Singen', 'Neuchatel', 'Vashi'],
} as const;

/**
 * Sites active in Jira but absent from the authoritative map.
 * Assigned by the plan; every resulting item carries `regionProvisional: true`.
 *
 * Empty under the 19-project MVP scope -- all four former entries are deferred
 * sites. Kept as a live mechanism so restoring a site is a one-line change here
 * rather than a rework of the region model.
 */
export const PROVISIONAL_REGION_MAP: Readonly<Record<string, Region>> = {} as const;

/** Site display names whose region is provisional rather than authoritative. */
export const PROVISIONAL_REGION_SITES: readonly string[] = Object.keys(PROVISIONAL_REGION_MAP);

/** Reverse index: site display name -> { region, provisional }. */
function buildIndex(): Map<string, { region: Region; provisional: boolean }> {
  const index = new Map<string, { region: Region; provisional: boolean }>();

  for (const region of REGIONS) {
    for (const site of AUTHORITATIVE_REGION_MAP[region]) {
      index.set(site, { region, provisional: false });
    }
  }
  for (const [site, region] of Object.entries(PROVISIONAL_REGION_MAP)) {
    // Authoritative wins if a site somehow appears in both.
    if (!index.has(site)) index.set(site, { region, provisional: true });
  }

  return index;
}

const REGION_INDEX = buildIndex();

export function resolveRegion(siteName: string): {
  region: RegionOrUnassigned;
  provisional: boolean;
} {
  const hit = REGION_INDEX.get(siteName);
  if (!hit) return { region: UNASSIGNED_REGION, provisional: true };
  return { region: hit.region, provisional: hit.provisional };
}
