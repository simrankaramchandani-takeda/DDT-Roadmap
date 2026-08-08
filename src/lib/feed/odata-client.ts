/**
 * OData v4 transport for the Alpha Serve feed. HTTP only, no domain knowledge.
 *
 * READ-ONLY BY CONSTRUCTION, exactly as `jira-client.ts` is. This module issues GET
 * and nothing else; there is no POST, PATCH or DELETE to call by mistake. Jira remains
 * the system of record and this application only ever reports on it.
 *
 * THE CONNECTION LIVES HERE AND NOWHERE ELSE. `config/feed.ts` holds shape facts and
 * states that it must never carry a URL or a credential; this is the other half of that
 * split. Everything secret arrives through the environment, and the only form of the URL
 * that leaves this module is redacted -- `origin` is what the snapshot records for its
 * audit trail, so it must be safe to write to disk and render on a page.
 *
 * WHAT THE FEED DOES NOT SUPPORT, AND WHY THAT DECIDES THE DESIGN. The service declares
 * `SkipSupported=false`, `Countable=false`, `IndexableByKey=false`, `NavigationType/None`
 * and 118 non-filterable properties including `PROJECT_KEY` and `UPDATED`. So:
 *
 *   - `@odata.nextLink` is the ONLY way past the first page. A probe run that assumed
 *     `$skip` stopped at exactly 1000 rows and wrongly reported six projects missing.
 *   - There is no server-side `$filter`, so all scoping happens in code -- which the
 *     adapter already does, and must, because it may not pre-filter links or levels.
 *   - There is no `$count`, so a total is only known once the pull finishes.
 *
 * None of that is worked around here. It is honoured.
 */

/** Auth schemes. This endpoint advertises `Basic`; the rest are retained for other feeds. */
export type ODataAuthMode = 'basic' | 'bearer' | 'anonymous';

export interface ODataConfig {
  /** Service root, no trailing slash. Secret: the path carries an export token. */
  feedUrl: string;
  authMode: ODataAuthMode;
  username?: string;
  password?: string;
  token?: string;
  /**
   * How the connected feed identifies itself in provenance. Defaults to `FEED_NAME`.
   *
   * Overridable because the three known Alpha Serve sources sit on one host and differ
   * only by token, so the URL cannot tell them apart and a hard-coded label would state
   * a feed identity the operator never confirmed. `assertFeedShape` checks the claim
   * against what the service actually serves.
   */
  feedLabel?: string;
}

export class ODataError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly body: string,
  ) {
    super(message);
    this.name = 'ODataError';
  }
}

// ---------------------------------------------------------------------------
// Redaction
// ---------------------------------------------------------------------------

/**
 * Strips the export token from a feed URL.
 *
 * The token segment IS the credential half of this endpoint's identity, and the URL
 * reaches two places that outlive the process: `snapshot.syncedAt`'s sibling `origin`
 * field, and any error message printed by a script. Both are written to disk, so
 * redaction happens at the boundary rather than at each call site that logs.
 */
export function redactFeedUrl(url: string): string {
  return url
    .replace(/(\/power-bi\/)[^/?#]+/gi, '$1<token>')
    .replace(/([?&](?:token|key|sig|password)=)[^&]*/gi, '$1<redacted>');
}

/**
 * Removes anything credential-shaped from text bound for a log or an error.
 *
 * KEYED FORMS ARE HANDLED FIRST, and they consume any scheme word that follows. Doing it
 * the other way round double-redacts -- `Authorization: Basic abc` becomes
 * `Authorization: <redacted> <redacted>`, because the bare-scheme rule rewrites the token
 * and the keyed rule then rewrites the word `Basic` it left behind. Safe either way, but
 * an error message that has been mangled twice is one a reader stops trusting.
 */
export function redactText(text: string): string {
  return redactFeedUrl(text)
    .replace(
      /("?(?:password|access_token|authorization)"?\s*[:=]\s*"?)(?:(?:Basic|Bearer)\s+)?[^"&\s,}]+/gi,
      '$1<redacted>',
    )
    .replace(/\b(Basic|Bearer)\s+[A-Za-z0-9+/=._-]+/gi, '$1 <redacted>');
}

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

const SETUP_HELP =
  `Set these in .env.local (gitignored -- never commit the feed URL or the credential):\n` +
  `  ODATA_FEED_URL=https://powerbi-cloud-prod.alphaservesp.com/api/export/power-bi/<token>\n` +
  `  ODATA_AUTH_MODE=basic\n` +
  `  ODATA_USERNAME=...\n` +
  `  ODATA_PASSWORD=...\n` +
  `Optional: ODATA_FEED_LABEL="Feed #3" states which source the URL points at.\n\n` +
  `Ask for a SERVICE credential, not a personal login: a named individual's account\n` +
  `relocates the key-person dependency the OData move exists to remove, and ties the\n` +
  `roadmap's data scope to that person's Jira permissions.`;

/**
 * Reads the connection from the environment, failing with actionable guidance.
 *
 * Mirrors `loadJiraConfig`: one place that knows the variable names, and a message that
 * says what to do rather than merely what is absent.
 */
export function loadODataConfig(env: NodeJS.ProcessEnv = process.env): ODataConfig {
  const feedUrl = env['ODATA_FEED_URL']?.replace(/\/+$/, '');
  if (!feedUrl) {
    throw new Error(`ODATA_FEED_URL is not set, so the feed cannot be read.\n\n${SETUP_HELP}`);
  }

  const authMode = (env['ODATA_AUTH_MODE'] ?? 'basic').toLowerCase() as ODataAuthMode;
  if (authMode !== 'basic' && authMode !== 'bearer' && authMode !== 'anonymous') {
    throw new Error(
      `ODATA_AUTH_MODE="${authMode}" is not supported. Use basic, bearer or anonymous.\n\n${SETUP_HELP}`,
    );
  }

  const config: ODataConfig = {
    feedUrl,
    authMode,
    ...(env['ODATA_USERNAME'] ? { username: env['ODATA_USERNAME'] } : {}),
    ...(env['ODATA_PASSWORD'] ? { password: env['ODATA_PASSWORD'] } : {}),
    ...(env['ODATA_TOKEN'] ? { token: env['ODATA_TOKEN'] } : {}),
    ...(env['ODATA_FEED_LABEL'] ? { feedLabel: env['ODATA_FEED_LABEL'] } : {}),
  };

  const missing =
    authMode === 'basic'
      ? [!config.username && 'ODATA_USERNAME', !config.password && 'ODATA_PASSWORD'].filter(Boolean)
      : authMode === 'bearer'
        ? [!config.token && 'ODATA_TOKEN'].filter(Boolean)
        : [];

  if (missing.length > 0) {
    throw new Error(
      `Missing required environment variable(s): ${missing.join(', ')}.\n\n${SETUP_HELP}`,
    );
  }

  return config;
}

function authHeader(config: ODataConfig): string | undefined {
  switch (config.authMode) {
    case 'anonymous':
      return undefined;
    case 'bearer':
      return `Bearer ${config.token}`;
    case 'basic':
      return `Basic ${Buffer.from(`${config.username}:${config.password}`).toString('base64')}`;
  }
}

// ---------------------------------------------------------------------------
// Transport
// ---------------------------------------------------------------------------

const RETRYABLE_STATUSES = new Set([429, 500, 502, 503, 504]);
const MAX_ATTEMPTS = 4;
const REQUEST_TIMEOUT_MS = 120_000;

/**
 * Page backstop. The full pull is a handful of pages at 1000 rows each; 500 is far
 * above any real export and still bounds a malformed `@odata.nextLink` that points at
 * itself, which would otherwise loop until the process died.
 */
const MAX_PAGES = 500;

/** Guard against an unbounded export being pulled into memory. */
const MAX_BODY_BYTES = 200 * 1024 * 1024;

export type FetchLike = (url: string, init: RequestInit) => Promise<Response>;

export interface ODataClientOptions {
  /** Injectable transport. Tests supply a stub; nothing else should pass this. */
  fetchImpl?: FetchLike;
  /** Reports rows read so a long pull is not a silent wait. */
  onProgress?: (entitySet: string, rows: number, page: number) => void;
}

export interface ODataClient {
  /** The service root with its token removed. Safe to log, store and render. */
  readonly origin: string;
  /** How the operator says this feed identifies itself. */
  readonly feedLabel: string;
  /** Entity-set names, verbatim from the service document. */
  listEntitySets(): Promise<string[]>;
  /** Every row of one entity set, following `@odata.nextLink` to exhaustion. */
  readEntitySet(name: string): Promise<Record<string, unknown>[]>;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * An OData service document is `{ "@odata.context": ..., "value": [{name, url, kind}] }`
 * -- an INDEX of entity sets, not data.
 *
 * Detected structurally rather than assumed, because mistaking this four-row index for
 * issue rows is a real defect this project has already shipped once: a probe run
 * reported "3 columns over 4 rows" and drew conclusions about field availability from
 * it. Entity-set discovery therefore never depends on parsing `$metadata` EDMX either.
 */
function parseServiceDocument(parsed: unknown): string[] | undefined {
  if (!parsed || typeof parsed !== 'object') return undefined;
  const value = (parsed as Record<string, unknown>)['value'];
  if (!Array.isArray(value) || value.length === 0) return undefined;

  const rows = value as Record<string, unknown>[];
  const looksLikeIndex = rows.every(
    (row) => row && typeof row === 'object' && typeof row['name'] === 'string' && ('kind' in row || 'url' in row),
  );
  if (!looksLikeIndex) return undefined;

  const sets = rows
    .filter((row) => row['kind'] === undefined || row['kind'] === 'EntitySet')
    .map((row) => String(row['name']));

  return sets.length > 0 ? sets : undefined;
}

/** Rows from a collection response: v4 `value`, v2 `d.results`, or a bare array. */
function extractRows(parsed: unknown): Record<string, unknown>[] {
  if (Array.isArray(parsed)) return parsed as Record<string, unknown>[];
  if (parsed && typeof parsed === 'object') {
    const object = parsed as Record<string, unknown>;
    if (Array.isArray(object['value'])) return object['value'] as Record<string, unknown>[];
    const d = object['d'] as Record<string, unknown> | undefined;
    if (d && Array.isArray(d['results'])) return d['results'] as Record<string, unknown>[];
  }
  return [];
}

export function createODataClient(
  config: ODataConfig,
  options: ODataClientOptions = {},
): ODataClient {
  const fetchImpl: FetchLike = options.fetchImpl ?? ((url, init) => fetch(url, init));
  const header = authHeader(config);
  const origin = redactFeedUrl(config.feedUrl);

  /** GET with retry on rate limiting and transient server errors. */
  async function get(url: string, describe: string): Promise<unknown> {
    let lastError: Error | undefined;

    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
      let response: Response;
      try {
        response = await fetchImpl(url, {
          method: 'GET',
          headers: {
            Accept: 'application/json',
            ...(header ? { Authorization: header } : {}),
          },
          signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
        });
      } catch (cause) {
        lastError = new Error(
          `Network error reading ${describe} from ${origin}: ${redactText((cause as Error).message)}`,
        );
        if (attempt < MAX_ATTEMPTS) {
          await sleep(500 * 2 ** (attempt - 1));
          continue;
        }
        throw lastError;
      }

      if (response.ok) {
        const declared = Number(response.headers.get('content-length') ?? 0);
        if (declared > MAX_BODY_BYTES) {
          throw new ODataError(
            `${describe} declares ${declared} bytes, over the ${MAX_BODY_BYTES}-byte cap. ` +
              `Refusing to buffer it rather than exhausting memory mid-render.`,
            response.status,
            '',
          );
        }

        const body = await response.text();
        try {
          return JSON.parse(body) as unknown;
        } catch {
          throw new ODataError(
            `${describe} did not return JSON. The feed may have returned an HTML error page ` +
              `or an EDMX document.`,
            response.status,
            redactText(body.slice(0, 500)),
          );
        }
      }

      const text = await response.text().catch(() => '');

      if (RETRYABLE_STATUSES.has(response.status) && attempt < MAX_ATTEMPTS) {
        const retryAfter = Number(response.headers.get('retry-after'));
        const waitMs =
          Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter * 1000 : 500 * 2 ** (attempt - 1);
        await sleep(waitMs);
        continue;
      }

      // 401/403 is the common first-run failure, and on this endpoint it is usually
      // entitlement rather than a typo -- the export token alone grants nothing.
      if (response.status === 401 || response.status === 403) {
        throw new ODataError(
          `The feed returned ${response.status} for ${describe}. Check ODATA_USERNAME and ` +
            `ODATA_PASSWORD, and that the identity is entitled to this export.`,
          response.status,
          redactText(text.slice(0, 500)),
        );
      }

      throw new ODataError(
        `The feed returned ${response.status} for ${describe} at ${origin}.`,
        response.status,
        redactText(text.slice(0, 500)),
      );
    }

    throw lastError ?? new Error(`Failed to read ${describe}`);
  }

  return {
    origin,
    feedLabel: config.feedLabel ?? 'Feed #3',

    async listEntitySets() {
      const parsed = await get(config.feedUrl, 'the service document');
      const sets = parseServiceDocument(parsed);
      if (!sets) {
        throw new ODataError(
          `${origin} did not return an OData service document, so its entity sets are unknown. ` +
            `Confirm the URL is the export root rather than a specific entity set.`,
          200,
          '',
        );
      }
      return sets;
    },

    /**
     * Follows server-driven paging to exhaustion.
     *
     * `@odata.nextLink` is absolute and already carries whatever continuation token the
     * service chose, so it is followed verbatim rather than rebuilt. Rebuilding it is
     * how a client ends up reinventing `$skip` against a service that does not support
     * it.
     */
    async readEntitySet(name) {
      const rows: Record<string, unknown>[] = [];
      let url: string | undefined = `${config.feedUrl}/${name}`;
      let page = 0;

      while (url && page < MAX_PAGES) {
        const parsed = await get(url, `entity set ${name}`);
        rows.push(...extractRows(parsed));
        page++;
        options.onProgress?.(name, rows.length, page);

        const next = (parsed as Record<string, unknown>)['@odata.nextLink'];
        url = typeof next === 'string' && next.length > 0 ? next : undefined;
      }

      if (url) {
        throw new ODataError(
          `Entity set ${name} still had pages after ${MAX_PAGES}, which means a paging bug ` +
            `rather than a large export. Aborting instead of serving a truncated portfolio.`,
          200,
          '',
        );
      }

      return rows;
    },
  };
}
