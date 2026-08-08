/**
 * Feed records -> the WP3 repository contracts.
 *
 * This is where WP4 proves its own goal. The claim is that the application can accept
 * Feed-style records with no screen, route, view-model or business-rule change; the
 * only way to demonstrate that rather than assert it is to hand the adapter's output
 * to the interfaces the pages already read, and render from it.
 *
 * NOTHING IS WIRED BY DEFAULT. `getRepositories()` still resolves to the
 * snapshot-backed set. Connecting to OData is later work and needs governance sign-off
 * (E4/E6/E8); this function takes records that are already in hand, so it can be
 * exercised today with no feed access and no credential.
 *
 * REPORTED AS `live`, NOT `fixture`. Feed data is real portfolio data whatever brought
 * it in. The `fixture` kind exists solely to mark the committed sample dataset, and
 * widening it here would make the sample-data chip meaningless.
 */

import { createSnapshotRepositories } from '@/lib/repositories/snapshot-repositories.js';
import type { RoadmapRepositories } from '@/lib/repositories/types.js';
import type { LoadedSnapshot } from '@/lib/snapshot.js';

import { adaptFeedSnapshot, type FeedAdaptation, type FeedAdapterOptions } from './adapter.js';
import type { Feed3Payload } from './dto.js';

export interface FeedRepositories {
  repositories: RoadmapRepositories;
  /** The adaptation behind them: diagnostics, severity and per-code tally. */
  adaptation: FeedAdaptation;
}

/**
 * Adapts once, then serves every contract from the result.
 *
 * The adaptation runs eagerly and exactly once. Repositories are read six times per
 * page render, and re-running a 1371-row transformation per call would be both slow
 * and -- because `asOf` defaults to today -- capable of producing two different
 * answers within one render.
 */
export function createFeedRepositories(
  payload: Feed3Payload,
  options: FeedAdapterOptions = {},
): FeedRepositories {
  const adaptation = adaptFeedSnapshot(payload, options);

  const loaded: LoadedSnapshot = {
    snapshot: adaptation.snapshot,
    source: 'live',
    ...(adaptation.source.origin ? { path: adaptation.source.origin } : {}),
  };

  return { repositories: createSnapshotRepositories(() => loaded), adaptation };
}
