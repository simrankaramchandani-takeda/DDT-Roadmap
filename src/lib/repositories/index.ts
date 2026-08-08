/**
 * Composition root for data access. The only module the app layer imports from.
 *
 * TWO JOBS, KEPT SEPARATE FROM THE CONTRACTS ON PURPOSE:
 *
 *   1. WIRING -- decide which implementation is in play. Today that is always the
 *      snapshot-backed set. When Feed #3 lands, `configureRepositories()` is the one
 *      call that changes, and no page, view model or component moves.
 *
 *   2. PROJECTION -- assemble the `Snapshot` shape the WP2 view models consume, from
 *      repository reads alone. The view models take a `Snapshot` and that contract is
 *      preserved verbatim, so something has to compose one; doing it here means the
 *      pages no longer know that a snapshot file exists, which is the whole point.
 *
 * THE PROJECTION IS NOT A SECOND SOURCE OF TRUTH. It copies repository output field
 * for field and computes nothing. `tests/repositories.test.ts` pins that it is
 * byte-identical to the loaded snapshot and still satisfies `snapshotSchema`, so a
 * field added to the domain model cannot be silently dropped on the way through.
 */

import { createODataRepositories } from '@/lib/feed/odata-repositories.js';
import type { Snapshot } from '@/types/domain.js';

import { createDefaultRepositories } from './snapshot-repositories.js';
import type { DataSourceKind, RoadmapRepositories } from './types.js';

export type {
  CoverageRepository,
  DataSourceKind,
  InitiativeRepository,
  Portfolio,
  RegionRepository,
  RoadmapItemRepository,
  RoadmapRepositories,
  SiteRepository,
  SourceFreshness,
  SourceMetadataRepository,
} from './types.js';

export {
  createDefaultRepositories,
  createFixtureRepositories,
  createSnapshotRepositories,
} from './snapshot-repositories.js';

// ---------------------------------------------------------------------------
// Wiring
// ---------------------------------------------------------------------------

let configured: RoadmapRepositories | undefined;
let fallback: RoadmapRepositories | undefined;

/** Where the application reads its data from. */
export type RoadmapSource = 'snapshot' | 'odata';

/**
 * Resolves the source from the environment.
 *
 * SNAPSHOT IS THE DEFAULT, AND THAT IS A GOVERNANCE DECISION RATHER THAN A TECHNICAL
 * ONE. ADR-001's E4, E6 and E8 are open: there is no statement that the existing
 * entitlement covers consumption by an application rather than by Power BI, no named
 * data owner, and no precedent for a non-BI consumer. Migration step 4 -- build the
 * client and adapter behind a flag, REST/snapshot staying default -- may proceed without
 * that sign-off; flipping the default is step 6 and may not. So this reads an explicit
 * opt-in and never infers one.
 */
export function resolveSource(env: NodeJS.ProcessEnv = process.env): RoadmapSource {
  return env['ROADMAP_SOURCE']?.trim().toLowerCase() === 'odata' ? 'odata' : 'snapshot';
}

/**
 * The repository set in force. Defaults to the snapshot-backed implementation, built
 * once per process and lazily, so importing this module reads nothing.
 *
 * Both implementations are free to construct: the OData set performs no I/O until a
 * method is called, so selecting it here cannot make an import reach the network.
 */
export function getRepositories(): RoadmapRepositories {
  if (configured) return configured;
  fallback ??=
    resolveSource() === 'odata' ? createODataRepositories().repositories : createDefaultRepositories();
  return fallback;
}

/**
 * Installs an alternative implementation.
 *
 * This is the Feed #3 seam. It is also the test seam, and those being the same seam is
 * deliberate: a substitution that tests exercise is a substitution that will work in
 * production.
 */
export function configureRepositories(repositories: RoadmapRepositories): void {
  configured = repositories;
}

/** Drops any override and the cached default. Tests, and nothing else. */
export function resetRepositories(): void {
  configured = undefined;
  fallback = undefined;
}

// ---------------------------------------------------------------------------
// Projection
// ---------------------------------------------------------------------------

export interface RoadmapView {
  /** The dataset in the shape every view model already accepts. */
  snapshot: Snapshot;
  /** Surfaced by `SiteHeader` on every page. Never suppress it. */
  source: DataSourceKind;
}

/**
 * Reads everything the screens need, through repositories only.
 *
 * Reads are issued together rather than in sequence. Against the snapshot-backed
 * implementation that changes nothing, but against a feed-backed one it is the
 * difference between six round trips and one wait.
 */
export async function loadRoadmapView(
  repositories: RoadmapRepositories = getRepositories(),
): Promise<RoadmapView> {
  const [freshness, portfolios, sites, initiatives, items, coverage, warnings] = await Promise.all([
    repositories.source.get(),
    repositories.initiatives.listPortfolios(),
    repositories.sites.list(),
    repositories.initiatives.list(),
    repositories.items.list(),
    repositories.coverage.get(),
    repositories.coverage.listWarnings(),
  ]);

  return {
    snapshot: {
      schemaVersion: freshness.schemaVersion,
      syncedAt: freshness.syncedAt,
      asOf: freshness.asOf,
      portfolios,
      sites,
      initiatives,
      items,
      coverage,
      warnings,
    },
    source: freshness.kind,
  };
}
