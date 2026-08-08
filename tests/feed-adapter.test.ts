/**
 * WP4 acceptance: Feed #3 records -> the canonical domain model.
 *
 * The claim under test is narrow and checkable: the application can accept Feed-style
 * records and produce the same canonical model it produces from Jira REST, with no
 * change to any screen, route, view model or business rule.
 *
 * The tests are ordered by how badly each property fails if it is wrong:
 *
 *   1. BUSINESS RULES SURVIVED THE SOURCE CHANGE. Held work is not on track,
 *      abandoned work is not delivered, alignment is undirected, an out-of-scope
 *      counterpart is rejected rather than never seen. A regression here is a wrong
 *      status on an executive screen with nothing raised anywhere.
 *   2. WHAT THE ADAPTER REFUSES IS AS WELL SPECIFIED AS WHAT IT ACCEPTS. Three values
 *      cannot be inferred from this feed; each must be reported, never guessed.
 *   3. A BAD FEED STILL RENDERS. Errors skip records, they do not throw, and the
 *      diagnostics that report them cannot themselves flood the page that shows them.
 *   4. THE OUTPUT SATISFIES THE EXISTING CONTRACTS -- `snapshotSchema` and the WP3
 *      repository interfaces -- because that is what "no UI change" actually means.
 */

import { afterEach, describe, expect, it } from 'vitest';

import {
  adaptCoverage,
  adaptFeedIssues,
  adaptFeedSnapshot,
  adaptSites,
  adaptSourceMetadata,
  canonicalProjectKey,
  classifyFeedProject,
  createFeedRepositories,
  DiagnosticCollector,
  diagnostic,
  isUsable,
  mapCustomFieldColumns,
  normaliseFeedStatus,
  parseFeedDate,
  parseFeedTimestamp,
  resolveFeedSite,
  resolveIssueTypeLevel,
  severityOf,
  type Feed3Payload,
  type FeedIssueRow,
} from '@/lib/feed/index.js';
import {
  FEED3_FIXTURE,
  FEED3_FIXTURE_AS_OF,
  FIXTURE_ISSUE_TYPE_LEVELS,
} from '@/fixtures/feed3.fixture.js';
import { configureRepositories, loadRoadmapView, resetRepositories } from '@/lib/repositories/index.js';
import { buildCoverage, buildSiteSummaries } from '@/lib/rollup.js';
import { buildDataModel } from '@/lib/view-models/data.js';
import { buildSiteModel } from '@/lib/view-models/site.js';
import { DEFAULT_FILTERS } from '@/lib/view-models/filters.js';
import { snapshotSchema, UNALIGNED_INITIATIVE_KEY } from '@/types/domain.js';
import { RESOLVED_SITES } from '@config/projects.js';

const OPTIONS = {
  asOf: FEED3_FIXTURE_AS_OF,
  baseUrl: 'https://takeda.atlassian.net',
  issueTypeLevels: FIXTURE_ISSUE_TYPE_LEVELS,
} as const;

function adapt(payload: Feed3Payload = FEED3_FIXTURE) {
  return adaptFeedSnapshot(payload, OPTIONS);
}

function itemsOf(payload?: Feed3Payload) {
  return adapt(payload).snapshot.items;
}

function item(key: string) {
  const found = itemsOf().find((i) => i.key === key);
  expect(found, `no item ${key} in the adapted snapshot`).toBeDefined();
  return found!;
}

afterEach(() => {
  resetRepositories();
});

// ---------------------------------------------------------------------------
// 1. Business rules survived the source change
// ---------------------------------------------------------------------------

describe('business rules are preserved, not reimplemented', () => {
  it('floors a held project at monitor even against an authored Green', () => {
    // DDTLNZ-1 is `Hold` with a Green RAG and a go-live eight months out. Without the
    // floor it derives as ON TRACK -- the exact false reassurance the phase exists to
    // prevent. This passes only because the feed path calls the same `assessRisk`.
    const held = item('DDTLNZ-1');
    expect(held.status.phase).toBe('hold');
    expect(held.risk.level).toBe('monitor');
    expect(held.risk.reasons.map((r) => r.code)).toContain('on-hold');
    // A floor, not a cap: the authored value still supplies the provenance.
    expect(held.risk.provenance).toBe('spot');
  });

  it('never lets abandoned work report as delivered', () => {
    // `Discarded` -> cancelled, and cancelled beats an authored Green outright.
    const discarded = item('DDTMBO-1');
    expect(discarded.status.phase).toBe('cancelled');
    expect(discarded.risk.level).toBe('cancelled');
  });

  it('matches alignment links in either direction', () => {
    // Direction is not consistently curated -- Polaris rows split near-evenly between
    // Inward and Outward, so honouring it would drop about half of all alignments.
    expect(item('DDTGC-1').initiativeKey).toBe('DDTGMPORT-1'); // Outward
    expect(item('DDTMBO-1').initiativeKey).toBe('DDTGMPORT-2'); // Inward
  });

  it('rejects a link whose counterpart is outside the portfolio, rather than not seeing it', () => {
    // DDTGC-2 links to LESOPS-77. Pre-filtering the row would give the same outcome
    // for entirely the wrong reason, and would break the day LESOPS came into scope.
    const local = item('DDTGC-2');
    expect(local.initiativeKey).toBeUndefined();
    expect(local.alignment).toBe('local');
  });

  it('treats a fully site-led site as a delivery model, not missing data', () => {
    const yaroslavl = itemsOf().filter((i) => i.siteKey === 'DDTYAR');
    expect(yaroslavl.length).toBeGreaterThan(0);
    expect(yaroslavl.every((i) => i.alignment === 'local')).toBe(true);

    // And it still renders the banner branch rather than an empty state.
    const model = buildSiteModel(adapt().snapshot, 'DDTYAR', DEFAULT_FILTERS);
    expect(model?.isFullyLocal).toBe(true);
  });

  it('collects every site-led item into the shared synthetic lane', () => {
    const { snapshot } = adapt();
    const lane = snapshot.initiatives.find((i) => i.key === UNALIGNED_INITIATIVE_KEY);
    const localKeys = snapshot.items.filter((i) => i.alignment === 'local').map((i) => i.key).sort();

    expect(lane).toBeDefined();
    expect([...lane!.itemKeys].sort()).toEqual(localKeys);
  });

  it('resolves regions from config, never from the feed', () => {
    // The feed carries no region at all. Region must arrive through `resolveSite`, so
    // Yaroslavl reports into Asia-Pacific by design rather than by geography.
    for (const adapted of itemsOf()) {
      const site = RESOLVED_SITES.find((s) => s.key === adapted.siteKey);
      expect(site, `${adapted.key} references unregistered site ${adapted.siteKey}`).toBeDefined();
      expect(adapted.region).toBe(site!.region);
      expect(adapted.siteCode).toBe(site!.code);
    }
    expect(item('DDTYAR-1').region).toBe('Asia-Pacific');
  });

  it('computes coverage with the same function the REST path uses', () => {
    // Not "produces matching numbers" -- literally the same call, so the two cannot
    // drift. `flaggedFieldPopulated` is 0 because the column is absent, which is a
    // declared known loss rather than a measurement.
    const { snapshot } = adapt();
    const active = snapshot.items.filter(
      (i) => i.risk.level !== 'complete' && i.risk.level !== 'cancelled',
    );
    expect(snapshot.coverage).toEqual(buildCoverage(snapshot.items, active, FEED3_FIXTURE_AS_OF, 0));
    expect(adaptCoverage(snapshot.items, active, FEED3_FIXTURE_AS_OF)).toEqual(snapshot.coverage);
  });

  it('lists every configured site, including those the feed carried no work for', () => {
    const { snapshot } = adapt();
    expect(snapshot.sites).toHaveLength(RESOLVED_SITES.length);
    expect(snapshot.sites.some((s) => s.activeCount === 0)).toBe(true);
    expect(adaptSites([])).toEqual(buildSiteSummaries([]));
  });
});

// ---------------------------------------------------------------------------
// 2. What the adapter refuses
// ---------------------------------------------------------------------------

describe('values that cannot be inferred are reported, never guessed', () => {
  it('skips an unmapped status rather than filing it as work in flight', () => {
    // Under REST this is a warning, because there is a real status category to fall
    // back to. Feed #3 has none, and `?? execute` would report unknown work as running.
    const outcome = normaliseFeedStatus('Awaiting Steerco', 'DDTGC-9');
    expect(outcome.severity).toBe('error');
    expect(outcome.diagnostics[0]?.code).toBe('unknown-status');

    expect(itemsOf().some((i) => i.key === 'DDTGC-9')).toBe(false);
    expect(adapt().snapshot.warnings.some((w) => w.includes('DDTGC-9'))).toBe(true);
  });

  it('skips an unregistered issue type and names what is needed to fix it', () => {
    const outcome = resolveIssueTypeLevel(
      22801,
      'DDTGC-8',
      { typeName: 'Digital Project', scopeType: 'PROJECT', scopeId: '23330' },
      FIXTURE_ISSUE_TYPE_LEVELS,
    );

    expect(outcome.severity).toBe('error');
    // An unknown level is silently DROPPED by `classifyIssues`, so a site would look
    // like it has no work. The diagnostic has to carry enough to extend the registry.
    expect(outcome.diagnostics[0]?.message).toContain('Digital Project');
    expect(outcome.diagnostics[0]?.message).toContain('PROJECT/23330');
    expect(outcome.diagnostics[0]?.remedy).toContain('ISSUE_TYPE_LEVELS');

    expect(itemsOf().some((i) => i.key === 'DDTGC-8')).toBe(false);
  });

  it('attributes no blocker at all while the Blocks direction is unresolved', () => {
    // No longer the default -- BLOCKS_DIRECTION_MEANING was resolved against real Jira
    // links on 2026-08-08 -- but the safe fallback stays covered, because it is what
    // must happen if a future feed change makes the mapping uncertain again. Guessing
    // DIRECTION would invert every attribution, making blocking items look blocked.
    const unresolved = adaptFeedSnapshot(FEED3_FIXTURE, { ...OPTIONS, blocksDirection: 'unresolved' });
    expect(unresolved.snapshot.items.every((i) => i.blockers.length === 0)).toBe(true);
    expect(unresolved.tally['unsupported-value']).toBeGreaterThan(0);
  });

  it('attributes blockers by default, since the direction is now established', () => {
    // `Inward` means the row's own issue is the BLOCKED one: verified against
    // DDTBP-8/DDTBP-27 and DDTSG-24/DDTSG-23 in Jira. See BLOCKS_DIRECTION_MEANING.
    const blocked = item('DDTSG-1');
    expect(blocked.blockers.map((b) => b.key)).toEqual(['DDTGC-1']);
    expect(blocked.blockers[0]?.open).toBe(true);
    expect(blocked.blockers[0]?.type).toBe('is blocked by');
  });

  it('does not warn about DIRECTION once it is established', () => {
    // The warning existed to make the gap visible. Leaving it in place after the gap
    // closed would train readers to ignore it.
    const subjects = adapt().diagnostics.map((d) => d.subject);
    expect(subjects).not.toContain('IssueLinks.DIRECTION');
  });

  it('states each known loss once, so a degradation is never rediscovered as a bug', () => {
    const subjects = adapt().diagnostics.filter((d) => d.code === 'known-loss').map((d) => d.subject);
    expect(subjects).toContain('childCount');
    expect(subjects).toContain('customfield_10387 (Flagged)');
    expect(subjects).toContain('customfield_11199 (Initiative RAG)');
    expect(itemsOf().every((i) => i.childCount.total === 0)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// 3. Diagnostics and rendering safety
// ---------------------------------------------------------------------------

describe('transformation warnings', () => {
  it('raises every required finding against the fixture', () => {
    const { tally } = adapt();
    for (const code of ['unknown-status', 'unmapped-site', 'missing-dates', 'duplicate-record']) {
      expect(tally[code], `no ${code} diagnostic was raised`).toBeGreaterThan(0);
    }
    // `unsupported-value` is deliberately absent from that list now: the fixture's only
    // source of it was the unresolved-DIRECTION warning, and the direction is resolved.
    // It is still raised for a row that cannot be identified at all.
    const noKey = adapt({ ...FEED3_FIXTURE, issues: [...FEED3_FIXTURE.issues, { ISSUE_KEY: '' }] });
    expect(noKey.tally['unsupported-value']).toBeGreaterThan(0);
  });

  it('separates a knowingly deferred project from an unregistered one', () => {
    // Feed #3 is configured for someone else's requirements and carries projects this
    // application does not cover. Lumping the expected noise in with the one finding
    // that needs a human would leave the bucket permanently full and permanently ignored.
    const codes = new Map(adapt().diagnostics.map((d) => [d.subject, d.code]));
    expect(codes.get('DDTLA')).toBe('out-of-scope');
    expect(codes.get('DDTZZZ')).toBe('unmapped-site');
  });

  it('keeps the first of a duplicated record and reports the repeat', () => {
    // "Last wins" would make the resolved value depend on export order, which the feed
    // does not guarantee -- non-deterministic output from identical data.
    const duplicated = item('DDTBP-1');
    expect(duplicated.summary.raw).toBe('Cleanroom monitoring upgrade');
    expect(adapt().diagnostics.some((d) => d.code === 'duplicate-record' && d.subject === 'DDTBP-1')).toBe(true);
  });

  it('reports an item with no dates rather than dropping it', () => {
    // It cannot be plotted, but it is real work and the UI has a named group for it.
    const undated = item('DDTSG-1');
    expect(undated.start).toBeUndefined();
    expect(undated.end).toBeUndefined();
    expect(adapt().diagnostics.some((d) => d.code === 'missing-dates' && d.subject === 'DDTSG-1')).toBe(true);
  });

  it('reports a missing entity set as a named capability loss', () => {
    const { issueLinks: _dropped, ...withoutLinks } = FEED3_FIXTURE;
    const result = adapt(withoutLinks as Feed3Payload);

    expect(result.diagnostics.some((d) => d.code === 'missing-entity-set')).toBe(true);
    // Without links nothing can align, and "no global programmes" looks identical on
    // screen to "the export forgot a table".
    expect(result.snapshot.items.every((i) => i.alignment === 'local')).toBe(true);
  });

  it('detects a custom-field column collision instead of resolving it last-write-wins', () => {
    const colliding: FeedIssueRow = {
      ISSUE_KEY: 'DDTGC-77',
      Overall_Status_24262: 'Green',
      Another_Label_24262: 'Red',
    };
    const outcome = mapCustomFieldColumns(colliding, 'DDTGC-77');

    expect(outcome.severity).toBe('error');
    expect(outcome.diagnostics[0]?.code).toBe('field-collision');
  });
});

describe('DiagnosticCollector', () => {
  it('renders into the existing data-quality model as plain strings', () => {
    const { snapshot } = adapt();
    expect(snapshot.warnings.every((w) => typeof w === 'string')).toBe(true);
    // Which is all `snapshotSchema` and the Data & coverage page have ever required.
    expect(snapshotSchema.safeParse(snapshot).success).toBe(true);
  });

  it('collapses repeats so a systemic failure cannot flood the page reporting it', () => {
    // 1371 rows failing the same way must not become 1371 list items on the one page
    // whose job is to report the failure.
    const collector = new DiagnosticCollector();
    for (let index = 0; index < 50; index++) {
      collector.add(diagnostic('warning', 'unknown-status', `DDTGC-${index}`, `status ${index} is unmapped.`));
    }

    const rendered = collector.toSnapshotWarnings(8);
    expect(rendered).toHaveLength(9);
    expect(rendered.at(-1)).toContain('42 further occurrences');
  });

  it('renders skipped records distinguishably from noted ones', () => {
    // A record dropped in silence is indistinguishable from one that never existed --
    // the failure this whole layer exists to prevent.
    const collector = new DiagnosticCollector();
    collector.add(diagnostic('error', 'unknown-status', 'DDTGC-9', 'unmapped.'));
    collector.add(diagnostic('warning', 'missing-dates', 'DDTSG-1', 'no dates.'));

    const [first, second] = collector.toSnapshotWarnings();
    expect(first).toContain('Feed record skipped');
    expect(second).toMatch(/^Feed \[missing-dates]/);
  });

  it('ignores an exact repeat of a diagnostic it already holds', () => {
    const collector = new DiagnosticCollector();
    const same = diagnostic('warning', 'out-of-scope', 'DDTLA', 'deferred.');
    collector.add(same);
    collector.add({ ...same });
    expect(collector.all).toHaveLength(1);
  });

  it('reports the worst severity it has seen', () => {
    expect(severityOf([])).toBe('valid');
    expect(severityOf([diagnostic('warning', 'missing-dates', 'x', 'y')])).toBe('warning');
    expect(severityOf([diagnostic('error', 'unknown-status', 'x', 'y')])).toBe('error');
    // The fixture deliberately contains unusable records, so the run is an error
    // overall -- and still produces a complete, renderable snapshot.
    expect(adapt().severity).toBe('error');
  });
});

// ---------------------------------------------------------------------------
// 4. Normalisation
// ---------------------------------------------------------------------------

describe('normalisation', () => {
  it('truncates rather than parses a date, so no timezone can shift a go-live', () => {
    expect(parseFeedDate('2029-03-31')).toBe('2029-03-31');
    expect(parseFeedDate('2026-04-01T00:00:00Z')).toBe('2026-04-01');
    expect(parseFeedDate(null)).toBeUndefined();
    expect(parseFeedDate('')).toBeUndefined();
    expect(parseFeedDate('not a date')).toBeUndefined();
  });

  it('keeps a timestamp at full precision, and rejects anything unrecognisable', () => {
    // `updatedAt` drives staleness. Coercing junk to "now" would make a stale item
    // look freshly touched.
    expect(parseFeedTimestamp('2026-08-07T05:02:16Z')).toBe('2026-08-07T05:02:16Z');
    expect(parseFeedTimestamp('yesterday')).toBeUndefined();
  });

  it('tolerates padding and casing on a project key', () => {
    expect(canonicalProjectKey('  ddtgc ')).toBe('DDTGC');
    expect(canonicalProjectKey(null)).toBeUndefined();
  });

  it('classifies a project key into the four cases that need different treatment', () => {
    expect(classifyFeedProject('DDTGC').kind).toBe('site');
    expect(classifyFeedProject('DDTGMPORT').kind).toBe('portfolio');
    expect(classifyFeedProject('DDTLA').kind).toBe('out-of-scope');
    expect(classifyFeedProject('DDTZZZ').kind).toBe('unknown');
  });

  it('resolves a site through config, and refuses anything else', () => {
    const resolved = resolveFeedSite('DDTGC', 'DDTGC-1');
    expect(isUsable(resolved)).toBe(true);
    expect(resolved.value?.region).toBe('Europe');

    expect(resolveFeedSite('DDTZZZ', 'DDTZZZ-1').severity).toBe('error');
  });

  it('derives status category from phase, because the feed carries none', () => {
    const held = normaliseFeedStatus('ON HOLD', 'DDTGMPORT-3');
    expect(held.value).toMatchObject({ phase: 'hold', category: 'in-progress', jiraCategoryKey: 'indeterminate' });

    // `cancelled` maps to the `done` category exactly as Jira files "Will not do" --
    // and stays safe because `risk.ts` resolves terminality from the phase first.
    const discarded = normaliseFeedStatus('Discarded', 'DDTMBO-1');
    expect(discarded.value).toMatchObject({ phase: 'cancelled', category: 'done', jiraCategoryKey: 'done' });
  });

  it('strips a type suffix, so a suffixing site resolves the same through either source', () => {
    expect(normaliseFeedStatus('To Do - Epic', 'DDTJG-1').value?.phase).toBe('demand');
  });

  it('maps every <Label>_<fieldId> column onto its Jira custom field', () => {
    // One rule rather than eighteen special cases, so config/fields.ts stays the only
    // place a field ID is declared and no OData-specific duplicate can drift.
    const outcome = mapCustomFieldColumns(
      {
        ISSUE_KEY: 'DDTTO-1',
        Start_date_10412: '2026-01-01',
        SPOT_Description__24271: 'body', // doubled underscore, seen in the real feed
        PROJECT_KEY: 'DDTTO',
        Empty_Column_24272: '',
      },
      'DDTTO-1',
    );

    expect(outcome.value).toEqual({
      customfield_10412: '2026-01-01',
      customfield_24271: 'body',
    });
  });
});

// ---------------------------------------------------------------------------
// 5. The synthesised JiraIssue contract
// ---------------------------------------------------------------------------

describe('adaptFeedIssues', () => {
  it('emits the internal JiraIssue contract the transformation layer already reads', () => {
    const { issues } = adaptFeedIssues(FEED3_FIXTURE, OPTIONS);
    const gc1 = issues.find((i) => i.key === 'DDTGC-1');

    expect(gc1).toBeDefined();
    expect(gc1!.fields['issuetype']).toMatchObject({ hierarchyLevel: 1, name: 'Epic' });
    expect(gc1!.fields['status']).toEqual({ name: 'Execute', statusCategory: { key: 'indeterminate' } });
    expect(gc1!.fields['project']).toEqual({ key: 'DDTGC' });
    expect(gc1!.fields['duedate']).toBe('2026-11-30');
    expect(gc1!.fields['customfield_10412']).toBe('2025-02-03');
    expect(gc1!.fields['customfield_24262']).toBe('Amber');
  });

  it('joins the label and owner side tables onto their issues', () => {
    const { issues } = adaptFeedIssues(FEED3_FIXTURE, OPTIONS);
    expect(issues.find((i) => i.key === 'DDTGC-2')!.fields['labels']).toEqual(['FY27', 'serialisation']);

    // Multi-user fields arrive as `[{ displayName }]`, the shape `extractScalar`
    // already walks -- so `normaliseOwners` needs no feed awareness.
    expect(issues.find((i) => i.key === 'DDTGC-1')!.fields['customfield_11209']).toEqual([
      { displayName: 'Priya Raman' },
    ]);
  });

  it('carries an out-of-export link counterpart as a bare key', () => {
    const { issues } = adaptFeedIssues(FEED3_FIXTURE, OPTIONS);
    const links = issues.find((i) => i.key === 'DDTGC-2')!.fields['issuelinks'] as {
      outwardIssue?: { key: string; fields: Record<string, unknown> };
    }[];

    expect(links[0]?.outwardIssue?.key).toBe('LESOPS-77');
    // No row to join against, so no status: `findBlockers` then treats it as open,
    // which is the conservative direction.
    expect(links[0]?.outwardIssue?.fields['status']).toBeUndefined();
  });

  it('drops level-0 detail by hierarchy level, not by type name', () => {
    // A pipeline keyed on `issuetype = Epic` returns nothing for a site using a
    // project-local level-1 type, and reports no error.
    expect(itemsOf().some((i) => i.key === 'NEUCHDDT-1')).toBe(false);
  });

  it('does not throw on a payload that is entirely unusable', () => {
    const broken: Feed3Payload = {
      metadata: { name: 'Feed #3', retrievedAt: '2026-08-08T00:00:00.000Z' },
      issues: [{ ISSUE_KEY: '' }, { ISSUE_KEY: 'DDTGC-1' }],
    };

    expect(() => adaptFeedSnapshot(broken, OPTIONS)).not.toThrow();
    const result = adaptFeedSnapshot(broken, OPTIONS);
    expect(result.snapshot.items).toEqual([]);
    // Still a complete, valid, renderable snapshot -- an empty roadmap that explains
    // itself, not a crash.
    expect(snapshotSchema.safeParse(result.snapshot).success).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// 6. The existing contracts
// ---------------------------------------------------------------------------

describe('the adapted snapshot satisfies the contracts the UI already reads', () => {
  it('parses as a Snapshot', () => {
    const parsed = snapshotSchema.safeParse(adapt().snapshot);
    const issues = parsed.success ? [] : parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`);
    expect(issues).toEqual([]);
  });

  it('reports feed provenance as live, never as sample data', () => {
    const source = adaptSourceMetadata(FEED3_FIXTURE.metadata, FEED3_FIXTURE_AS_OF);
    expect(source.kind).toBe('live');
    expect(source.syncedAt).toBe(FEED3_FIXTURE.metadata.retrievedAt);
    expect(source.asOf).toBe(FEED3_FIXTURE_AS_OF);
    // `syncedAt` is when the feed was READ, which is not the same as how current the
    // data is -- Feed #3 is same-day, not live. The UI derives data age separately
    // from the newest item update, so this must not be dressed up as freshness.
    expect(source.syncedAt).not.toBe(source.asOf);
  });

  it('passes the origin through without inventing one', () => {
    // Redaction is the caller's job -- a credential must never reach this layer -- so
    // the adapter's only obligation is not to fabricate provenance where there is none.
    expect(adaptSourceMetadata(FEED3_FIXTURE.metadata, FEED3_FIXTURE_AS_OF).origin).toBe(
      FEED3_FIXTURE.metadata.origin,
    );
    expect(
      adaptSourceMetadata({ name: 'Feed #3', retrievedAt: '2026-08-08T00:00:00.000Z' }, FEED3_FIXTURE_AS_OF).origin,
    ).toBeUndefined();
  });

  it('serves the WP3 repository contracts with no wiring change above them', async () => {
    const { repositories } = createFeedRepositories(FEED3_FIXTURE, OPTIONS);
    configureRepositories(repositories);

    const view = await loadRoadmapView();
    expect(view.source).toBe('live');
    expect(view.snapshot.items).toHaveLength(adapt().snapshot.items.length);
    expect(view.snapshot.sites).toHaveLength(RESOLVED_SITES.length);
  });

  it('renders through the unmodified view models, warnings included', () => {
    // The end-to-end claim: feed records in, the same page props out. `buildDataModel`
    // is the strictest consumer -- it reads coverage, sites, warnings and initiatives.
    const model = buildDataModel(adapt().snapshot);

    expect(model.itemsTotal).toBe(adapt().snapshot.coverage.itemsTotal);
    expect(model.warnings.length).toBeGreaterThan(0);
    expect(model.emptySites.length).toBeGreaterThan(0);
    expect(model.coverageRows.every((row) => row.total >= row.known)).toBe(true);
  });
});
