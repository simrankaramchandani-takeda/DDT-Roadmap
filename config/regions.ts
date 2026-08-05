/**
 * Authoritative region grouping for DDT sites.
 *
 * Supplied by the business and confirmed as reflecting DDT reporting lines --
 * NOT geography. Two assignments look geographically odd and are intentional:
 *   - Vashi (India)     -> Europe
 *   - Yaroslavl (Russia) -> Asia-Pacific
 * Do not "correct" these.
 *
 * Four sites are not named in the supplied map and are assigned provisionally
 * by the implementation plan (see PROVISIONAL_REGION_SITES). They are flagged
 * on every item as `regionProvisional: true` so they can be re-assigned or
 * filtered in one place.
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
 */
export const PROVISIONAL_REGION_MAP: Readonly<Record<string, Region>> = {
  'Los Angeles': 'Americas',
  Covington: 'Americas',
  'Jaguariuna': 'Americas',
  Lessines: 'Europe',
} as const;

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
