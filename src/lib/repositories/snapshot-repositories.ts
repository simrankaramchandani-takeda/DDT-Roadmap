/**
 * The first repository implementation: every contract served from one validated
 * Snapshot.
 *
 * This is the fixture-backed implementation WP3 calls for. It is deliberately the
 * *same* code path for a live `data/snapshot.json` and for the committed fixture,
 * because `loadSnapshot()` already decides between them and already reports which one
 * it served. Deciding again here would create a second place for the "sample data
 * mistaken for real data" failure to hide.
 *
 * LOADING IS LAZY. Constructing a repository set performs no I/O; the snapshot is read
 * on the first method call and cached by `loadSnapshot()` thereafter. Construction
 * happens at module scope in the wiring, and a module that touches the filesystem when
 * it is merely imported is a module that fails in surprising places.
 *
 * EVERY LIST RETURNS A COPY. Callers get arrays they may sort, filter and hand to view
 * models without reaching back into the cached snapshot. The cost is one shallow copy
 * per call over at most a few hundred elements; the alternative is a mutation defect
 * that only shows up on the second page render.
 */

import { loadSnapshot, type LoadSnapshotOptions, type LoadedSnapshot } from '@/lib/snapshot.js';
import type { Region } from '@/types/domain.js';

import type { RoadmapRepositories } from './types.js';

/**
 * Builds the repository set over a snapshot supplied on demand.
 *
 * `load` is a thunk rather than a value so that construction stays free of I/O and so
 * that a long-lived repository set picks up a re-resolved snapshot rather than pinning
 * the first one it ever saw.
 */
export function createSnapshotRepositories(load: () => LoadedSnapshot): RoadmapRepositories {
  return {
    initiatives: {
      async list() {
        return load().snapshot.initiatives.slice();
      },
      async listPortfolios() {
        return load().snapshot.portfolios.slice();
      },
    },

    items: {
      async list() {
        return load().snapshot.items.slice();
      },
    },

    sites: {
      async list() {
        return load().snapshot.sites.slice();
      },
    },

    regions: {
      async list() {
        const { snapshot } = load();
        // Union of both, matching buildRegionIndex: a region with sites but no items
        // is a finding, and so is an item whose region resolves through neither map.
        const seen = new Set<Region>([
          ...snapshot.sites.map((site) => site.region),
          ...snapshot.items.map((item) => item.region),
        ]);
        return [...seen].sort((a, b) => a.localeCompare(b));
      },
      async listSites(region) {
        return load().snapshot.sites.filter((site) => site.region === region);
      },
    },

    coverage: {
      async get() {
        return load().snapshot.coverage;
      },
      async listWarnings() {
        return load().snapshot.warnings.slice();
      },
    },

    source: {
      async get() {
        const loaded = load();
        return {
          kind: loaded.source,
          schemaVersion: loaded.snapshot.schemaVersion,
          syncedAt: loaded.snapshot.syncedAt,
          asOf: loaded.snapshot.asOf,
          // Absent for the fixture, which has no origin worth reporting.
          ...(loaded.path ? { origin: loaded.path } : {}),
        };
      },
    },
  };
}

/**
 * The default set: a live snapshot when one is present and valid, the committed
 * fixture otherwise. Resolution and validation are `loadSnapshot()`'s job, unchanged.
 */
export function createDefaultRepositories(options: LoadSnapshotOptions = {}): RoadmapRepositories {
  return createSnapshotRepositories(() => loadSnapshot(options));
}

/**
 * Fixture data regardless of what is on disk. Demos, tests, and any environment that
 * must not be able to reach real portfolio data.
 */
export function createFixtureRepositories(): RoadmapRepositories {
  return createSnapshotRepositories(() => loadSnapshot({ forceFixture: true }));
}
