/**
 * WP1 acceptance: the loader and the committed fixture.
 *
 * Three properties matter here, in order of how badly they fail:
 *   1. The fixture is schema-valid, so UI work is genuinely unblocked.
 *   2. A live snapshot that is present but BROKEN throws -- it must never degrade
 *      silently to fixture data, which would hide a real failure.
 *   3. `source` reports accurately, because a demo mistaken for production data is
 *      the one thing the fixture fallback could plausibly cause.
 */

import { afterEach, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import {
  clearSnapshotCache,
  loadSnapshot,
  SnapshotValidationError,
} from '@/lib/snapshot.js';
import { FIXTURE_SNAPSHOT, PROVISIONAL_REGION_ITEM } from '@/fixtures/snapshot.fixture.js';
import { snapshotSchema } from '@/types/domain.js';
import { RESOLVED_SITES } from '@config/projects.js';
import { UNALIGNED_INITIATIVE_KEY } from '@/types/domain.js';

const tempDirs: string[] = [];

function writeTempSnapshot(contents: string): string {
  const dir = mkdtempSync(path.join(tmpdir(), 'ddt-snapshot-'));
  tempDirs.push(dir);
  const file = path.join(dir, 'snapshot.json');
  writeFileSync(file, contents, 'utf8');
  return file;
}

afterEach(() => {
  clearSnapshotCache();
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop()!;
    rmSync(dir, { recursive: true, force: true });
  }
});

describe('fixture snapshot', () => {
  it('satisfies snapshotSchema', () => {
    const parsed = snapshotSchema.safeParse(FIXTURE_SNAPSHOT);
    const issues = parsed.success ? [] : parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`);
    expect(issues).toEqual([]);
  });

  it('derives coverage consistently with its own items', () => {
    // The fixture computes `coverage` with the real buildCoverage rather than
    // hand-typing it, so these can never drift apart. This test pins that.
    const active = FIXTURE_SNAPSHOT.items.filter(
      (i) => i.risk.level !== 'complete' && i.risk.level !== 'cancelled',
    );
    expect(FIXTURE_SNAPSHOT.coverage.itemsTotal).toBe(FIXTURE_SNAPSHOT.items.length);
    expect(FIXTURE_SNAPSHOT.coverage.itemsActive).toBe(active.length);
  });

  it('lists every configured site, including those with no items', () => {
    // buildSiteSummaries returns all RESOLVED_SITES so an empty site is visible as
    // a finding rather than absent -- the UI must be able to render that.
    expect(FIXTURE_SNAPSHOT.sites).toHaveLength(RESOLVED_SITES.length);
    expect(FIXTURE_SNAPSHOT.sites.some((s) => s.activeCount === 0)).toBe(true);
  });

  it('resolves site metadata from config rather than restating it', () => {
    for (const item of FIXTURE_SNAPSHOT.items) {
      const site = RESOLVED_SITES.find((s) => s.key === item.siteKey);
      expect(site, `${item.key} references unknown site ${item.siteKey}`).toBeDefined();
      expect(item.siteName).toBe(site!.name);
      expect(item.siteCode).toBe(site!.code);
      expect(item.region).toBe(site!.region);
    }
  });

  describe('covers the cases that break layouts', () => {
    const items = FIXTURE_SNAPSHOT.items;

    it('a site whose every item is site-led (the DDTYAR banner branch)', () => {
      const yar = items.filter((i) => i.siteKey === 'DDTYAR');
      expect(yar.length).toBeGreaterThan(0);
      expect(yar.every((i) => i.alignment === 'local')).toBe(true);
      expect(yar.filter((i) => i.alignment === 'initiative')).toHaveLength(0);
    });

    it('a site with both aligned and site-led work', () => {
      const mbo = items.filter((i) => i.siteKey === 'DDTMBO');
      expect(mbo.some((i) => i.alignment === 'initiative')).toBe(true);
      expect(mbo.some((i) => i.alignment === 'local')).toBe(true);
    });

    it('the shared site-local lane, holding every local item', () => {
      const lane = FIXTURE_SNAPSHOT.initiatives.find((i) => i.key === UNALIGNED_INITIATIVE_KEY);
      expect(lane).toBeDefined();
      const localKeys = items.filter((i) => i.alignment === 'local').map((i) => i.key).sort();
      expect([...lane!.itemKeys].sort()).toEqual(localKeys);
    });

    it('an initiative with no dates', () => {
      expect(FIXTURE_SNAPSHOT.initiatives.some((i) => !i.hasDates)).toBe(true);
    });

    it('an item with no dates at all', () => {
      expect(items.some((i) => !i.start && !i.end)).toBe(true);
    });

    it('an item with a go-live but no start', () => {
      expect(items.some((i) => !i.start && i.end)).toBe(true);
    });

    it('a multi-year span and a single-day span', () => {
      const spans = items.filter((i) => i.start && i.end);
      expect(spans.some((i) => i.start! < '2024-01-01' && i.end! > '2029-01-01')).toBe(true);
      expect(spans.some((i) => i.start === i.end)).toBe(true);
    });

    it('cancelled and unreported items, which share the grey token', () => {
      expect(items.some((i) => i.risk.level === 'cancelled')).toBe(true);
      expect(items.some((i) => i.risk.level === 'unreported')).toBe(true);
    });

    it('every risk level the UI must render at least once across items and initiatives', () => {
      const levels = new Set([
        ...items.map((i) => i.risk.level),
        ...FIXTURE_SNAPSHOT.initiatives.map((i) => i.risk.level),
      ]);
      // `blocked` only arises from links, so it is easy to omit by accident.
      for (const level of ['on-track', 'monitor', 'attention', 'blocked', 'complete', 'cancelled', 'unreported']) {
        expect(levels.has(level as never), `no fixture item has risk level "${level}"`).toBe(true);
      }
    });

    it('every provenance the UI must label', () => {
      const provenances = new Set(items.map((i) => i.risk.provenance));
      for (const p of ['spot', 'reported', 'inferred', 'none']) {
        expect(provenances.has(p as never), `no fixture item has provenance "${p}"`).toBe(true);
      }
    });

    it('every executive-summary source', () => {
      const sources = new Set(items.map((i) => i.narrative.summarySource));
      for (const s of ['spot', 'jira-description', 'generated']) {
        expect(sources.has(s as never), `no fixture item has summarySource "${s}"`).toBe(true);
      }
    });

    it('an item with an open blocker', () => {
      expect(items.some((i) => i.blockers.some((b) => b.open))).toBe(true);
    });

    it('a long summary and a multi-owner item, for row-height and truncation', () => {
      expect(items.some((i) => i.summary.cleanTitle.length > 150)).toBe(true);
      expect(items.some((i) => i.owners.length >= 5)).toBe(true);
    });

    it('three go-lives in one quarter at one site, for marker collision', () => {
      const q3 = items.filter(
        (i) => i.siteKey === 'DDTGC' && i.goLive && i.goLive >= '2026-10-01' && i.goLive <= '2026-12-31',
      );
      expect(q3.length).toBeGreaterThanOrEqual(3);
    });

    it('a derived initiative span, which must not read as a commitment', () => {
      expect(FIXTURE_SNAPSHOT.initiatives.some((i) => i.datesDerived && i.hasDates)).toBe(true);
    });

    it('at least one warning, for the Data & coverage page', () => {
      expect(FIXTURE_SNAPSHOT.warnings.length).toBeGreaterThan(0);
    });
  });

  it('exposes a provisional-region item separately, since config cannot produce one', () => {
    // PROVISIONAL_REGION_MAP is empty under the 19-project MVP scope, so this state
    // is unreachable in production today. Kept out of the main fixture so that
    // dataset stays faithful to config, but the UI branch still needs a subject.
    expect(PROVISIONAL_REGION_ITEM.regionProvisional).toBe(true);
    expect(FIXTURE_SNAPSHOT.items.every((i) => !i.regionProvisional)).toBe(true);
  });
});

describe('loadSnapshot', () => {
  it('serves the fixture and reports it when no live snapshot exists', () => {
    const loaded = loadSnapshot({ snapshotPath: path.join(tmpdir(), 'ddt-does-not-exist', 'snapshot.json') });
    expect(loaded.source).toBe('fixture');
    expect(loaded.path).toBeUndefined();
    expect(loaded.snapshot.items.length).toBe(FIXTURE_SNAPSHOT.items.length);
  });

  it('serves a valid live snapshot and reports it as live', () => {
    const file = writeTempSnapshot(JSON.stringify(FIXTURE_SNAPSHOT));
    const loaded = loadSnapshot({ snapshotPath: file });
    expect(loaded.source).toBe('live');
    expect(loaded.path).toBe(file);
  });

  it('throws rather than falling back when a live snapshot fails validation', () => {
    const broken = { ...FIXTURE_SNAPSHOT, items: [{ key: 'DDTGC-1' }] };
    const file = writeTempSnapshot(JSON.stringify(broken));
    expect(() => loadSnapshot({ snapshotPath: file })).toThrow(SnapshotValidationError);
  });

  it('throws on malformed JSON', () => {
    const file = writeTempSnapshot('{ this is not json');
    expect(() => loadSnapshot({ snapshotPath: file })).toThrow(SnapshotValidationError);
  });

  it('names the failing paths so a broken snapshot is diagnosable', () => {
    const broken = { ...FIXTURE_SNAPSHOT, coverage: { itemsTotal: 'lots' } };
    const file = writeTempSnapshot(JSON.stringify(broken));
    try {
      loadSnapshot({ snapshotPath: file });
      expect.unreachable('expected a SnapshotValidationError');
    } catch (error) {
      expect(error).toBeInstanceOf(SnapshotValidationError);
      expect((error as SnapshotValidationError).issues.join('\n')).toMatch(/coverage/);
    }
  });

  it('prefers the fixture when forceFixture is set, even with a live snapshot present', () => {
    const file = writeTempSnapshot(JSON.stringify(FIXTURE_SNAPSHOT));
    expect(loadSnapshot({ snapshotPath: file, forceFixture: true }).source).toBe('fixture');
  });

  it('caches the default resolution', () => {
    clearSnapshotCache();
    const first = loadSnapshot();
    const second = loadSnapshot();
    expect(second).toBe(first);
  });
});
