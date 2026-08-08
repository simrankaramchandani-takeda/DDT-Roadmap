/**
 * Feed #3 validation report -- READ ONLY.
 *
 * Run: npm run validate-feed3
 *
 * Reads the feed once through the SAME path the application uses -- client, source,
 * WP4 adapter, WP3 repositories -- and reports on exactly the data those repositories
 * would serve. It does not re-read the feed, re-implement a transformation, or apply a
 * second set of rules; reporting on a different pull than the one the app serves would
 * make the report reassuring rather than true.
 *
 * WHAT IT ANSWERS, in order of how much it would cost to get wrong:
 *
 *   1. Connection and shape -- am I talking to the feed I think I am?
 *   2. Validation -- what came back, what transformed, what was refused.
 *   3. Site and project mapping -- does every exported project resolve to a site?
 *   4. Unknown issue types -- the capture list for ISSUE_TYPE_LEVELS, which writes
 *      itself here because an unregistered type SILENTLY drops a site's work.
 *   5. Anomalies against the fixture's assumptions -- new statuses, new types, new
 *      owner fields, unexpected date formats, unexpected project aliases.
 *
 * IT PRINTS NO ISSUE CONTENT. Keys, counts, status names, type names and project keys
 * only -- never a summary, description, narrative or person's name. The report is meant
 * to be pasteable into a ticket, and real portfolio content is not.
 *
 * EXIT CODE. Non-zero when the adaptation produced blocking errors, so this is usable as
 * a gate before the source is trusted. A warning is not a failure: warnings are the
 * dataset describing itself, and this application exists to report them.
 */

import { existsSync } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

import { FEED_OWNER_SIDE_TABLES, ISSUE_TYPE_LEVELS, SITE_KEY_ALIASES } from '@config/feed.js';
import { OWNER_FIELD_CANDIDATES } from '@config/fields.js';
import {
  ALL_PROJECT_KEYS,
  DISCOVERY_BASELINE,
  PORTFOLIO_KEYS,
  SITE_KEYS,
} from '@config/projects.js';
import { STATUS_NAME_TO_PHASE } from '@config/status-map.js';
import { assessCompleteness, type CompletenessFinding } from '@/lib/feed/completeness.js';
import { createODataRepositories } from '@/lib/feed/odata-repositories.js';
import { classifyFeedProject, feedText } from '@/lib/feed/normalise.js';
import { redactText } from '@/lib/feed/odata-client.js';
import { stripStatusSuffix } from '@/lib/normalise.js';
import { todayIso } from '@/lib/transform.js';

/**
 * Raw rows are real Jira content, so anything derived from them that is not a count
 * goes under `data/probe/`, which is gitignored for exactly this reason.
 */
const REPORT_DIR = path.resolve('data', 'probe');
const REPORT_PATH = path.join(REPORT_DIR, 'feed3-validation.json');

const line = (text = ''): void => void process.stdout.write(`${text}\n`);
const heading = (text: string): void =>
  void process.stdout.write(`\n${text}\n${'-'.repeat(Math.max(text.length, 66))}\n`);

/** Minimal .env.local loader, matching `sync.ts` and `probe-odata.ts`. */
async function loadDotEnvLocal(): Promise<void> {
  const envPath = path.resolve('.env.local');
  if (!existsSync(envPath)) return;

  const contents = await readFile(envPath, 'utf8');
  for (const raw of contents.split(/\r?\n/)) {
    const trimmed = raw.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    if (eq === -1) continue;
    const key = trimmed.slice(0, eq).trim();
    let value = trimmed.slice(eq + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    if (!process.env[key]) process.env[key] = value;
  }
}

function tallyInto<K>(map: Map<K, number>, key: K): void {
  map.set(key, (map.get(key) ?? 0) + 1);
}

function sortedTally<K>(map: Map<K, number>): [K, number][] {
  return [...map.entries()].sort((a, b) => b[1] - a[1]);
}

// ---------------------------------------------------------------------------
// Date-format classification
// ---------------------------------------------------------------------------

/**
 * Classifies a raw date cell.
 *
 * `parseFeedDate` truncates to `YYYY-MM-DD` and `parseFeedTimestamp` rejects anything
 * unrecognisable, so both fail SOFT -- which is right for a pipeline and useless for a
 * report. A value silently dropped because it was `31/03/2029` rather than `2029-03-31`
 * is precisely the anomaly worth naming, so this classifies rather than parses.
 */
function classifyDateFormat(raw: unknown): string {
  if (raw === null || raw === undefined || raw === '') return 'empty';
  if (typeof raw === 'number') return 'number (epoch?)';
  if (typeof raw !== 'string') return `non-string (${typeof raw})`;

  const value = raw.trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) return 'YYYY-MM-DD';
  if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?Z$/.test(value)) return 'ISO 8601 UTC (Z)';
  if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?[+-]\d{2}:?\d{2}$/.test(value)) return 'ISO 8601 offset';
  if (/^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}(:\d{2})?$/.test(value)) return 'date-time, no zone';
  if (/^\d{2}\/\d{2}\/\d{4}$/.test(value)) return 'DD/MM/YYYY or MM/DD/YYYY (AMBIGUOUS)';
  if (/^\d{2}-\d{2}-\d{4}$/.test(value)) return 'DD-MM-YYYY (AMBIGUOUS)';
  return 'UNRECOGNISED';
}

const DATE_COLUMNS = ['CREATED', 'UPDATED', 'DUE_DATE', 'RESOLUTION_DATE', 'STATUS_CATEGORY_CHANGE_DATE'] as const;

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  await loadDotEnvLocal();

  const asOf = process.env['SNAPSHOT_AS_OF'] ?? todayIso();

  line('DDT Roadmap — Feed #3 validation report (read-only)');
  line(`  as of     ${asOf}`);
  line(`  scope     ${ALL_PROJECT_KEYS.length} projects (${PORTFOLIO_KEYS.length} portfolio, ${SITE_KEYS.length} site)`);
  line('');
  line('Reading the feed through the application\'s own client → adapter → repositories.');

  const odata = createODataRepositories({
    adapter: { asOf },
    // Report on one read, not on a cache that may expire mid-report.
    cacheTtlMs: 0,
    onProgress: (message) => line(`  ${message}`),
  });

  const { read, adaptation, diagnostics } = await odata.ready();
  const { payload } = read;
  const { snapshot } = adaptation;

  // -------------------------------------------------------------------------
  // 1. Connection and shape
  // -------------------------------------------------------------------------
  heading('1. Connection and shape');
  line(`  feed identity     ${payload.metadata.name}`);
  line(`  origin            ${payload.metadata.origin ?? '(not recorded)'}`);
  line(`  retrieved at      ${payload.metadata.retrievedAt}`);
  line(`  entity sets (${read.entitySets.length})  ${read.entitySets.join(', ')}`);
  line(`  Issues columns    ${read.issueColumns.length}`);
  line('');
  line('  rows per entity set read:');
  for (const [name, count] of Object.entries(payload.metadata.rowCounts ?? {})) {
    line(`    ${name.padEnd(34)} ${String(count).padStart(6)}`);
  }

  const shapeFindings = read.diagnostics;
  line('');
  if (shapeFindings.length === 0) {
    line('  Shape matches the feed as surveyed 2026-08-07. No divergence.');
  } else {
    line(`  ${shapeFindings.length} shape finding(s):`);
    for (const finding of shapeFindings) {
      line(`    [${finding.severity}] ${finding.code} — ${finding.subject}`);
      line(`      ${finding.message}`);
      if (finding.remedy) line(`      -> ${finding.remedy}`);
    }
  }

  // -------------------------------------------------------------------------
  // 2. Validation report
  // -------------------------------------------------------------------------
  const issueRows = payload.issues;
  const errors = diagnostics.filter((d) => d.severity === 'error');
  const warnings = diagnostics.filter((d) => d.severity === 'warning');

  // Unknown types and unmapped statuses are counted over RAW ROWS rather than over
  // diagnostics, because the collector dedupes by subject and a single unregistered type
  // raises one diagnostic per affected issue. The capture list needs the type, not the
  // issues.
  const unknownTypes = new Map<string, { name: string; scope: string; count: number; projects: Set<string> }>();
  const unmappedStatuses = new Map<string, number>();
  const statusNames = new Map<string, number>();
  const typeNames = new Map<string, number>();
  const projectRows = new Map<string, number>();
  const dateFormats = new Map<string, Map<string, number>>();

  const typesById = new Map<string, { name?: string; scopeType?: string; scopeId?: string }>();
  for (const row of payload.issueTypes ?? []) {
    const id = feedText(row.ISSUE_TYPE_ID);
    if (!id) continue;
    typesById.set(id, {
      ...(feedText(row.ISSUE_TYPE_NAME) ? { name: feedText(row.ISSUE_TYPE_NAME) } : {}),
      ...(feedText(row.SCOPE_TYPE) ? { scopeType: feedText(row.SCOPE_TYPE) } : {}),
      ...(feedText(row.SCOPE_ID) ? { scopeId: feedText(row.SCOPE_ID) } : {}),
    });
  }

  for (const row of issueRows) {
    const projectKey = feedText(row.PROJECT_KEY) ?? '(missing PROJECT_KEY)';
    tallyInto(projectRows, projectKey);

    const inScope = ALL_PROJECT_KEYS.includes(projectKey.toUpperCase());

    const statusName = feedText(row.ISSUE_STATUS_NAME);
    if (statusName) {
      tallyInto(statusNames, statusName);
      const phase = STATUS_NAME_TO_PHASE[stripStatusSuffix(statusName).toLowerCase().trim()];
      // Only in-scope rows matter: the adapter never reads a status on a project it does
      // not sync, so an unmapped status out of scope is not a defect to fix.
      if (!phase && inScope) tallyInto(unmappedStatuses, statusName);
    }

    const typeId = feedText(row.ISSUE_TYPE_ID);
    const typeName = feedText(row.ISSUE_TYPE_NAME) ?? (typeId ? typesById.get(typeId)?.name : undefined);
    if (typeName) tallyInto(typeNames, typeName);

    if (inScope && typeId && ISSUE_TYPE_LEVELS[typeId] === undefined) {
      const meta = typesById.get(typeId);
      const entry = unknownTypes.get(typeId) ?? {
        name: typeName ?? meta?.name ?? '(unnamed)',
        scope: `${meta?.scopeType ?? '?'}/${meta?.scopeId ?? '?'}`,
        count: 0,
        projects: new Set<string>(),
      };
      entry.count++;
      entry.projects.add(projectKey);
      unknownTypes.set(typeId, entry);
    }

    for (const column of DATE_COLUMNS) {
      const shapes = dateFormats.get(column) ?? new Map<string, number>();
      tallyInto(shapes, classifyDateFormat(row[column]));
      dateFormats.set(column, shapes);
    }
  }

  const unmappedSiteFindings = diagnostics.filter((d) => d.code === 'unmapped-site');

  heading('2. Validation report');
  line(`  records retrieved         ${issueRows.length} Issues rows`);
  line(`  link rows                 ${payload.issueLinks?.length ?? 0}`);
  line(`  label rows                ${payload.labels?.length ?? 0}`);
  line(`  issue type rows           ${payload.issueTypes?.length ?? 0}`);
  line('');
  line(`  transformed records       ${snapshot.items.length} roadmap items (level 1)`);
  line(`                            ${snapshot.initiatives.length} initiatives (incl. the site-local lane)`);
  line(`                            ${snapshot.sites.length} sites carrying active work`);
  line('');
  line(`  warning count             ${warnings.length}`);
  line(`  blocking error count      ${errors.length}`);
  line(`  overall severity          ${adaptation.severity}`);
  line('');
  line(`  unresolved issue types    ${unknownTypes.size} distinct type ID(s), affecting ${[...unknownTypes.values()].reduce((n, t) => n + t.count, 0)} in-scope row(s)`);
  line(`  unresolved site mappings  ${unmappedSiteFindings.length}`);
  line(`  unmapped status names     ${unmappedStatuses.size}`);
  line('');
  line('  diagnostics by code:');
  for (const [code, count] of Object.entries(adaptation.tally).sort((a, b) => b[1] - a[1])) {
    line(`    ${code.padEnd(24)} ${String(count).padStart(5)}`);
  }

  if (unmappedStatuses.size > 0) {
    line('');
    line('  UNMAPPED STATUS NAMES (each one skips every row carrying it):');
    for (const [name, count] of sortedTally(unmappedStatuses)) {
      line(`    "${name}" — ${count} row(s)`);
    }
    line('    -> Add to STATUS_NAME_TO_PHASE in config/status-map.ts.');
  }

  // -------------------------------------------------------------------------
  // 3. Site / project mapping report
  // -------------------------------------------------------------------------
  heading('3. Site and project mapping report');

  const itemsByProject = new Map<string, number>();
  for (const item of snapshot.items) tallyInto(itemsByProject, item.siteKey);

  line('  project      rows  items  classification');
  for (const [projectKey, rows] of [...projectRows.entries()].sort((a, b) => a[0].localeCompare(b[0]))) {
    const scope = classifyFeedProject(projectKey);
    const label =
      scope.kind === 'site'
        ? `site: ${scope.site.name} (${scope.site.region})`
        : scope.kind === 'portfolio'
          ? 'portfolio project'
          : scope.kind === 'out-of-scope'
            ? `OUT OF SCOPE — ${scope.reason}`
            : 'UNKNOWN — not in the site registry';
    const items = itemsByProject.get(projectKey) ?? 0;
    line(
      `  ${projectKey.padEnd(12)} ${String(rows).padStart(4)}  ${String(items).padStart(5)}  ${label}`,
    );
  }

  const exportedKeys = new Set([...projectRows.keys()].map((k) => k.toUpperCase()));
  const missingFromFeed = ALL_PROJECT_KEYS.filter((key) => !exportedKeys.has(key));
  line('');
  if (missingFromFeed.length === 0) {
    line(`  All ${ALL_PROJECT_KEYS.length} in-scope projects are present in the export.`);
  } else {
    line(`  IN-SCOPE PROJECTS ABSENT FROM THE EXPORT (${missingFromFeed.length}):`);
    for (const key of missingFromFeed) line(`    ${key}`);
    line('    -> A configured site with no rows renders as an empty site. Confirm export scope.');
  }

  const sitesWithNoItems = SITE_KEYS.filter((key) => (itemsByProject.get(key) ?? 0) === 0);
  if (sitesWithNoItems.length > 0) {
    line('');
    line(`  CONFIGURED SITES WITH ZERO TRANSFORMED ITEMS (${sitesWithNoItems.length}):`);
    for (const key of sitesWithNoItems) {
      line(`    ${key} — ${projectRows.get(key) ?? 0} raw row(s) exported`);
    }
    line('    -> Raw rows but no items means selection dropped them: check the type registry.');
  }

  line('');
  line(`  discovery baseline: ${DISCOVERY_BASELINE.initiatives} initiatives expected in the portfolio project`);

  // -------------------------------------------------------------------------
  // 4. Unknown issue type report
  // -------------------------------------------------------------------------
  heading('4. Unknown issue type report');
  if (unknownTypes.size === 0) {
    line('  Every in-scope ISSUE_TYPE_ID resolves through ISSUE_TYPE_LEVELS.');
  } else {
    line('  Each of these SKIPS every row carrying it. Type IDs are per-project in');
    line('  team-managed projects, so this list can only be completed by capture.');
    line('');
    line('  type ID   rows  scope              name / projects');
    for (const [id, entry] of [...unknownTypes.entries()].sort((a, b) => b[1].count - a[1].count)) {
      line(
        `  ${id.padEnd(9)} ${String(entry.count).padStart(4)}  ${entry.scope.padEnd(18)} ${entry.name}`,
      );
      line(`  ${' '.repeat(9)}       ${' '.repeat(18)} in: ${[...entry.projects].sort().join(', ')}`);
    }
    line('');
    line('  -> Capture hierarchyLevel from Jira REST /rest/api/3/issuetype and add each');
    line('     ID to ISSUE_TYPE_LEVELS in config/feed.ts. Do not infer a level from the name.');
  }

  line('');
  line(`  registry size: ${Object.keys(ISSUE_TYPE_LEVELS).length} type IDs`);
  line('  issue type names observed across all rows:');
  for (const [name, count] of sortedTally(typeNames)) {
    line(`    ${name.padEnd(24)} ${String(count).padStart(5)}`);
  }

  // -------------------------------------------------------------------------
  // 5. Anomalies against the fixture's assumptions
  // -------------------------------------------------------------------------
  heading('5. Feed anomalies against the fixture assumptions');

  const knownStatuses = new Set(Object.keys(STATUS_NAME_TO_PHASE));
  const newStatuses = [...statusNames.keys()].filter(
    (name) => !knownStatuses.has(stripStatusSuffix(name).toLowerCase().trim()),
  );
  line(`  status names observed     ${statusNames.size}`);
  line(`  not in STATUS_NAME_TO_PHASE (any scope): ${newStatuses.length}`);
  for (const name of newStatuses.sort()) line(`    "${name}" — ${statusNames.get(name)} row(s)`);

  const newTypes = [...unknownTypes.keys()];
  line('');
  line(`  issue type IDs not in ISSUE_TYPE_LEVELS (in scope): ${newTypes.length}`);
  for (const id of newTypes) line(`    ${id} (${unknownTypes.get(id)?.name})`);

  // Owner fields: which of the declared side tables actually arrived, and which owner
  // candidates the Issues columns can satisfy.
  line('');
  line('  owner sources:');
  for (const table of FEED_OWNER_SIDE_TABLES) {
    const rows = payload.owners?.[table.entitySet];
    const present = read.entitySets.includes(table.entitySet);
    const distinctIssues = new Set((rows ?? []).map((r) => r.ISSUE_KEY)).size;
    line(
      `    ${table.entitySet.padEnd(34)} ${present ? 'exported' : 'NOT EXPORTED'} — ` +
        `${rows?.length ?? 0} row(s) over ${distinctIssues} issue(s) -> ${table.fieldId}`,
    );
  }
  const ownerColumnIds = new Set(
    read.issueColumns
      .map((column) => /_(\d{4,6})$/.exec(column)?.[1])
      .filter((id): id is string => id !== undefined)
      .map((id) => `customfield_${id}`),
  );
  const ownerCandidatesPresent = OWNER_FIELD_CANDIDATES.filter((c) => ownerColumnIds.has(c.id));
  const ownerCandidatesAbsent = OWNER_FIELD_CANDIDATES.filter(
    (c) => !ownerColumnIds.has(c.id) && !FEED_OWNER_SIDE_TABLES.some((t) => t.fieldId === c.id),
  );
  line(
    `    OWNER_FIELD_CANDIDATES reachable as Issues columns: ${ownerCandidatesPresent.length}/${OWNER_FIELD_CANDIDATES.length}` +
      (ownerCandidatesPresent.length > 0
        ? ` (${ownerCandidatesPresent.map((c) => `${c.id} ${c.role}`).join(', ')})`
        : ''),
  );
  if (ownerCandidatesAbsent.length > 0) {
    line(`    not exported at all: ${ownerCandidatesAbsent.map((c) => c.id).join(', ')}`);
  }

  line('');
  line('  date formats by column:');
  for (const column of DATE_COLUMNS) {
    const shapes = dateFormats.get(column);
    if (!shapes) continue;
    const rendered = sortedTally(shapes)
      .map(([shape, count]) => `${shape} ×${count}`)
      .join(', ');
    line(`    ${column.padEnd(30)} ${rendered}`);
  }
  const ambiguous = DATE_COLUMNS.filter((column) =>
    [...(dateFormats.get(column)?.keys() ?? [])].some((shape) => shape.includes('AMBIGUOUS') || shape === 'UNRECOGNISED'),
  );
  if (ambiguous.length > 0) {
    line(`    UNEXPECTED FORMAT in: ${ambiguous.join(', ')}`);
    line('    -> parseFeedDate/parseFeedTimestamp reject these silently. Investigate before trusting dates.');
  }

  // Project aliases: a feed key that resolves only via trim/upper-case, or not at all.
  const aliasFindings: string[] = [];
  for (const raw of projectRows.keys()) {
    const upper = raw.trim().toUpperCase();
    if (raw !== upper) aliasFindings.push(`"${raw}" needed trim/upper-case to reach ${upper}`);
    if (SITE_KEY_ALIASES[upper]) aliasFindings.push(`${upper} resolved through SITE_KEY_ALIASES`);
  }
  line('');
  line(`  project key aliases required: ${aliasFindings.length}`);
  for (const finding of aliasFindings) line(`    ${finding}`);
  if (aliasFindings.length === 0) {
    line('    Every exported PROJECT_KEY matched a config key verbatim. SITE_KEY_ALIASES stays empty.');
  }

  // -------------------------------------------------------------------------
  // 6. Portfolio completeness
  // -------------------------------------------------------------------------
  const completeness = assessCompleteness(payload, snapshot);

  heading('6. Portfolio completeness report');
  line('  Reconciliation -- every in-scope level-1 row must become a roadmap item:');
  line(`    in-scope rows            ${completeness.reconciliation.inScopeRows}`);
  line(`    level-1 rows (sites)     ${completeness.reconciliation.level1Rows}`);
  line(`    roadmap items produced   ${completeness.reconciliation.items}`);
  line(
    `    UNACCOUNTED FOR          ${completeness.reconciliation.unaccounted}` +
      (completeness.reconciliation.unaccounted === 0 ? '  (reconciles)' : '  <-- work missing from the dashboard'),
  );

  line('');
  line(`  Sites: ${completeness.sites.withItems}/${completeness.sites.configured} carry roadmap items.`);
  if (completeness.sites.withoutItems.length > 0) {
    line(`    without items: ${completeness.sites.withoutItems.join(', ')}`);
  }

  line('');
  line('  Initiatives:');
  line(`    discovery baseline       ${completeness.initiatives.expected}`);
  line(`    level-2 rows in feed     ${completeness.initiatives.returnedByFeed}`);
  line(`    in snapshot (real)       ${completeness.initiatives.inSnapshot}`);
  line(`    dangling references      ${completeness.initiatives.dangling.length}${completeness.initiatives.dangling.length > 0 ? ` (${completeness.initiatives.dangling.join(', ')})` : ''}`);
  line(`    carrying no items        ${completeness.initiatives.withNoItems.length}${completeness.initiatives.withNoItems.length > 0 ? ` (${completeness.initiatives.withNoItems.join(', ')})` : ''}`);

  line('');
  line('  Per-project reconciliation:');
  line('    project      rows  lvl1  lvl2  unreg  items  unacct  classification');
  for (const p of completeness.projects) {
    line(
      `    ${p.key.padEnd(12)} ${String(p.rows).padStart(4)}  ${String(p.level1Rows).padStart(4)}  ` +
        `${String(p.level2Rows).padStart(4)}  ${String(p.unregisteredRows).padStart(5)}  ` +
        `${String(p.items).padStart(5)}  ${String(p.unaccounted).padStart(6)}  ${p.classification}`,
    );
  }

  line('');
  line('  Field yield, over ACTIVE items -- the basis buildCoverage uses.');
  line('  Each stage is nested in the one above, so a drop localises the cause:');
  line('    populated -> parsed  = parser;  parsed -> authored = data;  authored -> used = summariser.');
  for (const y of completeness.yields) {
    const pct = (y.yield * 100).toFixed(1);
    // `status text authored` is expected to be well under 100%: 50 SPOT tables carry no
    // authored paragraph. Flagging it would train the reader to ignore this whole block.
    const expectedLow = y.field === 'status text authored';
    line(
      `    ${y.field.padEnd(21)} ${String(y.populatedInFeed).padStart(4)} -> ` +
        `${String(y.resolvedInModel).padStart(4)}  (${pct}%)` +
        (y.yield < 0.95 && !expectedLow ? '  <-- investigate' : '') +
        (expectedLow ? '  (expected: authored content, not a defect)' : ''),
    );
  }

  const byKind = (kind: CompletenessFinding['kind']): CompletenessFinding[] =>
    completeness.findings.filter((f) => f.kind === kind);

  for (const kind of ['missing', 'duplicate', 'orphaned', 'excluded'] as const) {
    const found = byKind(kind);
    line('');
    line(`  ${kind.toUpperCase()} entities: ${found.length}`);
    for (const finding of found) line(`    ${finding.subject}: ${finding.detail}`);
  }

  // -------------------------------------------------------------------------
  // Machine-readable copy, and the verdict
  // -------------------------------------------------------------------------
  await mkdir(REPORT_DIR, { recursive: true });
  await writeFile(
    REPORT_PATH,
    JSON.stringify(
      {
        generatedAt: new Date().toISOString(),
        asOf,
        feed: {
          name: payload.metadata.name,
          origin: payload.metadata.origin,
          retrievedAt: payload.metadata.retrievedAt,
          entitySets: read.entitySets,
          issueColumnCount: read.issueColumns.length,
          issueColumns: read.issueColumns,
          rowCounts: payload.metadata.rowCounts,
        },
        totals: {
          issueRows: issueRows.length,
          items: snapshot.items.length,
          initiatives: snapshot.initiatives.length,
          sites: snapshot.sites.length,
          warnings: warnings.length,
          errors: errors.length,
          severity: adaptation.severity,
        },
        tally: adaptation.tally,
        unknownIssueTypes: [...unknownTypes.entries()].map(([id, e]) => ({
          id,
          name: e.name,
          scope: e.scope,
          rows: e.count,
          projects: [...e.projects].sort(),
        })),
        unmappedStatuses: Object.fromEntries(unmappedStatuses),
        statusNames: Object.fromEntries(statusNames),
        issueTypeNames: Object.fromEntries(typeNames),
        rowsByProject: Object.fromEntries(projectRows),
        itemsByProject: Object.fromEntries(itemsByProject),
        inScopeProjectsAbsentFromFeed: missingFromFeed,
        sitesWithNoItems: sitesWithNoItems,
        dateFormats: Object.fromEntries(
          [...dateFormats.entries()].map(([column, shapes]) => [column, Object.fromEntries(shapes)]),
        ),
        coverage: snapshot.coverage,
        completeness: {
          ok: completeness.ok,
          reconciliation: completeness.reconciliation,
          sites: completeness.sites,
          initiatives: completeness.initiatives,
          yields: completeness.yields,
          projects: completeness.projects,
          findings: completeness.findings,
        },
        diagnostics: diagnostics.map((d) => ({
          severity: d.severity,
          code: d.code,
          subject: d.subject,
          message: d.message,
          ...(d.remedy ? { remedy: d.remedy } : {}),
        })),
      },
      null,
      2,
    ),
    'utf8',
  );

  heading('Verdict');
  line(`  full report  ${path.relative(process.cwd(), REPORT_PATH)} (gitignored — contains real keys)`);
  line('');
  if (errors.length > 0) {
    line(`  BLOCKING: ${errors.length} error(s). Records were skipped, so the served portfolio is`);
    line('  incomplete. Resolve the reports above before this source is trusted.');
    process.exitCode = 1;
    return;
  }

  if (!completeness.ok) {
    line('  BLOCKING: the portfolio does not reconcile. No record was refused, but entities are');
    line('  missing or duplicated — which is the failure a per-row diagnostic cannot catch.');
    process.exitCode = 1;
    return;
  }

  line(`  No blocking errors, and the portfolio reconciles: ${completeness.reconciliation.level1Rows}`);
  line(`  level-1 rows produced ${completeness.reconciliation.items} items with none unaccounted for.`);
  line(`  ${warnings.length} warning(s) — these are the dataset describing itself and are`);
  line('  reported on the Data & coverage page by design.');
}

main().catch((error: unknown) => {
  process.stderr.write(`\nValidation failed: ${redactText((error as Error).message)}\n`);
  const body = (error as { body?: string }).body;
  if (body) process.stderr.write(`${redactText(body.slice(0, 500))}\n`);
  process.exit(1);
});
