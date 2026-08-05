/**
 * Minimal Jira Cloud REST v3 client. Read-only by construction -- this module
 * exposes no write operations, so the MVP cannot mutate Jira even by mistake.
 */

export interface JiraConfig {
  baseUrl: string;
  email: string;
  apiToken: string;
}

export interface JiraIssue {
  id: string;
  key: string;
  fields: Record<string, unknown>;
}

export interface JiraSearchPage {
  issues: JiraIssue[];
  nextPageToken?: string;
  isLast?: boolean;
}

export class JiraError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly body: string,
  ) {
    super(message);
    this.name = 'JiraError';
  }
}

/** Reads credentials from the environment, failing with actionable guidance. */
export function loadJiraConfig(env: NodeJS.ProcessEnv = process.env): JiraConfig {
  const baseUrl = env['JIRA_BASE_URL']?.replace(/\/+$/, '');
  const email = env['JIRA_EMAIL'];
  const apiToken = env['JIRA_API_TOKEN'];

  const missing = [
    !baseUrl && 'JIRA_BASE_URL',
    !email && 'JIRA_EMAIL',
    !apiToken && 'JIRA_API_TOKEN',
  ].filter(Boolean);

  if (missing.length > 0) {
    throw new Error(
      `Missing required environment variable(s): ${missing.join(', ')}.\n` +
        `Copy .env.example to .env.local and fill it in.\n` +
        `Create an API token at https://id.atlassian.com/manage-profile/security/api-tokens`,
    );
  }

  return { baseUrl: baseUrl!, email: email!, apiToken: apiToken! };
}

function authHeader(config: JiraConfig): string {
  return `Basic ${Buffer.from(`${config.email}:${config.apiToken}`).toString('base64')}`;
}

const RETRYABLE_STATUSES = new Set([429, 500, 502, 503, 504]);
const MAX_ATTEMPTS = 4;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * POST with retry on rate limiting and transient server errors. Honours
 * `Retry-After` when Jira supplies it; exponential backoff otherwise.
 */
async function post<T>(config: JiraConfig, path: string, body: unknown): Promise<T> {
  const url = `${config.baseUrl}${path}`;
  let lastError: Error | undefined;

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    let response: Response;
    try {
      response = await fetch(url, {
        method: 'POST',
        headers: {
          Authorization: authHeader(config),
          Accept: 'application/json',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(body),
      });
    } catch (cause) {
      // Network-level failure: retry.
      lastError = new Error(`Network error calling ${path}: ${(cause as Error).message}`);
      if (attempt < MAX_ATTEMPTS) {
        await sleep(500 * 2 ** (attempt - 1));
        continue;
      }
      throw lastError;
    }

    if (response.ok) return (await response.json()) as T;

    const text = await response.text().catch(() => '');

    if (RETRYABLE_STATUSES.has(response.status) && attempt < MAX_ATTEMPTS) {
      const retryAfter = Number(response.headers.get('retry-after'));
      const waitMs = Number.isFinite(retryAfter) && retryAfter > 0
        ? retryAfter * 1000
        : 500 * 2 ** (attempt - 1);
      await sleep(waitMs);
      continue;
    }

    // 401/403 are the common first-run failures; say what to check.
    if (response.status === 401 || response.status === 403) {
      throw new JiraError(
        `Jira returned ${response.status}. Check JIRA_EMAIL and JIRA_API_TOKEN, ` +
          `and that the account can browse the DDT projects.`,
        response.status,
        text,
      );
    }

    throw new JiraError(`Jira returned ${response.status} for ${path}`, response.status, text);
  }

  throw lastError ?? new Error(`Failed to call ${path}`);
}

export interface SearchOptions {
  jql: string;
  fields: readonly string[];
  maxResults?: number;
  /** 'markdown' keeps descriptions readable; 'adf' preserves table structure.
   *  The SPOT Description field needs 'adf' to be parseable. */
  expand?: readonly string[];
}

/**
 * Runs a JQL search, following `nextPageToken` until exhausted.
 *
 * Uses the `/search/jql` endpoint (the older `/search` is deprecated and its
 * `startAt` pagination is unreliable past 5,000 results).
 */
export async function searchAllIssues(
  config: JiraConfig,
  options: SearchOptions,
  onPage?: (count: number, total: number) => void,
): Promise<JiraIssue[]> {
  const issues: JiraIssue[] = [];
  let nextPageToken: string | undefined;
  let guard = 0;

  do {
    const page = await post<JiraSearchPage>(config, '/rest/api/3/search/jql', {
      jql: options.jql,
      fields: options.fields,
      maxResults: options.maxResults ?? 100,
      ...(options.expand ? { expand: options.expand.join(',') } : {}),
      ...(nextPageToken ? { nextPageToken } : {}),
    });

    issues.push(...(page.issues ?? []));
    nextPageToken = page.isLast ? undefined : page.nextPageToken;

    onPage?.(issues.length, issues.length);

    // Backstop against a malformed paging response looping forever.
    if (++guard > 200) {
      throw new Error('Aborting: exceeded 200 pages, which suggests a paging bug.');
    }
  } while (nextPageToken);

  return issues;
}

/** Counts matching issues without fetching them. */
export async function countIssues(config: JiraConfig, jql: string): Promise<number> {
  const result = await post<{ count?: number }>(config, '/rest/api/3/search/approximate-count', {
    jql,
  });
  return result.count ?? 0;
}
