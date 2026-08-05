/**
 * The executive summary. One to three sentences answering "why should leadership
 * care about this right now?", in leadership language rather than Jira fields.
 *
 * Resolution order:
 *   1. 'spot'             -- SPOT `Overall Status Description`, verbatim (~1% of items)
 *   2. 'jira-description' -- the objective paragraph from `description`
 *   3. 'generated'        -- composed from structured facts (the majority path)
 *
 * Generation is DETERMINISTIC TEMPLATE COMPOSITION, not an LLM call. It must be
 * reproducible for a given snapshot, auditable (`summaryBasis` records every fact
 * used), free, offline, and incapable of inventing a cause. An LLM pass over 645
 * items per sync would be non-deterministic and could assert a "resource
 * constraint" that no field evidences.
 *
 * Rules:
 *   - Never assert a cause the data does not support.
 *   - Never imply a reported status where none exists.
 *   - State missing data as a finding, not an omission.
 *   - Generated output is always labelled as such in the UI.
 */

import { RISK_LEVEL_LABELS, type RiskLevel } from '@config/narrative.js';
import { PHASE_LABELS, type CanonicalPhase } from '@config/status-map.js';
import { formatDate } from './risk.js';
import type { Narrative, RiskAssessment, SummarySource } from '@/types/domain.js';
import type { SpotNarrative } from './adf.js';

/** Longest description excerpt used before trimming on a sentence boundary. */
const DESCRIPTION_EXCERPT_MAX = 240;

export interface SummariseInput {
  risk: RiskAssessment;
  phase: CanonicalPhase;
  statusRaw: string;
  start?: string | undefined;
  goLive?: string | undefined;
  daysSinceUpdate: number;
  updatedAt: string;
  /** Parsed SPOT narrative, when the field exists. */
  spot?: SpotNarrative | undefined;
  /** Plain-text Jira description, when present. */
  description?: string | undefined;
  /** Initiative context for the rollout sentence. */
  initiativeSummary?: string | undefined;
  initiativeSiteCount?: number | undefined;
  childCount?: { total: number; done: number } | undefined;
}

// ---------------------------------------------------------------------------
// Description excerpt
// ---------------------------------------------------------------------------

/**
 * Pulls the most useful paragraph out of a Jira description.
 *
 * DDTJG descriptions are consistently structured with bold headings
 * (`**Business Problem & Objective**`, `**Scope (In/Out)**`, ...). The objective
 * paragraph is the one worth showing; taking the first paragraph blindly would
 * surface the heading itself.
 */
/**
 * A markdown heading on its own line: `**Business Problem & Objective**`,
 * `## Scope`, `**In:**`. Detection is restricted to emphasised or `#` lines --
 * treating any short unpunctuated line as a heading misfired on real prose.
 */
const HEADING_LINE = /^\s*(?:#{1,6}\s+)?(?:\*{1,3}|_{1,3})[^*_]+(?:\*{1,3}|_{1,3})\s*:?\s*$/;

interface DescriptionBlock {
  heading?: string;
  prose: string;
}

/**
 * Splits a description into heading/prose blocks.
 *
 * Splitting on blank lines alone is not enough: Jira markdown separates a heading
 * from its prose with a hard break (two trailing spaces then a newline), so
 * `**Business Problem & Objective**  \nEnhance workforce...` is a single
 * paragraph and the heading would be glued onto the excerpt.
 */
function splitDescriptionBlocks(text: string): DescriptionBlock[] {
  const blocks: DescriptionBlock[] = [];
  let current: DescriptionBlock = { prose: '' };

  const flush = (): void => {
    if (current.heading || current.prose.trim()) {
      blocks.push({ ...current, prose: current.prose.replace(/\s+/g, ' ').trim() });
    }
  };

  for (const rawLine of text.split('\n')) {
    const line = rawLine.trim();
    if (!line) continue;

    if (HEADING_LINE.test(line)) {
      flush();
      current = { heading: line.replace(/[*_#:]/g, '').trim(), prose: '' };
      continue;
    }

    current.prose += `${current.prose ? ' ' : ''}${line}`;
  }
  flush();

  return blocks;
}

export function extractDescriptionExcerpt(description: string | undefined): string | undefined {
  if (!description) return undefined;

  const text = description.replace(/\r/g, '').trim();
  if (!text) return undefined;

  const blocks = splitDescriptionBlocks(text);
  if (blocks.length === 0) return undefined;

  // Prefer the prose under an objective-style heading. DDTJG descriptions are
  // consistently structured this way and the objective is the useful part.
  const objective = blocks.find(
    (b) => b.heading && /objective|summary|business (problem|need)|purpose/i.test(b.heading) && b.prose,
  );

  const chosen = objective?.prose ?? blocks.find((b) => b.prose)?.prose;
  if (!chosen) return undefined;

  const clean = chosen.replace(/\*+/g, '').replace(/\s+/g, ' ').trim();
  if (!clean) return undefined;

  if (clean.length <= DESCRIPTION_EXCERPT_MAX) return clean;

  // Trim on a sentence boundary where possible, otherwise a word boundary.
  const window = clean.slice(0, DESCRIPTION_EXCERPT_MAX);
  const lastStop = Math.max(window.lastIndexOf('. '), window.lastIndexOf('; '));
  if (lastStop > DESCRIPTION_EXCERPT_MAX * 0.5) return window.slice(0, lastStop + 1).trim();

  const lastSpace = window.lastIndexOf(' ');
  return `${window.slice(0, lastSpace > 0 ? lastSpace : DESCRIPTION_EXCERPT_MAX).trim()}...`;
}

// ---------------------------------------------------------------------------
// Generation
// ---------------------------------------------------------------------------

function progressClause(childCount: { total: number; done: number } | undefined): string | undefined {
  if (!childCount || childCount.total === 0) return undefined;
  return `${childCount.done} of ${childCount.total} child item${childCount.total === 1 ? '' : 's'} complete`;
}

/**
 * Composes a summary from facts already computed elsewhere. Sentence one states
 * the headline; sentence two the schedule position; sentence three the context.
 */
export function generateSummary(input: SummariseInput): { text: string; basis: string[] } {
  const { risk, phase, statusRaw, start, goLive, daysSinceUpdate, childCount } = input;
  const basis: string[] = [];
  const sentences: string[] = [];

  // --- 1. headline --------------------------------------------------------
  const headline = RISK_LEVEL_LABELS[risk.level];
  basis.push(`risk.level=${risk.level}`);
  basis.push(`risk.provenance=${risk.provenance}`);

  // --- 2. the specific problem, or the schedule position ------------------
  const primary = risk.reasons.find((r) => r.code !== 'no-immediate-action');

  if (primary) {
    sentences.push(`${headline}. ${primary.detail}`);
    basis.push(`primary reason=${primary.code}`);
  } else if (risk.level === 'complete') {
    sentences.push(
      goLive
        ? `${headline}. Delivered against a go-live of ${formatDate(goLive)}.`
        : `${headline}.`,
    );
    if (goLive) basis.push(`goLive=${goLive}`);
  } else if (start && goLive) {
    sentences.push(
      `${headline}. In ${PHASE_LABELS[phase]} since ${formatDate(start)}, with go-live planned ${formatDate(goLive)}.`,
    );
    basis.push(`start=${start}`, `goLive=${goLive}`, `phase=${phase}`);
  } else if (goLive) {
    sentences.push(`${headline}. Go-live planned ${formatDate(goLive)}; currently in ${PHASE_LABELS[phase]}.`);
    basis.push(`goLive=${goLive}`, `phase=${phase}`);
  } else {
    sentences.push(`${headline}. Currently in ${PHASE_LABELS[phase]} (${statusRaw}).`);
    basis.push(`phase=${phase}`, `statusRaw=${statusRaw}`);
  }

  // --- 3. secondary reasons ----------------------------------------------
  const secondary = risk.reasons.filter((r) => r !== primary && r.code !== 'no-immediate-action');
  if (secondary.length > 0) {
    const first = secondary[0]!;
    sentences.push(first.detail);
    basis.push(`secondary reason=${first.code}`);
  }

  // --- 4. context: rollout, then progress --------------------------------
  const context: string[] = [];

  if (input.initiativeSummary) {
    const siteClause =
      input.initiativeSiteCount && input.initiativeSiteCount > 1
        ? ` (${input.initiativeSiteCount} sites)`
        : '';
    context.push(`Part of ${input.initiativeSummary}${siteClause}`);
    basis.push(`initiative=${input.initiativeSummary}`);
  }

  const progress = progressClause(childCount);
  // Only worth saying when it is not already implied by a terminal state.
  if (progress && risk.level !== 'complete' && risk.level !== 'cancelled') {
    context.push(progress);
    basis.push(`childCount=${childCount!.done}/${childCount!.total}`);
  }

  if (context.length > 0) sentences.push(`${context.join('. ')}.`);

  // --- 5. staleness, when not already the primary reason ------------------
  const staleAlreadyStated = risk.reasons.some((r) => r.code === 'reporting-gap');
  if (!staleAlreadyStated && daysSinceUpdate >= 60) {
    sentences.push(`Last updated in Jira ${daysSinceUpdate} days ago.`);
    basis.push(`daysSinceUpdate=${daysSinceUpdate}`);
  }

  return { text: sentences.join(' ').replace(/\s{2,}/g, ' ').trim(), basis };
}

// ---------------------------------------------------------------------------
// Resolution
// ---------------------------------------------------------------------------

/**
 * Builds the `Narrative` for an item, choosing the best available summary source
 * and recording which one was used so the UI can always attribute it.
 */
export function buildNarrative(input: SummariseInput): Narrative {
  const { spot } = input;

  // 1. Site-authored SPOT status.
  if (spot?.statusDescription) {
    return {
      ...(spot.phase ? { phase: spot.phase } : {}),
      ...(spot.state ? { state: spot.state } : {}),
      statusDescription: spot.statusDescription,
      ...(spot.recentAccomplishments ? { recentAccomplishments: spot.recentAccomplishments } : {}),
      ...(spot.nextPriorities ? { nextPriorities: spot.nextPriorities } : {}),
      ...(spot.sourceUrl ? { sourceUrl: spot.sourceUrl } : {}),
      sourceUpdatedAt: input.updatedAt,
      executiveSummary: spot.statusDescription,
      summarySource: 'spot' satisfies SummarySource,
    };
  }

  // Carry SPOT fields through even when the status description is missing --
  // accomplishments and priorities are still worth showing.
  const spotCarry = spot
    ? {
        ...(spot.phase ? { phase: spot.phase } : {}),
        ...(spot.state ? { state: spot.state } : {}),
        ...(spot.recentAccomplishments ? { recentAccomplishments: spot.recentAccomplishments } : {}),
        ...(spot.nextPriorities ? { nextPriorities: spot.nextPriorities } : {}),
        ...(spot.sourceUrl ? { sourceUrl: spot.sourceUrl } : {}),
      }
    : {};

  // 2. Jira description.
  const excerpt = extractDescriptionExcerpt(input.description);
  if (excerpt) {
    return {
      ...spotCarry,
      executiveSummary: excerpt,
      summarySource: 'jira-description' satisfies SummarySource,
    };
  }

  // 3. Generated.
  const { text, basis } = generateSummary(input);
  return {
    ...spotCarry,
    executiveSummary: text,
    summarySource: 'generated' satisfies SummarySource,
    summaryBasis: basis,
  };
}

/**
 * Narrative for an Initiative. Descriptions on DDTGMPORT Initiatives are
 * genuinely good executive prose (verified on MES, LPMS, STRIVE, Veeva eQMS,
 * Takami, LabWare EM), so they are preferred over generation.
 */
export function buildInitiativeNarrative(input: {
  risk: RiskAssessment;
  phase: CanonicalPhase;
  statusRaw: string;
  description?: string | undefined;
  siteCount: number;
  atRiskCount: number;
  start?: string | undefined;
  end?: string | undefined;
  updatedAt: string;
  daysSinceUpdate: number;
}): Narrative {
  const excerpt = extractDescriptionExcerpt(input.description);
  if (excerpt) {
    return { executiveSummary: excerpt, summarySource: 'jira-description' };
  }

  const { text, basis } = generateSummary({
    risk: input.risk,
    phase: input.phase,
    statusRaw: input.statusRaw,
    start: input.start,
    goLive: input.end,
    daysSinceUpdate: input.daysSinceUpdate,
    updatedAt: input.updatedAt,
    initiativeSiteCount: input.siteCount,
  });

  return { executiveSummary: text, summarySource: 'generated', summaryBasis: basis };
}

/** Levels a "rollout" sentence is worth appending to for initiatives. */
export function rolloutSentence(siteCount: number, atRiskCount: number, level: RiskLevel): string {
  const onTrack = siteCount - atRiskCount;
  if (siteCount === 0) return 'No site projects are linked to this programme yet.';
  if (atRiskCount === 0) return `Rolling out across ${siteCount} site${siteCount === 1 ? '' : 's'}, all on schedule.`;
  return `Rolling out across ${siteCount} site${siteCount === 1 ? '' : 's'}: ${onTrack} on schedule, ${atRiskCount} ${
    level === 'attention' ? 'requiring attention' : 'to monitor'
  }.`;
}
