/**
 * A committed, schema-valid snapshot for UI development and regression testing.
 *
 * WHY THIS EXISTS
 * ---------------
 * The application reads only `data/snapshot.json`, which is gitignored and needs a
 * credentialled sync to produce. This fixture decouples UI work from ingestion
 * entirely: every screen can be built, reviewed and regression-tested with no feed
 * access, no credential and no governance sign-off. See
 * reference/plan-001-mvp-build.md.
 *
 * WHY IT LIVES IN src/ AND NOT tests/
 * -----------------------------------
 * `src/lib/snapshot.ts` falls back to it at runtime, so it is production code that
 * happens to contain sample data. `src/` must never import from `tests/`.
 *
 * TWO CLASSES OF CONTENT
 * ----------------------
 *   HAND-AUTHORED  items and initiatives -- chosen to exercise the cases that
 *                  break layouts, not to look tidy.
 *   DERIVED        `sites` and `coverage`, computed by the REAL functions from
 *                  src/lib/rollup.ts. This is deliberate: a hand-typed coverage
 *                  block would eventually contradict the items it describes, and
 *                  the UI would then display numbers that disagree with
 *                  verify-snapshot. Deriving them makes that impossible.
 *
 * Site metadata is likewise resolved through `resolveSite()` rather than typed
 * literally, so the fixture cannot contradict config/projects.ts or the region map.
 *
 * COUNTS ARE NOT PRODUCTION COUNTS. This is ~25 items across 6 sites; production
 * is 510 across 18. Where a real-world count matters to a branch, the comment says
 * so -- e.g. DDTYAR has 6 items here and 17 in production, but the branch under
 * test is `alignedCount === 0`, which is count-independent.
 */

import { buildCoverage, buildSiteRollup, buildSiteSummaries } from '@/lib/rollup.js';
import { PORTFOLIOS, resolveSite } from '@config/projects.js';
import {
  UNALIGNED_INITIATIVE_KEY,
  UNALIGNED_INITIATIVE_LABEL,
  type Initiative,
  type RoadmapItem,
  type Snapshot,
} from '@/types/domain.js';

const BASE_URL = 'https://onetakeda.atlassian.net';
const AS_OF = '2026-08-07';
const SYNCED_AT = '2026-08-07T14:00:00.000Z';

/** Site identity straight from config, so the fixture cannot drift from it. */
function site(key: string): Pick<
  RoadmapItem,
  'siteKey' | 'siteName' | 'siteCode' | 'region' | 'regionProvisional' | 'inCurrentPowerBiScope'
> {
  const resolved = resolveSite(key);
  if (!resolved) {
    throw new Error(`Fixture references ${key}, which is not in config/projects.ts.`);
  }
  return {
    siteKey: resolved.key,
    siteName: resolved.name,
    siteCode: resolved.code,
    region: resolved.region,
    regionProvisional: resolved.regionProvisional,
    inCurrentPowerBiScope: resolved.inCurrentPowerBiScope,
  };
}

interface ItemSeed {
  key: string;
  siteKey: string;
  title: string;
  raw?: string;
  spotId?: string;
  initiativeKey?: string;
  start?: string;
  end?: string;
  phase: RoadmapItem['status']['phase'];
  statusRaw: string;
  category: RoadmapItem['status']['category'];
  risk: RoadmapItem['risk'];
  narrative: RoadmapItem['narrative'];
  owners?: RoadmapItem['owners'];
  blockers?: RoadmapItem['blockers'];
  fiscalYears?: string[];
  updatedAt: string;
  daysSinceUpdate: number;
  childCount?: { total: number; done: number };
}

function item(seed: ItemSeed): RoadmapItem {
  const goLive = seed.end;
  return {
    key: seed.key,
    summary: {
      cleanTitle: seed.title,
      raw: seed.raw ?? seed.title,
      ...(seed.spotId ? { spotId: seed.spotId } : {}),
    },
    ...site(seed.siteKey),
    issueTypeName: 'Epic',
    ...(seed.initiativeKey ? { initiativeKey: seed.initiativeKey } : {}),
    alignment: seed.initiativeKey ? 'initiative' : 'local',
    status: { raw: seed.statusRaw, phase: seed.phase, category: seed.category },
    ...(seed.start ? { start: seed.start } : {}),
    ...(seed.end ? { end: seed.end } : {}),
    ...(goLive ? { goLive } : {}),
    fiscalYears: seed.fiscalYears ?? [],
    risk: seed.risk,
    narrative: seed.narrative,
    owners: seed.owners ?? [],
    ...(seed.spotId
      ? { spotId: seed.spotId, spotIdSource: 'summary' as const, spotUrl: `https://tospot.azurewebsites.net/project-hub?projectId=${seed.spotId}` }
      : {}),
    updatedAt: seed.updatedAt,
    daysSinceUpdate: seed.daysSinceUpdate,
    blockers: seed.blockers ?? [],
    childCount: seed.childCount ?? { total: 0, done: 0 },
    jiraUrl: `${BASE_URL}/browse/${seed.key}`,
  };
}

// ---------------------------------------------------------------------------
// Risk shorthands. Authored levels carry `authored`; derived ones carry reasons.
// ---------------------------------------------------------------------------

const onTrackSpot = (fieldId: string): RoadmapItem['risk'] => ({
  level: 'on-track',
  provenance: 'spot',
  atRisk: false,
  reasons: [{ code: 'no-immediate-action', label: 'No Immediate Action Required', detail: 'Site reports Green.' }],
  authored: { value: 'Green', fieldId, sourceLabel: 'Overall Status (SPOT)', asOf: '2026-08-04T08:00:00.000Z' },
  score: 5,
});

const unreported: RoadmapItem['risk'] = {
  level: 'unreported',
  provenance: 'none',
  atRisk: false,
  reasons: [],
  score: 0,
};

// ---------------------------------------------------------------------------
// Items -- each group annotated with the layout case it exists to exercise.
// ---------------------------------------------------------------------------

const ITEMS: RoadmapItem[] = [
  // --- Overdue, site-authored Red, full SPOT narrative. The Project drill-down's
  //     richest case: authored RAG + multiple reasons + narrative + provenance.
  item({
    key: 'DDTTO-41',
    siteKey: 'DDTTO',
    title: 'MES Filling Line',
    raw: 'TO MES Filling Line - SPOT 1039506',
    spotId: '1039506',
    initiativeKey: 'DDTGMPORT-12',
    start: '2024-10-01',
    end: '2026-03-31',
    fiscalYears: ['FY24', 'FY25', 'FY26'],
    phase: 'execute',
    statusRaw: 'Execute',
    category: 'in-progress',
    risk: {
      level: 'attention',
      provenance: 'spot',
      atRisk: true,
      reasons: [
        { code: 'delayed-milestone', label: 'Delayed Milestone', detail: 'Go-live was 31 Mar 2026, 129 days ago.' },
        { code: 'reporting-gap', label: 'Reporting Gap', detail: 'No update in Jira for 94 days.' },
      ],
      authored: { value: 'Red', fieldId: 'customfield_24272', sourceLabel: 'Overall Status (SPOT, Thousand Oaks)', asOf: '2026-05-05T09:00:00.000Z' },
      score: 88,
    },
    narrative: {
      phase: 'Execute',
      state: 'Active',
      statusDescription:
        '27/07/2026: confirming next waves\n21/05/2026: The Automation folder was migrated to SharePoint\n16/12/25: MANOPS and Automation are preparing for the migration.',
      recentAccomplishments: 'Pilot migration wave is complete\nFollow-up meetings with MANOPS P1 and Automation completed',
      nextPriorities: 'MAN Ops P1, Engineering folder and EHS folder would be next to be migrated',
      sourceUrl: 'https://tospot.azurewebsites.net/project-hub/8260bc2f-bf42-4f44-b980-77fe36fbef60',
      executiveSummary: 'Go-live passed 129 days ago and the site reports Red. No Jira update for 94 days.',
      summarySource: 'spot',
    },
    owners: [
      { role: 'IT Lead', name: 'A. Patel' },
      { role: 'Business Owner', name: 'M. Okafor' },
    ],
    updatedAt: '2026-05-05T09:00:00.000Z',
    daysSinceUpdate: 94,
    childCount: { total: 7, done: 3 },
  }),

  item({
    key: 'DDTTO-52',
    siteKey: 'DDTTO',
    title: 'MES Adynovate DS',
    initiativeKey: 'DDTGMPORT-12',
    start: '2026-04-01',
    end: '2027-03-31',
    fiscalYears: ['FY26'],
    phase: 'plan',
    statusRaw: 'Plan',
    category: 'todo',
    risk: {
      level: 'monitor',
      provenance: 'reported',
      atRisk: true,
      reasons: [{ code: 'schedule-risk', label: 'Schedule Risk', detail: 'Still in Plan with go-live 31 Mar 2027.' }],
      authored: { value: 'Amber', fieldId: 'customfield_24272', sourceLabel: 'Overall Status (SPOT, Thousand Oaks)', asOf: '2026-08-01T10:00:00.000Z' },
      score: 42,
    },
    narrative: { executiveSummary: 'In planning; site reports Amber.', summarySource: 'generated', summaryBasis: ['phase=plan', 'authoredRag=Amber'] },
    updatedAt: '2026-08-01T10:00:00.000Z',
    daysSinceUpdate: 6,
  }),

  // --- COMPLETE. Must render as delivered and must NOT appear in active counts.
  item({
    key: 'DDTTO-63',
    siteKey: 'DDTTO',
    title: 'MES Elaprase DS',
    raw: 'TO MES Elaprase DS - SPOT 1024096',
    spotId: '1024096',
    initiativeKey: 'DDTGMPORT-12',
    start: '2020-04-01',
    end: '2026-06-30',
    fiscalYears: ['FY20', 'FY21', 'FY22', 'FY23', 'FY24', 'FY25', 'FY26'],
    phase: 'complete',
    statusRaw: 'Done',
    category: 'done',
    risk: { level: 'complete', provenance: 'reported', atRisk: false, reasons: [], score: 0 },
    narrative: { executiveSummary: 'Delivered 30 Jun 2026.', summarySource: 'generated', summaryBasis: ['phase=complete'] },
    updatedAt: '2026-07-01T09:00:00.000Z',
    daysSinceUpdate: 37,
  }),

  // --- LONG SUMMARY (183 chars) + FIVE OWNERS. Breaks row height and label
  //     truncation in the timeline row label and the attention list.
  item({
    key: 'DDTMBO-77',
    siteKey: 'DDTMBO',
    title:
      'Knowledge Management at MBO including SharePoint migration of MANOPS, Automation, Engineering and EHS shared drives with retention policy remediation and downstream reporting rework',
    raw: '1054576 - 400SW - DDT - Knowledge Management at MBO',
    spotId: '1054576',
    initiativeKey: 'DDTGMPORT-12',
    start: '2025-01-01',
    end: '2027-09-30',
    fiscalYears: ['FY24', 'FY25', 'FY26', 'FY27'],
    phase: 'execute',
    statusRaw: 'Execute',
    category: 'in-progress',
    risk: onTrackSpot('customfield_24270'),
    narrative: {
      phase: 'Execute',
      state: 'Active',
      statusDescription: '04/08/2026: Wave 3 complete, wave 4 scheduled.',
      executiveSummary: 'Wave 3 complete; wave 4 scheduled. Site reports Green.',
      summarySource: 'spot',
    },
    owners: [
      { role: 'Digital Delivery Lead', name: 'S. Iyer' },
      { role: 'IT Lead', name: 'D. Novak' },
      { role: 'Business Owner', name: 'R. Kowalski' },
      { role: 'Validation Lead', name: 'T. Nakamura' },
      { role: 'Sponsor', name: 'L. Fernandez' },
    ],
    updatedAt: '2026-08-04T11:00:00.000Z',
    daysSinceUpdate: 3,
  }),

  // --- CANCELLED. Shares the grey token with `unreported`, so the glyph and hatch
  //     are the only things stopping it reading as delivered.
  item({
    key: 'DDTMBO-81',
    siteKey: 'DDTMBO',
    title: 'AGILE Digital Tier Boards',
    raw: '1052161 - MBO - AGILE - Digital Tier Boards',
    spotId: '1052161',
    initiativeKey: 'DDTGMPORT-12',
    start: '2025-04-01',
    end: '2026-06-30',
    fiscalYears: ['FY25', 'FY26'],
    phase: 'cancelled',
    statusRaw: 'Discarded',
    category: 'done',
    risk: { level: 'cancelled', provenance: 'reported', atRisk: false, reasons: [], score: 0 },
    narrative: { executiveSummary: 'Cancelled.', summarySource: 'generated', summaryBasis: ['phase=cancelled'] },
    updatedAt: '2026-06-12T09:00:00.000Z',
    daysSinceUpdate: 56,
  }),

  // --- NO DATES AT ALL. Cannot be plotted; belongs in the named no-dates group.
  item({
    key: 'DDTMBO-90',
    siteKey: 'DDTMBO',
    title: 'SmartQC',
    raw: '1053262 - 300SW - QUAL - SmartQC',
    spotId: '1053262',
    initiativeKey: 'DDTGMPORT-12',
    phase: 'demand',
    statusRaw: 'Demand',
    category: 'todo',
    risk: unreported,
    narrative: { executiveSummary: 'No status reported and no dates in Jira.', summarySource: 'generated', summaryBasis: ['phase=demand'] },
    updatedAt: '2026-02-02T09:00:00.000Z',
    daysSinceUpdate: 186,
  }),

  // --- SEVEN-YEAR SPAN. Exercises domain clamping: without it, this one item
  //     compresses every other bar in the view.
  item({
    key: 'DDTGC-101',
    siteKey: 'DDTGC',
    title: 'Lab of the Future programme rollout',
    initiativeKey: 'DDTGMPORT-4',
    start: '2023-04-01',
    end: '2030-03-31',
    fiscalYears: ['FY23', 'FY24', 'FY25', 'FY26', 'FY27', 'FY28', 'FY29'],
    phase: 'execute',
    statusRaw: 'Execute',
    category: 'in-progress',
    risk: onTrackSpot('customfield_24262'),
    narrative: { executiveSummary: 'Multi-year programme tracking to plan.', summarySource: 'spot', statusDescription: '01/08/2026: On plan.' },
    updatedAt: '2026-08-01T09:00:00.000Z',
    daysSinceUpdate: 6,
  }),

  // --- ONE-DAY SPAN (start === end). Exercises the minimum bar width.
  item({
    key: 'DDTGC-115',
    siteKey: 'DDTGC',
    title: 'SIMCA local to global server cutover',
    initiativeKey: 'DDTGMPORT-4',
    start: '2026-09-15',
    end: '2026-09-15',
    fiscalYears: ['FY26'],
    phase: 'plan',
    statusRaw: 'Define',
    category: 'todo',
    risk: {
      level: 'monitor',
      provenance: 'inferred',
      atRisk: true,
      reasons: [{ code: 'go-live-risk', label: 'Go-Live Risk', detail: 'Go-live in 39 days and not yet started.' }],
      score: 55,
    },
    narrative: { executiveSummary: 'Single-day cutover in 39 days; not yet started.', summarySource: 'generated', summaryBasis: ['goLive=2026-09-15', 'phase=plan'] },
    updatedAt: '2026-07-20T09:00:00.000Z',
    daysSinceUpdate: 18,
  }),

  // --- BLOCKED with an open blocker. The only risk level sourced from links.
  item({
    key: 'DDTGC-120',
    siteKey: 'DDTGC',
    title: 'MBR Migration from legacy Syncade',
    initiativeKey: 'DDTGMPORT-12',
    start: '2026-01-01',
    end: '2026-12-31',
    fiscalYears: ['FY25', 'FY26'],
    phase: 'execute',
    statusRaw: 'Execute',
    category: 'in-progress',
    risk: {
      level: 'blocked',
      provenance: 'inferred',
      atRisk: true,
      reasons: [{ code: 'dependency-risk', label: 'Dependency Risk', detail: 'Blocked by DDTGC-118, which is still open.' }],
      score: 76,
    },
    narrative: { executiveSummary: 'Blocked by an open dependency (DDTGC-118).', summarySource: 'generated', summaryBasis: ['blockers=1'] },
    blockers: [{ key: 'DDTGC-118', summary: 'Syncade licence renewal', type: 'is blocked by', open: true }],
    updatedAt: '2026-07-28T09:00:00.000Z',
    daysSinceUpdate: 10,
  }),

  // --- THREE GO-LIVES IN ONE QUARTER AT ONE SITE. Collides into a single
  //     milestone marker carrying a count badge, on the MES lane at GRA.
  item({
    key: 'DDTGC-131',
    siteKey: 'DDTGC',
    title: 'MES interface hardening',
    initiativeKey: 'DDTGMPORT-12',
    start: '2026-04-01',
    end: '2026-11-10',
    fiscalYears: ['FY26'],
    phase: 'execute',
    statusRaw: 'Execute',
    category: 'in-progress',
    risk: onTrackSpot('customfield_24262'),
    narrative: { executiveSummary: 'Tracking to a November go-live.', summarySource: 'generated', summaryBasis: ['goLive=2026-11-10'] },
    updatedAt: '2026-08-05T09:00:00.000Z',
    daysSinceUpdate: 2,
  }),
  item({
    key: 'DDTGC-132',
    siteKey: 'DDTGC',
    title: 'MES weighing operations',
    initiativeKey: 'DDTGMPORT-12',
    start: '2026-05-01',
    end: '2026-11-24',
    fiscalYears: ['FY26'],
    phase: 'execute',
    statusRaw: 'Execute',
    category: 'in-progress',
    risk: {
      level: 'monitor',
      provenance: 'reported',
      atRisk: true,
      reasons: [{ code: 'schedule-risk', label: 'Schedule Risk', detail: 'Site reports Amber against a November go-live.' }],
      authored: { value: 'Amber', fieldId: 'customfield_24262', sourceLabel: 'Overall Status (SPOT, Grange Castle)', asOf: '2026-08-05T09:00:00.000Z' },
      score: 48,
    },
    narrative: { executiveSummary: 'Site reports Amber against a November go-live.', summarySource: 'generated', summaryBasis: ['authoredRag=Amber'] },
    updatedAt: '2026-08-05T09:00:00.000Z',
    daysSinceUpdate: 2,
  }),
  item({
    key: 'DDTGC-133',
    siteKey: 'DDTGC',
    title: 'eLogbook integration in production',
    initiativeKey: 'DDTGMPORT-12',
    start: '2026-06-01',
    end: '2026-12-08',
    fiscalYears: ['FY26'],
    phase: 'execute',
    statusRaw: 'In Review',
    category: 'in-progress',
    risk: unreported,
    narrative: { executiveSummary: 'No status reported; go-live 8 Dec 2026.', summarySource: 'jira-description', summaryBasis: undefined },
    updatedAt: '2026-06-30T09:00:00.000Z',
    daysSinceUpdate: 38,
  }),

  // --- Phoenix items. DDTHIK-38 is the item ADR-001 cites as appearing on the
  //     OUTWARD side of its Polaris link, which is why matching is undirected.
  item({
    key: 'DDTHIK-38',
    siteKey: 'DDTHIK',
    title: 'PAS-X Next Gen Migration',
    initiativeKey: 'DDTGMPORT-27',
    start: '2025-10-01',
    end: '2027-03-31',
    fiscalYears: ['FY25', 'FY26'],
    phase: 'execute',
    statusRaw: 'Execute',
    category: 'in-progress',
    risk: onTrackSpot('customfield_23822'),
    narrative: { executiveSummary: 'Migration on plan; site reports Green.', summarySource: 'spot', statusDescription: '02/08/2026: Wave 2 signed off.' },
    updatedAt: '2026-08-02T09:00:00.000Z',
    daysSinceUpdate: 5,
  }),

  // --- GO-LIVE ONLY, NO START. Renders as a milestone diamond with no bar.
  item({
    key: 'DDTHIK-44',
    siteKey: 'DDTHIK',
    title: 'PAS-X upgrade — MES hardware',
    initiativeKey: 'DDTGMPORT-27',
    end: '2026-10-30',
    fiscalYears: ['FY26'],
    phase: 'plan',
    statusRaw: 'Assessment',
    category: 'todo',
    risk: {
      level: 'attention',
      provenance: 'inferred',
      atRisk: true,
      reasons: [
        { code: 'go-live-risk', label: 'Go-Live Risk', detail: 'Go-live in 84 days with no start date recorded.' },
        { code: 'reporting-gap', label: 'Reporting Gap', detail: 'No update in Jira for 121 days.' },
      ],
      score: 71,
    },
    narrative: { executiveSummary: 'Go-live in 84 days, no start date and no update for 121 days.', summarySource: 'generated', summaryBasis: ['goLive=2026-10-30', 'daysSinceUpdate=121'] },
    updatedAt: '2026-04-08T09:00:00.000Z',
    daysSinceUpdate: 121,
  }),

  item({
    key: 'DDTSG-55',
    siteKey: 'DDTSG',
    title: 'Project Phoenix Singapore',
    raw: 'SGP Project Phoenix - SPOT 1056412',
    spotId: '1056412',
    initiativeKey: 'DDTGMPORT-27',
    start: '2025-04-01',
    end: '2026-09-30',
    fiscalYears: ['FY25', 'FY26'],
    phase: 'closeout',
    statusRaw: 'Closeout',
    category: 'in-progress',
    risk: onTrackSpot('customfield_24266'),
    narrative: {
      phase: 'Closeout',
      state: 'Active',
      statusDescription: '06/08/2026: PMC endorsed closeout 18Jun26; hypercare exit pending.',
      recentAccomplishments: 'Go-live completed, hypercare in progress',
      nextPriorities: 'Hypercare exit and benefits realisation review',
      executiveSummary: 'In closeout; hypercare exit pending. Site reports Green.',
      summarySource: 'spot',
    },
    updatedAt: '2026-08-06T09:00:00.000Z',
    daysSinceUpdate: 1,
  }),

  item({
    key: 'DDTSG-60',
    siteKey: 'DDTSG',
    title: 'SAIL Singapore rollout',
    initiativeKey: 'DDTGMPORT-4',
    start: '2026-07-01',
    end: '2028-03-31',
    fiscalYears: ['FY26', 'FY27'],
    phase: 'initiate',
    statusRaw: 'Initiate',
    category: 'todo',
    risk: unreported,
    narrative: { executiveSummary: 'Recently initiated; no status reported yet.', summarySource: 'generated', summaryBasis: ['phase=initiate'] },
    updatedAt: '2026-07-15T09:00:00.000Z',
    daysSinceUpdate: 23,
  }),

  // --- DDTYAR: EVERY item is site-led. The branch under test is
  //     `alignedCount === 0`, which must render an explanatory banner rather than
  //     an empty state. Production has 17 items; six is enough to exercise it.
  item({
    key: 'DDTYAR-1',
    siteKey: 'DDTYAR',
    title: 'OT network segmentation',
    start: '2026-04-01',
    end: '2026-11-30',
    fiscalYears: ['FY26'],
    phase: 'execute',
    statusRaw: 'Execute',
    category: 'in-progress',
    risk: onTrackSpot('customfield_25432'),
    narrative: { executiveSummary: 'Segmentation on plan; site reports Green.', summarySource: 'generated', summaryBasis: ['authoredRag=Green'] },
    updatedAt: '2026-08-03T09:00:00.000Z',
    daysSinceUpdate: 4,
  }),
  item({
    key: 'DDTYAR-2',
    siteKey: 'DDTYAR',
    title: 'SAP interface optimisation',
    start: '2026-06-01',
    end: '2027-06-30',
    fiscalYears: ['FY26', 'FY27'],
    phase: 'execute',
    statusRaw: 'Execute',
    category: 'in-progress',
    risk: {
      level: 'monitor',
      provenance: 'reported',
      atRisk: true,
      reasons: [{ code: 'schedule-risk', label: 'Schedule Risk', detail: 'Site reports Amber.' }],
      authored: { value: 'Amber', fieldId: 'customfield_25432', sourceLabel: 'Overall Status (SPOT, Yaroslavl)', asOf: '2026-08-03T09:00:00.000Z' },
      score: 45,
    },
    narrative: { executiveSummary: 'Site reports Amber; interface scope still moving.', summarySource: 'generated', summaryBasis: ['authoredRag=Amber'] },
    updatedAt: '2026-08-03T09:00:00.000Z',
    daysSinceUpdate: 4,
  }),
  item({
    key: 'DDTYAR-3',
    siteKey: 'DDTYAR',
    title: 'Warehouse scanning refresh',
    start: '2026-09-01',
    end: '2027-02-28',
    fiscalYears: ['FY26'],
    phase: 'plan',
    statusRaw: 'Plan',
    category: 'todo',
    risk: unreported,
    narrative: { executiveSummary: 'No status reported.', summarySource: 'generated', summaryBasis: ['phase=plan'] },
    updatedAt: '2026-07-10T09:00:00.000Z',
    daysSinceUpdate: 28,
  }),
  item({
    key: 'DDTYAR-4',
    siteKey: 'DDTYAR',
    title: 'Label printing consolidation',
    start: '2026-05-01',
    end: '2026-10-15',
    fiscalYears: ['FY26'],
    phase: 'execute',
    statusRaw: 'Execute',
    category: 'in-progress',
    risk: onTrackSpot('customfield_25432'),
    narrative: { executiveSummary: 'On plan for an October go-live.', summarySource: 'generated', summaryBasis: ['goLive=2026-10-15'] },
    updatedAt: '2026-08-01T09:00:00.000Z',
    daysSinceUpdate: 6,
  }),
  item({
    key: 'DDTYAR-5',
    siteKey: 'DDTYAR',
    title: 'Quality deviation workflow digitisation',
    start: '2026-02-01',
    end: '2026-08-31',
    fiscalYears: ['FY25', 'FY26'],
    phase: 'closeout',
    statusRaw: 'Closeout',
    category: 'in-progress',
    risk: onTrackSpot('customfield_25432'),
    narrative: { executiveSummary: 'Entering closeout ahead of the August go-live.', summarySource: 'generated', summaryBasis: ['phase=closeout'] },
    updatedAt: '2026-08-05T09:00:00.000Z',
    daysSinceUpdate: 2,
  }),
  item({
    key: 'DDTYAR-6',
    siteKey: 'DDTYAR',
    title: 'Legacy historian decommission',
    phase: 'demand',
    statusRaw: 'Open',
    category: 'todo',
    risk: unreported,
    narrative: { executiveSummary: 'Demand only; no dates and no status reported.', summarySource: 'generated', summaryBasis: ['phase=demand'] },
    updatedAt: '2026-03-01T09:00:00.000Z',
    daysSinceUpdate: 159,
  }),

  // --- Site-led work at a site that ALSO has aligned work, so the site view has
  //     both an initiative group and a site-led group (reference-report parity).
  item({
    key: 'DDTMBO-95',
    siteKey: 'DDTMBO',
    title: 'NinjaOne rollout (Tanium replacement)',
    raw: 'MBO CIM - NinjaOne Rollout (Tanium Replacement)',
    start: '2026-04-01',
    end: '2026-10-31',
    fiscalYears: ['FY26'],
    phase: 'execute',
    statusRaw: 'Execute',
    category: 'in-progress',
    risk: onTrackSpot('customfield_24270'),
    narrative: { executiveSummary: 'Rollout on plan; site reports Green.', summarySource: 'generated', summaryBasis: ['authoredRag=Green'] },
    updatedAt: '2026-08-04T09:00:00.000Z',
    daysSinceUpdate: 3,
  }),
  item({
    key: 'DDTGC-140',
    siteKey: 'DDTGC',
    title: 'Site file share retention remediation',
    start: '2026-01-15',
    end: '2026-07-31',
    fiscalYears: ['FY25', 'FY26'],
    phase: 'execute',
    statusRaw: 'Execute',
    category: 'in-progress',
    risk: {
      level: 'attention',
      provenance: 'inferred',
      atRisk: true,
      reasons: [{ code: 'delayed-milestone', label: 'Delayed Milestone', detail: 'Go-live was 31 Jul 2026, 7 days ago.' }],
      score: 62,
    },
    narrative: { executiveSummary: 'Go-live passed 7 days ago with no status reported.', summarySource: 'generated', summaryBasis: ['goLive=2026-07-31'] },
    updatedAt: '2026-07-25T09:00:00.000Z',
    daysSinceUpdate: 13,
  }),
  item({
    key: 'DDTSG-71',
    siteKey: 'DDTSG',
    title: 'Meeting room AV standardisation',
    start: '2026-08-01',
    end: '2026-12-15',
    fiscalYears: ['FY26'],
    phase: 'initiate',
    statusRaw: 'Initiate',
    category: 'todo',
    risk: unreported,
    narrative: { executiveSummary: 'Just initiated; no status reported.', summarySource: 'generated', summaryBasis: ['phase=initiate'] },
    updatedAt: '2026-08-01T09:00:00.000Z',
    daysSinceUpdate: 6,
  }),
];

// ---------------------------------------------------------------------------
// Initiatives
// ---------------------------------------------------------------------------

const ACTIVE_ITEMS = ITEMS.filter((i) => i.risk.level !== 'complete' && i.risk.level !== 'cancelled');

function itemsFor(initiativeKey: string): RoadmapItem[] {
  return ITEMS.filter((i) => i.initiativeKey === initiativeKey);
}

function initiative(
  key: string,
  summary: string,
  opts: {
    start?: string;
    end?: string;
    datesDerived: boolean;
    risk: Initiative['risk'];
    statusRaw: string;
    phase: Initiative['status']['phase'];
    category: Initiative['status']['category'];
    description?: string;
    authoredRag?: string;
  },
): Initiative {
  const linked = itemsFor(key);
  // Every initiative's RAG is `inferred` -- no feed exposes customfield_11199, so
  // initiative status is rolled up from linked items. The UI must say so.
  return {
    key,
    portfolioKey: PORTFOLIOS[0]!.key,
    summary,
    ...(opts.description ? { description: opts.description } : {}),
    status: { raw: opts.statusRaw, phase: opts.phase, category: opts.category },
    ...(opts.start ? { start: opts.start } : {}),
    ...(opts.end ? { end: opts.end } : {}),
    datesDerived: opts.datesDerived,
    hasDates: Boolean(opts.start && opts.end),
    ...(opts.authoredRag ? { authoredRag: opts.authoredRag } : {}),
    risk: opts.risk,
    narrative: {
      executiveSummary: `${linked.length} projects across ${new Set(linked.map((i) => i.siteKey)).size} sites.`,
      summarySource: 'generated',
      summaryBasis: [`itemCount=${linked.length}`],
    },
    itemKeys: linked.map((i) => i.key),
    siteRollup: buildSiteRollup(linked),
    owners: [],
    updatedAt: '2026-08-06T09:00:00.000Z',
    jiraUrl: `${BASE_URL}/browse/${key}`,
  };
}

const INITIATIVES: Initiative[] = [
  initiative('DDTGMPORT-12', 'MES', {
    start: '2020-04-01',
    end: '2027-09-30',
    datesDerived: true,
    statusRaw: 'Execute',
    phase: 'execute',
    category: 'in-progress',
    description: 'Manufacturing Execution System deployment across the network.',
    risk: {
      level: 'attention',
      provenance: 'inferred',
      atRisk: true,
      reasons: [{ code: 'delayed-milestone', label: 'Delayed Milestone', detail: '1 of 9 projects is overdue by more than 90 days.' }],
      score: 88,
    },
  }),
  initiative('DDTGMPORT-27', 'CIM — Project Phoenix', {
    start: '2025-04-01',
    end: '2027-03-31',
    datesDerived: true,
    statusRaw: 'Execute',
    phase: 'execute',
    category: 'in-progress',
    risk: {
      level: 'attention',
      provenance: 'inferred',
      atRisk: true,
      reasons: [{ code: 'go-live-risk', label: 'Go-Live Risk', detail: '1 of 3 projects has a go-live within 90 days and no start date.' }],
      score: 71,
    },
  }),
  initiative('DDTGMPORT-4', 'SAIL', {
    start: '2023-04-01',
    end: '2030-03-31',
    datesDerived: true,
    statusRaw: 'Execute',
    phase: 'execute',
    category: 'in-progress',
    risk: {
      level: 'monitor',
      provenance: 'inferred',
      atRisk: true,
      reasons: [{ code: 'go-live-risk', label: 'Go-Live Risk', detail: '1 of 3 projects has a near-term go-live and has not started.' }],
      score: 55,
    },
  }),

  // --- NO DATES. The reference report renders these as silently empty lanes; we
  //     name them. Has no linked items either, which is the real-world reason.
  initiative('DDTGMPORT-31', 'MetrIQ', {
    datesDerived: false,
    statusRaw: 'Demand',
    phase: 'demand',
    category: 'todo',
    risk: { level: 'unreported', provenance: 'none', atRisk: false, reasons: [], score: 0 },
  }),

  // --- The single shared site-local lane. Approved to stay shared through the
  //     source migration; per-site lanes are deferred until after it.
  {
    key: UNALIGNED_INITIATIVE_KEY,
    portfolioKey: '',
    summary: UNALIGNED_INITIATIVE_LABEL,
    description:
      'Site-led work delivered outside the global portfolio programmes. These items have no ' +
      'Polaris work item link to a DDTGMPORT Initiative, which is an expected delivery model ' +
      'rather than missing data.',
    status: { raw: 'n/a', phase: 'execute', category: 'in-progress' },
    start: '2026-01-15',
    end: '2027-06-30',
    datesDerived: true,
    hasDates: true,
    risk: {
      level: 'attention',
      provenance: 'inferred',
      atRisk: true,
      reasons: [{ code: 'delayed-milestone', label: 'Delayed Milestone', detail: '1 of 9 site-led projects is overdue.' }],
      score: 62,
    },
    narrative: {
      executiveSummary: '9 site-led projects across 4 sites, delivered outside the global portfolio programmes.',
      summarySource: 'generated',
      summaryBasis: ['itemCount=9', 'siteCount=4'],
    },
    itemKeys: ITEMS.filter((i) => i.alignment === 'local').map((i) => i.key),
    siteRollup: buildSiteRollup(ITEMS.filter((i) => i.alignment === 'local')),
    owners: [],
    updatedAt: `${AS_OF}T00:00:00.000Z`,
    jiraUrl: '',
  },
];

// ---------------------------------------------------------------------------
// The snapshot. `sites` and `coverage` are DERIVED by the real rollup functions
// so they can never contradict the items above.
// ---------------------------------------------------------------------------

export const FIXTURE_SNAPSHOT: Snapshot = {
  schemaVersion: 1,
  syncedAt: SYNCED_AT,
  asOf: AS_OF,
  portfolios: PORTFOLIOS.map((p) => ({ key: p.key, name: p.name })),
  sites: buildSiteSummaries(ACTIVE_ITEMS),
  initiatives: INITIATIVES,
  items: ITEMS,
  coverage: buildCoverage(ITEMS, ACTIVE_ITEMS, AS_OF, 0),
  warnings: [
    'DDTGC-133 has an unmapped status "In Review"; fell back to statusCategory -> "execute". Add it to config/status-map.ts.',
    'DDTYAR-6 has no authored status and no dates; a derived signal was used.',
    'Fixture data — not a real sync. See src/fixtures/snapshot.fixture.ts.',
  ],
};

/**
 * A one-item variant for the provisional-region disclosure.
 *
 * SYNTHETIC BY NECESSITY: `PROVISIONAL_REGION_MAP` in config/regions.ts is empty
 * under the 19-project MVP scope, so no in-scope site can currently produce
 * `regionProvisional: true`. The UI must still disclose it, because restoring any
 * deferred site would reintroduce the state. Kept out of FIXTURE_SNAPSHOT so the
 * main dataset stays faithful to config.
 */
export const PROVISIONAL_REGION_ITEM: RoadmapItem = {
  ...ITEMS[0]!,
  key: 'DDTLESS-96',
  siteKey: 'DDTLESS',
  siteName: 'Lessines',
  siteCode: 'LES',
  region: 'Europe',
  regionProvisional: true,
  inCurrentPowerBiScope: false,
};
