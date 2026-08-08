/**
 * Repository contracts -- the application's only statement of where data comes from.
 *
 * WHY THIS LAYER EXISTS. Every page used to call `loadSnapshot()` and read the
 * filesystem through it. That is fine while the only source is a JSON file written
 * by `scripts/sync.ts`; it stops being fine the moment Feed #3 becomes the source,
 * because the read then carries credentials, paging and network failure modes. These
 * interfaces are the seam that confines that change to one wiring module instead of
 * spreading it across eight pages, seven view models and the components below them.
 *
 * ASYNC ON PURPOSE. Every method returns a Promise even though the snapshot-backed
 * implementation resolves immediately. A synchronous contract would have to be broken
 * to admit a network source, which is precisely the change this layer exists to
 * absorb. Server Components await these during render, so build-time generation and
 * static export are unaffected.
 *
 * READ-ONLY ON PURPOSE. There is no write surface anywhere below. This application
 * reports on the portfolio; Jira remains the system of record for it.
 *
 * NO ZOD HERE. Validation belongs to the implementation, at the point data enters the
 * process -- `snapshotSchema` on read, exactly as `sync.ts` applies it on write. A
 * contract that re-validated would imply the boundary is somewhere it is not.
 */

import type {
  Coverage,
  Initiative,
  Region,
  RoadmapItem,
  SiteSummary,
  Snapshot,
} from '@/types/domain.js';

// ---------------------------------------------------------------------------
// Source metadata
// ---------------------------------------------------------------------------

/**
 * Where the served data came from. Never hide this from the user: sample data
 * mistaken for real data is the one failure mode the fixture fallback can cause.
 */
export type DataSourceKind = 'live' | 'fixture';

/** A portfolio container, as the snapshot records it. */
export type Portfolio = Snapshot['portfolios'][number];

/**
 * What the application must be able to say about the data it is serving, without
 * knowing what produced it.
 */
export interface SourceFreshness {
  kind: DataSourceKind;
  /** Contract version of the served data. A mismatch is a hard failure upstream. */
  schemaVersion: Snapshot['schemaVersion'];
  /** When the source was read. */
  syncedAt: string;
  /** The date risk was evaluated against. */
  asOf: string;
  /**
   * Where the data physically came from -- a file path today, a feed URL later.
   * Absent for the committed fixture, which has no meaningful origin.
   */
  origin?: string;
}

// ---------------------------------------------------------------------------
// Collection contracts
// ---------------------------------------------------------------------------

/**
 * Initiatives and the portfolios that contain them.
 *
 * `list()` includes the synthetic `__unaligned__` lane. It is not a real Jira issue,
 * but 51% of level-1 work hangs off it, and a repository that filtered it out would
 * make the largest lane in the portfolio invisible to every consumer at once.
 */
export interface InitiativeRepository {
  list(): Promise<Initiative[]>;
  listPortfolios(): Promise<Portfolio[]>;
}

/** Roadmap items -- the level-1 issues in site projects. */
export interface RoadmapItemRepository {
  list(): Promise<RoadmapItem[]>;
}

/**
 * Sites.
 *
 * `list()` returns every configured site, including those carrying no items. An empty
 * site is the failure mode the hierarchy model exists to catch; omitting it here would
 * turn a finding into an absence.
 */
export interface SiteRepository {
  list(): Promise<SiteSummary[]>;
}

/**
 * Regions.
 *
 * REGION IS NOT A CLOSED SET AT THIS LAYER, on the same reasoning as the region view
 * model: validity is decided by the data, not by `config/regions.ts`. `Unassigned`
 * must be listable, because its presence means config is incomplete and that is
 * exactly what the coverage gate reports on.
 */
export interface RegionRepository {
  /** Every region carrying a site or an item, sorted for determinism. */
  list(): Promise<Region[]>;
  listSites(region: Region): Promise<SiteSummary[]>;
}

/**
 * Coverage metrics and the warnings raised while producing them.
 *
 * Coverage describes the whole dataset and is never filtered. A filtered coverage
 * figure is a different and much weaker claim, and it would break the agreement with
 * `verify-snapshot` that the two report the same numbers.
 */
export interface CoverageRepository {
  get(): Promise<Coverage>;
  listWarnings(): Promise<string[]>;
}

/** Provenance and freshness of the served data. */
export interface SourceMetadataRepository {
  get(): Promise<SourceFreshness>;
}

// ---------------------------------------------------------------------------
// The set
// ---------------------------------------------------------------------------

/**
 * The complete read surface of the application. An implementation supplies all six or
 * none -- a half-swapped source would serve items from one place and coverage from
 * another, and the resulting page would be internally inconsistent with no way to tell.
 */
export interface RoadmapRepositories {
  initiatives: InitiativeRepository;
  items: RoadmapItemRepository;
  sites: SiteRepository;
  regions: RegionRepository;
  coverage: CoverageRepository;
  source: SourceMetadataRepository;
}
