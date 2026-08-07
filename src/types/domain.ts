/**
 * The domain model and its Zod schemas.
 *
 * Zod is the contract at the sync/read boundary: the sync validates before
 * writing and the loader validates after reading. A snapshot that does not parse
 * is never served, so a malformed sync fails loudly at write time instead of
 * producing a plausible-looking but wrong executive dashboard.
 */

import { z } from 'zod';
import { CANONICAL_PHASES } from '@config/status-map.js';
import { REASON_CODES, RISK_LEVELS } from '@config/narrative.js';
import { REGIONS, UNASSIGNED_REGION } from '@config/regions.js';

// ---------------------------------------------------------------------------
// Primitives
// ---------------------------------------------------------------------------

/** Calendar date, `YYYY-MM-DD`. Deliberately not a Date: snapshots are JSON, and
 *  Jira date fields are date-only with no meaningful timezone. */
export const isoDateSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'expected YYYY-MM-DD');

/** Full timestamp, as Jira returns for `updated`/`created`. */
export const isoTimestampSchema = z.string().min(10);

export const riskLevelSchema = z.enum(RISK_LEVELS);
export const reasonCodeSchema = z.enum(REASON_CODES);
export const canonicalPhaseSchema = z.enum(CANONICAL_PHASES);
export const riskProvenanceSchema = z.enum(['spot', 'reported', 'inferred', 'none']);
export const summarySourceSchema = z.enum(['spot', 'jira-description', 'generated']);
export const regionSchema = z.enum([...REGIONS, UNASSIGNED_REGION]);
export const statusCategorySchema = z.enum(['todo', 'in-progress', 'done']);
export const alignmentSchema = z.enum(['initiative', 'local']);

// ---------------------------------------------------------------------------
// Risk
// ---------------------------------------------------------------------------

export const riskReasonSchema = z.object({
  code: reasonCodeSchema,
  /** Executive label from config/narrative.ts. */
  label: z.string(),
  /** The specific fact behind it, e.g. "Go-live was 31 Mar 2026, 127 days ago". */
  detail: z.string(),
});

export const authoredRagSchema = z.object({
  /** Raw value as stored, e.g. "Green". */
  value: z.string(),
  /** Field it came from, for auditability. */
  fieldId: z.string(),
  /** Human label for that field, e.g. "Overall Status (SPOT)". */
  sourceLabel: z.string(),
  /** When the issue was last updated -- the closest available proxy for when the
   *  status was authored, since Jira does not expose per-field timestamps. */
  asOf: isoTimestampSchema.optional(),
});

export const riskAssessmentSchema = z.object({
  level: riskLevelSchema,
  provenance: riskProvenanceSchema,
  /** Drives the binary At Risk / Not At Risk filter preserved from the report. */
  atRisk: z.boolean(),
  reasons: z.array(riskReasonSchema),
  authored: authoredRagSchema.optional(),
  /** 0-100. Orders the attention list. NOT shown as a number to executives --
   *  a false-precision score invites arguments about the arithmetic. */
  score: z.number().min(0).max(100),
});

// ---------------------------------------------------------------------------
// Narrative
// ---------------------------------------------------------------------------

export const narrativeSchema = z.object({
  /** SPOT-authored fields, present only when customfield_24265 exists. */
  phase: z.string().optional(),
  state: z.string().optional(),
  statusDescription: z.string().optional(),
  recentAccomplishments: z.string().optional(),
  nextPriorities: z.string().optional(),
  sourceUrl: z.string().optional(),
  sourceUpdatedAt: isoTimestampSchema.optional(),

  /** The summary actually displayed. Never empty. */
  executiveSummary: z.string().min(1),
  summarySource: summarySourceSchema,
  /** Facts the generated summary was composed from, so any sentence can be
   *  traced back to data. Populated only when summarySource === 'generated'. */
  summaryBasis: z.array(z.string()).optional(),
});

// ---------------------------------------------------------------------------
// Summary taxonomy
// ---------------------------------------------------------------------------

export const parsedSummarySchema = z.object({
  /** Human title with taxonomy tokens stripped. Falls back to `raw`. */
  cleanTitle: z.string().min(1),
  spotId: z.string().optional(),
  fyTag: z.string().optional(),
  functionCode: z.string().optional(),
  sitePrefix: z.string().optional(),
  /** Unmodified Jira summary. */
  raw: z.string(),
});

// ---------------------------------------------------------------------------
// Roadmap item (a hierarchy-level-1 issue in a site project)
// ---------------------------------------------------------------------------

export const ownerSchema = z.object({
  role: z.string(),
  name: z.string(),
});

export const blockerSchema = z.object({
  key: z.string(),
  summary: z.string(),
  /** Link description, e.g. "is blocked by". */
  type: z.string(),
  /** False when the blocking issue is already resolved. */
  open: z.boolean(),
});

export const statusSchema = z.object({
  /** Verbatim Jira status name, e.g. "To Do - Epic". */
  raw: z.string(),
  phase: canonicalPhaseSchema,
  category: statusCategorySchema,
});

export const roadmapItemSchema = z.object({
  key: z.string(),
  summary: parsedSummarySchema,

  siteKey: z.string(),
  siteName: z.string(),
  siteCode: z.string(),
  region: regionSchema,
  /** True when the region came from the plan rather than the authoritative map. */
  regionProvisional: z.boolean(),
  /** Reconciliation metadata against the current Power BI report. Not a filter. */
  inCurrentPowerBiScope: z.boolean(),

  /** e.g. "Epic" or "Digital Project". Recorded because it varies per project. */
  issueTypeName: z.string(),

  initiativeKey: z.string().optional(),
  alignment: alignmentSchema,

  status: statusSchema,

  start: isoDateSchema.optional(),
  end: isoDateSchema.optional(),
  /** Alias of `end`, named for the UI. Go-live is the due date -- confirmed by
   *  the report's note "Milestones are tied to local go-live dates". */
  goLive: isoDateSchema.optional(),

  /** Fiscal years the bar spans, derived from start/end. */
  fiscalYears: z.array(z.string()),
  /** FY as declared by a field, label, or parsed [FYxx] tag -- may disagree with
   *  the dates, which is itself worth surfacing. */
  declaredFiscalYear: z.string().optional(),

  risk: riskAssessmentSchema,
  narrative: narrativeSchema,

  owners: z.array(ownerSchema),
  spotId: z.string().optional(),
  spotIdSource: z.enum(['field', 'summary']).optional(),
  spotUrl: z.string().optional(),

  updatedAt: isoTimestampSchema,
  /** Days since last update at snapshot time. */
  daysSinceUpdate: z.number().int().min(0),

  blockers: z.array(blockerSchema),
  childCount: z.object({ total: z.number().int().min(0), done: z.number().int().min(0) }),

  jiraUrl: z.string(),
});

// ---------------------------------------------------------------------------
// Initiative (a hierarchy-level-2 issue in a portfolio project)
// ---------------------------------------------------------------------------

/** Per-site rollup that powers the go-live markers on a collapsed lane. */
export const siteRollupSchema = z.object({
  siteKey: z.string(),
  siteName: z.string(),
  siteCode: z.string(),
  region: regionSchema,
  /** Earliest go-live among this site's items for the initiative. */
  goLive: isoDateSchema.optional(),
  /** Worst risk level across this site's items for the initiative. */
  risk: riskLevelSchema,
  itemCount: z.number().int().min(1),
  atRiskCount: z.number().int().min(0),
});

export const initiativeSchema = z.object({
  key: z.string(),
  portfolioKey: z.string(),
  summary: z.string(),
  description: z.string().optional(),

  status: statusSchema,

  start: isoDateSchema.optional(),
  end: isoDateSchema.optional(),
  /** True when start/end were rolled up from linked items rather than authored. */
  datesDerived: z.boolean(),
  /** False -> belongs in the "No dates reported" group rather than the timeline. */
  hasDates: z.boolean(),

  authoredRag: z.string().optional(),
  risk: riskAssessmentSchema,
  narrative: narrativeSchema,

  itemKeys: z.array(z.string()),
  siteRollup: z.array(siteRollupSchema),

  owners: z.array(ownerSchema),
  spotId: z.string().optional(),
  updatedAt: isoTimestampSchema,
  jiraUrl: z.string(),
});

// ---------------------------------------------------------------------------
// Snapshot
// ---------------------------------------------------------------------------

export const siteSummarySchema = z.object({
  key: z.string(),
  name: z.string(),
  code: z.string(),
  region: regionSchema,
  regionProvisional: z.boolean(),
  inCurrentPowerBiScope: z.boolean(),
  activeCount: z.number().int().min(0),
  /** From config, for drift detection. */
  expectedActiveCount: z.number().int().min(0),
});

export const coverageSchema = z.object({
  itemsTotal: z.number().int().min(0),
  itemsActive: z.number().int().min(0),
  withStart: z.number().int().min(0),
  withEnd: z.number().int().min(0),
  withBothDates: z.number().int().min(0),
  withSpotStatus: z.number().int().min(0),
  withAnyRag: z.number().int().min(0),
  withNarrative: z.number().int().min(0),
  spotIdFromField: z.number().int().min(0),
  spotIdFromSummary: z.number().int().min(0),
  overdueActive: z.number().int().min(0),
  staleActive: z.number().int().min(0),
  flaggedFieldPopulated: z.number().int().min(0),
  byRegion: z.record(z.string(), z.number().int().min(0)),
  byRiskLevel: z.record(z.string(), z.number().int().min(0)),
  bySummarySource: z.record(z.string(), z.number().int().min(0)),
  byProvenance: z.record(z.string(), z.number().int().min(0)),
});

export const snapshotSchema = z.object({
  /** Schema version. Bump on a breaking shape change so a stale snapshot is
   *  rejected rather than silently misread. */
  schemaVersion: z.literal(1),
  syncedAt: isoTimestampSchema,
  /** The date risk was evaluated against. Overridable for reproducible runs. */
  asOf: isoDateSchema,

  portfolios: z.array(z.object({ key: z.string(), name: z.string() })),
  sites: z.array(siteSummarySchema),

  initiatives: z.array(initiativeSchema),
  items: z.array(roadmapItemSchema),

  coverage: coverageSchema,
  /** Unknown statuses, unexpected level-1 type names, unresolved site codes,
   *  unparseable summaries. Reviewed at the Phase 1 gate. */
  warnings: z.array(z.string()),
});

// ---------------------------------------------------------------------------
// Inferred types
// ---------------------------------------------------------------------------

export type RiskLevel = z.infer<typeof riskLevelSchema>;
export type ReasonCode = z.infer<typeof reasonCodeSchema>;
export type CanonicalPhase = z.infer<typeof canonicalPhaseSchema>;
export type RiskProvenance = z.infer<typeof riskProvenanceSchema>;
export type SummarySource = z.infer<typeof summarySourceSchema>;
export type Region = z.infer<typeof regionSchema>;
export type RiskReason = z.infer<typeof riskReasonSchema>;
export type AuthoredRag = z.infer<typeof authoredRagSchema>;
export type RiskAssessment = z.infer<typeof riskAssessmentSchema>;
export type Narrative = z.infer<typeof narrativeSchema>;
export type ParsedSummary = z.infer<typeof parsedSummarySchema>;
export type Owner = z.infer<typeof ownerSchema>;
export type Blocker = z.infer<typeof blockerSchema>;
export type ItemStatus = z.infer<typeof statusSchema>;
export type RoadmapItem = z.infer<typeof roadmapItemSchema>;
export type SiteRollup = z.infer<typeof siteRollupSchema>;
export type Initiative = z.infer<typeof initiativeSchema>;
export type SiteSummary = z.infer<typeof siteSummarySchema>;
export type Coverage = z.infer<typeof coverageSchema>;
export type Snapshot = z.infer<typeof snapshotSchema>;

/**
 * Synthetic initiative collecting items with no DDTGMPORT link -- 261 of 510
 * in-scope level-1 items (51%) as measured on 2026-08-07, making it the largest
 * single lane. `alignment: 'local'` is an expected delivery model, not a data
 * gap; see buildUnalignedInitiative in src/lib/transform.ts.
 */
export const UNALIGNED_INITIATIVE_KEY = '__unaligned__';
export const UNALIGNED_INITIATIVE_LABEL = 'Site-local initiatives';
