/**
 * Snapshot parity gate -- READ ONLY.
 *
 * Run: npm run diff-snapshots [-- --left <path|feed> --right <path|feed>]
 *      npm run diff-snapshots -- --right feed --write data/feed-snapshot.json
 *
 * WHY A DIFF AND NOT A CHECKLIST. The migration's safety net is not "the feed produces
 * plausible numbers", it is "the feed produces THE SAME portfolio the REST pipeline
 * produces, and every difference is named". A checklist of expected totals passes on a
 * dataset that is wrong in a way nobody thought to check. A per-entity diff cannot.
 *
 * DIVERGENCE IS CLASSIFIED, NOT MERELY COUNTED. Some differences are known consequences
 * of the source swap and must not block; everything else must be zero. Reporting one
 * unclassified count would make the gate unusable, because the expected differences are
 * numerous and permanent:
 *
 *   EXPECTED   childCount        Feed #3 exports no PARENT_ISSUE_* columns.
 *   EXPECTED   flagged canary    customfield_10387 is absent, so the count is vacuous.
 *   EXPECTED   syncedAt / asOf   the two snapshots were taken at different moments.
 *   EXPECTED   updatedAt skew    the feed is same-day, not live.
 *   EXPECTED   summary whitespace  the ADF and wiki parsers differ in trailing space.
 *   UNEXPLAINED everything else  blocks the phase.
 *
 * SEMANTICS AND SOURCE MUST NOT CHANGE IN THE SAME STEP. If a lane structure, a status
 * mapping or a risk rule changes in the same commit as the source swap, the snapshot
 * changes for two reasons and this gate can no longer attribute either. That is why
 * design-001 §5 defers per-site local lanes to either side of the migration.
 */

import { existsSync } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

import { createODataRepositories } from '@/lib/feed/odata-repositories.js';
import { redactText } from '@/lib/feed/odata-client.js';
import { loadRoadmapView } from '@/lib/repositories/index.js';
import { createSnapshotRepositories } from '@/lib/repositories/snapshot-repositories.js';
import { todayIso } from '@/lib/transform.js';
import { snapshotSchema, type Initiative, type RoadmapItem, type Snapshot } from '@/types/domain.js';

const line = (text = ''): void => void process.stdout.write(`${text}\n`);
const heading = (text: string): void =>
  void process.stdout.write(`\n${text}\n${'-'.repeat(Math.max(text.length, 66))}\n`);

/** Minimal .env.local loader, matching the other scripts. */
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

// ---------------------------------------------------------------------------
// Arguments
// ---------------------------------------------------------------------------

interface Args {
  left: string;
  right: string;
  write?: string;
  /** Read the feed once, write it, and stop. The baseline half of the workflow. */
  capture?: string;
}

function parseArgs(argv: readonly string[]): Args {
  const args: Args = { left: path.resolve('data', 'snapshot.json'), right: 'feed' };
  for (let i = 0; i < argv.length; i++) {
    const flag = argv[i];
    const value = argv[i + 1];
    if (flag === '--left' && value) { args.left = value === 'feed' ? 'feed' : path.resolve(value); i++; }
    else if (flag === '--right' && value) { args.right = value === 'feed' ? 'feed' : path.resolve(value); i++; }
    else if (flag === '--write' && value) { args.write = path.resolve(value); i++; }
    else if (flag === '--capture' && value) { args.capture = path.resolve(value); i++; }
  }
  return args;
}

// ---------------------------------------------------------------------------
// Loading
// ---------------------------------------------------------------------------

interface Side {
  label: string;
  snapshot: Snapshot;
}

async function load(source: string, asOf: string): Promise<Side> {
  if (source === 'feed') {
    const odata = createODataRepositories({ adapter: { asOf }, cacheTtlMs: 0 });
    const view = await loadRoadmapView(odata.repositories);
    return { label: 'Feed #3 (live)', snapshot: view.snapshot };
  }

  if (!existsSync(source)) {
    throw new Error(
      `No snapshot at ${path.relative(process.cwd(), source)}.\n` +
        `A REST-vs-feed parity run needs a snapshot produced by \`npm run sync\`, which requires\n` +
        `JIRA_BASE_URL, JIRA_EMAIL and JIRA_API_TOKEN in .env.local. Without it, compare two feed\n` +
        `reads instead:\n` +
        `  npm run diff-snapshots -- --right feed --write data/feed-baseline.json\n` +
        `  npm run diff-snapshots -- --left data/feed-baseline.json --right feed`,
    );
  }

  const parsed = snapshotSchema.safeParse(JSON.parse(await readFile(source, 'utf8')));
  if (!parsed.success) {
    throw new Error(
      `${path.relative(process.cwd(), source)} failed schema validation:\n` +
        parsed.error.issues.slice(0, 10).map((i) => `  ${i.path.join('.')}: ${i.message}`).join('\n'),
    );
  }

  // Served through the repository layer, exactly as the app would, so a file and the feed
  // are compared after the same projection rather than one raw and one projected.
  const view = await loadRoadmapView(
    createSnapshotRepositories(() => ({ snapshot: parsed.data, source: 'live', path: source })),
  );
  return { label: path.relative(process.cwd(), source), snapshot: view.snapshot };
}

// ---------------------------------------------------------------------------
// Comparison
// ---------------------------------------------------------------------------

/** Fields whose divergence is a known, permanent consequence of the source swap. */
const EXPECTED_FIELDS = new Set([
  'childCount.total',
  'childCount.done',
  'updatedAt',
  'daysSinceUpdate',
  'narrative.executiveSummary',
]);

interface FieldDiff {
  entity: string;
  field: string;
  left: string;
  right: string;
  expected: boolean;
}

const show = (value: unknown): string =>
  value === undefined ? '(absent)' : typeof value === 'object' ? JSON.stringify(value) : String(value);

/** Collapses whitespace so the two parser paths are compared on content, not spacing. */
const normaliseText = (value: string | undefined): string | undefined =>
  value?.replace(/\s+/g, ' ').trim();

function compareItem(left: RoadmapItem, right: RoadmapItem): FieldDiff[] {
  const diffs: FieldDiff[] = [];
  const check = (field: string, a: unknown, b: unknown): void => {
    if (show(a) === show(b)) return;
    diffs.push({ entity: left.key, field, left: show(a), right: show(b), expected: EXPECTED_FIELDS.has(field) });
  };

  check('siteKey', left.siteKey, right.siteKey);
  check('region', left.region, right.region);
  check('status.phase', left.status.phase, right.status.phase);
  check('status.category', left.status.category, right.status.category);
  check('risk.level', left.risk.level, right.risk.level);
  check('risk.provenance', left.risk.provenance, right.risk.provenance);
  check('start', left.start, right.start);
  check('end', left.end, right.end);
  check('initiativeKey', left.initiativeKey, right.initiativeKey);
  check('alignment', left.alignment, right.alignment);
  check('spotId', left.spotId, right.spotId);
  check('owners', [...left.owners].sort(), [...right.owners].sort());
  check('narrative.summarySource', left.narrative.summarySource, right.narrative.summarySource);
  check('blockers', left.blockers.map((b) => b.key).sort(), right.blockers.map((b) => b.key).sort());
  check('childCount.total', left.childCount.total, right.childCount.total);
  check('updatedAt', left.updatedAt, right.updatedAt);
  // Compared whitespace-insensitively: the ADF and wiki parsers legitimately differ in
  // spacing, and flagging that would bury the differences that matter.
  check('narrative.executiveSummary', normaliseText(left.narrative.executiveSummary), normaliseText(right.narrative.executiveSummary));

  return diffs;
}

function compareInitiative(left: Initiative, right: Initiative): FieldDiff[] {
  const diffs: FieldDiff[] = [];
  const check = (field: string, a: unknown, b: unknown): void => {
    if (show(a) === show(b)) return;
    diffs.push({ entity: left.key, field, left: show(a), right: show(b), expected: EXPECTED_FIELDS.has(field) });
  };

  check('risk.level', left.risk.level, right.risk.level);
  check('risk.provenance', left.risk.provenance, right.risk.provenance);
  check('itemCount', left.siteRollup.length, right.siteRollup.length);
  return diffs;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  await loadDotEnvLocal();

  const args = parseArgs(process.argv.slice(2));
  // Both sides are evaluated against the SAME date. Risk is a function of asOf, so
  // letting each side default to its own "today" would manufacture divergence at midnight.
  const asOf = process.env['SNAPSHOT_AS_OF'] ?? todayIso();

  line('DDT Roadmap — snapshot parity gate (read-only)');
  line(`  as of  ${asOf} (applied to both sides)`);

  // Capture mode: one read, written out, nothing compared. Used to take the baseline that
  // a later run diffs against -- which is how the feed is checked for stability when no
  // REST snapshot exists to compare with.
  if (args.capture) {
    const side = await load('feed', asOf);
    await mkdir(path.dirname(args.capture), { recursive: true });
    await writeFile(args.capture, JSON.stringify(side.snapshot, null, 2), 'utf8');
    line(`  captured ${side.snapshot.items.length} items to ${path.relative(process.cwd(), args.capture)}`);
    line('');
    line('Next: npm run diff-snapshots -- --left ' + path.relative(process.cwd(), args.capture) + ' --right feed');
    return;
  }

  line(`  left   ${args.left === 'feed' ? 'feed' : path.relative(process.cwd(), args.left)}`);
  line(`  right  ${args.right === 'feed' ? 'feed' : path.relative(process.cwd(), args.right)}`);

  const [left, right] = await Promise.all([load(args.left, asOf), load(args.right, asOf)]);

  if (args.write) {
    const target = args.right === 'feed' ? right : left;
    await mkdir(path.dirname(args.write), { recursive: true });
    await writeFile(args.write, JSON.stringify(target.snapshot, null, 2), 'utf8');
    line(`  wrote  ${path.relative(process.cwd(), args.write)}`);
  }

  // --- count variances -----------------------------------------------------
  heading('1. Count variances');
  const counts: [string, number, number][] = [
    ['roadmap items', left.snapshot.items.length, right.snapshot.items.length],
    ['initiatives', left.snapshot.initiatives.length, right.snapshot.initiatives.length],
    ['sites', left.snapshot.sites.length, right.snapshot.sites.length],
    ['portfolios', left.snapshot.portfolios.length, right.snapshot.portfolios.length],
    ['warnings', left.snapshot.warnings.length, right.snapshot.warnings.length],
  ];
  for (const key of Object.keys(left.snapshot.coverage) as (keyof Snapshot['coverage'])[]) {
    const a = left.snapshot.coverage[key];
    const b = right.snapshot.coverage[key];
    if (typeof a === 'number' && typeof b === 'number') counts.push([`coverage.${key}`, a, b]);
  }

  line('  metric                          left   right    delta');
  let countVariances = 0;
  for (const [label, a, b] of counts) {
    const delta = b - a;
    if (delta !== 0) countVariances++;
    line(
      `  ${label.padEnd(30)} ${String(a).padStart(5)}   ${String(b).padStart(5)}  ${
        delta === 0 ? '       —' : (delta > 0 ? `+${delta}` : String(delta)).padStart(8)
      }`,
    );
  }

  // --- membership ----------------------------------------------------------
  const leftItems = new Map(left.snapshot.items.map((i) => [i.key, i]));
  const rightItems = new Map(right.snapshot.items.map((i) => [i.key, i]));
  const onlyLeft = [...leftItems.keys()].filter((k) => !rightItems.has(k)).sort();
  const onlyRight = [...rightItems.keys()].filter((k) => !leftItems.has(k)).sort();

  heading('2. Membership variances');
  line(`  items only in left  ${onlyLeft.length}`);
  for (const key of onlyLeft.slice(0, 25)) line(`    ${key}`);
  if (onlyLeft.length > 25) line(`    ...and ${onlyLeft.length - 25} more`);
  line(`  items only in right ${onlyRight.length}`);
  for (const key of onlyRight.slice(0, 25)) line(`    ${key}`);
  if (onlyRight.length > 25) line(`    ...and ${onlyRight.length - 25} more`);

  // --- field variances -----------------------------------------------------
  const diffs: FieldDiff[] = [];
  for (const [key, leftItem] of leftItems) {
    const rightItem = rightItems.get(key);
    if (rightItem) diffs.push(...compareItem(leftItem, rightItem));
  }

  const leftInitiatives = new Map(left.snapshot.initiatives.map((i) => [i.key, i]));
  for (const rightInitiative of right.snapshot.initiatives) {
    const leftInitiative = leftInitiatives.get(rightInitiative.key);
    if (leftInitiative) diffs.push(...compareInitiative(leftInitiative, rightInitiative));
  }

  const byField = new Map<string, FieldDiff[]>();
  for (const diff of diffs) {
    const list = byField.get(diff.field) ?? [];
    list.push(diff);
    byField.set(diff.field, list);
  }

  const render = (title: string, fields: string[]): number => {
    heading(title);
    let total = 0;
    for (const field of fields) {
      const found = byField.get(field) ?? [];
      total += found.length;
      const tag = EXPECTED_FIELDS.has(field) ? ' [EXPECTED]' : '';
      line(`  ${field.padEnd(28)} ${String(found.length).padStart(4)} entity/entities differ${tag}`);
      for (const diff of found.slice(0, 6)) {
        line(`      ${diff.entity}: ${diff.left}  ->  ${diff.right}`);
      }
      if (found.length > 6) line(`      ...and ${found.length - 6} more`);
    }
    return total;
  };

  render('3. Status variances', ['status.phase', 'status.category', 'risk.level', 'risk.provenance', 'blockers']);
  render('4. Ownership variances', ['owners', 'spotId', 'narrative.summarySource', 'narrative.executiveSummary']);
  render('5. Site variances', ['siteKey', 'region', 'initiativeKey', 'alignment', 'itemCount']);
  render('6. Date and progress variances', ['start', 'end', 'updatedAt', 'childCount.total']);

  // --- verdict -------------------------------------------------------------
  const unexplained = diffs.filter((d) => !d.expected);
  const expected = diffs.filter((d) => d.expected);

  heading('Verdict');
  line(`  entities compared        ${[...leftItems.keys()].filter((k) => rightItems.has(k)).length} items`);
  line(`  count variances          ${countVariances}`);
  line(`  membership variances     ${onlyLeft.length + onlyRight.length}`);
  line(`  field diffs (EXPECTED)   ${expected.length}`);
  line(`  field diffs UNEXPLAINED  ${unexplained.length}`);
  line('');

  if (unexplained.length > 0 || onlyLeft.length > 0 || onlyRight.length > 0) {
    line('  NOT AT PARITY. Every unexplained divergence must be attributed before the');
    line('  source is switched: an unattributed difference is an unmeasured risk to');
    line('  executive reporting, not a rounding error.');
    process.exitCode = 1;
    return;
  }

  line('  AT PARITY. Every difference is a declared consequence of the source swap.');
}

main().catch((error: unknown) => {
  process.stderr.write(`\nDiff failed: ${redactText((error as Error).message)}\n`);
  process.exit(1);
});
