/**
 * OData feed probe -- READ ONLY. Answers E1-E3, E5 and E7 from ADR-001.
 *
 * Run: npm run probe-odata
 *
 * This script does NOT migrate anything. scripts/sync.ts and src/lib/jira-client.ts
 * are deliberately untouched; the Jira REST pipeline remains the working source
 * and the comparison baseline until this probe reports and migration is approved.
 *
 * TARGET
 * ------
 * The DDTRoadmap feed is an Alpha Serve "Power BI Connector for Jira" endpoint
 * (powerbi-cloud-prod.alphaservesp.com/api/export/power-bi/<token>). Probed
 * 2026-08-06: reachable from an ordinary workstation, `WWW-Authenticate: Basic`,
 * and it serves a genuine **OData v4** service exposing four entity sets:
 *
 *     Issues · IssueStatuses · IssueTypes · IssueLinks
 *
 * That is a NORMALISED relational model. src/lib/normalise.ts expects Jira's
 * DENORMALISED nested JSON (fields.issuetype.hierarchyLevel,
 * fields.status.statusCategory.key, fields.issuelinks[]). So a future adapter
 * must JOIN these entity sets, not merely rename columns. Confirming the join
 * keys exist is part of this probe's job.
 *
 * Field availability is NOT probed -- it is settled. What this collects is row
 * SHAPE, link structure, project visibility and refresh behaviour.
 *
 * HISTORY: the first run misreported E3/E5 because it mistook the OData service
 * document (a 4-row index of entity sets) for issue data, and asked $metadata
 * for JSON when OData v4 returns EDMX XML. Both are fixed below.
 */

import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';

import { ALL_PROJECT_KEYS, PORTFOLIO_KEYS, PORTFOLIOS, SITE_KEYS, SITES } from '@config/projects.js';

const PROBE_DIR = path.resolve('data', 'probe');
const REQUEST_TIMEOUT_MS = 120_000;
const RETRY_STATUS = new Set([429, 500, 502, 503, 504]);
const MAX_ATTEMPTS = 3;
/** Guard against pulling an unbounded export into memory. */
const MAX_BODY_BYTES = 200 * 1024 * 1024;

// ---------------------------------------------------------------------------
// Output
// ---------------------------------------------------------------------------

type Level = 'PASS' | 'WARN' | 'FAIL' | 'INFO' | 'BLOCKED';

interface Check {
  id: string;
  level: Level;
  label: string;
  detail: string;
}

const checks: Check[] = [];
const record = (id: string, level: Level, label: string, detail: string): void => {
  checks.push({ id, level, label, detail });
};

const line = (text = ''): void => void process.stdout.write(`${text}\n`);
const heading = (text: string): void =>
  void process.stdout.write(`\n${text}\n${'-'.repeat(Math.max(text.length, 62))}\n`);

/** Never let a secret or feed token reach stdout or a dumped file. */
function redact(text: string): string {
  return text
    .replace(/("?(?:access_token|client_secret|password|authorization)"?\s*[:=]\s*"?)[^"&\s,}]+/gi, '$1***')
    .replace(/Bearer\s+[A-Za-z0-9._\-]+/gi, 'Bearer ***')
    .replace(/Basic\s+[A-Za-z0-9+/=]+/gi, 'Basic ***')
    .replace(/\/power-bi\/[a-f0-9]{16,}/gi, '/power-bi/<token>');
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

type AuthMode = 'basic' | 'oauth2' | 'bearer' | 'anonymous';

interface ProbeConfig {
  feedUrl: string;
  authMode: AuthMode;
  username?: string;
  password?: string;
  token?: string;
  tokenUrl?: string;
  clientId?: string;
  clientSecret?: string;
  scope?: string;
  issueEntity?: string;
  projectKeyField?: string;
}

const SETUP_HELP = `
Set these in .env.local (gitignored -- never commit the feed URL or credential).

  ODATA_FEED_URL=https://powerbi-cloud-prod.alphaservesp.com/api/export/power-bi/<token>
  ODATA_AUTH_MODE=basic
  ODATA_USERNAME=...
  ODATA_PASSWORD=...

Ask for a SERVICE credential, not a personal one. A named individual's account
relocates the key-person dependency the OData move is meant to remove, and ties
the roadmap's data scope to that person's Jira permissions.

Optional -- only if auto-detection fails:
  ODATA_ISSUE_ENTITY=Issues
  ODATA_PROJECT_KEY_FIELD=...
`;

function loadConfig(): ProbeConfig | undefined {
  const feedUrl = process.env['ODATA_FEED_URL']?.replace(/\/+$/, '');
  if (!feedUrl) return undefined;
  return {
    feedUrl,
    authMode: (process.env['ODATA_AUTH_MODE'] ?? 'basic').toLowerCase() as AuthMode,
    username: process.env['ODATA_USERNAME'],
    password: process.env['ODATA_PASSWORD'],
    token: process.env['ODATA_TOKEN'],
    tokenUrl: process.env['ODATA_TOKEN_URL'],
    clientId: process.env['ODATA_CLIENT_ID'],
    clientSecret: process.env['ODATA_CLIENT_SECRET'],
    scope: process.env['ODATA_SCOPE'],
    issueEntity: process.env['ODATA_ISSUE_ENTITY'],
    projectKeyField: process.env['ODATA_PROJECT_KEY_FIELD'],
  };
}

function hasCredential(config: ProbeConfig): boolean {
  switch (config.authMode) {
    case 'basic':
      return Boolean(config.username && config.password);
    case 'bearer':
      return Boolean(config.token);
    case 'oauth2':
      return Boolean(config.tokenUrl && config.clientId && config.clientSecret);
    case 'anonymous':
      return true;
    default:
      return false;
  }
}

// ---------------------------------------------------------------------------
// HTTP
// ---------------------------------------------------------------------------

interface Response_ {
  ok: boolean;
  status: number;
  body: string;
  headers: Record<string, string>;
  elapsedMs: number;
  bytes: number;
}

/**
 * @param accept Content negotiation matters here: OData v4 $metadata is EDMX
 *   XML, and asking for application/json gets a JSON document that fails EDMX
 *   detection. That defect caused the first run to misclassify the service.
 */
async function httpGet(
  url: string,
  authHeader: string | undefined,
  accept = 'application/json',
): Promise<Response_> {
  let lastError: unknown;

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    const startedAt = process.hrtime.bigint();
    try {
      const response = await fetch(url, {
        method: 'GET',
        headers: { Accept: accept, ...(authHeader ? { Authorization: authHeader } : {}) },
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });

      const declared = Number(response.headers.get('content-length') ?? 0);
      if (declared > MAX_BODY_BYTES) {
        return {
          ok: false,
          status: response.status,
          body: `Refused: content-length ${declared} exceeds the ${MAX_BODY_BYTES}-byte probe cap.`,
          headers: {},
          elapsedMs: 0,
          bytes: declared,
        };
      }

      const body = await response.text();
      const elapsedMs = Number(process.hrtime.bigint() - startedAt) / 1e6;
      const headers: Record<string, string> = {};
      response.headers.forEach((value, key) => void (headers[key] = value));

      if (!response.ok && RETRY_STATUS.has(response.status) && attempt < MAX_ATTEMPTS) {
        const retryAfter = Number(response.headers.get('retry-after'));
        const waitMs = Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter * 1000 : 500 * 2 ** (attempt - 1);
        await new Promise((resolve) => setTimeout(resolve, waitMs));
        continue;
      }

      return { ok: response.ok, status: response.status, body, headers, elapsedMs, bytes: body.length };
    } catch (error) {
      lastError = error;
      if (attempt < MAX_ATTEMPTS) {
        await new Promise((resolve) => setTimeout(resolve, 500 * 2 ** (attempt - 1)));
      }
    }
  }

  return {
    ok: false,
    status: 0,
    body: `Network error: ${(lastError as Error)?.message ?? 'unknown'}`,
    headers: {},
    elapsedMs: 0,
    bytes: 0,
  };
}

// ---------------------------------------------------------------------------
// E1
// ---------------------------------------------------------------------------

async function acquireAuthHeader(config: ProbeConfig): Promise<string | undefined> {
  switch (config.authMode) {
    case 'anonymous':
      return undefined;
    case 'basic':
      return `Basic ${Buffer.from(`${config.username}:${config.password}`).toString('base64')}`;
    case 'bearer':
      return `Bearer ${config.token}`;
    case 'oauth2': {
      const body = new URLSearchParams({
        grant_type: 'client_credentials',
        client_id: config.clientId!,
        client_secret: config.clientSecret!,
        ...(config.scope ? { scope: config.scope } : {}),
      });
      const response = await fetch(config.tokenUrl!, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body,
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
      const text = await response.text();
      if (!response.ok) throw new Error(`Token endpoint returned ${response.status}: ${redact(text).slice(0, 200)}`);
      const parsed = JSON.parse(text) as { access_token?: string };
      if (!parsed.access_token) throw new Error('Token endpoint returned 200 but no access_token.');
      return `Bearer ${parsed.access_token}`;
    }
    default:
      throw new Error(`Unknown ODATA_AUTH_MODE "${config.authMode}".`);
  }
}

// ---------------------------------------------------------------------------
// Shape helpers
// ---------------------------------------------------------------------------

/**
 * An OData service document is `{ "@odata.context": ..., "value": [ {name, url,
 * kind} ] }` -- an INDEX of entity sets, not data. The first probe run mistook
 * this for issue rows and reported "3 columns over 4 rows". Detect it up front
 * so entity-set discovery never depends on $metadata parsing.
 */
function serviceDocumentEntitySets(parsed: unknown): string[] | undefined {
  if (!parsed || typeof parsed !== 'object') return undefined;
  const obj = parsed as Record<string, unknown>;
  if (!Array.isArray(obj['value'])) return undefined;

  const rows = obj['value'] as Record<string, unknown>[];
  if (rows.length === 0) return undefined;

  const looksLikeIndex = rows.every(
    (row) => row && typeof row === 'object' && typeof row['name'] === 'string' && ('kind' in row || 'url' in row),
  );
  if (!looksLikeIndex) return undefined;

  const sets = rows
    .filter((row) => row['kind'] === undefined || row['kind'] === 'EntitySet')
    .map((row) => String(row['name']));

  return sets.length > 0 ? sets : undefined;
}

/** Row array from an OData collection response (v4 `value`, v2 `d.results`, bare array). */
function extractRows(parsed: unknown): Record<string, unknown>[] {
  if (Array.isArray(parsed)) return parsed as Record<string, unknown>[];
  if (parsed && typeof parsed === 'object') {
    const obj = parsed as Record<string, unknown>;
    if (Array.isArray(obj['value'])) return obj['value'] as Record<string, unknown>[];
    const d = obj['d'] as Record<string, unknown> | undefined;
    if (d && Array.isArray(d['results'])) return d['results'] as Record<string, unknown>[];
  }
  return [];
}

function odataCount(parsed: unknown): number | undefined {
  if (!parsed || typeof parsed !== 'object') return undefined;
  const raw = (parsed as Record<string, unknown>)['@odata.count'];
  return typeof raw === 'number' ? raw : undefined;
}

function pickProjectKeyField(columns: string[]): string | undefined {
  const ranked = [
    /^project_?key$/i,
    /^projectkey$/i,
    /^project$/i,
    /project.*key/i,
    /key.*project/i,
    /^issue_?key$/i,
    /^key$/i,
    /project/i,
  ];
  for (const pattern of ranked) {
    const hit = columns.find((c) => pattern.test(c));
    if (hit) return hit;
  }
  return undefined;
}

/** Jira issue keys look like ABC-123; derive the project key from one. */
function projectKeyOf(value: unknown): string | undefined {
  const text =
    typeof value === 'string'
      ? value
      : value && typeof value === 'object'
        ? ((value as Record<string, unknown>)['key'] as string) ??
          ((value as Record<string, unknown>)['name'] as string)
        : undefined;
  if (typeof text !== 'string' || !text) return undefined;
  return text.includes('-') ? text.split('-')[0] : text;
}

/**
 * Capability annotations the service declares about itself. This feed switches
 * most of OData off, which decides the adapter's whole strategy.
 */
function capabilitiesFrom(edmx: string): Record<string, string> {
  const out: Record<string, string> = {};
  if (/CountRestrictions[\s\S]{0,200}?Bool="false"[^>]*Property="Countable"/i.test(edmx)) out['$count'] = 'NOT supported';
  if (/Bool="false"\s+Term="Org\.OData\.Capabilities\.V1\.SkipSupported"/i.test(edmx)) out['$skip'] = 'NOT supported';
  if (/ExpandRestrictions[\s\S]{0,200}?Bool="false"[^>]*Property="Expandable"/i.test(edmx)) out['$expand'] = 'NOT supported';
  if (/Bool="false"\s+Term="Org\.OData\.Capabilities\.V1\.IndexableByKey"/i.test(edmx)) out['by-key access'] = 'NOT supported';
  if (/NavigationType\/None/i.test(edmx)) out['navigation'] = 'None';

  const nonFilterable = /NonFilterableProperties[\s\S]*?<\/Collection>/i.exec(edmx);
  if (nonFilterable) {
    const props = [...nonFilterable[0].matchAll(/<PropertyPath>([^<]+)<\/PropertyPath>/gi)].map((m) => m[1]!);
    if (props.includes('PROJECT_KEY')) out['$filter on PROJECT_KEY'] = 'NOT supported';
    out['non-filterable properties'] = String(props.length);
  }
  return out;
}

/**
 * Follows server-driven paging. With SkipSupported=false and Countable=false,
 * `@odata.nextLink` is the ONLY way to read past the first page -- the earlier
 * run stopped at exactly 1000 rows and wrongly reported six projects missing.
 */
async function fetchAllPages(
  startUrl: string,
  authHeader: string | undefined,
  maxPages = 500,
): Promise<{ rows: Record<string, unknown>[]; pages: number; truncated: boolean }> {
  const rows: Record<string, unknown>[] = [];
  let url: string | undefined = startUrl;
  let pages = 0;

  while (url && pages < maxPages) {
    const response: Response_ = await httpGet(url, authHeader);
    if (!response.ok) break;

    let parsed: unknown;
    try {
      parsed = JSON.parse(response.body);
    } catch {
      break;
    }

    rows.push(...extractRows(parsed));
    pages++;
    process.stdout.write(`\r    page ${pages}, ${rows.length} rows`);

    const next = (parsed as Record<string, unknown>)['@odata.nextLink'];
    url = typeof next === 'string' && next ? next : undefined;
  }

  if (pages > 0) process.stdout.write('\n');
  return { rows, pages, truncated: Boolean(url) };
}

function columnsOf(rows: Record<string, unknown>[]): string[] {
  const seen = new Set<string>();
  for (const row of rows) for (const key of Object.keys(row)) seen.add(key);
  return [...seen].filter((c) => !c.startsWith('@odata'));
}

function findColumn(columns: string[], patterns: RegExp[]): string | undefined {
  for (const pattern of patterns) {
    const hit = columns.find((c) => pattern.test(c));
    if (hit) return hit;
  }
  return undefined;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  await loadDotEnvLocal();

  line('DDT Roadmap — OData feed probe (read-only)');
  line('E1 auth · E2 reachability/shape · E3 project visibility · E5 links · E7 refresh');

  const config = loadConfig();
  if (!config) {
    process.stderr.write(`\nODATA_FEED_URL is not set, so the probe cannot run.\n${SETUP_HELP}\n`);
    process.exitCode = 1;
    return;
  }

  line(`  feed      ${redact(config.feedUrl)}`);
  line(`  authMode  ${config.authMode}`);
  line(`  scope     ${ALL_PROJECT_KEYS.length} projects (${PORTFOLIO_KEYS.length} portfolio, ${SITE_KEYS.length} site)`);

  await mkdir(PROBE_DIR, { recursive: true });

  // --- E2: reachability is testable WITHOUT a credential, and is the most
  //     likely hard blocker. Establish it before anything else.
  heading('E2 — network reachability (no credential required)');
  const unauth = await httpGet(config.feedUrl, undefined);

  if (unauth.status === 0) {
    record(
      'E2',
      'FAIL',
      'Endpoint unreachable',
      `${unauth.body}. A DNS or connection failure means a scheduled job has no network path — ` +
        `likely an on-premises gateway or an allowlist. That is a platform issue, not an application one.`,
    );
    line(`  ${unauth.body}`);
    summarise();
    process.exitCode = 1;
    return;
  }

  const authScheme = unauth.headers['www-authenticate'];
  record(
    'E2',
    'PASS',
    'Endpoint reachable outside Power BI',
    `Responded HTTP ${unauth.status} in ${unauth.elapsedMs.toFixed(0)}ms to a plain HTTPS client. ` +
      `No on-premises gateway and no Power-BI-service-only path.`,
  );
  line(`  HTTP ${unauth.status} in ${unauth.elapsedMs.toFixed(0)}ms`);
  if (authScheme) line(`  WWW-Authenticate: ${authScheme}`);

  // --- E1 ---------------------------------------------------------------
  heading('E1 — non-interactive authentication');

  if (!hasCredential(config)) {
    record(
      'E1',
      'BLOCKED',
      'No credential supplied',
      `The endpoint requires ${authScheme ?? 'authentication'}. Reachability (E2) is proven, but ` +
        `E3, E5 and E7 all need a working credential. See .env.example.`,
    );
    line(`  No credential configured for authMode=${config.authMode}.`);
    summarise();
    process.exitCode = 1;
    return;
  }

  let authHeader: string | undefined;
  try {
    authHeader = await acquireAuthHeader(config);
  } catch (error) {
    record('E1', 'FAIL', 'Authentication failed', redact((error as Error).message));
    summarise();
    process.exitCode = 1;
    return;
  }

  const root = await httpGet(config.feedUrl, authHeader);
  if (!root.ok) {
    record('E1', 'FAIL', 'Credential rejected', `HTTP ${root.status} — ${redact(root.body).slice(0, 200)}`);
    summarise();
    process.exitCode = 1;
    return;
  }

  record(
    'E1',
    config.authMode === 'basic' ? 'WARN' : 'PASS',
    'Non-interactive authentication works',
    config.authMode === 'basic'
      ? 'Basic auth succeeded, so a scheduled sync CAN authenticate unattended. But this is a ' +
        'username/password, not a federated service identity: confirm it is a service account, ' +
        'else the key-person dependency is relocated rather than removed, and confirm a rotation owner.'
      : `${config.authMode} credential accepted.`,
  );
  line(`  Authenticated: HTTP ${root.status} in ${root.elapsedMs.toFixed(0)}ms`);

  // --- E2b: service shape ------------------------------------------------
  heading('E2 — service shape');
  await writeFile(path.join(PROBE_DIR, 'service-document.json'), redact(root.body), 'utf8');

  let rootParsed: unknown;
  try {
    rootParsed = JSON.parse(root.body);
  } catch {
    record('E2', 'FAIL', 'Service root is not JSON', `Content-Type ${root.headers['content-type'] ?? 'unknown'}.`);
    summarise();
    process.exitCode = 1;
    return;
  }

  const entitySets = serviceDocumentEntitySets(rootParsed);
  if (!entitySets) {
    record(
      'E2',
      'FAIL',
      'No OData service document at the root',
      'Expected {"@odata.context":..., "value":[{name,url,kind}]}. Inspect data/probe/service-document.json.',
    );
    summarise();
    process.exitCode = 1;
    return;
  }

  record('E2', 'PASS', 'OData v4 service confirmed', `Entity sets: ${entitySets.join(', ')}`);
  line(`  entity sets (${entitySets.length}): ${entitySets.join(', ')}`);

  // $metadata as EDMX XML. Informational -- entity sets already came from the
  // service document, so a failure here no longer misclassifies the service.
  const metadata = await httpGet(`${config.feedUrl}/$metadata`, authHeader, 'application/xml');
  if (metadata.ok && /<(?:edmx:)?Edmx|<EntitySet/i.test(metadata.body)) {
    await writeFile(path.join(PROBE_DIR, 'metadata.xml'), redact(metadata.body), 'utf8');
    line(`  $metadata: EDMX retrieved (${metadata.bytes} bytes) → data/probe/metadata.xml`);
    record('E2', 'PASS', '$metadata is EDMX', `${metadata.bytes} bytes; full type model available for the adapter.`);

    const capabilities = capabilitiesFrom(metadata.body);
    if (Object.keys(capabilities).length > 0) {
      line('  declared query capabilities:');
      for (const [name, value] of Object.entries(capabilities)) line(`    ${name}: ${value}`);
      record(
        'E2',
        'WARN',
        'Feed switches off most OData query options',
        Object.entries(capabilities).map(([k, v]) => `${k}=${v}`).join('; ') +
          '. The adapter must pull everything and filter in code, and incremental sync by UPDATED is impossible.',
      );
    }
  } else {
    line(`  $metadata: HTTP ${metadata.status}, non-EDMX (informational only)`);
    record('E2', 'INFO', '$metadata not EDMX', `HTTP ${metadata.status}. Entity sets came from the service document instead.`);
  }

  const issueEntity = config.issueEntity ?? entitySets.find((e) => /^issues$/i.test(e)) ?? entitySets[0]!;

  /** Fetch a bounded sample from an entity set. */
  const sample = async (entity: string, top = 5, extra = ''): Promise<Record<string, unknown>[]> => {
    const response = await httpGet(`${config.feedUrl}/${entity}?$top=${top}${extra}`, authHeader);
    if (!response.ok) {
      record('E2', 'WARN', `${entity} sample failed`, `HTTP ${response.status} — ${redact(response.body).slice(0, 160)}`);
      return [];
    }
    try {
      return extractRows(JSON.parse(response.body));
    } catch {
      record('E2', 'WARN', `${entity} sample unparseable`, 'Response was not JSON.');
      return [];
    }
  };

  // --- Issues -------------------------------------------------------------
  heading(`Issues — row shape (${issueEntity})`);
  const issueRows = await sample(issueEntity, 5);
  if (issueRows.length === 0) {
    record('E3', 'FAIL', 'Issues returned no rows', `${issueEntity} is empty or unreadable under this identity.`);
    summarise();
    process.exitCode = 1;
    return;
  }

  const issueColumns = columnsOf(issueRows);
  await writeFile(path.join(PROBE_DIR, 'issues-sample.json'), redact(JSON.stringify(issueRows, null, 2)), 'utf8');
  await writeFile(path.join(PROBE_DIR, 'columns.json'), JSON.stringify(issueColumns, null, 2), 'utf8');
  record('E2', 'PASS', 'Issue row shape captured', `${issueColumns.length} columns; data/probe/issues-sample.json`);
  line(`  columns (${issueColumns.length}):`);
  for (const chunk of chunked(issueColumns, 6)) line(`    ${chunk.join(', ')}`);

  // --- E3 -----------------------------------------------------------------
  heading('E3 — per-project visibility under this identity');
  line('  Every project is checked individually; coverage is never inferred from');
  line('  a naming pattern. A site silently returning zero rows is the worst');
  line('  failure mode this application has.');
  line('');

  const projectField = config.projectKeyField ?? pickProjectKeyField(issueColumns);
  if (!projectField) {
    record(
      'E3',
      'FAIL',
      'Project-key column not identified',
      `None of the ${issueColumns.length} Issues columns look like a project key. ` +
        `Set ODATA_PROJECT_KEY_FIELD; see data/probe/columns.json.`,
    );
    summarise();
    process.exitCode = 1;
    return;
  }
  line(`  project key column: ${projectField}${config.projectKeyField ? ' (configured)' : ' (auto-detected)'}`);

  // The service declares Countable=false, SkipSupported=false and PROJECT_KEY
  // non-filterable, so there is no server-side count or per-project filter to
  // use. The only correct read is a full pull following @odata.nextLink.
  line('  Pulling the full Issues set (server-driven paging via @odata.nextLink)...');
  const pull = await fetchAllPages(`${config.feedUrl}/${issueEntity}`, authHeader);

  if (pull.rows.length === 0) {
    record('E3', 'FAIL', 'Issues pull returned nothing', 'Could not read the Issues entity set.');
    summarise();
    process.exitCode = 1;
    return;
  }

  // Cross-validate project identity across EVERY representation the feed offers.
  // A project could plausibly appear under a business-facing name rather than a
  // Jira key, so a single column is not sufficient evidence of absence.
  //   - PROJECT_KEY   raw value, NOT split on '-' (splitting would mangle a name)
  //   - ISSUE_KEY     prefix; Jira keys are PROJECTKEY-123, so this is an
  //                   INDEPENDENT encoding of the project key
  //   - PROJECT_ID    numeric identity, to detect a project present under an
  //                   unexpected label
  const counts = new Map<string, number>();
  const byIssueKeyPrefix = new Map<string, number>();
  const byProjectId = new Map<string, string>();

  for (const row of pull.rows) {
    const raw = row[projectField];
    const key = typeof raw === 'string' ? raw.trim() : projectKeyOf(raw);
    if (key) counts.set(key, (counts.get(key) ?? 0) + 1);

    const issueKey = row['ISSUE_KEY'];
    if (typeof issueKey === 'string' && issueKey.includes('-')) {
      const prefix = issueKey.split('-')[0]!;
      byIssueKeyPrefix.set(prefix, (byIssueKeyPrefix.get(prefix) ?? 0) + 1);
    }

    const projectId = row['PROJECT_ID'];
    if (projectId != null && key) byProjectId.set(String(projectId), key);
  }

  line('');
  line(`  distinct ${projectField} values (${counts.size}):`);
  for (const chunk of chunked([...counts.keys()].sort(), 6)) line(`    ${chunk.join(', ')}`);
  line(`  distinct ISSUE_KEY prefixes (${byIssueKeyPrefix.size}):`);
  for (const chunk of chunked([...byIssueKeyPrefix.keys()].sort(), 6)) line(`    ${chunk.join(', ')}`);
  line(`  distinct PROJECT_ID values (${byProjectId.size})`);

  // Do the two independent encodings agree? A disagreement would mean
  // PROJECT_KEY is carrying something other than the Jira key.
  const prefixOnly = [...byIssueKeyPrefix.keys()].filter((k) => !counts.has(k));
  const keyOnly = [...counts.keys()].filter((k) => !byIssueKeyPrefix.has(k));
  if (prefixOnly.length > 0 || keyOnly.length > 0) {
    record(
      'E3',
      'WARN',
      'PROJECT_KEY and ISSUE_KEY disagree',
      `Only in ISSUE_KEY prefixes: ${prefixOnly.join(', ') || 'none'}. ` +
        `Only in ${projectField}: ${keyOnly.join(', ') || 'none'}. ` +
        `PROJECT_KEY may hold display names rather than Jira keys.`,
    );
    line(`  DISAGREEMENT — prefix-only: ${prefixOnly.join(', ') || 'none'}; key-only: ${keyOnly.join(', ') || 'none'}`);
  } else {
    record(
      'E3',
      'PASS',
      'Project identity is consistent',
      `${projectField} and ISSUE_KEY prefixes agree on all ${counts.size} projects, so PROJECT_KEY ` +
        `holds genuine Jira keys — a name-based representation is not hiding anything.`,
    );
    line('  PROJECT_KEY and ISSUE_KEY prefixes agree — these are genuine Jira keys.');
  }

  // Name-based fallback: could a missing project be present under its business
  // name? Compare against the configured display names.
  const normalise_ = (s: string): string => s.toLowerCase().replace(/[^a-z0-9]/g, '');
  const observed = [...new Set([...counts.keys(), ...byIssueKeyPrefix.keys()])];
  const nameMatches = new Map<string, string>();
  for (const site of [...SITES, ...PORTFOLIOS.map((p) => ({ key: p.key, name: p.name }))]) {
    if (counts.has(site.key)) continue;
    const target = normalise_(site.name);
    const hit = observed.find((o) => {
      const on = normalise_(o);
      return on === target || on.includes(target) || (target.length > 4 && target.includes(on));
    });
    if (hit) nameMatches.set(site.key, hit);
  }
  if (nameMatches.size > 0) {
    const rendered = [...nameMatches].map(([k, v]) => `${k} → "${v}"`).join(', ');
    record('E3', 'WARN', 'Projects matched by business name', rendered);
    line(`  Name-based matches for otherwise-missing projects: ${rendered}`);
  } else {
    line('  No missing project matched by business name either.');
  }

  const bulkTotal = pull.rows.length;
  line(`  ${bulkTotal} issues across ${pull.pages} page(s)${pull.truncated ? ' (TRUNCATED at the page cap)' : ''}`);
  if (pull.truncated) {
    record(
      'E3',
      'WARN',
      'Issues pull hit the page cap',
      `Stopped after ${pull.pages} pages; counts below are a lower bound. Raise maxPages in fetchAllPages.`,
    );
  }
  line('');

  const missing: string[] = [];
  for (const key of ALL_PROJECT_KEYS) {
    const count = counts.get(key) ?? 0;
    const kind = PORTFOLIO_KEYS.includes(key) ? 'portfolio' : 'site';
    if (count === 0) missing.push(key);
    line(`  ${key.padEnd(10)} ${kind.padEnd(9)} ${String(count).padStart(6)}${count === 0 ? '  ← MISSING' : ''}`);
  }

  const extra = [...counts.keys()].filter((k) => !ALL_PROJECT_KEYS.includes(k)).sort();
  await writeFile(
    path.join(PROBE_DIR, 'project-visibility.json'),
    JSON.stringify(
      {
        projectField,
        totalIssues: bulkTotal,
        pagesFetched: pull.pages,
        truncated: pull.truncated,
        inScope: Object.fromEntries(ALL_PROJECT_KEYS.map((k) => [k, counts.get(k) ?? 0])),
        outOfScope: Object.fromEntries(extra.map((k) => [k, counts.get(k) ?? 0])),
      },
      null,
      2,
    ),
    'utf8',
  );

  if (missing.length > 0) {
    record(
      'E3',
      'FAIL',
      'In-scope projects missing from the feed',
      `${missing.join(', ')} returned zero rows. Either row-level security is scoping this identity, ` +
        `or the feed's configured project selection excludes them. Both block migration.`,
    );
  } else {
    record(
      'E3',
      'PASS',
      'All in-scope projects visible',
      `${ALL_PROJECT_KEYS.length}/${ALL_PROJECT_KEYS.length} projects returned rows under this identity.`,
    );
  }

  if (extra.length > 0) {
    line('');
    line(`  Feed also carries ${extra.length} out-of-scope projects: ${extra.slice(0, 12).join(', ')}${extra.length > 12 ? ', ...' : ''}`);
    record('E3', 'INFO', 'Feed is broader than MVP scope', `${extra.length} additional projects present; the adapter must filter.`);
  }

  // --- E5 IssueLinks ------------------------------------------------------
  heading('E5 — IssueLinks shape');
  const linkEntity = entitySets.find((e) => /link/i.test(e));
  if (!linkEntity) {
    record('E5', 'FAIL', 'No IssueLinks entity set', `Entity sets: ${entitySets.join(', ')}`);
  } else {
    const linkRows = await sample(linkEntity, 5);
    if (linkRows.length === 0) {
      record('E5', 'FAIL', `${linkEntity} returned no rows`, 'Initiative alignment depends on this entity set.');
    } else {
      const linkColumns = columnsOf(linkRows);
      await writeFile(path.join(PROBE_DIR, 'issue-links-sample.json'), redact(JSON.stringify(linkRows, null, 2)), 'utf8');
      line(`  columns (${linkColumns.length}): ${linkColumns.join(', ')}`);

      // findInitiativeKey (src/lib/transform.ts:158-171) needs BOTH endpoints,
      // the link type, and enough to tell direction. Matching is undirected, so
      // both endpoint keys must be present.
      const typeCol = findColumn(linkColumns, [/link.*type/i, /^type/i, /relation/i]);
      const endpointCols = linkColumns.filter((c) => /inward|outward|source|target|from|to|issue/i.test(c));

      const gaps: string[] = [];
      if (!typeCol) gaps.push('link type');
      if (endpointCols.length < 2) gaps.push('two endpoint columns');

      if (gaps.length === 0) {
        record(
          'E5',
          'PASS',
          'IssueLinks carries what alignment needs',
          `type via "${typeCol}"; endpoints via ${endpointCols.join(', ')}. Adapter must JOIN this per issue.`,
        );
      } else {
        record(
          'E5',
          'WARN',
          'IssueLinks may be missing fields',
          `Could not locate: ${gaps.join(' and ')}. Columns: ${linkColumns.join(', ')}. ` +
            `Undirected matching needs both endpoints plus the Polaris link type (id 10319).`,
        );
      }
    }
  }

  // --- IssueTypes / IssueStatuses join keys -------------------------------
  heading('Join keys — IssueTypes and IssueStatuses');

  const typeEntity = entitySets.find((e) => /issuetype/i.test(e));
  if (typeEntity) {
    const typeRows = await sample(typeEntity, 20);
    const typeColumns = columnsOf(typeRows);
    await writeFile(path.join(PROBE_DIR, 'issue-types-sample.json'), redact(JSON.stringify(typeRows, null, 2)), 'utf8');
    line(`  ${typeEntity} columns: ${typeColumns.join(', ')}`);
    const hierarchyCol = findColumn(typeColumns, [/hierarchy/i, /level/i]);
    if (hierarchyCol) {
      const levels = [...new Set(typeRows.map((r) => String(r[hierarchyCol])))].sort();
      record(
        'E2',
        'PASS',
        'IssueTypes exposes hierarchy level',
        `"${hierarchyCol}" observed values: ${levels.join(', ')}. Selection keys on level 1/2 — see config/hierarchy.ts.`,
      );
      line(`    hierarchy column: ${hierarchyCol} (values ${levels.join(', ')})`);
    } else {
      record(
        'E2',
        'FAIL',
        'IssueTypes has no hierarchy level',
        `Columns: ${typeColumns.join(', ')}. Roadmap items are selected by issuetype.hierarchyLevel; ` +
          `without it, selection would regress to name matching — the failure mode config/hierarchy.ts exists to prevent.`,
      );
    }
  } else {
    record('E2', 'WARN', 'No IssueTypes entity set', `Entity sets: ${entitySets.join(', ')}`);
  }

  const statusEntity = entitySets.find((e) => /issuestatus/i.test(e));
  if (statusEntity) {
    const statusRows = await sample(statusEntity, 20);
    const statusColumns = columnsOf(statusRows);
    await writeFile(path.join(PROBE_DIR, 'issue-statuses-sample.json'), redact(JSON.stringify(statusRows, null, 2)), 'utf8');
    line(`  ${statusEntity} columns: ${statusColumns.join(', ')}`);
    const nameCol = findColumn(statusColumns, [/^name$/i, /status.*name/i, /^status$/i]);
    const categoryCol = findColumn(statusColumns, [/category/i]);
    if (nameCol && categoryCol) {
      record(
        'E2',
        'PASS',
        'IssueStatuses exposes name and category',
        `"${nameCol}" + "${categoryCol}". normaliseStatus needs BOTH — category alone reports ` +
          `"Will not do" as delivered (README "three things that are easy to get wrong", #3).`,
      );
      line(`    name: ${nameCol}, category: ${categoryCol}`);
    } else {
      record(
        'E2',
        'FAIL',
        'IssueStatuses missing name or category',
        `name=${nameCol ?? 'NOT FOUND'}, category=${categoryCol ?? 'NOT FOUND'}. Columns: ${statusColumns.join(', ')}.`,
      );
    }
  } else {
    record('E2', 'WARN', 'No IssueStatuses entity set', `Entity sets: ${entitySets.join(', ')}`);
  }

  // --- E7 refresh ---------------------------------------------------------
  heading('E7 — refresh characteristics');
  for (const key of ['date', 'last-modified', 'etag', 'age', 'cache-control', 'content-type']) {
    if (root.headers[key]) line(`  ${key}: ${root.headers[key]}`);
  }

  const updatedCol = findColumn(issueColumns, [/^updated$/i, /updated/i, /modified/i]);
  if (updatedCol) {
    const newest = await sample(issueEntity, 1, `&$orderby=${encodeURIComponent(updatedCol)}%20desc`);
    const value = newest[0]?.[updatedCol];
    if (value) {
      record(
        'E7',
        'INFO',
        'Feed freshness',
        `Newest ${updatedCol} in the feed: ${String(value)}. Compare against live Jira to measure lag.`,
      );
      line(`  newest ${updatedCol}: ${String(value)}`);
    } else {
      record('E7', 'WARN', 'Could not read newest updated', `$orderby on "${updatedCol}" returned nothing usable.`);
    }
  } else {
    record('E7', 'WARN', 'No updated column found', `Staleness detection needs one; see data/probe/columns.json.`);
  }

  summarise();
  // Set exitCode rather than calling process.exit(): an abrupt exit while fetch
  // handles are still closing trips a libuv assertion on Windows.
  process.exitCode = checks.some((c) => c.level === 'FAIL') ? 1 : 0;
}

function chunked<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

function summarise(): void {
  heading('Probe result');
  for (const check of checks) {
    line(`  ${check.id.padEnd(3)} ${check.level.padEnd(7)} ${check.label}`);
    line(`      ${check.detail}`);
  }

  const fails = checks.filter((c) => c.level === 'FAIL');
  const blocked = checks.filter((c) => c.level === 'BLOCKED');
  const warns = checks.filter((c) => c.level === 'WARN');

  line('');
  line(
    `  ${checks.filter((c) => c.level === 'PASS').length} passed · ${warns.length} warning(s) · ` +
      `${blocked.length} blocked · ${fails.length} failure(s)`,
  );

  if (fails.length > 0) {
    line('\n  NOT CLEARED — migration is blocked on the failures above.');
  } else if (blocked.length > 0) {
    line('\n  PARTIAL — some evidence still needs a credential.');
  } else {
    line('\n  CLEARED — artifacts in data/probe/ (gitignored).');
  }
  line('  The Jira REST pipeline remains the working source and comparison baseline.');
}

main().catch((error: unknown) => {
  process.stderr.write(`\nProbe failed: ${redact((error as Error).message)}\n`);
  process.exitCode = 1;
});
