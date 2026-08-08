/**
 * Portfolio completeness: did everything that came in come out?
 *
 * WHAT THIS IS FOR. The adapter reports what it refuses, row by row. That is necessary
 * and not sufficient: it cannot tell you that a whole site is missing, that an initiative
 * nothing links to has quietly appeared, or that 1371 rows became 400 items for reasons
 * nobody has accounted for. Those are properties of the WHOLE dataset, and they are the
 * ones that matter before a source is trusted for executive reporting.
 *
 * THE CENTRAL CHECK IS RECONCILIATION. Every in-scope row whose registered hierarchy
 * level makes it a roadmap item must appear as an item, or be explained. `unaccounted`
 * being non-zero means work exists in Jira and does not exist on the dashboard, which is
 * the failure this project treats as unacceptable. It is computed by subtraction over
 * observed data, not asserted from a baseline, so it stays true as the portfolio changes.
 *
 * IT MEASURES, IT DOES NOT DECIDE. No risk, region, coverage or alignment rule is
 * reimplemented here; every number is a count over `Snapshot` output or over raw rows,
 * and the field-population figures reuse `mapCustomFieldColumns` rather than
 * re-deriving the column convention. A validator that recomputed the rules it validates
 * would agree with itself and prove nothing.
 */

import { ISSUE_TYPE_LEVELS } from '@config/feed.js';
import {
  RAG_FIELD_CANDIDATES,
  SPOT_DESCRIPTION_FIELD_CANDIDATES,
  SPOT_ID_FIELD_CANDIDATES,
} from '@config/fields.js';
import {
  PORTFOLIO_INITIATIVE_HIERARCHY_LEVEL,
  ROADMAP_ITEM_HIERARCHY_LEVEL,
} from '@config/hierarchy.js';
import {
  ALL_PROJECT_KEYS,
  DEFERRED_SITES,
  DISCOVERY_BASELINE,
  EXCLUDED_PROJECTS,
  PORTFOLIO_KEYS,
  SITE_KEYS,
} from '@config/projects.js';
import { UNALIGNED_INITIATIVE_KEY, type Snapshot } from '@/types/domain.js';

import type { Feed3Payload } from './dto.js';
import { canonicalProjectKey, feedText, isInScopeProject, mapCustomFieldColumns } from './normalise.js';

// ---------------------------------------------------------------------------
// Shape
// ---------------------------------------------------------------------------

export interface ProjectReconciliation {
  key: string;
  /** `site`, `portfolio`, or why it is not either. */
  classification: 'site' | 'portfolio' | 'deferred' | 'excluded' | 'unknown';
  rows: number;
  /** Rows whose registered level makes them roadmap items. */
  level1Rows: number;
  /** Rows whose registered level makes them portfolio initiatives. */
  level2Rows: number;
  /** Rows whose type is not in the registry -- these are the blocked ones. */
  unregisteredRows: number;
  /** Roadmap items actually produced. */
  items: number;
  /** `level1Rows - items`. Non-zero is unexplained loss. */
  unaccounted: number;
}

export interface CompletenessFinding {
  kind: 'missing' | 'duplicate' | 'orphaned' | 'excluded';
  subject: string;
  detail: string;
}

/**
 * Populated-in-the-feed vs resolved-into-the-model, per narrative field.
 *
 * WHY THIS EXISTS SEPARATELY FROM COVERAGE. `Coverage` counts what the model ended up
 * with. That number falling does not distinguish "the sites stopped filling the field in"
 * from "the parser stopped understanding it" -- and Feed #3 returns SPOT narratives as
 * wiki markup parsed by a different code path than the REST/ADF one. A yield well below
 * 100% is a parser finding; a yield near 100% over a falling population is a data
 * finding. Conflating them cost this project a headline metric once already.
 *
 * BOTH SIDES ARE MEASURED ON THE SAME BASIS: items that are ACTIVE in the snapshot.
 * `buildCoverage` computes every one of these figures over `activeItems`, not over all
 * items, so counting the feed side over all 510 level-1 rows would divide by the wrong
 * denominator and under-report the yield -- inventing a parser problem out of completed
 * work. This is the same basis mismatch `DISCOVERY_BASELINE` warns about in
 * `config/projects.ts`; it is easy to reintroduce and it always reads as a regression.
 */
export interface FieldYield {
  field: string;
  /** Active items whose feed row has at least one candidate column populated. */
  populatedInFeed: number;
  /** Active items where the value actually reached the model. */
  resolvedInModel: number;
  /** `resolvedInModel / populatedInFeed`, or 1 when nothing is populated. */
  yield: number;
}

export interface CompletenessReport {
  projects: ProjectReconciliation[];
  findings: CompletenessFinding[];
  reconciliation: {
    inScopeRows: number;
    level1Rows: number;
    items: number;
    /** Level-1 rows that produced no item. MUST be zero. */
    unaccounted: number;
  };
  initiatives: {
    /** `DISCOVERY_BASELINE.initiatives` -- the count discovery measured. */
    expected: number;
    /** Level-2 rows the feed returned in portfolio projects. */
    returnedByFeed: number;
    /** Real initiatives in the snapshot, excluding the synthetic site-local lane. */
    inSnapshot: number;
    /** Initiative keys items link to that the feed did not return. */
    dangling: string[];
    /** Initiatives carrying no items -- valid, but worth naming. */
    withNoItems: string[];
  };
  sites: {
    configured: number;
    withItems: number;
    withoutItems: string[];
  };
  yields: FieldYield[];
  /** True when nothing is missing, duplicated or unaccounted for. */
  ok: boolean;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function classify(key: string): ProjectReconciliation['classification'] {
  if (PORTFOLIO_KEYS.includes(key)) return 'portfolio';
  if (SITE_KEYS.includes(key)) return 'site';
  if (DEFERRED_SITES[key]) return 'deferred';
  if (EXCLUDED_PROJECTS[key]) return 'excluded';
  return 'unknown';
}

/** True when any candidate field carries a non-empty value. */
function anyPopulated(fields: Record<string, unknown>, candidates: readonly string[]): boolean {
  return candidates.some((id) => {
    const value = fields[id];
    return value !== undefined && value !== null && value !== '';
  });
}

// ---------------------------------------------------------------------------
// The report
// ---------------------------------------------------------------------------

export function assessCompleteness(payload: Feed3Payload, snapshot: Snapshot): CompletenessReport {
  const findings: CompletenessFinding[] = [];

  // --- per-project row census, over raw rows -------------------------------
  const byProject = new Map<string, ProjectReconciliation>();
  const ragCandidates = RAG_FIELD_CANDIDATES.map((c) => c.id);

  // The exact population `buildCoverage` measures over. Derived from the snapshot rather
  // than recomputed, so the two can never drift apart on the definition of "active".
  const activeItemKeys = new Set(
    snapshot.items
      .filter((i) => i.risk.level !== 'complete' && i.risk.level !== 'cancelled')
      .map((i) => i.key),
  );

  let populatedRag = 0;
  let populatedNarrative = 0;
  let populatedSpotId = 0;

  for (const row of payload.issues) {
    const key = canonicalProjectKey(row.PROJECT_KEY) ?? '(missing PROJECT_KEY)';
    const entry =
      byProject.get(key) ??
      ({
        key,
        classification: classify(key),
        rows: 0,
        level1Rows: 0,
        level2Rows: 0,
        unregisteredRows: 0,
        items: 0,
        unaccounted: 0,
      } satisfies ProjectReconciliation);

    entry.rows++;

    const typeId = feedText(row.ISSUE_TYPE_ID);
    const level = typeId ? ISSUE_TYPE_LEVELS[typeId] : undefined;

    if (level === undefined) entry.unregisteredRows++;
    else if (level === ROADMAP_ITEM_HIERARCHY_LEVEL) entry.level1Rows++;
    else if (level === PORTFOLIO_INITIATIVE_HIERARCHY_LEVEL) entry.level2Rows++;

    byProject.set(key, entry);

    // Measured over rows that became ACTIVE items -- the population `buildCoverage` uses.
    const issueKey = feedText(row.ISSUE_KEY);
    if (
      level === ROADMAP_ITEM_HIERARCHY_LEVEL &&
      isInScopeProject(row.PROJECT_KEY) &&
      issueKey !== undefined &&
      activeItemKeys.has(issueKey)
    ) {
      const outcome = mapCustomFieldColumns(row, issueKey);
      const fields = outcome.severity === 'error' ? {} : outcome.value;
      if (anyPopulated(fields, ragCandidates)) populatedRag++;
      if (anyPopulated(fields, SPOT_DESCRIPTION_FIELD_CANDIDATES)) populatedNarrative++;
      if (anyPopulated(fields, SPOT_ID_FIELD_CANDIDATES)) populatedSpotId++;
    }
  }

  // --- items produced, per project -----------------------------------------
  for (const item of snapshot.items) {
    const entry = byProject.get(item.siteKey);
    if (entry) entry.items++;
    else {
      findings.push({
        kind: 'orphaned',
        subject: item.key,
        detail:
          `item resolves to site ${item.siteKey}, which returned no rows in this read. The item ` +
          `cannot have come from this payload.`,
      });
    }
  }

  for (const entry of byProject.values()) {
    entry.unaccounted = entry.classification === 'site' ? entry.level1Rows - entry.items : 0;
  }

  const projects = [...byProject.values()].sort((a, b) => a.key.localeCompare(b.key));

  // --- missing --------------------------------------------------------------
  for (const key of ALL_PROJECT_KEYS) {
    if (!byProject.has(key)) {
      findings.push({
        kind: 'missing',
        subject: key,
        detail: 'in-scope project returned no rows at all. A configured site with no rows renders as empty.',
      });
    }
  }

  const sitesWithoutItems = SITE_KEYS.filter(
    (key) => (byProject.get(key)?.items ?? 0) === 0,
  );
  for (const key of sitesWithoutItems) {
    const rows = byProject.get(key)?.rows ?? 0;
    findings.push({
      kind: 'missing',
      subject: key,
      detail:
        rows === 0
          ? 'configured site has no rows and no items.'
          : `configured site exported ${rows} row(s) but produced no roadmap items. Selection dropped them.`,
    });
  }

  for (const entry of projects) {
    if (entry.unaccounted !== 0) {
      findings.push({
        kind: 'missing',
        subject: entry.key,
        detail:
          `${entry.level1Rows} level-1 row(s) produced ${entry.items} item(s); ` +
          `${entry.unaccounted} unaccounted for. Work exists in Jira and not on the dashboard.`,
      });
    }
    // Only in scope. The adapter tests `isInScopeProject` and skips out-of-scope rows
    // BEFORE resolving a level, so an unregistered type in a deferred project such as
    // DDTJG is never looked up and costs nothing. Reporting it as missing would make the
    // gate permanently red over rows the application deliberately does not read -- and a
    // gate that is always red is a gate nobody reads.
    const inScope = entry.classification === 'site' || entry.classification === 'portfolio';
    if (inScope && entry.unregisteredRows > 0) {
      findings.push({
        kind: 'missing',
        subject: entry.key,
        detail:
          `${entry.unregisteredRows} row(s) carry an issue type absent from ISSUE_TYPE_LEVELS, so ` +
          `their hierarchy level is unknown and they were skipped.`,
      });
    }
  }

  // --- duplicates -----------------------------------------------------------
  const rowKeyCounts = new Map<string, number>();
  for (const row of payload.issues) {
    const key = feedText(row.ISSUE_KEY);
    if (key) rowKeyCounts.set(key, (rowKeyCounts.get(key) ?? 0) + 1);
  }
  for (const [key, count] of rowKeyCounts) {
    if (count > 1) {
      findings.push({
        kind: 'duplicate',
        subject: key,
        detail: `appears ${count} times in the Issues export; the first occurrence was kept.`,
      });
    }
  }

  const itemKeyCounts = new Map<string, number>();
  for (const item of snapshot.items) itemKeyCounts.set(item.key, (itemKeyCounts.get(item.key) ?? 0) + 1);
  for (const [key, count] of itemKeyCounts) {
    if (count > 1) {
      findings.push({
        kind: 'duplicate',
        subject: key,
        detail: `${count} roadmap items share this key. Every downstream total double-counts it.`,
      });
    }
  }

  const initiativeKeyCounts = new Map<string, number>();
  for (const initiative of snapshot.initiatives) {
    initiativeKeyCounts.set(initiative.key, (initiativeKeyCounts.get(initiative.key) ?? 0) + 1);
  }
  for (const [key, count] of initiativeKeyCounts) {
    if (count > 1) {
      findings.push({ kind: 'duplicate', subject: key, detail: `${count} initiatives share this key.` });
    }
  }

  // --- initiatives ----------------------------------------------------------
  const realInitiatives = snapshot.initiatives.filter((i) => i.key !== UNALIGNED_INITIATIVE_KEY);
  const knownInitiativeKeys = new Set(realInitiatives.map((i) => i.key));

  const referenced = new Set<string>();
  for (const item of snapshot.items) if (item.initiativeKey) referenced.add(item.initiativeKey);

  const dangling = [...referenced].filter((key) => !knownInitiativeKeys.has(key)).sort();
  for (const key of dangling) {
    findings.push({
      kind: 'orphaned',
      subject: key,
      detail: 'items link to this initiative, which the feed did not return.',
    });
  }

  const withNoItems = realInitiatives
    .filter((i) => !referenced.has(i.key))
    .map((i) => i.key)
    .sort();
  for (const key of withNoItems) {
    findings.push({
      kind: 'orphaned',
      subject: key,
      detail: 'initiative carries no roadmap items. Valid -- a programme may not have started -- but named so it is not mistaken for a link failure.',
    });
  }

  const level2InFeed = projects
    .filter((p) => p.classification === 'portfolio')
    .reduce((sum, p) => sum + p.level2Rows, 0);

  // --- excluded -------------------------------------------------------------
  for (const entry of projects) {
    if (entry.classification === 'deferred' || entry.classification === 'excluded') {
      findings.push({
        kind: 'excluded',
        subject: entry.key,
        detail:
          `${entry.rows} row(s) exported for a project that is knowingly out of MVP scope ` +
          `(${DEFERRED_SITES[entry.key] ?? EXCLUDED_PROJECTS[entry.key]}). Filtered, as intended.`,
      });
    }
    if (entry.classification === 'unknown') {
      findings.push({
        kind: 'orphaned',
        subject: entry.key,
        detail:
          `${entry.rows} row(s) exported for a project in neither the site registry nor the ` +
          `recorded exclusions. It has no site, region or baseline.`,
      });
    }
  }

  // --- yields ---------------------------------------------------------------
  const yieldOf = (field: string, populatedInFeed: number, resolvedInModel: number): FieldYield => ({
    field,
    populatedInFeed,
    resolvedInModel,
    yield: populatedInFeed === 0 ? 1 : resolvedInModel / populatedInFeed,
  });

  // Active items whose SPOT table was READ, and those whose table carried an authored
  // status paragraph. Taken from the domain model, so no narrative is re-parsed here.
  const activeItems = snapshot.items.filter((i) => activeItemKeys.has(i.key));
  const withParsedTable = activeItems.filter((i) => i.narrative.phase !== undefined).length;
  const withStatusText = activeItems.filter((i) => i.narrative.statusDescription !== undefined).length;

  // THREE NESTED MEASURES, NOT ONE. Each numerator is a subset of its own denominator, so
  // each isolates one stage and a drop points at one thing:
  //
  //   populated in feed  ->  table parsed        a PARSER regression
  //   table parsed       ->  status text present  a DATA property (sites leave it blank)
  //   status text        ->  used as the summary  a SUMMARISER regression
  //
  // Measured 2026-08-08: 299 populated, 295 parsed, 245 carry status text. The 50-item
  // difference is authored content that does not exist -- those tables carry phase, state
  // and a URL only. Comparing "populated" straight to "used as the summary" reads as an
  // 82% parser failure and is simply the wrong denominator; the parser reads 295 of 295.
  const yields: FieldYield[] = [
    yieldOf('authored RAG', populatedRag, snapshot.coverage.withAnyRag),
    yieldOf('SPOT table parsed', populatedNarrative, withParsedTable),
    yieldOf('status text authored', withParsedTable, withStatusText),
    yieldOf('summary from SPOT', withStatusText, snapshot.coverage.withNarrative),
    yieldOf('SPOT ID', populatedSpotId, snapshot.coverage.spotIdFromField),
  ];

  const inScopeRows = projects
    .filter((p) => p.classification === 'site' || p.classification === 'portfolio')
    .reduce((sum, p) => sum + p.rows, 0);
  const level1Rows = projects
    .filter((p) => p.classification === 'site')
    .reduce((sum, p) => sum + p.level1Rows, 0);
  const unaccounted = level1Rows - snapshot.items.length;

  return {
    projects,
    findings,
    reconciliation: { inScopeRows, level1Rows, items: snapshot.items.length, unaccounted },
    initiatives: {
      expected: DISCOVERY_BASELINE.initiatives,
      returnedByFeed: level2InFeed,
      inSnapshot: realInitiatives.length,
      dangling,
      withNoItems,
    },
    sites: {
      configured: SITE_KEYS.length,
      withItems: SITE_KEYS.length - sitesWithoutItems.length,
      withoutItems: sitesWithoutItems,
    },
    yields,
    // `excluded` is expected and `orphaned` initiatives-with-no-items are valid, so
    // neither blocks. Missing entities and duplicates always do.
    ok:
      unaccounted === 0 &&
      !findings.some((f) => f.kind === 'missing' || f.kind === 'duplicate'),
  };
}
