/**
 * Jira -> data/snapshot.json
 *
 * Run: npm run sync
 *
 * Writes atomically (temp file + rename) so a failed or partial sync never
 * truncates a good snapshot -- a stale-but-valid dashboard is far better than an
 * empty or half-populated one.
 */

import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';

import { ALL_PROJECT_KEYS, PORTFOLIOS } from '@config/projects.js';
import { SYNC_FIELDS } from '@config/fields.js';
import { loadJiraConfig, searchAllIssues, type JiraIssue } from '@/lib/jira-client.js';
import {
  buildUnalignedInitiative,
  classifyIssues,
  countFlaggedPopulated,
  findInitiativeKey,
  todayIso,
  transformInitiative,
  transformItem,
  type TransformContext,
} from '@/lib/transform.js';
import { buildCoverage, buildSiteSummaries } from '@/lib/rollup.js';
import { snapshotSchema, type Initiative, type RoadmapItem, type Snapshot } from '@/types/domain.js';

const DATA_DIR = path.resolve('data');
const SNAPSHOT_PATH = path.join(DATA_DIR, 'snapshot.json');
const META_PATH = path.join(DATA_DIR, 'snapshot.meta.json');

/**
 * Minimal .env.local loader. Avoids a dotenv dependency for a nine-line job, and
 * keeps the sync runnable with zero runtime deps beyond zod.
 */
async function loadDotEnvLocal(): Promise<void> {
  const envPath = path.resolve('.env.local');
  if (!existsSync(envPath)) return;

  const contents = await readFile(envPath, 'utf8');
  for (const line of contents.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;

    const eq = trimmed.indexOf('=');
    if (eq === -1) continue;

    const key = trimmed.slice(0, eq).trim();
    let value = trimmed.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    // Real environment variables win over the file.
    if (!process.env[key]) process.env[key] = value;
  }
}

function log(message: string): void {
  process.stdout.write(`${message}\n`);
}

async function writeAtomic(filePath: string, contents: string): Promise<void> {
  const tmp = `${filePath}.tmp`;
  await writeFile(tmp, contents, 'utf8');
  await rename(tmp, filePath);
}

async function main(): Promise<void> {
  await loadDotEnvLocal();

  const config = loadJiraConfig();
  const asOf = process.env['SNAPSHOT_AS_OF'] ?? todayIso();
  const warnings: string[] = [];
  const context: TransformContext = { baseUrl: config.baseUrl, asOf, warnings };

  log(`DDT Roadmap sync`);
  log(`  site      ${config.baseUrl}`);
  log(`  as of     ${asOf}`);
  log(`  projects  ${ALL_PROJECT_KEYS.length} (${PORTFOLIOS.length} portfolio, ${ALL_PROJECT_KEYS.length - PORTFOLIOS.length} site)`);
  log('');

  // ---------------------------------------------------------------------
  // 1. Fetch
  // ---------------------------------------------------------------------
  // One query across all projects rather than one per project: fewer round trips,
  // and cross-project links resolve in a single pass.
  //
  // No issuetype filter -- items are selected by hierarchy level after fetching,
  // because type names vary per project (DDTJG uses "Digital Project", not "Epic").
  const jql = `project in (${ALL_PROJECT_KEYS.join(', ')}) ORDER BY key ASC`;

  log('Fetching issues...');
  const allIssues = await searchAllIssues(
    config,
    { jql, fields: SYNC_FIELDS, maxResults: 100 },
    (count) => process.stdout.write(`\r  ${count} issues fetched`),
  );
  process.stdout.write('\n');
  log(`  ${allIssues.length} issues returned across all hierarchy levels`);

  // ---------------------------------------------------------------------
  // 2. Classify by hierarchy level
  // ---------------------------------------------------------------------
  const { items: rawItems, initiatives: rawInitiatives } = classifyIssues(allIssues, warnings);
  log(`  ${rawItems.length} roadmap items (level 1), ${rawInitiatives.length} initiatives (level 2)`);

  const typeNameCounts = new Map<string, number>();
  for (const issue of rawItems) {
    const name = (issue.fields['issuetype'] as { name?: string } | undefined)?.name ?? 'Unknown';
    typeNameCounts.set(name, (typeNameCounts.get(name) ?? 0) + 1);
  }
  log(
    `  level-1 types: ${[...typeNameCounts.entries()]
      .map(([n, c]) => `${n} (${c})`)
      .join(', ')}`,
  );
  log('');

  // ---------------------------------------------------------------------
  // 3. Index initiatives so items can carry rollout context in their narrative
  // ---------------------------------------------------------------------
  const initiativeSiteCounts = new Map<string, Set<string>>();
  for (const issue of rawItems) {
    const initiativeKey = findInitiativeKey(issue);
    if (!initiativeKey) continue;
    const projectKey = (issue.fields['project'] as { key?: string } | undefined)?.key;
    if (!projectKey) continue;
    const set = initiativeSiteCounts.get(initiativeKey) ?? new Set<string>();
    set.add(projectKey);
    initiativeSiteCounts.set(initiativeKey, set);
  }

  const initiativeIndex = new Map<string, { summary: string; siteCount: number }>();
  for (const issue of rawInitiatives) {
    const summary = (issue.fields['summary'] as string | undefined) ?? issue.key;
    initiativeIndex.set(issue.key, {
      summary,
      siteCount: initiativeSiteCounts.get(issue.key)?.size ?? 0,
    });
  }

  // ---------------------------------------------------------------------
  // 4. Transform items
  // ---------------------------------------------------------------------
  log('Transforming...');
  const items: RoadmapItem[] = [];
  for (const issue of rawItems) {
    const item = transformItem(issue, context, initiativeIndex);
    if (item) items.push(item);
  }

  // Child counts: level-0 issues whose parent is a roadmap item. Available from
  // the same fetch, so no extra requests.
  const childTally = new Map<string, { total: number; done: number }>();
  for (const issue of allIssues) {
    const parent = issue.fields['parent'] as { key?: string } | undefined;
    if (!parent?.key) continue;
    const status = issue.fields['status'] as Record<string, unknown> | undefined;
    const category = status?.['statusCategory'] as Record<string, unknown> | undefined;
    const entry = childTally.get(parent.key) ?? { total: 0, done: 0 };
    entry.total++;
    if (category?.['key'] === 'done') entry.done++;
    childTally.set(parent.key, entry);
  }
  for (const item of items) {
    const tally = childTally.get(item.key);
    if (tally) item.childCount = tally;
  }

  // ---------------------------------------------------------------------
  // 5. Transform initiatives with their linked items
  // ---------------------------------------------------------------------
  const itemsByInitiative = new Map<string, RoadmapItem[]>();
  for (const item of items) {
    if (!item.initiativeKey) continue;
    const list = itemsByInitiative.get(item.initiativeKey) ?? [];
    list.push(item);
    itemsByInitiative.set(item.initiativeKey, list);
  }

  const initiatives: Initiative[] = rawInitiatives.map((issue) =>
    transformInitiative(issue, itemsByInitiative.get(issue.key) ?? [], context),
  );

  // Warn about links pointing at initiatives that were not fetched -- a sign the
  // portfolio registry is incomplete.
  const knownInitiativeKeys = new Set(rawInitiatives.map((i) => i.key));
  const danglingInitiatives = new Set<string>();
  for (const item of items) {
    if (item.initiativeKey && !knownInitiativeKeys.has(item.initiativeKey)) {
      danglingInitiatives.add(item.initiativeKey);
    }
  }
  for (const key of danglingInitiatives) {
    warnings.push(
      `Items link to initiative ${key}, which was not returned by the sync. ` +
        `Its portfolio project may be missing from config/projects.ts.`,
    );
  }

  const unalignedItems = items.filter((i) => i.alignment === 'local');
  if (unalignedItems.length > 0) {
    initiatives.push(buildUnalignedInitiative(unalignedItems, context));
  }

  // ---------------------------------------------------------------------
  // 6. Coverage
  // ---------------------------------------------------------------------
  const activeItems = items.filter(
    (i) => i.risk.level !== 'complete' && i.risk.level !== 'cancelled',
  );

  const coverage = buildCoverage(items, activeItems, asOf, countFlaggedPopulated(allIssues));
  const sites = buildSiteSummaries(activeItems);

  const snapshot: Snapshot = {
    schemaVersion: 1,
    syncedAt: new Date().toISOString(),
    asOf,
    portfolios: PORTFOLIOS.map((p) => ({ key: p.key, name: p.name })),
    sites,
    initiatives,
    items,
    coverage,
    warnings,
  };

  // ---------------------------------------------------------------------
  // 7. Validate, then write
  // ---------------------------------------------------------------------
  const parsed = snapshotSchema.safeParse(snapshot);
  if (!parsed.success) {
    process.stderr.write('Snapshot failed schema validation; nothing was written.\n');
    for (const issue of parsed.error.issues.slice(0, 20)) {
      process.stderr.write(`  ${issue.path.join('.')}: ${issue.message}\n`);
    }
    if (parsed.error.issues.length > 20) {
      process.stderr.write(`  ...and ${parsed.error.issues.length - 20} more\n`);
    }
    process.exit(1);
  }

  await mkdir(DATA_DIR, { recursive: true });
  await writeAtomic(SNAPSHOT_PATH, JSON.stringify(parsed.data, null, 2));
  await writeAtomic(
    META_PATH,
    JSON.stringify(
      {
        schemaVersion: snapshot.schemaVersion,
        syncedAt: snapshot.syncedAt,
        asOf,
        issuesFetched: allIssues.length,
        roadmapItems: items.length,
        activeItems: activeItems.length,
        initiatives: initiatives.length,
        level1TypeNames: Object.fromEntries(typeNameCounts),
        coverage,
        warningCount: warnings.length,
      },
      null,
      2,
    ),
  );

  log('');
  log(`Wrote ${path.relative(process.cwd(), SNAPSHOT_PATH)}`);
  log(`  ${items.length} items (${activeItems.length} active), ${initiatives.length} initiatives`);
  log(`  ${warnings.length} warning(s)`);
  log('');
  log('Next: npm run verify-snapshot');
}

main().catch((error: unknown) => {
  process.stderr.write(`\nSync failed: ${(error as Error).message}\n`);
  const body = (error as { body?: string }).body;
  if (body) process.stderr.write(`${body.slice(0, 500)}\n`);
  process.exit(1);
});
