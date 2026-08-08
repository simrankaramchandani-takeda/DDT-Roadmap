/**
 * Captures `ISSUE_TYPE_ID -> hierarchyLevel` from Jira REST -- READ ONLY.
 *
 * Run: npm run capture-issue-types
 *
 * WHY THIS SCRIPT EXISTS. `classifyIssues` selects roadmap items by
 * `issuetype.hierarchyLevel`, and NO OData feed exposes it -- `hierarchy` appears zero
 * times in Feed #3's 57 KB EDMX, and all three Alpha Serve sources expose the same
 * reduced type model, so this is a product limitation rather than a setting. Jira REST
 * `/rest/api/3/issuetype` DOES return it, for every type including project-scoped ones.
 * So REST is retained after the migration for exactly this one job: it is the issue-type
 * oracle.
 *
 * WHY IT CANNOT BE REPLACED BY REASONING. Type IDs are PER-PROJECT in team-managed
 * projects: `Epic` appears as 18380 in DDTORA, 18329 in DDTGC, 19568 in DDTSG and 21576
 * in DDTHIK. There is no arithmetic and no naming rule that connects them. A name-based
 * guess is worse than useless here, because a project-local level-1 type called something
 * other than `Epic` is precisely the case the hierarchy model exists to catch -- and an
 * unknown level means `classifyIssues` SILENTLY DROPS the issue, which makes a site look
 * like it has no work while every other count still looks plausible.
 *
 * OUTPUT IS A PASTEABLE BLOCK, NOT A GENERATED FILE. `config/feed.ts` stays
 * hand-maintained and reviewable: a registry that silently regenerates is a registry
 * nobody reads, and this one encodes a decision about what the portfolio contains. The
 * script prints the block and says which IDs are new; a human commits it.
 */

import { existsSync } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

import { ISSUE_TYPE_LEVELS } from '@config/feed.js';
import { loadJiraConfig, type JiraConfig } from '@/lib/jira-client.js';

const OUT_DIR = path.resolve('data', 'probe');
const OUT_PATH = path.join(OUT_DIR, 'issue-types.json');

const line = (text = ''): void => void process.stdout.write(`${text}\n`);
const heading = (text: string): void =>
  void process.stdout.write(`\n${text}\n${'-'.repeat(Math.max(text.length, 66))}\n`);

/**
 * Minimal .env.local loader.
 *
 * Duplicated from `sync.ts` rather than imported, following the precedent set by
 * `probe-odata.ts`: a capture tool that stays standalone can be run against a fresh
 * checkout without dragging the sync's module graph -- and `jira-client.ts` is on
 * design-001's "deliberately unchanged" list, so this script brings its own HTTP too.
 */
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

/** A Jira issue type as `/rest/api/3/issuetype` returns it. */
interface JiraIssueType {
  id: string;
  name: string;
  subtask?: boolean;
  hierarchyLevel?: number;
  description?: string;
  scope?: { type?: string; project?: { id?: string } };
}

/** GET with retry. Read-only: this script issues no other verb. */
async function getIssueTypes(config: JiraConfig): Promise<JiraIssueType[]> {
  const url = `${config.baseUrl}/rest/api/3/issuetype`;
  const authorization = `Basic ${Buffer.from(`${config.email}:${config.apiToken}`).toString('base64')}`;
  const retryable = new Set([429, 500, 502, 503, 504]);

  for (let attempt = 1; attempt <= 4; attempt++) {
    const response = await fetch(url, {
      headers: { Authorization: authorization, Accept: 'application/json' },
      signal: AbortSignal.timeout(60_000),
    });

    if (response.ok) return (await response.json()) as JiraIssueType[];

    const body = await response.text().catch(() => '');

    if (retryable.has(response.status) && attempt < 4) {
      const retryAfter = Number(response.headers.get('retry-after'));
      const waitMs = Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter * 1000 : 500 * 2 ** (attempt - 1);
      await new Promise((resolve) => setTimeout(resolve, waitMs));
      continue;
    }

    if (response.status === 401 || response.status === 403) {
      throw new Error(
        `Jira returned ${response.status}. Check JIRA_EMAIL and JIRA_API_TOKEN, and that the ` +
          `account can browse the DDT projects.\n${body.slice(0, 300)}`,
      );
    }

    throw new Error(`Jira returned ${response.status} for /rest/api/3/issuetype.\n${body.slice(0, 300)}`);
  }

  throw new Error('Failed to read /rest/api/3/issuetype');
}

async function main(): Promise<void> {
  await loadDotEnvLocal();

  const config = loadJiraConfig();
  line('DDT Roadmap — issue type hierarchy capture (read-only)');
  line(`  site      ${config.baseUrl}`);
  line(`  registry  ${Object.keys(ISSUE_TYPE_LEVELS).length} type IDs currently in config/feed.ts`);
  line('');

  const types = await getIssueTypes(config);
  line(`  ${types.length} issue types returned`);

  // A type with no hierarchyLevel cannot be registered, and must be reported rather
  // than defaulted -- the whole point of the registry is that an unknown level is loud.
  const usable = types.filter((t) => typeof t.hierarchyLevel === 'number');
  const unusable = types.filter((t) => typeof t.hierarchyLevel !== 'number');

  const known = new Set(Object.keys(ISSUE_TYPE_LEVELS));
  const captured = new Map<string, { level: number; name: string; scope: string }>();

  for (const type of usable) {
    captured.set(String(type.id), {
      level: type.hierarchyLevel as number,
      name: type.name,
      scope: type.scope?.type ? `${type.scope.type}/${type.scope.project?.id ?? '?'}` : 'GLOBAL',
    });
  }

  const added = [...captured.keys()].filter((id) => !known.has(id));
  const changed = [...captured.entries()].filter(
    ([id, entry]) => known.has(id) && ISSUE_TYPE_LEVELS[id] !== entry.level,
  );

  heading('Capture summary');
  line(`  types with a hierarchy level   ${usable.length}`);
  line(`  types without one (skipped)    ${unusable.length}`);
  line(`  already in the registry         ${captured.size - added.length}`);
  line(`  new                             ${added.length}`);
  line(`  CONFLICTING with the registry   ${changed.length}`);

  if (changed.length > 0) {
    line('');
    line('  CONFLICTS — the registry disagrees with Jira. Jira is authoritative; investigate');
    line('  before overwriting, because a level change silently moves work on or off the roadmap:');
    for (const [id, entry] of changed) {
      line(`    ${id} "${entry.name}": registry says ${ISSUE_TYPE_LEVELS[id]}, Jira says ${entry.level}`);
    }
  }

  if (unusable.length > 0) {
    line('');
    line(`  Types with no hierarchyLevel (${unusable.length}) — cannot be registered:`);
    for (const type of unusable.slice(0, 20)) line(`    ${type.id} "${type.name}"`);
    if (unusable.length > 20) line(`    ...and ${unusable.length - 20} more`);
  }

  // ---- the pasteable block ----
  heading('Paste into ISSUE_TYPE_LEVELS in config/feed.ts');
  const byLevel = new Map<number, [string, { level: number; name: string; scope: string }][]>();
  for (const entry of captured.entries()) {
    const list = byLevel.get(entry[1].level) ?? [];
    list.push(entry);
    byLevel.set(entry[1].level, list);
  }

  const levelLabels: Record<string, string> = {
    '2': 'portfolio initiative',
    '1': 'roadmap item',
    '0': 'operational detail, expected to be dropped',
    '-1': 'subtask',
  };

  line(`export const ISSUE_TYPE_LEVELS: Readonly<Record<string, number>> = {`);
  for (const level of [...byLevel.keys()].sort((a, b) => b - a)) {
    const label = levelLabels[String(level)] ?? 'unexpected level';
    line(`  // --- level ${level}: ${label} ---`);
    for (const [id, entry] of (byLevel.get(level) ?? []).sort((a, b) => Number(a[0]) - Number(b[0]))) {
      const isNew = added.includes(id) ? '  // NEW' : '';
      line(`  '${id}': ${level}, // ${entry.name} (${entry.scope})${isNew}`);
    }
  }
  line(`} as const;`);
  line('');
  line(`Then set ISSUE_TYPE_LEVELS_ARE_COMPLETE = true, since this capture covers the instance.`);

  await mkdir(OUT_DIR, { recursive: true });
  await writeFile(
    OUT_PATH,
    JSON.stringify(
      {
        capturedAt: new Date().toISOString(),
        baseUrl: config.baseUrl,
        total: types.length,
        levels: Object.fromEntries([...captured.entries()].map(([id, e]) => [id, e.level])),
        detail: [...captured.entries()].map(([id, e]) => ({ id, ...e })),
        withoutHierarchyLevel: unusable.map((t) => ({ id: t.id, name: t.name })),
      },
      null,
      2,
    ),
    'utf8',
  );

  line('');
  line(`Wrote ${path.relative(process.cwd(), OUT_PATH)} (gitignored)`);
  line('Next: npm run validate-feed3 — the unknown-issue-type report should be empty.');
}

main().catch((error: unknown) => {
  process.stderr.write(`\nCapture failed: ${(error as Error).message}\n`);
  process.exit(1);
});
