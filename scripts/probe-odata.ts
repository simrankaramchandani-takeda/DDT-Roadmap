/**
 * OData feed probe -- READ ONLY. Answers E1-E3 from ADR-001.
 *
 * Run: npm run probe-odata
 *
 * This script does NOT migrate anything. scripts/sync.ts and src/lib/jira-client.ts
 * are deliberately untouched; the Jira REST pipeline remains the working source
 * until this probe reports and a migration is approved.
 *
 * What it answers, and why each one can block the migration outright:
 *
 *   E1  Non-interactive authentication
 *       Power BI can authenticate as an interactive user. A scheduled sync
 *       cannot. If the feed only accepts an interactive principal, the migration
 *       needs a platform change, not application work.
 *
 *   E2  Network reachability
 *       If the feed is only reachable through an on-premises data gateway or
 *       from inside the Power BI service, a standalone Node process has no path
 *       to it regardless of credentials. This is the most commonly missed
 *       blocker in this exact migration, so it is checked before anything else.
 *
 *   E3  Project visibility under the service identity
 *       Row-level security may key on the requesting user. A service principal
 *       could therefore see a different dataset -- or none. Every in-scope
 *       project is probed INDIVIDUALLY and never inferred from a naming pattern
 *       (see the header of config/projects.ts): a site silently returning zero
 *       rows is the worst failure mode this application has.
 *
 * Field availability is NOT probed. It is settled: the feed exposes the
 * underlying Jira dataset. What this collects instead is the row SHAPE, so the
 * ingestion adapter can be written against real payloads.
 */

import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';

import { ALL_PROJECT_KEYS, PORTFOLIO_KEYS, SITE_KEYS } from '@config/projects.js';

const PROBE_DIR = path.resolve('data', 'probe');
const REQUEST_TIMEOUT_MS = 60_000;
const RETRY_STATUS = new Set([429, 500, 502, 503, 504]);
const MAX_ATTEMPTS = 3;

// ---------------------------------------------------------------------------
// Output helpers
// ---------------------------------------------------------------------------

type Level = 'PASS' | 'WARN' | 'FAIL' | 'INFO';

interface Check {
  id: string;
  level: Level;
  label: string;
  detail: string;
}

const checks: Check[] = [];

function record(id: string, level: Level, label: string, detail: string): void {
  checks.push({ id, level, label, detail });
}

function line(text = ''): void {
  process.stdout.write(`${text}\n`);
}

function heading(text: string): void {
  process.stdout.write(`\n${text}\n${'-'.repeat(Math.max(text.length, 60))}\n`);
}

/** Never let a secret reach stdout or a dumped file. */
function redact(text: string): string {
  return text
    .replace(/("?(?:access_token|client_secret|password|authorization)"?\s*[:=]\s*"?)[^"&\s,}]+/gi, '$1***')
    .replace(/Bearer\s+[A-Za-z0-9._\-]+/gi, 'Bearer ***');
}

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

/**
 * Minimal .env.local loader. Mirrors the one in scripts/sync.ts rather than
 * importing it, so this probe stays standalone and sync.ts is not modified.
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

type AuthMode = 'oauth2' | 'bearer' | 'basic' | 'anonymous';

interface ProbeConfig {
  feedUrl: string;
  authMode: AuthMode;
  tokenUrl?: string;
  clientId?: string;
  clientSecret?: string;
  scope?: string;
  token?: string;
  username?: string;
  password?: string;
  /** Entity set holding issues. Auto-detected from $metadata when unset. */
  issueEntity?: string;
  /** Property holding the Jira project key. Auto-detected when unset. */
  projectKeyField?: string;
}

const SETUP_HELP = `
Set these in .env.local (gitignored). The feed URL is the same one the
DDTRoadmap Power BI report connects to -- copy it from that report's data
source settings (Power BI Desktop: Transform data > Data source settings).

  ODATA_FEED_URL=https://<host>/<path>            # required, the service root

  # Pick ONE auth mode. 'oauth2' is the only one a scheduled job can rely on,
  # and proving it works is the point of E1.
  ODATA_AUTH_MODE=oauth2                          # oauth2 | bearer | basic | anonymous

  # ODATA_AUTH_MODE=oauth2  (client credentials -- service principal)
  ODATA_TOKEN_URL=https://login.microsoftonline.com/<tenant>/oauth2/v2.0/token
  ODATA_CLIENT_ID=...
  ODATA_CLIENT_SECRET=...
  ODATA_SCOPE=...                                 # often <resource>/.default

  # ODATA_AUTH_MODE=bearer   -- a token you already hold (proves E2/E3, not E1)
  ODATA_TOKEN=...

  # ODATA_AUTH_MODE=basic
  ODATA_USERNAME=...
  ODATA_PASSWORD=...

Optional -- only needed if auto-detection from $metadata fails:
  ODATA_ISSUE_ENTITY=Issues
  ODATA_PROJECT_KEY_FIELD=projectKey
`;

function loadConfig(): ProbeConfig | undefined {
  const feedUrl = process.env['ODATA_FEED_URL']?.replace(/\/+$/, '');
  if (!feedUrl) return undefined;

  const authMode = (process.env['ODATA_AUTH_MODE'] ?? 'oauth2').toLowerCase() as AuthMode;

  return {
    feedUrl,
    authMode,
    tokenUrl: process.env['ODATA_TOKEN_URL'],
    clientId: process.env['ODATA_CLIENT_ID'],
    clientSecret: process.env['ODATA_CLIENT_SECRET'],
    scope: process.env['ODATA_SCOPE'],
    token: process.env['ODATA_TOKEN'],
    username: process.env['ODATA_USERNAME'],
    password: process.env['ODATA_PASSWORD'],
    issueEntity: process.env['ODATA_ISSUE_ENTITY'],
    projectKeyField: process.env['ODATA_PROJECT_KEY_FIELD'],
  };
}

// ---------------------------------------------------------------------------
// E1 -- non-interactive authentication
// ---------------------------------------------------------------------------

async function acquireAuthHeader(config: ProbeConfig): Promise<string | undefined> {
  switch (config.authMode) {
    case 'anonymous':
      record('E1', 'WARN', 'Non-interactive auth', 'ODATA_AUTH_MODE=anonymous — no credential presented. Proves reachability only.');
      return undefined;

    case 'bearer': {
      if (!config.token) throw new Error('ODATA_AUTH_MODE=bearer requires ODATA_TOKEN.');
      record(
        'E1',
        'WARN',
        'Non-interactive auth',
        'A pre-issued bearer token was supplied. This proves the feed accepts token auth, but NOT ' +
          'that a scheduled job can mint one unattended. Re-run with ODATA_AUTH_MODE=oauth2 to close E1.',
      );
      return `Bearer ${config.token}`;
    }

    case 'basic': {
      if (!config.username || !config.password) {
        throw new Error('ODATA_AUTH_MODE=basic requires ODATA_USERNAME and ODATA_PASSWORD.');
      }
      record(
        'E1',
        'WARN',
        'Non-interactive auth',
        'Basic auth with a user credential. Works unattended, but ties the sync to a named ' +
          'individual — the governance defect the OData move is meant to remove. Prefer a service principal.',
      );
      return `Basic ${Buffer.from(`${config.username}:${config.password}`).toString('base64')}`;
    }

    case 'oauth2': {
      if (!config.tokenUrl || !config.clientId || !config.clientSecret) {
        throw new Error(
          'ODATA_AUTH_MODE=oauth2 requires ODATA_TOKEN_URL, ODATA_CLIENT_ID and ODATA_CLIENT_SECRET.',
        );
      }

      const body = new URLSearchParams({
        grant_type: 'client_credentials',
        client_id: config.clientId,
        client_secret: config.clientSecret,
        ...(config.scope ? { scope: config.scope } : {}),
      });

      const response = await fetch(config.tokenUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body,
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });

      const text = await response.text();
      if (!response.ok) {
        record(
          'E1',
          'FAIL',
          'Non-interactive auth',
          `Token endpoint returned ${response.status}. ${redact(text).slice(0, 300)}`,
        );
        return undefined;
      }

      const parsed = JSON.parse(text) as { access_token?: string; expires_in?: number };
      if (!parsed.access_token) {
        record('E1', 'FAIL', 'Non-interactive auth', 'Token endpoint returned 200 but no access_token.');
        return undefined;
      }

      record(
        'E1',
        'PASS',
        'Non-interactive auth',
        `Client-credentials token acquired (expires_in ${parsed.expires_in ?? 'unknown'}s). ` +
          `A scheduled sync can authenticate without a human.`,
      );
      return `Bearer ${parsed.access_token}`;
    }

    default:
      throw new Error(`Unknown ODATA_AUTH_MODE "${config.authMode}".`);
  }
}

// ---------------------------------------------------------------------------
// HTTP
// ---------------------------------------------------------------------------

interface GetResult {
  ok: boolean;
  status: number;
  body: string;
}

async function httpGet(url: string, authHeader: string | undefined): Promise<GetResult> {
  let lastError: unknown;

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    try {
      const response = await fetch(url, {
        method: 'GET',
        headers: {
          Accept: 'application/json',
          ...(authHeader ? { Authorization: authHeader } : {}),
        },
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });

      const body = await response.text();
      if (response.ok) return { ok: true, status: response.status, body };

      if (RETRY_STATUS.has(response.status) && attempt < MAX_ATTEMPTS) {
        const retryAfter = Number(response.headers.get('retry-after'));
        const waitMs = Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter * 1000 : 500 * 2 ** (attempt - 1);
        await new Promise((resolve) => setTimeout(resolve, waitMs));
        continue;
      }

      return { ok: false, status: response.status, body };
    } catch (error) {
      lastError = error;
      if (attempt < MAX_ATTEMPTS) {
        await new Promise((resolve) => setTimeout(resolve, 500 * 2 ** (attempt - 1)));
        continue;
      }
    }
  }

  return { ok: false, status: 0, body: `Network error: ${(lastError as Error)?.message ?? 'unknown'}` };
}

// ---------------------------------------------------------------------------
// E2 -- reachability and shape discovery
// ---------------------------------------------------------------------------

/** Entity set names from an EDMX $metadata document. No XML dependency needed. */
function entitySetsFromMetadata(xml: string): string[] {
  const names = new Set<string>();
  for (const match of xml.matchAll(/<EntitySet\b[^>]*\bName="([^"]+)"/gi)) {
    names.add(match[1]!);
  }
  return [...names];
}

/** Property names declared on an entity type, used to locate the project-key column. */
function propertiesOfEntityType(xml: string, typeName: string): string[] {
  const block = new RegExp(`<EntityType\\b[^>]*\\bName="${typeName}"[\\s\\S]*?</EntityType>`, 'i').exec(xml);
  if (!block) return [];
  return [...block[0].matchAll(/<(?:Property|NavigationProperty)\b[^>]*\bName="([^"]+)"/gi)].map((m) => m[1]!);
}

function pickIssueEntity(entitySets: string[]): string | undefined {
  const ranked = [/^issues?$/i, /issue/i, /work.?items?/i, /^jira/i];
  for (const pattern of ranked) {
    const hit = entitySets.find((name) => pattern.test(name));
    if (hit) return hit;
  }
  return undefined;
}

function pickProjectKeyField(properties: string[]): string | undefined {
  const ranked = [
    /^project_?key$/i,
    /^projectkey$/i,
    /^project_?id$/i,
    /^project$/i,
    /project.*key/i,
    /key/i,
  ];
  for (const pattern of ranked) {
    const hit = properties.find((name) => pattern.test(name));
    if (hit) return hit;
  }
  return undefined;
}

// ---------------------------------------------------------------------------
// E3 -- per-project visibility
// ---------------------------------------------------------------------------

interface ProjectProbe {
  key: string;
  kind: 'portfolio' | 'site';
  reachable: boolean;
  count?: number;
  status: number;
  note?: string;
}

async function probeProject(
  config: ProbeConfig,
  authHeader: string | undefined,
  entity: string,
  field: string,
  key: string,
): Promise<ProjectProbe> {
  const kind: ProjectProbe['kind'] = PORTFOLIO_KEYS.includes(key) ? 'portfolio' : 'site';

  // $count=true is OData v4. If the service rejects it, fall back to presence.
  const filter = encodeURIComponent(`${field} eq '${key}'`);
  const withCount = `${config.feedUrl}/${entity}?$filter=${filter}&$top=1&$count=true`;

  let result = await httpGet(withCount, authHeader);
  let usedCount = true;

  if (!result.ok) {
    result = await httpGet(`${config.feedUrl}/${entity}?$filter=${filter}&$top=1`, authHeader);
    usedCount = false;
  }

  if (!result.ok) {
    return { key, kind, reachable: false, status: result.status, note: redact(result.body).slice(0, 160) };
  }

  try {
    const parsed = JSON.parse(result.body) as Record<string, unknown>;
    const rows = (parsed['value'] ?? parsed['d'] ?? []) as unknown[];
    const rawCount = parsed['@odata.count'] ?? parsed['@count'];
    const count = typeof rawCount === 'number' ? rawCount : Array.isArray(rows) ? rows.length : 0;

    return {
      key,
      kind,
      reachable: true,
      count,
      status: result.status,
      ...(usedCount ? {} : { note: '$count unsupported; presence only' }),
    };
  } catch {
    return { key, kind, reachable: false, status: result.status, note: 'response was not JSON' };
  }
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  await loadDotEnvLocal();

  line('DDT Roadmap — OData feed probe (read-only)');
  line('Answers E1 (non-interactive auth), E2 (reachability), E3 (project visibility).');

  const config = loadConfig();
  if (!config) {
    process.stderr.write(`\nODATA_FEED_URL is not set, so the probe cannot run.\n${SETUP_HELP}\n`);
    process.exit(1);
  }

  line(`  feed      ${config.feedUrl}`);
  line(`  authMode  ${config.authMode}`);
  line(`  scope     ${ALL_PROJECT_KEYS.length} projects (${PORTFOLIO_KEYS.length} portfolio, ${SITE_KEYS.length} site)`);

  await mkdir(PROBE_DIR, { recursive: true });

  // --- E1 ---------------------------------------------------------------
  heading('E1 — non-interactive authentication');
  let authHeader: string | undefined;
  try {
    authHeader = await acquireAuthHeader(config);
  } catch (error) {
    record('E1', 'FAIL', 'Non-interactive auth', (error as Error).message);
  }
  for (const check of checks.filter((c) => c.id === 'E1')) line(`  ${check.level}  ${check.detail}`);

  if (config.authMode === 'oauth2' && !authHeader) {
    line('\n  Cannot continue without a token. E2 and E3 are unresolved.');
    summarise();
    process.exit(1);
  }

  // --- E2 ---------------------------------------------------------------
  heading('E2 — network reachability and shape discovery');

  const serviceDoc = await httpGet(config.feedUrl, authHeader);
  if (serviceDoc.ok) {
    record('E2', 'PASS', 'Service root reachable', `${config.feedUrl} returned ${serviceDoc.status}`);
  } else {
    record(
      'E2',
      'FAIL',
      'Service root unreachable',
      `${serviceDoc.status || 'network error'} — ${redact(serviceDoc.body).slice(0, 240)}. ` +
        `If this is a timeout or DNS failure, the feed is likely behind an on-premises gateway ` +
        `and a scheduled job has no path to it. That is a platform issue, not an application one.`,
    );
  }
  line(`  service root: ${serviceDoc.ok ? 'OK' : 'UNREACHABLE'} (${serviceDoc.status})`);

  const metadata = await httpGet(`${config.feedUrl}/$metadata`, authHeader);
  let entitySets: string[] = [];

  if (metadata.ok) {
    entitySets = entitySetsFromMetadata(metadata.body);
    await writeFile(path.join(PROBE_DIR, 'metadata.xml'), metadata.body, 'utf8');
    record('E2', 'PASS', '$metadata retrieved', `${entitySets.length} entity sets; saved to data/probe/metadata.xml`);
    line(`  entity sets (${entitySets.length}): ${entitySets.slice(0, 25).join(', ')}${entitySets.length > 25 ? ', ...' : ''}`);
  } else {
    record('E2', 'FAIL', '$metadata unavailable', `${metadata.status} — ${redact(metadata.body).slice(0, 240)}`);
  }

  if (!serviceDoc.ok && !metadata.ok) {
    line('\n  Feed unreachable. E3 cannot be assessed.');
    summarise();
    process.exit(1);
  }

  const entity = config.issueEntity ?? pickIssueEntity(entitySets);
  if (!entity) {
    record(
      'E2',
      'FAIL',
      'Issue entity set not identified',
      `Could not infer it from ${entitySets.length} entity sets. Set ODATA_ISSUE_ENTITY explicitly ` +
        `after inspecting data/probe/metadata.xml.`,
    );
    summarise();
    process.exit(1);
  }
  line(`  issue entity: ${entity}${config.issueEntity ? ' (configured)' : ' (auto-detected)'}`);

  // Sample one row to learn the shape and locate the project-key column.
  const sample = await httpGet(`${config.feedUrl}/${entity}?$top=1`, authHeader);
  let projectKeyField = config.projectKeyField;

  if (sample.ok) {
    await writeFile(path.join(PROBE_DIR, 'sample-row.json'), redact(sample.body), 'utf8');
    try {
      const parsed = JSON.parse(sample.body) as Record<string, unknown>;
      const rows = (parsed['value'] ?? []) as Record<string, unknown>[];
      const first = rows[0];
      if (first) {
        const columns = Object.keys(first);
        line(`  columns (${columns.length}): ${columns.slice(0, 20).join(', ')}${columns.length > 20 ? ', ...' : ''}`);
        projectKeyField ??= pickProjectKeyField(columns);
        record('E2', 'PASS', 'Row shape captured', `${columns.length} columns; saved to data/probe/sample-row.json`);
      } else {
        record('E2', 'WARN', 'Row shape not captured', `${entity} returned no rows for an unfiltered $top=1.`);
      }
    } catch {
      record('E2', 'WARN', 'Row shape not captured', 'Sample response was not JSON.');
    }
  } else {
    record('E2', 'WARN', 'Row shape not captured', `Sample query returned ${sample.status}.`);
  }

  projectKeyField ??= metadata.ok ? pickProjectKeyField(propertiesOfEntityType(metadata.body, entity)) : undefined;

  if (!projectKeyField) {
    record(
      'E2',
      'FAIL',
      'Project-key column not identified',
      'Set ODATA_PROJECT_KEY_FIELD after inspecting data/probe/metadata.xml or sample-row.json.',
    );
    summarise();
    process.exit(1);
  }
  line(`  project key column: ${projectKeyField}${config.projectKeyField ? ' (configured)' : ' (auto-detected)'}`);

  // --- E3 ---------------------------------------------------------------
  heading('E3 — per-project visibility under this identity');
  line('  Every project is probed individually. Coverage is never inferred from a');
  line('  naming pattern: a site that silently returns zero rows is the worst');
  line('  failure mode this application has.');
  line('');

  const results: ProjectProbe[] = [];
  for (const key of ALL_PROJECT_KEYS) {
    const probe = await probeProject(config, authHeader, entity, projectKeyField, key);
    results.push(probe);
    const countText = probe.reachable ? String(probe.count ?? 0).padStart(5) : '    ?';
    const flag = !probe.reachable ? ' ← ERROR' : probe.count === 0 ? ' ← EMPTY' : '';
    line(`  ${key.padEnd(10)} ${probe.kind.padEnd(9)} ${countText}${flag}${probe.note ? `  (${probe.note})` : ''}`);
  }

  await writeFile(path.join(PROBE_DIR, 'project-visibility.json'), JSON.stringify(results, null, 2), 'utf8');

  const unreachable = results.filter((r) => !r.reachable);
  const empty = results.filter((r) => r.reachable && (r.count ?? 0) === 0);
  const visible = results.filter((r) => r.reachable && (r.count ?? 0) > 0);

  if (unreachable.length > 0) {
    record('E3', 'FAIL', 'Projects errored', `${unreachable.map((r) => r.key).join(', ')} — query failed.`);
  }
  if (empty.length > 0) {
    record(
      'E3',
      'FAIL',
      'Projects visible but empty',
      `${empty.map((r) => r.key).join(', ')} returned zero rows. Either row-level security is scoping ` +
        `this identity, or the feed does not cover these projects. Both block migration.`,
    );
  }
  if (unreachable.length === 0 && empty.length === 0) {
    record(
      'E3',
      'PASS',
      'All in-scope projects visible',
      `${visible.length}/${ALL_PROJECT_KEYS.length} projects returned rows under this identity.`,
    );
  }

  summarise();
  process.exit(checks.some((c) => c.level === 'FAIL') ? 1 : 0);
}

function summarise(): void {
  heading('Probe result');
  for (const check of checks) {
    line(`  ${check.id}  ${check.level.padEnd(4)} ${check.label}`);
    line(`        ${check.detail}`);
  }

  const fails = checks.filter((c) => c.level === 'FAIL');
  const warns = checks.filter((c) => c.level === 'WARN');

  line('');
  line(`  ${checks.filter((c) => c.level === 'PASS').length} passed · ${warns.length} warning(s) · ${fails.length} failure(s)`);

  if (fails.length > 0) {
    line('\n  NOT CLEARED — the OData migration is blocked on the failures above.');
    line('  The Jira REST pipeline remains the working source; nothing has changed.');
  } else {
    line('\n  CLEARED — E1-E3 answered. Artifacts in data/probe/ (gitignored).');
    line('  Next: present findings and seek approval before touching the ingestion layer.');
  }
}

main().catch((error: unknown) => {
  process.stderr.write(`\nProbe failed: ${redact((error as Error).message)}\n`);
  process.exit(1);
});
