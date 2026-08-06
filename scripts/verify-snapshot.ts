/**
 * The Phase 1 gate.
 *
 * Run: npm run verify-snapshot
 *
 * Validates the snapshot against its schema, compares it to the discovery
 * baseline, and runs canaries. Exits non-zero on any FAIL so this can gate a
 * scheduled sync.
 *
 * The most important canary is "no site has zero items": a Jira change that
 * introduces a new project-local level-1 type name would silently empty a site,
 * and a roadmap that quietly loses a site is worse than one that fails loudly.
 */

import { readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';

import {
  DEFERRED_SITES,
  DISCOVERY_BASELINE,
  INHERITED_BASELINE_KEYS,
  PORTFOLIOS,
  RESOLVED_SITES,
} from '@config/projects.js';
import { findDuplicateSiteCodes, UNCONFIRMED_SITE_CODES } from '@config/site-codes.js';
import { snapshotSchema, UNALIGNED_INITIATIVE_KEY, type Snapshot } from '@/types/domain.js';

const SNAPSHOT_PATH = path.resolve('data', 'snapshot.json');

/** Tolerance on baseline comparisons -- Jira changes daily, so exact equality
 *  would produce noise. Beyond this, something structural has changed. */
const DRIFT_TOLERANCE = 0.1;

type Level = 'PASS' | 'WARN' | 'FAIL';

interface Check {
  level: Level;
  label: string;
  detail: string;
}

const checks: Check[] = [];

function record(level: Level, label: string, detail: string): void {
  checks.push({ level, label, detail });
}

function compare(label: string, actual: number, expected: number, unit = ''): void {
  const drift = expected === 0 ? (actual === 0 ? 0 : 1) : Math.abs(actual - expected) / expected;
  const delta = actual - expected;
  const sign = delta > 0 ? '+' : '';
  const detail = `${actual}${unit} (discovery: ${expected}${unit}, ${sign}${delta})`;

  if (drift <= DRIFT_TOLERANCE) record('PASS', label, detail);
  else record('WARN', label, `${detail} — drift ${(drift * 100).toFixed(0)}% exceeds ${DRIFT_TOLERANCE * 100}%`);
}

function pct(n: number, total: number): string {
  return total === 0 ? 'n/a' : `${((n / total) * 100).toFixed(0)}%`;
}

function bar(label: string, value: number, total: number, width = 28): string {
  const filled = total === 0 ? 0 : Math.round((value / total) * width);
  return `  ${label.padEnd(22)} ${'█'.repeat(filled)}${'░'.repeat(width - filled)} ${String(value).padStart(4)}  ${pct(value, total).padStart(4)}`;
}

function heading(text: string): void {
  process.stdout.write(`\n${text}\n${'─'.repeat(Math.max(text.length, 60))}\n`);
}

function line(text = ''): void {
  process.stdout.write(`${text}\n`);
}

async function main(): Promise<void> {
  if (!existsSync(SNAPSHOT_PATH)) {
    process.stderr.write(
      `No snapshot at ${path.relative(process.cwd(), SNAPSHOT_PATH)}.\nRun: npm run sync\n`,
    );
    process.exit(1);
  }

  const raw = await readFile(SNAPSHOT_PATH, 'utf8');

  // --- schema ------------------------------------------------------------
  const parsed = snapshotSchema.safeParse(JSON.parse(raw));
  if (!parsed.success) {
    process.stderr.write('Snapshot failed schema validation:\n');
    for (const issue of parsed.error.issues.slice(0, 20)) {
      process.stderr.write(`  ${issue.path.join('.')}: ${issue.message}\n`);
    }
    process.exit(1);
  }
  const snapshot: Snapshot = parsed.data;
  record('PASS', 'Schema validation', `snapshot conforms to schemaVersion ${snapshot.schemaVersion}`);

  const { coverage, items, initiatives, sites } = snapshot;
  const activeItems = items.filter(
    (i) => i.risk.level !== 'complete' && i.risk.level !== 'cancelled',
  );

  line('DDT Roadmap — Phase 1 data model verification');
  line(`  synced   ${snapshot.syncedAt}`);
  line(`  as of    ${snapshot.asOf}`);
  line(`  baseline discovery of ${DISCOVERY_BASELINE.asOf}`);

  // --- scope -------------------------------------------------------------
  heading('Scope');
  const projectCount = PORTFOLIOS.length + RESOLVED_SITES.length;
  compare('Projects in scope', projectCount, DISCOVERY_BASELINE.projectCount);
  compare('Portfolio initiatives', initiatives.filter((i) => i.key !== UNALIGNED_INITIATIVE_KEY).length, DISCOVERY_BASELINE.initiatives);
  compare('Active roadmap items', coverage.itemsActive, DISCOVERY_BASELINE.activeItems);
  line(`  Total items incl. complete/cancelled: ${coverage.itemsTotal}`);

  // --- per-site canary ---------------------------------------------------
  heading('Per-site item counts');
  const emptySites: string[] = [];
  const driftedSites: string[] = [];

  for (const site of [...sites].sort((a, b) => b.activeCount - a.activeCount)) {
    const flag =
      site.activeCount === 0
        ? ' ← EMPTY'
        : Math.abs(site.activeCount - site.expectedActiveCount) / Math.max(1, site.expectedActiveCount) > 0.25
          ? ' ← drift'
          : '';
    if (site.activeCount === 0) emptySites.push(`${site.name} (${site.key})`);
    else if (flag === ' ← drift') driftedSites.push(`${site.name} ${site.activeCount} vs ${site.expectedActiveCount}`);

    line(
      `  ${site.code.padEnd(4)} ${site.name.padEnd(16)} ${String(site.activeCount).padStart(4)}` +
        `  (expected ${String(site.expectedActiveCount).padStart(3)})  ${site.region}${flag}`,
    );
  }

  if (emptySites.length === 0) {
    record('PASS', 'No empty sites', 'every configured site returned at least one roadmap item');
  } else {
    record(
      'FAIL',
      'Empty site detected',
      `${emptySites.join(', ')} returned zero items. This is the failure mode the ` +
        `hierarchy-level model exists to prevent — check for a new project-local ` +
        `level-1 issue type name, or a permissions change.`,
    );
  }
  if (driftedSites.length > 0) {
    record('WARN', 'Site counts drifted >25%', driftedSites.join('; '));
  }

  // --- hierarchy-level model --------------------------------------------
  //
  // This section previously hard-failed if DDTJG returned zero items, since
  // Jaguariuna was the only observed project using a non-"Epic" level-1 type
  // ("Digital Project"). DDTJG is now out of MVP scope, so that assertion would
  // fail unconditionally and has been replaced.
  //
  // The invariant it protected still holds and still matters: selection is on
  // issuetype.hierarchyLevel, never on type name. Within the 19-project scope
  // that is no longer observable from the data -- every in-scope level-1 type is
  // expected to be "Epic" -- so it is now enforced by the per-site zero canary
  // above (the failure mode that actually hurts) plus unit coverage of the
  // alternate-type path in tests/pipeline.test.ts.
  heading('Hierarchy-level model');
  const typeNames = new Map<string, number>();
  for (const item of items) typeNames.set(item.issueTypeName, (typeNames.get(item.issueTypeName) ?? 0) + 1);

  for (const [name, count] of [...typeNames.entries()].sort((a, b) => b[1] - a[1])) {
    line(`  ${name.padEnd(20)} ${String(count).padStart(4)} items`);
  }

  const unexpectedTypeNames = [...typeNames.keys()].filter((n) => n !== 'Epic');
  if (unexpectedTypeNames.length > 0) {
    // Not a failure -- ingestion is hierarchy-driven, so a new type name is
    // carried rather than dropped. It is reported because it means a site
    // introduced a project-local level-1 type, which config should acknowledge.
    record(
      'WARN',
      'Non-"Epic" level-1 type ingested',
      `${unexpectedTypeNames.join(', ')} — ingested correctly via hierarchy level. ` +
        `Add to KNOWN_LEVEL_1_TYPE_NAMES in config/hierarchy.ts if expected.`,
    );
  } else {
    record(
      'PASS',
      'Level-1 types as expected',
      `all ${items.length} items are type "Epic"; no project-local level-1 type in the 19-project scope`,
    );
  }

  // --- dates / plottability ---------------------------------------------
  heading('Timeline coverage (active items)');
  line(bar('Both dates', coverage.withBothDates, coverage.itemsActive));
  line(bar('Start date only', coverage.withStart - coverage.withBothDates, coverage.itemsActive));
  line(bar('Go-live date only', coverage.withEnd - coverage.withBothDates, coverage.itemsActive));
  line(bar('Neither', coverage.itemsActive - coverage.withStart - coverage.withEnd + coverage.withBothDates, coverage.itemsActive));
  compare('Items with both dates', coverage.withBothDates, DISCOVERY_BASELINE.itemsWithBothDates);

  const unplottable = coverage.itemsActive - coverage.withBothDates;
  line(`\n  ${unplottable} active items cannot be plotted as a bar.`);
  line(
    `  Of those, ${coverage.withEnd - coverage.withBothDates} have a go-live date and can render as a milestone diamond.`,
  );

  // --- status provenance -------------------------------------------------
  heading('Status provenance (active items)');
  for (const [provenance, count] of Object.entries(coverage.byProvenance).sort((a, b) => b[1] - a[1])) {
    line(bar(provenance, count, coverage.itemsActive));
  }
  compare('Items with any authored RAG', coverage.withAnyRag, DISCOVERY_BASELINE.itemsWithAnyRag);
  compare('Items with SPOT narrative', coverage.withNarrative, DISCOVERY_BASELINE.itemsWithSpotNarrative);

  if (coverage.withAnyRag / Math.max(1, coverage.itemsActive) < 0.5) {
    record(
      'WARN',
      'Authored status coverage is low',
      `${coverage.withAnyRag} of ${coverage.itemsActive} (${pct(coverage.withAnyRag, coverage.itemsActive)}) ` +
        `carry a site-authored status; the rest are inferred or unreported. ` +
        `Expected — this is the central data-quality finding, surfaced in the UI, not hidden.`,
    );
  }

  // --- risk distribution -------------------------------------------------
  heading('Risk distribution (active items)');
  for (const [level, count] of Object.entries(coverage.byRiskLevel).sort((a, b) => b[1] - a[1])) {
    line(bar(level, count, coverage.itemsActive));
  }
  compare('Overdue active items', coverage.overdueActive, DISCOVERY_BASELINE.overdueActive);
  compare('Stale active items (90d+)', coverage.staleActive, DISCOVERY_BASELINE.staleActive90d);

  // --- executive summary -------------------------------------------------
  heading('Executive summary source (active items)');
  for (const [source, count] of Object.entries(coverage.bySummarySource).sort((a, b) => b[1] - a[1])) {
    line(bar(source, count, coverage.itemsActive));
  }

  const missingSummary = items.filter((i) => !i.narrative.executiveSummary?.trim());
  if (missingSummary.length === 0) {
    record('PASS', 'Every item has an executive summary', `${items.length} items, none empty`);
  } else {
    record('FAIL', 'Items without an executive summary', `${missingSummary.length} items, e.g. ${missingSummary[0]!.key}`);
  }

  const generatedWithoutBasis = items.filter(
    (i) => i.narrative.summarySource === 'generated' && (i.narrative.summaryBasis ?? []).length === 0,
  );
  if (generatedWithoutBasis.length === 0) {
    record('PASS', 'Generated summaries are auditable', 'all carry a summaryBasis');
  } else {
    record('FAIL', 'Generated summaries missing basis', `${generatedWithoutBasis.length} items`);
  }

  // --- SPOT ID recovery --------------------------------------------------
  heading('SPOT ID recovery');
  line(`  From the dedicated field:  ${coverage.spotIdFromField}`);
  line(`  Parsed from the summary:   ${coverage.spotIdFromSummary}`);
  line(`  Total:                     ${coverage.spotIdFromField + coverage.spotIdFromSummary} of ${coverage.itemsActive} (${pct(coverage.spotIdFromField + coverage.spotIdFromSummary, coverage.itemsActive)})`);

  if (coverage.spotIdFromSummary > coverage.spotIdFromField) {
    record(
      'PASS',
      'Summary parsing recovers SPOT IDs at scale',
      `${coverage.spotIdFromSummary} from summaries vs ${coverage.spotIdFromField} from the field ` +
        `(field coverage at discovery was ${DISCOVERY_BASELINE.itemsWithSpotIdField})`,
    );
  } else {
    record(
      'WARN',
      'Summary parsing recovered few SPOT IDs',
      `${coverage.spotIdFromSummary} from summaries vs ${coverage.spotIdFromField} from the field. ` +
        `Check config/summary-taxonomy.ts against current summary formats.`,
    );
  }

  // --- regions -----------------------------------------------------------
  heading('Regional distribution (active items)');
  for (const [region, count] of Object.entries(coverage.byRegion).sort((a, b) => b[1] - a[1])) {
    const expected = (DISCOVERY_BASELINE.byRegion as Record<string, number>)[region];
    line(
      `  ${region.padEnd(16)} ${String(count).padStart(4)}` +
        (expected === undefined ? '' : `  (discovery: ${expected})`),
    );
  }

  const unassigned = coverage.byRegion['Unassigned'] ?? 0;
  if (unassigned > 0) {
    record('FAIL', 'Items with no region', `${unassigned} items resolved to "Unassigned" — config/regions.ts is incomplete`);
  } else {
    record('PASS', 'Every item has a region', 'no items resolved to "Unassigned"');
  }

  const provisionalCount = activeItems.filter((i) => i.regionProvisional).length;
  if (provisionalCount > 0) {
    const provisionalSites = [...new Set(activeItems.filter((i) => i.regionProvisional).map((i) => i.siteName))];
    record(
      'WARN',
      'Provisional region assignments',
      `${provisionalCount} items across ${provisionalSites.join(', ')} use a region assigned by the ` +
        `plan rather than the authoritative map. Open question 2.`,
    );
  }

  // --- initiative linkage ------------------------------------------------
  heading('Initiative linkage');
  const aligned = activeItems.filter((i) => i.alignment === 'initiative').length;
  const local = activeItems.filter((i) => i.alignment === 'local').length;
  line(bar('Linked to a programme', aligned, coverage.itemsActive));
  line(bar('Site-local', local, coverage.itemsActive));

  const withDates = initiatives.filter((i) => i.hasDates).length;
  const withoutDates = initiatives.filter((i) => !i.hasDates);
  line(`\n  ${withDates} initiatives have a plottable span; ${withoutDates.length} do not.`);
  if (withoutDates.length > 0) {
    line(`  "No dates reported" group: ${withoutDates.slice(0, 6).map((i) => i.summary).join(', ')}${withoutDates.length > 6 ? ', ...' : ''}`);
  }

  const phoenix = initiatives.find((i) => /phoenix/i.test(i.summary));
  if (phoenix) {
    const siteCount = phoenix.siteRollup.length;
    line(`\n  Cross-check "${phoenix.summary}": ${phoenix.itemKeys.length} items across ${siteCount} sites`);
    line(`    sites: ${phoenix.siteRollup.map((s) => s.siteCode).join(', ')}`);
    // Discovery measured 16 items across 11 sites over the ORIGINAL 23-project
    // scope. Four sites are now deferred, so a lower count here is expected and
    // is not evidence of a link-matching regression. The threshold is reduced
    // accordingly; what still matters is that undirected matching resolves a
    // meaningful cross-site rollup at all.
    if (phoenix.itemKeys.length >= 6) {
      record(
        'PASS',
        'Undirected link matching works',
        `${phoenix.summary} resolved ${phoenix.itemKeys.length} items across ${siteCount} sites ` +
          `(discovery found 16 across 11, over the pre-rebaseline 23-project scope)`,
      );
    } else {
      record(
        'WARN',
        'Phoenix linkage lower than expected',
        `${phoenix.itemKeys.length} items across ${siteCount} sites. Some of the shortfall is the ` +
          `scope reduction, but below 6 the link direction handling should be checked for a regression.`,
      );
    }
  }

  // --- config hygiene ----------------------------------------------------
  heading('Config hygiene');

  const deferred = Object.keys(DEFERRED_SITES);
  line(`  Deferred from MVP scope: ${deferred.join(', ')}`);
  const leakedDeferred = items.filter((i) => deferred.includes(i.siteKey));
  if (leakedDeferred.length > 0) {
    record(
      'FAIL',
      'Deferred site present in snapshot',
      `${leakedDeferred.length} items from ${[...new Set(leakedDeferred.map((i) => i.siteKey))].join(', ')} ` +
        `— these projects are out of MVP scope but were ingested.`,
    );
  } else {
    record('PASS', 'No deferred sites in snapshot', `${deferred.length} deferred projects, none ingested`);
  }

  // Any item whose initiative link resolved through a deferred project would
  // change alignment silently; the counterpart-membership check should prevent
  // it, but the scope reduction makes this newly reachable.
  const deferredLinked = items.filter((i) => i.initiativeKey && deferred.some((d) => i.initiativeKey!.startsWith(`${d}-`)));
  if (deferredLinked.length > 0) {
    record(
      'FAIL',
      'Initiative resolved through a deferred project',
      `${deferredLinked.length} items link to an initiative in a deferred project, e.g. ${deferredLinked[0]!.key}`,
    );
  }

  if (INHERITED_BASELINE_KEYS.length > 0) {
    record(
      'WARN',
      'Baseline metrics awaiting re-measurement',
      `${INHERITED_BASELINE_KEYS.join(', ')} still carry pre-rebaseline (23-project) values, so ` +
        `drift on those lines is expected and is not a defect. Re-measure from this run and ` +
        `update DISCOVERY_BASELINE in config/projects.ts.`,
    );
  }

  const dupeCodes = findDuplicateSiteCodes();
  if (dupeCodes.length === 0) record('PASS', 'Site codes unique', 'no duplicate 3-letter codes');
  else record('FAIL', 'Duplicate site codes', dupeCodes.join(', '));

  if (UNCONFIRMED_SITE_CODES.length > 0) {
    record(
      'WARN',
      'Unconfirmed site codes',
      `${UNCONFIRMED_SITE_CODES.join(', ')} were proposed by the plan, not observed in the ` +
        `reference report. Open question 3.`,
    );
  }

  if (coverage.flaggedFieldPopulated > 0) {
    record(
      'WARN',
      'Flagged field is now populated',
      `${coverage.flaggedFieldPopulated} issues use customfield_10387, which was empty at discovery. ` +
        `It may now be usable as a blocker signal.`,
    );
  } else {
    record('PASS', 'Flagged field still unusable', 'zero issues populate customfield_10387, as at discovery');
  }

  // --- warnings ----------------------------------------------------------
  heading(`Sync warnings (${snapshot.warnings.length})`);
  if (snapshot.warnings.length === 0) {
    line('  none');
  } else {
    const grouped = new Map<string, number>();
    for (const w of snapshot.warnings) {
      const kind = w.replace(/"[^"]*"/g, '"..."').replace(/\b[A-Z]+-\d+\b/g, 'KEY').slice(0, 110);
      grouped.set(kind, (grouped.get(kind) ?? 0) + 1);
    }
    for (const [kind, count] of [...grouped.entries()].sort((a, b) => b[1] - a[1]).slice(0, 15)) {
      line(`  ${count > 1 ? `(x${count}) ` : ''}${kind}`);
    }
    if (grouped.size > 15) line(`  ...and ${grouped.size - 15} more distinct warnings`);
  }

  // --- samples -----------------------------------------------------------
  heading('Sample records (one per executive summary source)');
  for (const source of ['spot', 'jira-description', 'generated'] as const) {
    const sample =
      activeItems.find((i) => i.narrative.summarySource === source && i.risk.atRisk) ??
      activeItems.find((i) => i.narrative.summarySource === source);

    line(`\n  [${source}]`);
    if (!sample) {
      line('    (none in this snapshot)');
      continue;
    }
    line(`    ${sample.key}  ${sample.summary.cleanTitle}`);
    line(`    ${sample.siteName} (${sample.siteCode}) · ${sample.region}${sample.initiativeKey ? ` · ${sample.initiativeKey}` : ' · site-local'}`);
    line(`    status: ${sample.risk.level} (${sample.risk.provenance})${sample.risk.authored ? ` — "${sample.risk.authored.value}" from ${sample.risk.authored.sourceLabel}` : ''}`);
    line(`    dates:  ${sample.start ?? '—'} → ${sample.goLive ?? '—'}  [${sample.fiscalYears.join(', ') || 'not plottable'}]`);
    if (sample.spotId) line(`    spot:   ${sample.spotId} (from ${sample.spotIdSource})`);
    line(`    summary: ${sample.narrative.executiveSummary.replace(/\s+/g, ' ').slice(0, 260)}`);
    if (sample.narrative.summaryBasis) {
      line(`    basis:   ${sample.narrative.summaryBasis.join(', ')}`);
    }
  }

  // --- verdict -----------------------------------------------------------
  const fails = checks.filter((c) => c.level === 'FAIL');
  const warns = checks.filter((c) => c.level === 'WARN');
  const passes = checks.filter((c) => c.level === 'PASS');

  heading('Checks');
  for (const check of checks) {
    line(`  ${check.level.padEnd(4)} ${check.label}`);
    line(`       ${check.detail}`);
  }

  heading('Verdict');
  line(`  ${passes.length} passed · ${warns.length} warning(s) · ${fails.length} failure(s)`);

  if (fails.length > 0) {
    line('\n  GATE NOT MET — resolve the failures above before UI work.');
    process.exit(1);
  }

  line('\n  GATE MET — the data model reproduces the discovery metrics.');
  line('  Warnings are expected findings (data quality, open questions), not defects.');
}

main().catch((error: unknown) => {
  process.stderr.write(`\nVerification failed: ${(error as Error).message}\n`);
  process.exit(1);
});
