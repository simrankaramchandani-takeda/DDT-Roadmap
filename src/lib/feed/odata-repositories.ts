/**
 * Feed #3 over the network -> the WP3 repository contracts.
 *
 * `repositories.ts` proved the adapter satisfies those contracts from records already in
 * hand. This module is the same proof with a real source behind it, and it deliberately
 * adds nothing to the chain: it reads the feed, hands the payload to
 * `createFeedRepositories`, and forwards every call. No contract is widened, no view
 * model is touched, and there is no second projection of the domain model.
 *
 * WHY THE WP3 CONTRACTS ARE ASYNC. This is the change they were made async to absorb.
 * Every method already returns a Promise even though the snapshot-backed implementation
 * resolves immediately, so a network source needs no signature change anywhere -- not in
 * the interfaces, not in `loadRoadmapView`, not in the eight pages that await it.
 *
 * CONSTRUCTION PERFORMS NO I/O. Building the set is free; the feed is read on the first
 * method call. A module that opens a network connection because it was imported fails in
 * surprising places -- during a build, in a test that never touches data, in a page that
 * renders a static error.
 *
 * REPORTED AS `live`. Feed data is real portfolio data. The `fixture` kind marks the
 * committed sample dataset and nothing else, which is what keeps the sample-data chip
 * meaningful.
 */

import type { RoadmapRepositories } from '@/lib/repositories/types.js';

import type { FeedAdaptation, FeedAdapterOptions } from './adapter.js';
import {
  createODataClient,
  loadODataConfig,
  type ODataClient,
  type ODataClientOptions,
  type ODataConfig,
} from './odata-client.js';
import { DiagnosticCollector, type Diagnostic } from './outcomes.js';
import { createFeedRepositories } from './repositories.js';
import { readFeed3, type Feed3Read } from './source.js';

/**
 * How long one read is served before the feed is read again.
 *
 * NOT A PERFORMANCE KNOB -- A CORRECTNESS ONE. Two things go stale without it. The data
 * itself, obviously; but also `asOf`, which defaults to today and is the date every risk
 * derivation is evaluated against. A server process that cached its first read would
 * still be reporting yesterday's risk after midnight, with no signal that it was. A
 * bounded lifetime makes the worst case "up to fifteen minutes behind" rather than
 * "however long this process has been up".
 *
 * Fifteen minutes because the feed is same-day rather than live: reading it more often
 * cannot produce fresher data, it only adds load to a third-party export whose rate
 * limits are undocumented and whose owner (E6) is unidentified.
 */
const DEFAULT_CACHE_TTL_SECONDS = 900;

function resolveTtlMs(env: NodeJS.ProcessEnv): number {
  const raw = env['ODATA_CACHE_TTL_SECONDS'];
  const parsed = raw === undefined ? NaN : Number(raw);
  const seconds = Number.isFinite(parsed) && parsed >= 0 ? parsed : DEFAULT_CACHE_TTL_SECONDS;
  return seconds * 1000;
}

export interface ODataRepositoriesOptions {
  /** Defaults to `loadODataConfig()`. Supplied explicitly by scripts and tests. */
  config?: ODataConfig;
  /** Passed through to the WP4 adapter -- `asOf`, `baseUrl`, the level registry. */
  adapter?: FeedAdapterOptions;
  /** Transport injection. Tests supply a stub `fetchImpl`; nothing else should. */
  client?: ODataClientOptions;
  /** Overrides the cache lifetime, in milliseconds. `0` reads on every call. */
  cacheTtlMs?: number;
  onProgress?: (message: string) => void;
}

/** One completed read, and everything it produced. */
export interface ODataAdaptation {
  read: Feed3Read;
  adaptation: FeedAdaptation;
  /** Read diagnostics and record diagnostics in one list, cause before symptom. */
  diagnostics: readonly Diagnostic[];
}

interface ResolvedRead extends ODataAdaptation {
  /** Built once per read, so the adaptation runs once rather than once per page read. */
  repositories: RoadmapRepositories;
}

export interface ODataRepositories {
  repositories: RoadmapRepositories;
  /**
   * The current read, triggering one if necessary.
   *
   * Exposed so a script can report on exactly the data the repositories are serving,
   * rather than reading the feed a second time and reporting on something else.
   */
  ready(): Promise<ODataAdaptation>;
}

/**
 * Renders read-level diagnostics for `snapshot.warnings[]`.
 *
 * Reuses the collector rather than formatting strings here, so a missing entity set and
 * an unknown issue type reach the Data & coverage page in identical shape and are
 * collapsed per code by the same rule.
 */
function renderReadDiagnostics(diagnostics: readonly Diagnostic[]): string[] {
  const collector = new DiagnosticCollector();
  collector.addAll(diagnostics);
  return collector.toSnapshotWarnings();
}

/**
 * The Feed #3-backed repository set.
 *
 * @param options.client Injecting `fetchImpl` is how the tests exercise this without a
 *   network or a credential -- the same seam production uses, which is what makes the
 *   test meaningful rather than a parallel implementation.
 */
export function createODataRepositories(
  options: ODataRepositoriesOptions = {},
  env: NodeJS.ProcessEnv = process.env,
): ODataRepositories {
  const ttlMs = options.cacheTtlMs ?? resolveTtlMs(env);

  let pending: Promise<ResolvedRead> | undefined;
  let readAtMs = 0;
  let client: ODataClient | undefined;

  async function read(): Promise<ResolvedRead> {
    // Config is resolved here rather than at construction so that building the set
    // never throws for a missing credential -- a page that renders an error is far more
    // useful than a module that fails to import.
    client ??= createODataClient(options.config ?? loadODataConfig(env), options.client ?? {});

    const feedRead = await readFeed3(client, {
      ...(options.onProgress ? { onProgress: options.onProgress } : {}),
    });

    // ADAPTED EXACTLY ONCE PER READ. Repositories are read seven times per page render,
    // and re-running a 1371-row transformation per call would be both slow and -- because
    // `asOf` defaults to today -- capable of producing two different answers within one
    // render.
    const { repositories, adaptation } = createFeedRepositories(feedRead.payload, options.adapter ?? {});

    // Read findings go FIRST. "This entity set is missing" explains a whole class of
    // record-level findings below it, and a reader scanning the top of the list should
    // meet the cause before the symptoms.
    return {
      read: feedRead,
      adaptation,
      diagnostics: [...feedRead.diagnostics, ...adaptation.diagnostics],
      repositories,
    };
  }

  function current(): Promise<ResolvedRead> {
    const now = Date.now();
    if (pending !== undefined && ttlMs > 0 && now - readAtMs < ttlMs) return pending;

    readAtMs = now;

    // A FAILED READ IS NOT CACHED. A transient network error must not pin an error state
    // for the whole TTL, so the memo is cleared on rejection and the next render retries.
    // The rejection still propagates to this caller.
    const attempt = read();
    pending = attempt;
    attempt.catch(() => {
      if (pending === attempt) pending = undefined;
    });

    return attempt;
  }

  /** Awaits the read, then answers from the feed-backed repositories underneath. */
  async function delegate<T>(pick: (repositories: RoadmapRepositories) => Promise<T>): Promise<T> {
    const resolved = await current();
    return pick(resolved.repositories);
  }

  return {
    ready: current,

    repositories: {
      initiatives: {
        list: () => delegate((r) => r.initiatives.list()),
        listPortfolios: () => delegate((r) => r.initiatives.listPortfolios()),
      },
      items: {
        list: () => delegate((r) => r.items.list()),
      },
      sites: {
        list: () => delegate((r) => r.sites.list()),
      },
      regions: {
        list: () => delegate((r) => r.regions.list()),
        listSites: (region) => delegate((r) => r.regions.listSites(region)),
      },
      coverage: {
        get: () => delegate((r) => r.coverage.get()),
        // The one contract that is not a straight forward: read-level findings are
        // prepended so a missing entity set reaches the page that reports data quality.
        listWarnings: async () => {
          const resolved = await current();
          return [
            ...renderReadDiagnostics(resolved.read.diagnostics),
            ...resolved.adaptation.snapshot.warnings,
          ];
        },
      },
      source: {
        get: () => delegate((r) => r.source.get()),
      },
    },
  };
}
