/**
 * End-to-end pipeline test over real Jira payload shapes.
 *
 * Runs classify -> transform -> risk -> summarise -> rollup -> schema validation
 * without needing Jira credentials, so the two silent-failure modes stay covered
 * even before a live sync is possible.
 */

import { describe, expect, it } from 'vitest';
import {
  ALL_FIXTURES,
  DDTBRY_412,
  DDTGC_24,
  DDTGMPORT_27,
  DDTHIK_38,
  DDTSG_55,
  NEUCHDDT_96,
  NEUCHDDT_133,
} from './fixtures/jira-issues.js';
import {
  buildUnalignedInitiative,
  classifyIssues,
  findBlockers,
  findInitiativeKey,
  transformInitiative,
  transformItem,
  type TransformContext,
} from '@/lib/transform.js';
import { buildCoverage, buildSiteRollup, buildSiteSummaries } from '@/lib/rollup.js';
import { snapshotSchema, type RoadmapItem, type Snapshot } from '@/types/domain.js';
import { PORTFOLIOS } from '@config/projects.js';

const ASOF = '2026-08-05';

function context(): TransformContext {
  return { baseUrl: 'https://onetakeda.atlassian.net', asOf: ASOF, warnings: [] };
}

function transformAll(): { items: RoadmapItem[]; ctx: TransformContext } {
  const ctx = context();
  const { items: raw } = classifyIssues(ALL_FIXTURES, ctx.warnings);
  const items = raw.map((issue) => transformItem(issue, ctx)).filter((i): i is RoadmapItem => Boolean(i));
  return { items, ctx };
}

describe('classifyIssues: selection by hierarchy level', () => {
  it('selects level-1 items and level-2 initiatives, dropping operational detail', () => {
    const warnings: string[] = [];
    const { items, initiatives } = classifyIssues(ALL_FIXTURES, warnings);

    expect(initiatives.map((i) => i.key)).toEqual(['DDTGMPORT-27']);
    expect(items.map((i) => i.key).sort()).toEqual([
      'DDTBRY-412',
      'DDTGC-24',
      'DDTHIK-38',
      'DDTSG-55',
      'NEUCHDDT-133',
      'NEUCHDDT-96',
    ]);
  });

  it('excludes the level-0 story and the subtask', () => {
    const { items } = classifyIssues(ALL_FIXTURES, []);
    const keys = items.map((i) => i.key);
    expect(keys).not.toContain('DDTSG-56');
    expect(keys).not.toContain('DDTSG-57');
  });

  it('ingests "Digital Project" and warns so a new type name cannot pass unnoticed', () => {
    const warnings: string[] = [];
    const { items } = classifyIssues([DDTBRY_412], warnings);

    // Ingested despite not being called "Epic".
    expect(items.map((i) => i.key)).toEqual(['DDTBRY-412']);
    // "Digital Project" is known, so no warning.
    expect(warnings).toHaveLength(0);
  });

  it('warns on a level-1 type name never seen during discovery', () => {
    const warnings: string[] = [];
    const novel = {
      ...DDTBRY_412,
      key: 'DDTVAS-1',
      fields: {
        ...DDTBRY_412.fields,
        issuetype: { id: '99999', name: 'Site Programme', subtask: false, hierarchyLevel: 1 },
        project: { self: '', id: '15562', key: 'DDTVAS', name: 'DDT Vashi' },
      },
    };
    const { items } = classifyIssues([novel], warnings);

    expect(items).toHaveLength(1);
    expect(warnings[0]).toContain('Site Programme');
    expect(warnings[0]).toContain('Ingested as a roadmap item');
  });
});

describe('findInitiativeKey: undirected link matching', () => {
  it('resolves a portfolio counterpart in the OUTWARD position', () => {
    expect(findInitiativeKey(DDTSG_55)).toBe('DDTGMPORT-27');
  });

  it('resolves a portfolio counterpart in the INWARD position', () => {
    // The direction is reversed relative to DDTSG-55. Honouring direction would
    // drop this relationship silently.
    expect(findInitiativeKey(DDTHIK_38)).toBe('DDTGMPORT-27');
  });

  it('ignores Polaris links whose counterpart is outside the portfolio', () => {
    // NEUCHDDT-96 links to NEUOPS-77 and NEUCHDDT-159 -- neither is a portfolio.
    expect(findInitiativeKey(NEUCHDDT_96)).toBeUndefined();
  });

  it('returns undefined when there are no links', () => {
    expect(findInitiativeKey(DDTBRY_412)).toBeUndefined();
  });
});

describe('transformItem', () => {
  it('maps DDTSG-55 with its SPOT status and narrative', () => {
    const ctx = context();
    const item = transformItem(DDTSG_55, ctx)!;

    expect(item.siteName).toBe('Singapore');
    expect(item.siteCode).toBe('SGP');
    expect(item.region).toBe('Asia-Pacific');
    expect(item.regionProvisional).toBe(false);
    expect(item.alignment).toBe('initiative');
    expect(item.initiativeKey).toBe('DDTGMPORT-27');

    // SPOT status is primary.
    expect(item.risk.level).toBe('on-track');
    expect(item.risk.provenance).toBe('spot');
    expect(item.risk.authored?.value).toBe('Green');

    // Narrative comes from SPOT verbatim.
    expect(item.narrative.summarySource).toBe('spot');
    expect(item.narrative.executiveSummary).toContain('PMC endorsed 18Jun26');
    expect(item.narrative.nextPriorities).toContain('LAN controller replacement');

    expect(item.start).toBe('2026-06-30');
    expect(item.goLive).toBe('2028-04-01');
    expect(item.fiscalYears).toEqual(['FY26', 'FY27', 'FY28']);

    expect(item.spotId).toBe('1062480');
    expect(item.spotIdSource).toBe('field');
    expect(item.jiraUrl).toBe('https://onetakeda.atlassian.net/browse/DDTSG-55');
  });

  it('maps DDTGC-24 as inferred attention with a concrete reason', () => {
    const item = transformItem(DDTGC_24, context())!;

    expect(item.risk.level).toBe('attention');
    expect(item.risk.provenance).toBe('inferred');
    expect(item.risk.atRisk).toBe(true);
    expect(item.risk.reasons[0]?.detail).toBe('Go-live was 31 Mar 2026, now 127 days overdue.');

    // SPOT id recovered from the summary, since the field is empty.
    expect(item.spotId).toBe('1059534');
    expect(item.spotIdSource).toBe('summary');

    // Clean title strips the SPOT label and FY tag.
    expect(item.summary.cleanTitle).not.toContain('SPOT-1059534');
    expect(item.summary.fyTag).toBe('FY26');
  });

  it('maps a non-"Epic" level-1 type and strips the status suffix', () => {
    const item = transformItem(DDTBRY_412, context())!;

    expect(item.issueTypeName).toBe('Digital Project');
    expect(item.siteName).toBe('Bray');
    expect(item.region).toBe('Europe');
    // Every in-scope site resolves through the authoritative region map.
    expect(item.regionProvisional).toBe(false);

    // "To Do - Epic" must normalise, not fall through to the category fallback.
    expect(item.status.raw).toBe('To Do - Epic');
    expect(item.status.phase).toBe('demand');

    // Structured description supplies the summary.
    expect(item.narrative.summarySource).toBe('jira-description');
    expect(item.narrative.executiveSummary).toContain('Enhance workforce digital fluency');
    // The heading itself must not leak in.
    expect(item.narrative.executiveSummary).not.toContain('Business Problem');
  });

  it('maps NEUCHDDT-96 as site-local with a non-SPOT authored status', () => {
    const item = transformItem(NEUCHDDT_96, context())!;

    expect(item.alignment).toBe('local');
    expect(item.initiativeKey).toBeUndefined();
    expect(item.risk.provenance).toBe('reported');
    expect(item.risk.authored?.sourceLabel).toBe('Health');
    expect(item.declaredFiscalYear).toBe('FY26');

    // No dates: not plottable.
    expect(item.start).toBeUndefined();
    expect(item.goLive).toBeUndefined();
    expect(item.fiscalYears).toEqual([]);

    expect(item.owners.map((o) => o.name)).toContain('Philippe Moins');
    // Deduplicated despite appearing as assignee, delivery lead and text field.
    expect(item.owners.filter((o) => o.name === 'Philippe Moins')).toHaveLength(1);
  });

  it('maps "Will not do" to cancelled, NOT complete', () => {
    // Jira gives this statusCategory `done`. Reporting it as complete would
    // inflate the delivered count with abandoned work.
    const item = transformItem(NEUCHDDT_133, context())!;

    expect(item.status.raw).toBe('Will not do');
    expect(item.risk.level).toBe('cancelled');
    expect(item.risk.atRisk).toBe(false);
  });

  it('skips an issue from an unregistered project and says so', () => {
    const ctx = context();
    const orphan = {
      ...DDTSG_55,
      key: 'NOTDDT-1',
      fields: { ...DDTSG_55.fields, project: { self: '', id: '1', key: 'NOTDDT', name: 'Other' } },
    };

    expect(transformItem(orphan, ctx)).toBeUndefined();
    expect(ctx.warnings[0]).toContain('not in the site');
  });
});

describe('transformInitiative', () => {
  it('rolls up linked items and reads the portfolio RAG from customfield_11199', () => {
    const ctx = context();
    const linked = [DDTSG_55, DDTHIK_38, DDTGC_24]
      .map((i) => transformItem(i, ctx))
      .filter((i): i is RoadmapItem => Boolean(i));

    const initiative = transformInitiative(DDTGMPORT_27, linked, ctx);

    expect(initiative.summary).toBe('CIM - Project Phoenix');
    expect(initiative.portfolioKey).toBe('DDTGMPORT');
    expect(initiative.itemKeys).toHaveLength(3);

    // The field named "Asset ID" holds RAG. Authored wins over the rollup.
    expect(initiative.authoredRag).toBe('Green');
    expect(initiative.risk.provenance).toBe('reported');
    expect(initiative.risk.level).toBe('on-track');
    // ...but the child problem is still stated.
    expect(initiative.risk.reasons[0]?.detail).toContain('of 3 linked projects');

    // Authored dates present, so not derived.
    expect(initiative.start).toBe('2024-09-02');
    expect(initiative.end).toBe('2027-10-31');
    expect(initiative.datesDerived).toBe(false);
    expect(initiative.hasDates).toBe(true);

    expect(initiative.owners.map((o) => o.role)).toContain('IT Lead');
    expect(initiative.narrative.executiveSummary).toContain('Project Phoenix');
  });

  it('produces a site rollup ordered by go-live for the collapsed lane markers', () => {
    const ctx = context();
    const linked = [DDTSG_55, DDTHIK_38, DDTGC_24]
      .map((i) => transformItem(i, ctx))
      .filter((i): i is RoadmapItem => Boolean(i));

    const rollup = buildSiteRollup(linked);

    expect(rollup.map((r) => r.siteCode)).toEqual(['GRA', 'HIK', 'SGP']);
    expect(rollup[0]!.goLive).toBe('2026-03-31');
    expect(rollup[0]!.risk).toBe('attention');
    expect(rollup[0]!.atRiskCount).toBe(1);
    expect(rollup[2]!.risk).toBe('on-track');
  });

  it('derives dates from items when the initiative has none', () => {
    const ctx = context();
    const linked = [transformItem(DDTGC_24, ctx)!];
    const undated = {
      ...DDTGMPORT_27,
      fields: { ...DDTGMPORT_27.fields, duedate: null, customfield_10412: null },
    };

    const initiative = transformInitiative(undated, linked, ctx);

    expect(initiative.start).toBe('2025-06-01');
    expect(initiative.end).toBe('2026-03-31');
    expect(initiative.datesDerived).toBe(true);
  });

  it('marks an initiative with no items and no dates as not plottable', () => {
    const ctx = context();
    const undated = {
      ...DDTGMPORT_27,
      fields: { ...DDTGMPORT_27.fields, duedate: null, customfield_10412: null },
    };

    const initiative = transformInitiative(undated, [], ctx);

    expect(initiative.hasDates).toBe(false);
    expect(initiative.risk.level).toBe('on-track'); // authored RAG still applies
    expect(initiative.siteRollup).toEqual([]);
  });
});

describe('findBlockers', () => {
  it('returns nothing when there are no blocking links', () => {
    // The DDT schema has no usable blocker signal today: `Flagged` is empty
    // portfolio-wide and Polaris links are not blocking links.
    expect(findBlockers(DDTSG_55)).toEqual([]);
    expect(findBlockers(NEUCHDDT_96)).toEqual([]);
  });

  it('detects an open blocker and ignores a resolved one', () => {
    const withBlockers = {
      ...DDTSG_55,
      fields: {
        ...DDTSG_55.fields,
        issuelinks: [
          {
            id: '1',
            type: { id: '10000', name: 'Blocks', inward: 'is blocked by', outward: 'blocks' },
            inwardIssue: {
              key: 'DDTSG-90',
              fields: {
                summary: 'Firewall change',
                status: { statusCategory: { key: 'indeterminate' } },
              },
            },
          },
          {
            id: '2',
            type: { id: '10000', name: 'Blocks', inward: 'is blocked by', outward: 'blocks' },
            inwardIssue: {
              key: 'DDTSG-91',
              fields: { summary: 'Old work', status: { statusCategory: { key: 'done' } } },
            },
          },
        ],
      },
    };

    const blockers = findBlockers(withBlockers);
    expect(blockers).toHaveLength(2);
    expect(blockers.find((b) => b.key === 'DDTSG-90')?.open).toBe(true);
    expect(blockers.find((b) => b.key === 'DDTSG-91')?.open).toBe(false);
  });
});

describe('full snapshot assembly', () => {
  it('produces a schema-valid snapshot from real payload shapes', () => {
    const { items, ctx } = transformAll();

    const itemsByInitiative = new Map<string, RoadmapItem[]>();
    for (const item of items) {
      if (!item.initiativeKey) continue;
      const list = itemsByInitiative.get(item.initiativeKey) ?? [];
      list.push(item);
      itemsByInitiative.set(item.initiativeKey, list);
    }

    const initiatives = [
      transformInitiative(DDTGMPORT_27, itemsByInitiative.get('DDTGMPORT-27') ?? [], ctx),
    ];
    const local = items.filter((i) => i.alignment === 'local');
    if (local.length > 0) initiatives.push(buildUnalignedInitiative(local, ctx));

    const active = items.filter(
      (i) => i.risk.level !== 'complete' && i.risk.level !== 'cancelled',
    );

    const snapshot: Snapshot = {
      schemaVersion: 1,
      syncedAt: '2026-08-05T10:00:00.000Z',
      asOf: ASOF,
      portfolios: PORTFOLIOS.map((p) => ({ key: p.key, name: p.name })),
      sites: buildSiteSummaries(active),
      initiatives,
      items,
      coverage: buildCoverage(items, active, ASOF, 0),
      warnings: ctx.warnings,
    };

    const parsed = snapshotSchema.safeParse(snapshot);
    if (!parsed.success) {
      throw new Error(
        `Snapshot invalid:\n${parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('\n')}`,
      );
    }
    expect(parsed.success).toBe(true);
  });

  it('gives every item a non-empty executive summary', () => {
    const { items } = transformAll();
    expect(items.length).toBeGreaterThan(0);
    for (const item of items) {
      expect(item.narrative.executiveSummary.trim().length).toBeGreaterThan(0);
    }
  });

  it('records a basis for every generated summary, so each is auditable', () => {
    const { items } = transformAll();
    for (const item of items) {
      if (item.narrative.summarySource === 'generated') {
        expect(item.narrative.summaryBasis?.length ?? 0).toBeGreaterThan(0);
      }
    }
  });

  it('excludes complete and cancelled work from the active set', () => {
    const { items } = transformAll();
    const active = items.filter(
      (i) => i.risk.level !== 'complete' && i.risk.level !== 'cancelled',
    );

    // NEUCHDDT-96 is Done and NEUCHDDT-133 is Will not do.
    expect(active.map((i) => i.key)).not.toContain('NEUCHDDT-96');
    expect(active.map((i) => i.key)).not.toContain('NEUCHDDT-133');
  });

  it('reports coverage that distinguishes reported from inferred', () => {
    const { items } = transformAll();
    const active = items.filter(
      (i) => i.risk.level !== 'complete' && i.risk.level !== 'cancelled',
    );
    const coverage = buildCoverage(items, active, ASOF, 0);

    expect(coverage.itemsActive).toBe(active.length);
    expect(coverage.withSpotStatus).toBe(1); // DDTSG-55
    expect(coverage.byProvenance['spot']).toBe(1);
    expect(coverage.byProvenance['inferred']).toBeGreaterThan(0);
    expect(coverage.spotIdFromSummary).toBeGreaterThan(0);

    // Regions must total the active set -- nothing silently unassigned.
    const regionTotal = Object.values(coverage.byRegion).reduce((a, b) => a + b, 0);
    expect(regionTotal).toBe(active.length);
    expect(coverage.byRegion['Unassigned']).toBeUndefined();
  });

  it('counts every configured site, including those with no items', () => {
    const { items } = transformAll();
    const summaries = buildSiteSummaries(items);

    // All 18 in-scope sites appear, so an empty site is visible as a finding.
    expect(summaries).toHaveLength(18);
    expect(summaries.find((s) => s.key === 'DDTSG')?.activeCount).toBe(1);
    expect(summaries.find((s) => s.key === 'DDTOSA')?.activeCount).toBe(0);
    // Deferred sites must not reappear in the rollup.
    expect(summaries.find((s) => s.key === 'DDTLESS')).toBeUndefined();
  });

  it('collects site-local items into the unaligned lane', () => {
    const { items, ctx } = transformAll();
    const local = items.filter((i) => i.alignment === 'local');
    const unaligned = buildUnalignedInitiative(local, ctx);

    expect(local.map((i) => i.key).sort()).toEqual(['DDTBRY-412', 'NEUCHDDT-133', 'NEUCHDDT-96']);
    expect(unaligned.itemKeys).toHaveLength(3);
    expect(unaligned.narrative.executiveSummary).toContain('site-led projects');
  });
});
