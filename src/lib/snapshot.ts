/**
 * Snapshot loading -- the storage detail behind the repository layer.
 *
 * WP3 MOVED THE SEAM UP. This file used to be the application's only data-access
 * point; it is now the only *snapshot* access point, and the seam the app sees is
 * `src/lib/repositories/`. Nothing under `app/` imports this module any more. That
 * matters because the next source is a feed rather than a file, and a feed cannot be
 * expressed as a `readFileSync`. The properties this file was built for are unchanged:
 *   - row-level authorisation becomes a filter, not a schema change;
 *   - the source of the data is always known and always reportable;
 *   - swapping the storage is a change confined to one module.
 *
 * VALIDATION IS NOT OPTIONAL. A snapshot is validated with `snapshotSchema` on the
 * way in, exactly as `scripts/sync.ts` validates on the way out. A snapshot that
 * does not parse is never served -- a loud failure beats a plausible-looking but
 * wrong executive dashboard.
 *
 * FIXTURE FALLBACK. `data/snapshot.json` is gitignored and needs a credentialled
 * sync. When it is absent the loader serves the committed fixture and reports
 * `source: 'fixture'`, so UI development needs no feed access. Callers MUST surface
 * that: sample data being mistaken for real data is the one failure mode this
 * module exists to prevent.
 */

import { readFileSync, existsSync } from 'node:fs';
import path from 'node:path';

import { FIXTURE_SNAPSHOT } from '@/fixtures/snapshot.fixture.js';
import { snapshotSchema, type Snapshot } from '@/types/domain.js';
import type { DataSourceKind } from './repositories/types.js';

/**
 * Where the served snapshot came from. Never hide this from the user.
 *
 * Aliased to the repository contract's `DataSourceKind` rather than restated, so the
 * loader and the repository layer cannot come to disagree about what sources exist.
 */
export type SnapshotSource = DataSourceKind;

export interface LoadedSnapshot {
  snapshot: Snapshot;
  source: SnapshotSource;
  /** Absolute path when `source === 'live'`; undefined for the fixture. */
  path?: string;
}

export interface LoadSnapshotOptions {
  /** Overrides the default `data/snapshot.json`. Tests and alternate deployments. */
  snapshotPath?: string;
  /** Ignore any live snapshot and serve the fixture. Demos and tests. */
  forceFixture?: boolean;
  /** Bypass the process cache. Tests only. */
  noCache?: boolean;
}

export const DEFAULT_SNAPSHOT_PATH = path.resolve('data', 'snapshot.json');

let cached: LoadedSnapshot | undefined;

/** Thrown when a snapshot exists but is unusable. Never swallowed into a fallback. */
export class SnapshotValidationError extends Error {
  constructor(
    readonly snapshotPath: string,
    readonly issues: string[],
  ) {
    super(
      `Snapshot at ${snapshotPath} failed schema validation and was not served:\n` +
        issues.map((i) => `  ${i}`).join('\n') +
        `\n\nRe-run \`npm run sync\`. Delete the file to fall back to fixture data.`,
    );
    this.name = 'SnapshotValidationError';
  }
}

function parseOrThrow(raw: unknown, snapshotPath: string): Snapshot {
  const parsed = snapshotSchema.safeParse(raw);
  if (parsed.success) return parsed.data;

  throw new SnapshotValidationError(
    snapshotPath,
    parsed.error.issues.slice(0, 20).map((i) => `${i.path.join('.') || '(root)'}: ${i.message}`),
  );
}

/**
 * Resolution order:
 *   1. `forceFixture` / `ROADMAP_USE_FIXTURE` -> the fixture.
 *   2. A readable, valid snapshot at `snapshotPath` -> live.
 *   3. Otherwise -> the fixture.
 *
 * A snapshot that is present but INVALID throws rather than silently degrading to
 * the fixture. Quietly serving sample data in place of a broken real snapshot
 * would turn a visible failure into an invisible one.
 */
export function loadSnapshot(options: LoadSnapshotOptions = {}): LoadedSnapshot {
  if (cached && !options.noCache && !options.snapshotPath && !options.forceFixture) {
    return cached;
  }

  const forceFixture = options.forceFixture ?? process.env['ROADMAP_USE_FIXTURE'] === '1';
  const snapshotPath = options.snapshotPath ?? process.env['ROADMAP_SNAPSHOT_PATH'] ?? DEFAULT_SNAPSHOT_PATH;

  let loaded: LoadedSnapshot;

  if (!forceFixture && existsSync(snapshotPath)) {
    const contents = readFileSync(snapshotPath, 'utf8');

    let raw: unknown;
    try {
      raw = JSON.parse(contents);
    } catch (cause) {
      throw new SnapshotValidationError(snapshotPath, [`not valid JSON: ${(cause as Error).message}`]);
    }

    loaded = { snapshot: parseOrThrow(raw, snapshotPath), source: 'live', path: snapshotPath };
  } else {
    // Validate the fixture too. It is typed as `Snapshot`, but typing proves shape,
    // not the schema's runtime refinements -- and this is the same code path a live
    // snapshot takes, so a fixture that drifts fails here rather than in a page.
    loaded = { snapshot: parseOrThrow(FIXTURE_SNAPSHOT, 'src/fixtures/snapshot.fixture.ts'), source: 'fixture' };
  }

  if (!options.noCache && !options.snapshotPath) cached = loaded;
  return loaded;
}

/** Test seam. Production code has no reason to call this. */
export function clearSnapshotCache(): void {
  cached = undefined;
}
