/**
 * WP3 acceptance: the repository layer.
 *
 * Four properties matter, in order of how badly they fail:
 *
 *   1. The projection handed to the view models is byte-identical to what the source
 *      holds. This layer sits between the data and every number on screen; a field
 *      quietly dropped in assembly would surface as a wrong figure with no error.
 *   2. An alternative implementation can be substituted without touching anything
 *      above it. That is the entire justification for the layer -- if the swap does
 *      not work here, it will not work when Feed #3 arrives either.
 *   3. `source` still reports accurately through the new indirection, because a demo
 *      mistaken for production data is the failure the fixture fallback can cause.
 *   4. Lists are copies. A view model that sorts its input must not mutate the cached
 *      snapshot and change the next page render.
 */

import { afterEach, describe, expect, it } from 'vitest';

import {
  configureRepositories,
  createDefaultRepositories,
  createFixtureRepositories,
  createSnapshotRepositories,
  getRepositories,
  loadRoadmapView,
  resetRepositories,
  type RoadmapRepositories,
} from '@/lib/repositories/index.js';
import { clearSnapshotCache } from '@/lib/snapshot.js';
import { FIXTURE_SNAPSHOT } from '@/fixtures/snapshot.fixture.js';
import { snapshotSchema, UNALIGNED_INITIATIVE_KEY, type Snapshot } from '@/types/domain.js';

afterEach(() => {
  resetRepositories();
  clearSnapshotCache();
});

/**
 * A repository set backed by a plain object rather than the snapshot loader -- the
 * shape a Feed #3 implementation will take. Deliberately serves data that DIFFERS from
 * the fixture, so a test that passes cannot be passing on the fixture by accident.
 */
function createInMemoryRepositories(snapshot: Snapshot): RoadmapRepositories {
  return {
    initiatives: {
      list: async () => snapshot.initiatives.slice(),
      listPortfolios: async () => snapshot.portfolios.slice(),
    },
    items: { list: async () => snapshot.items.slice() },
    sites: { list: async () => snapshot.sites.slice() },
    regions: {
      list: async () => [...new Set(snapshot.sites.map((s) => s.region))].sort(),
      listSites: async (region) => snapshot.sites.filter((s) => s.region === region),
    },
    coverage: {
      get: async () => snapshot.coverage,
      listWarnings: async () => snapshot.warnings.slice(),
    },
    source: {
      get: async () => ({
        kind: 'live' as const,
        schemaVersion: snapshot.schemaVersion,
        syncedAt: snapshot.syncedAt,
        asOf: snapshot.asOf,
        origin: 'https://example.invalid/odata/Feed3',
      }),
    },
  };
}

describe('snapshot-backed repositories', () => {
  const repos = createFixtureRepositories();

  it('serves the fixture and reports it as fixture data', async () => {
    const freshness = await repos.source.get();
    expect(freshness.kind).toBe('fixture');
    expect(freshness.syncedAt).toBe(FIXTURE_SNAPSHOT.syncedAt);
    expect(freshness.asOf).toBe(FIXTURE_SNAPSHOT.asOf);
    expect(freshness.schemaVersion).toBe(FIXTURE_SNAPSHOT.schemaVersion);
    // The committed fixture has no origin worth reporting; a live snapshot has a path.
    expect(freshness.origin).toBeUndefined();
  });

  it('returns every item and initiative, including the synthetic site-local lane', async () => {
    const [items, initiatives] = await Promise.all([repos.items.list(), repos.initiatives.list()]);

    expect(items).toHaveLength(FIXTURE_SNAPSHOT.items.length);
    expect(initiatives).toHaveLength(FIXTURE_SNAPSHOT.initiatives.length);
    // 51% of level-1 work hangs off this lane. A repository that filtered it as "not a
    // real issue" would make the largest lane in the portfolio invisible everywhere.
    expect(initiatives.some((i) => i.key === UNALIGNED_INITIATIVE_KEY)).toBe(true);
  });

  it('returns every configured site, including those carrying no items', async () => {
    const sites = await repos.sites.list();
    expect(sites).toHaveLength(FIXTURE_SNAPSHOT.sites.length);
    expect(sites.some((s) => s.activeCount === 0)).toBe(true);
  });

  it('lists regions from sites and items together, not from config', async () => {
    const regions = await repos.regions.list();
    const expected = [
      ...new Set([
        ...FIXTURE_SNAPSHOT.sites.map((s) => s.region),
        ...FIXTURE_SNAPSHOT.items.map((i) => i.region),
      ]),
    ].sort((a, b) => a.localeCompare(b));

    // Same union buildRegionIndex uses. Deriving it from config/regions.ts instead
    // would drop `Unassigned`, which is the one region whose presence is a finding.
    expect(regions).toEqual(expected);
  });

  it('scopes sites to their region', async () => {
    const regions = await repos.regions.list();
    for (const region of regions) {
      const sites = await repos.regions.listSites(region);
      expect(sites.every((s) => s.region === region)).toBe(true);
    }

    const allScoped = (await Promise.all(regions.map((r) => repos.regions.listSites(r)))).flat();
    expect(allScoped).toHaveLength(FIXTURE_SNAPSHOT.sites.length);
  });

  it('serves coverage and warnings unfiltered', async () => {
    expect(await repos.coverage.get()).toEqual(FIXTURE_SNAPSHOT.coverage);
    expect(await repos.coverage.listWarnings()).toEqual(FIXTURE_SNAPSHOT.warnings);
  });

  it('hands out copies, so a consumer that sorts cannot corrupt the next read', async () => {
    const first = await repos.items.list();
    first.reverse();
    const second = await repos.items.list();
    expect(second[0]?.key).toBe(FIXTURE_SNAPSHOT.items[0]?.key);
    expect(second).not.toBe(first);
  });

  it('performs no I/O until a method is called', () => {
    let loads = 0;
    const set = createSnapshotRepositories(() => {
      loads += 1;
      return { snapshot: FIXTURE_SNAPSHOT, source: 'fixture' };
    });
    expect(loads).toBe(0);
    void set.items.list();
    expect(loads).toBe(1);
  });
});

describe('loadRoadmapView', () => {
  it('assembles a projection identical to the source snapshot', async () => {
    const { snapshot } = await loadRoadmapView(createFixtureRepositories());

    // The anti-drift guarantee. Every view model reads this object, so a field lost in
    // assembly becomes a wrong number on screen with nothing raised anywhere.
    expect(snapshot).toEqual(FIXTURE_SNAPSHOT);
  });

  it('produces a projection that still satisfies snapshotSchema', async () => {
    const { snapshot } = await loadRoadmapView(createFixtureRepositories());
    const parsed = snapshotSchema.safeParse(snapshot);
    const issues = parsed.success ? [] : parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`);
    expect(issues).toEqual([]);
  });

  it('reports the source through the indirection', async () => {
    expect((await loadRoadmapView(createFixtureRepositories())).source).toBe('fixture');
  });

  it('serves whichever implementation is wired, with no change above it', async () => {
    // The Feed #3 rehearsal: a set that is not snapshot-backed, wired at the root, with
    // pages, view models and components untouched.
    const trimmed: Snapshot = {
      ...FIXTURE_SNAPSHOT,
      items: FIXTURE_SNAPSHOT.items.slice(0, 3),
      warnings: ['served by the in-memory repository'],
    };
    configureRepositories(createInMemoryRepositories(trimmed));

    const view = await loadRoadmapView();
    expect(view.source).toBe('live');
    expect(view.snapshot.items).toHaveLength(3);
    expect(view.snapshot.warnings).toEqual(['served by the in-memory repository']);
  });

  it('falls back to the snapshot-backed set once the override is dropped', async () => {
    configureRepositories(createInMemoryRepositories({ ...FIXTURE_SNAPSHOT, items: [] }));
    expect((await loadRoadmapView()).snapshot.items).toHaveLength(0);

    resetRepositories();
    // Compared against the default set rather than against the fixture, so the test
    // holds whether or not a live `data/snapshot.json` is present on the machine.
    const restored = await loadRoadmapView();
    expect(restored.snapshot).toEqual((await loadRoadmapView(createDefaultRepositories())).snapshot);
    expect(restored.snapshot.items.length).toBeGreaterThan(0);
  });
});

describe('getRepositories', () => {
  it('returns the same set for the life of the process', () => {
    expect(getRepositories()).toBe(getRepositories());
  });

  it('prefers a configured override', () => {
    const override = createInMemoryRepositories(FIXTURE_SNAPSHOT);
    configureRepositories(override);
    expect(getRepositories()).toBe(override);
  });
});
