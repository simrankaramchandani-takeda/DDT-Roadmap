/**
 * The connection layer: transport, payload assembly, and the repository wiring.
 *
 * NOTHING HERE TOUCHES THE NETWORK. Every test injects `fetchImpl`, which is the same
 * seam production uses -- so what is exercised is the real client, not a parallel
 * implementation of it. A test that stubbed the client instead would pass while the
 * paging logic was broken.
 *
 * The cases are chosen from what the live feed actually did on 2026-08-08, not from what
 * an OData service might hypothetically do. `Business_Application_Owner_11209` really does
 * return an empty page carrying an `@odata.nextLink`, and a client that treated "no rows"
 * as "last page" would be correct there by luck and wrong elsewhere.
 */

import { describe, expect, it } from 'vitest';

import { FEED_OWNER_SIDE_TABLES } from '@config/feed.js';
import {
  createODataClient,
  loadODataConfig,
  redactFeedUrl,
  redactText,
  ODataError,
  type FetchLike,
  type ODataConfig,
} from '@/lib/feed/odata-client.js';
import { createODataRepositories } from '@/lib/feed/odata-repositories.js';
import { inspectFeedShape, readFeed3 } from '@/lib/feed/source.js';
import { resolveSource } from '@/lib/repositories/index.js';

const FEED_URL = 'https://powerbi-cloud-prod.alphaservesp.com/api/export/power-bi/0123456789abcdef0123456789abcdef';

const CONFIG: ODataConfig = {
  feedUrl: FEED_URL,
  authMode: 'basic',
  username: 'service@takeda.com',
  password: 'secret-password',
  feedLabel: 'Feed #3',
};

/**
 * A `ProcessEnv` from a plain object.
 *
 * `NODE_ENV` is declared required on `ProcessEnv` by the Next types, so a bare object
 * literal cannot be cast to it directly. Every environment-reading function under test
 * takes `env` as a parameter precisely so no test has to mutate `process.env` and leak
 * into another.
 */
function env(vars: Record<string, string>): NodeJS.ProcessEnv {
  return vars as unknown as NodeJS.ProcessEnv;
}

/** Builds a JSON `Response` the client will accept. */
function json(body: unknown, init: { status?: number; headers?: Record<string, string> } = {}): Response {
  return new Response(JSON.stringify(body), {
    status: init.status ?? 200,
    headers: { 'content-type': 'application/json', ...(init.headers ?? {}) },
  });
}

function serviceDocument(names: string[]): unknown {
  return { '@odata.context': `${FEED_URL}/$metadata`, value: names.map((name) => ({ name, url: name, kind: 'EntitySet' })) };
}

/** Records every URL requested, so paging and request COUNT can both be asserted. */
function recordingFetch(handler: (url: string, calls: string[]) => Response): {
  fetchImpl: FetchLike;
  calls: string[];
} {
  const calls: string[] = [];
  const fetchImpl: FetchLike = async (url) => {
    calls.push(url);
    return handler(url, calls);
  };
  return { fetchImpl, calls };
}

// ---------------------------------------------------------------------------
// Redaction
// ---------------------------------------------------------------------------

describe('redaction', () => {
  it('strips the export token, which is the credential half of this endpoint', () => {
    expect(redactFeedUrl(FEED_URL)).toBe(
      'https://powerbi-cloud-prod.alphaservesp.com/api/export/power-bi/<token>',
    );
    expect(redactFeedUrl(FEED_URL)).not.toContain('0123456789abcdef');
  });

  it('strips query-string tokens and Authorization values from text bound for a log', () => {
    expect(redactText('GET /x?token=abc123&page=2')).toBe('GET /x?token=<redacted>&page=2');
    expect(redactText('{"password":"hunter2"}')).not.toContain('hunter2');
  });

  it('redacts a keyed Authorization exactly once, scheme word included', () => {
    expect(redactText('Authorization: Basic c2VjcmV0')).toBe('Authorization: <redacted>');
  });

  it('still catches a bare scheme and token, as copied into a curl command', () => {
    expect(redactText('curl -H "Basic c2VjcmV0"')).toContain('Basic <redacted>');
    expect(redactText('sent Bearer abc.def.ghi')).toBe('sent Bearer <redacted>');
  });

  it('redacts the token inside an arbitrary message, not just a bare URL', () => {
    expect(redactText(`failed calling ${FEED_URL}/Issues`)).toContain('/power-bi/<token>/Issues');
  });
});

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

describe('loadODataConfig', () => {
  it('reads basic auth from the environment', () => {
    const config = loadODataConfig(env({
        ODATA_FEED_URL: `${FEED_URL}/`,
        ODATA_AUTH_MODE: 'basic',
        ODATA_USERNAME: 'a@b.com',
        ODATA_PASSWORD: 'p',
      }));

    expect(config.feedUrl).toBe(FEED_URL);
    expect(config.authMode).toBe('basic');
  });

  it('names the missing variable rather than failing generically', () => {
    expect(() =>
      loadODataConfig(env({ ODATA_FEED_URL: FEED_URL, ODATA_USERNAME: 'a@b.com' })),
    ).toThrow(/ODATA_PASSWORD/);
  });

  it('refuses an unsupported auth mode instead of falling back to anonymous', () => {
    expect(() =>
      loadODataConfig(env({ ODATA_FEED_URL: FEED_URL, ODATA_AUTH_MODE: 'ntlm' })),
    ).toThrow(/not supported/);
  });

  it('does not put a credential in the error message', () => {
    let message = '';
    try {
      loadODataConfig(env({ ODATA_FEED_URL: FEED_URL, ODATA_PASSWORD: 'hunter2' }));
    } catch (error) {
      message = (error as Error).message;
    }
    expect(message).not.toContain('hunter2');
  });
});

// ---------------------------------------------------------------------------
// Transport
// ---------------------------------------------------------------------------

describe('createODataClient', () => {
  it('sends basic auth and asks for JSON', async () => {
    const seen: RequestInit[] = [];
    const client = createODataClient(CONFIG, {
      fetchImpl: async (_url, init) => {
        seen.push(init);
        return json(serviceDocument(['Issues']));
      },
    });

    await client.listEntitySets();
    const headers = seen[0]!.headers as Record<string, string>;
    expect(headers['Authorization']).toBe(
      `Basic ${Buffer.from('service@takeda.com:secret-password').toString('base64')}`,
    );
    expect(headers['Accept']).toBe('application/json');
  });

  it('issues GET and nothing else -- read-only by construction', async () => {
    const methods: (string | undefined)[] = [];
    const client = createODataClient(CONFIG, {
      fetchImpl: async (_url, init) => {
        methods.push(init.method);
        return json(serviceDocument(['Issues']));
      },
    });

    await client.listEntitySets();
    await client.readEntitySet('Issues');
    expect(new Set(methods)).toEqual(new Set(['GET']));
  });

  it('exposes only the redacted origin', () => {
    expect(createODataClient(CONFIG).origin).toBe(
      'https://powerbi-cloud-prod.alphaservesp.com/api/export/power-bi/<token>',
    );
  });

  it('reads the entity-set list from the service document', async () => {
    const client = createODataClient(CONFIG, {
      fetchImpl: async () => json(serviceDocument(['Issues', 'Labels', 'IssueTypes'])),
    });
    expect(await client.listEntitySets()).toEqual(['Issues', 'Labels', 'IssueTypes']);
  });

  it('rejects a document that is not a service document rather than inventing entity sets', async () => {
    const client = createODataClient(CONFIG, {
      fetchImpl: async () => json({ value: [{ ISSUE_KEY: 'DDTGC-1' }] }),
    });
    await expect(client.listEntitySets()).rejects.toThrow(/did not return an OData service document/);
  });

  it('follows @odata.nextLink to exhaustion -- the only paging this feed supports', async () => {
    const { fetchImpl, calls } = recordingFetch((url) => {
      if (url.endsWith('/Issues')) {
        return json({ value: [{ ISSUE_KEY: 'A-1' }], '@odata.nextLink': `${FEED_URL}/Issues?page=2` });
      }
      if (url.endsWith('page=2')) {
        return json({ value: [{ ISSUE_KEY: 'A-2' }], '@odata.nextLink': `${FEED_URL}/Issues?page=3` });
      }
      return json({ value: [{ ISSUE_KEY: 'A-3' }] });
    });

    const rows = await createODataClient(CONFIG, { fetchImpl }).readEntitySet('Issues');
    expect(rows.map((r) => r['ISSUE_KEY'])).toEqual(['A-1', 'A-2', 'A-3']);
    expect(calls).toHaveLength(3);
  });

  it('follows the nextLink verbatim rather than rebuilding it with $skip', async () => {
    const { fetchImpl, calls } = recordingFetch((url) =>
      url.includes('continuation=opaque-token')
        ? json({ value: [] })
        : json({ value: [], '@odata.nextLink': `${FEED_URL}/Issues?continuation=opaque-token` }),
    );

    await createODataClient(CONFIG, { fetchImpl }).readEntitySet('Issues');
    expect(calls[1]).toBe(`${FEED_URL}/Issues?continuation=opaque-token`);
    expect(calls.join(' ')).not.toContain('$skip');
  });

  it('keeps paging through an EMPTY page that still carries a nextLink', async () => {
    // Observed on the live feed: Business_Application_Owner_11209 answers $top=2 with
    // zero rows and a nextLink. Stopping on an empty page would silently truncate.
    const { fetchImpl, calls } = recordingFetch((url) =>
      url.endsWith('/Owner')
        ? json({ value: [], '@odata.nextLink': `${FEED_URL}/Owner?page=2` })
        : json({ value: [{ ISSUE_KEY: 'A-9' }] }),
    );

    const rows = await createODataClient(CONFIG, { fetchImpl }).readEntitySet('Owner');
    expect(calls).toHaveLength(2);
    expect(rows).toHaveLength(1);
  });

  it('retries a 429 and honours Retry-After', async () => {
    let attempts = 0;
    const client = createODataClient(CONFIG, {
      fetchImpl: async () => {
        attempts++;
        return attempts === 1
          ? new Response('slow down', { status: 429, headers: { 'retry-after': '0' } })
          : json({ value: [{ ISSUE_KEY: 'A-1' }] });
      },
    });

    expect(await client.readEntitySet('Issues')).toHaveLength(1);
    expect(attempts).toBe(2);
  });

  it('explains a 401 in terms of entitlement, since the token alone grants nothing', async () => {
    const client = createODataClient(CONFIG, {
      fetchImpl: async () => new Response('Email mismatch', { status: 401 }),
    });

    await expect(client.readEntitySet('Issues')).rejects.toThrow(/ODATA_USERNAME/);
    await expect(client.readEntitySet('Issues')).rejects.toBeInstanceOf(ODataError);
  });

  it('does not retry a 401 -- a wrong credential will stay wrong', async () => {
    let attempts = 0;
    const client = createODataClient(CONFIG, {
      fetchImpl: async () => {
        attempts++;
        return new Response('nope', { status: 401 });
      },
    });

    await expect(client.readEntitySet('Issues')).rejects.toThrow();
    expect(attempts).toBe(1);
  });

  it('reports a non-JSON body rather than throwing a parse error', async () => {
    const client = createODataClient(CONFIG, {
      fetchImpl: async () =>
        new Response('<html>gateway timeout</html>', { status: 200, headers: { 'content-type': 'text/html' } }),
    });
    await expect(client.readEntitySet('Issues')).rejects.toThrow(/did not return JSON/);
  });

  it('aborts rather than serving a truncated portfolio when paging never terminates', async () => {
    const client = createODataClient(CONFIG, {
      // A nextLink pointing at itself: the shape a paging bug actually takes.
      fetchImpl: async () => json({ value: [{ ISSUE_KEY: 'A' }], '@odata.nextLink': `${FEED_URL}/Issues` }),
    });
    await expect(client.readEntitySet('Issues')).rejects.toThrow(/paging bug/);
  });
});

// ---------------------------------------------------------------------------
// Payload assembly
// ---------------------------------------------------------------------------

/** A stub feed shaped like the live one, with row counts controllable per set. */
function stubFeed(
  sets: string[],
  rows: Record<string, Record<string, unknown>[]> = {},
): { fetchImpl: FetchLike; calls: string[] } {
  return recordingFetch((url) => {
    if (url === FEED_URL) return json(serviceDocument(sets));
    const name = url.slice(FEED_URL.length + 1).split('?')[0]!;
    return json({ value: rows[name] ?? [] });
  });
}

const LIVE_SETS = [
  'Issues',
  'Business_Application_Owner_11209',
  'Business_Owner_10489',
  'Worklogs',
  'Labels',
  'IssueTypes',
  'IssueLinks',
  'Projects',
  'Components',
  'Versions',
  'ProjectProperties',
];

describe('readFeed3', () => {
  it('assembles a payload from the entity sets the service advertises', async () => {
    const { fetchImpl } = stubFeed(LIVE_SETS, {
      Issues: [{ ISSUE_KEY: 'DDTGC-1', PROJECT_KEY: 'DDTGC' }],
      IssueTypes: [{ ISSUE_TYPE_ID: 18329, ISSUE_TYPE_NAME: 'Epic' }],
      IssueLinks: [{ ISSUE_KEY: 'DDTGC-1', TYPE: 'Polaris work item link' }],
      Labels: [{ ISSUE_KEY: 'DDTGC-1', NAME: 'FY26' }],
      Business_Owner_10489: [{ ISSUE_KEY: 'DDTGC-1', USER_NAME: 'A Person' }],
    });

    const read = await readFeed3(createODataClient(CONFIG, { fetchImpl }));

    expect(read.payload.issues).toHaveLength(1);
    expect(read.payload.issueTypes).toHaveLength(1);
    expect(read.payload.issueLinks).toHaveLength(1);
    expect(read.payload.labels).toHaveLength(1);
    expect(read.payload.owners?.['Business_Owner_10489']).toHaveLength(1);
    expect(read.entitySets).toEqual(LIVE_SETS);
  });

  it('records the redacted origin and per-set row counts as provenance', async () => {
    const { fetchImpl } = stubFeed(LIVE_SETS, { Issues: [{ ISSUE_KEY: 'A-1' }, { ISSUE_KEY: 'A-2' }] });
    const read = await readFeed3(createODataClient(CONFIG, { fetchImpl }));

    expect(read.payload.metadata.origin).toContain('<token>');
    expect(read.payload.metadata.origin).not.toContain('0123456789abcdef');
    expect(read.payload.metadata.rowCounts?.['Issues']).toBe(2);
    expect(read.payload.metadata.name).toBe('Feed #3');
  });

  it('reads only the entity sets it consumes, not everything advertised', async () => {
    const { fetchImpl, calls } = stubFeed(LIVE_SETS);
    await readFeed3(createODataClient(CONFIG, { fetchImpl }));

    const read = calls.map((url) => url.slice(FEED_URL.length + 1));
    expect(read).not.toContain('Worklogs');
    expect(read).not.toContain('Components');
    expect(read).toContain('Issues');
  });

  it('refuses to proceed with no Issues entity set -- there is no portfolio to serve', async () => {
    const { fetchImpl } = stubFeed(['IssueTypes', 'Labels']);
    await expect(readFeed3(createODataClient(CONFIG, { fetchImpl }))).rejects.toThrow(
      /does not export Issues/,
    );
  });

  it('names the capability lost when a side table is absent, rather than thinning silently', async () => {
    const { fetchImpl } = stubFeed(['Issues'], { Issues: [{ ISSUE_KEY: 'A-1' }] });
    const read = await readFeed3(createODataClient(CONFIG, { fetchImpl }));

    const subjects = read.diagnostics.map((d) => d.subject);
    expect(subjects).toContain('IssueLinks');
    expect(subjects).toContain('Labels');
    expect(read.diagnostics.find((d) => d.subject === 'IssueLinks')?.message).toMatch(
      /site-led/,
    );
    expect(read.payload.issueLinks).toBeUndefined();
  });

  it('probes each owner side table individually rather than inferring from the shared name pattern', async () => {
    const { fetchImpl } = stubFeed(['Issues', 'Business_Owner_10489'], {
      Issues: [{ ISSUE_KEY: 'A-1' }],
      Business_Owner_10489: [{ ISSUE_KEY: 'A-1', USER_NAME: 'A Person' }],
    });
    const read = await readFeed3(createODataClient(CONFIG, { fetchImpl }));

    expect(read.payload.owners?.['Business_Owner_10489']).toHaveLength(1);
    expect(read.payload.owners?.['Business_Application_Owner_11209']).toBeUndefined();
    expect(read.diagnostics.map((d) => d.subject)).toContain('Business_Application_Owner_11209');
  });

  it('carries an exported-but-empty owner table as present with no rows', async () => {
    // The live shape: the table exists, so nothing is missing; it simply has no data.
    const { fetchImpl } = stubFeed(LIVE_SETS, { Issues: [{ ISSUE_KEY: 'A-1' }] });
    const read = await readFeed3(createODataClient(CONFIG, { fetchImpl }));

    for (const table of FEED_OWNER_SIDE_TABLES) {
      expect(read.payload.owners?.[table.entitySet]).toEqual([]);
      expect(read.diagnostics.map((d) => d.subject)).not.toContain(table.entitySet);
    }
  });

  it('strips OData annotations so a column census counts columns of data', async () => {
    const { fetchImpl } = stubFeed(LIVE_SETS, {
      Issues: [{ '@odata.id': 'Issues(1)', '@odata.etag': 'W/"1"', ISSUE_KEY: 'A-1', SUMMARY: 'x' }],
    });
    const read = await readFeed3(createODataClient(CONFIG, { fetchImpl }));

    expect([...read.issueColumns].sort()).toEqual(['ISSUE_KEY', 'SUMMARY']);
    expect(Object.keys(read.payload.issues[0]!)).not.toContain('@odata.id');
  });

  it('does not filter rows -- out-of-scope projects and level-0 rows must reach the adapter', async () => {
    const { fetchImpl } = stubFeed(LIVE_SETS, {
      Issues: [
        { ISSUE_KEY: 'DDTGC-1', PROJECT_KEY: 'DDTGC' },
        { ISSUE_KEY: 'DDTJG-1', PROJECT_KEY: 'DDTJG' },
        { ISSUE_KEY: 'ADMX-1', PROJECT_KEY: 'ADMX' },
      ],
    });
    const read = await readFeed3(createODataClient(CONFIG, { fetchImpl }));
    expect(read.payload.issues).toHaveLength(3);
  });
});

// ---------------------------------------------------------------------------
// Shape guard
// ---------------------------------------------------------------------------

describe('inspectFeedShape', () => {
  const liveColumns = Array.from({ length: 119 }, (_, i) => `COL_${i}`);

  it('is silent when the feed matches the surveyed shape', () => {
    expect(inspectFeedShape(LIVE_SETS, liveColumns, 'Feed #3')).toEqual([]);
  });

  it('reports reaching a different data source rather than letting counts collapse unexplained', () => {
    // Feed #1's shape: four entity sets, 69 columns.
    const findings = inspectFeedShape(
      ['Issues', 'IssueStatuses', 'IssueTypes', 'IssueLinks'],
      Array.from({ length: 69 }, (_, i) => `COL_${i}`),
      'Feed #3',
    );

    expect(findings.length).toBeGreaterThan(0);
    const joined = findings.map((f) => f.message).join(' ');
    expect(joined).toMatch(/Labels/);
    expect(joined).toMatch(/different data source|reconfigured/);
  });

  it('reports IssueStatuses APPEARING, because its absence is why category is derived', () => {
    const findings = inspectFeedShape([...LIVE_SETS, 'IssueStatuses'], liveColumns, 'Feed #3');
    const finding = findings.find((f) => f.subject === 'IssueStatuses');

    expect(finding).toBeDefined();
    expect(finding!.message).toMatch(/being ignored/);
    expect(finding!.remedy).toMatch(/UNMAPPED_STATUS_IS_FATAL/);
  });

  it('reports PARENT_ISSUE_* appearing, so a stale known-loss cannot sit unnoticed', () => {
    const findings = inspectFeedShape(
      LIVE_SETS,
      [...liveColumns, 'PARENT_ISSUE_KEY', 'PARENT_ISSUE_ID'],
      'Feed #3',
    );
    const finding = findings.find((f) => f.subject === 'PARENT_ISSUE_*');

    expect(finding).toBeDefined();
    expect(finding!.message).toMatch(/childCount/);
  });

  it('tolerates a small column change but reports a material one', () => {
    expect(inspectFeedShape(LIVE_SETS, liveColumns.slice(0, 116), 'Feed #3')).toEqual([]);
    expect(inspectFeedShape(LIVE_SETS, liveColumns.slice(0, 100), 'Feed #3').length).toBe(1);
  });

  it('every finding is a warning -- a reshaped feed is reportable, not an outage', () => {
    const findings = inspectFeedShape(['Issues', 'IssueStatuses'], ['A'], 'Feed #3');
    expect(findings.every((f) => f.severity === 'warning')).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Repository wiring
// ---------------------------------------------------------------------------

describe('createODataRepositories', () => {
  const ISSUES = [
    {
      ISSUE_ID: 1,
      ISSUE_KEY: 'DDTGC-1',
      ISSUE_TYPE_ID: 18329,
      ISSUE_TYPE_NAME: 'Epic',
      ISSUE_STATUS_NAME: 'Execute',
      PROJECT_KEY: 'DDTGC',
      SUMMARY: 'A roadmap item',
      DUE_DATE: '2027-03-31',
      Start_date_10412: '2026-01-05',
    },
  ];

  function repositories(overrides: Record<string, Record<string, unknown>[]> = {}) {
    const { fetchImpl, calls } = stubFeed(LIVE_SETS, { Issues: ISSUES, ...overrides });
    const odata = createODataRepositories(
      { config: CONFIG, client: { fetchImpl }, adapter: { asOf: '2026-08-08' }, cacheTtlMs: 60_000 },
      env({}),
    );
    return { odata, calls };
  }

  it('performs no I/O when constructed', () => {
    const { calls } = repositories();
    expect(calls).toEqual([]);
  });

  it('does not throw at construction when the credential is absent', () => {
    expect(() => createODataRepositories({}, env({}))).not.toThrow();
  });

  it('serves the WP3 contracts from real feed records', async () => {
    const { odata } = repositories();
    const items = await odata.repositories.items.list();

    expect(items).toHaveLength(1);
    expect(items[0]!.key).toBe('DDTGC-1');
    expect(items[0]!.siteKey).toBe('DDTGC');
  });

  it('reports the served data as live, never as fixture', async () => {
    const { odata } = repositories();
    const freshness = await odata.repositories.source.get();

    expect(freshness.kind).toBe('live');
    expect(freshness.origin).toContain('<token>');
    expect(freshness.asOf).toBe('2026-08-08');
  });

  it('reads the feed ONCE across the seven reads a page render performs', async () => {
    const { odata, calls } = repositories();

    await Promise.all([
      odata.repositories.source.get(),
      odata.repositories.initiatives.listPortfolios(),
      odata.repositories.sites.list(),
      odata.repositories.initiatives.list(),
      odata.repositories.items.list(),
      odata.repositories.coverage.get(),
      odata.repositories.coverage.listWarnings(),
    ]);

    // One service document plus one request per consumed entity set.
    const issueReads = calls.filter((url) => url.endsWith('/Issues'));
    expect(issueReads).toHaveLength(1);
  });

  it('re-reads once the cache lifetime has elapsed, so asOf cannot go stale', async () => {
    const { fetchImpl, calls } = stubFeed(LIVE_SETS, { Issues: ISSUES });
    const odata = createODataRepositories(
      { config: CONFIG, client: { fetchImpl }, cacheTtlMs: 0 },
      env({}),
    );

    await odata.repositories.items.list();
    await odata.repositories.items.list();

    expect(calls.filter((url) => url.endsWith('/Issues'))).toHaveLength(2);
  });

  it('does not cache a failed read, so an error is not pinned for the whole TTL', async () => {
    let attempt = 0;
    const fetchImpl: FetchLike = async (url) => {
      if (url === FEED_URL) {
        attempt++;
        // 400 rather than 500: a non-retryable status fails the read immediately, which
        // is what makes this a test of the memo rather than a test of the retry budget.
        if (attempt === 1) return new Response('bad request', { status: 400 });
        return json(serviceDocument(LIVE_SETS));
      }
      return json({ value: url.endsWith('/Issues') ? ISSUES : [] });
    };

    const odata = createODataRepositories(
      { config: CONFIG, client: { fetchImpl }, cacheTtlMs: 60_000 },
      env({}),
    );

    await expect(odata.repositories.items.list()).rejects.toThrow();
    // Still inside the TTL: a cached rejection would fail here, which is the defect.
    await expect(odata.repositories.items.list()).resolves.toHaveLength(1);
  });

  it('prepends read findings to the warnings the coverage page renders', async () => {
    const { fetchImpl } = stubFeed(['Issues'], { Issues: ISSUES });
    const odata = createODataRepositories(
      { config: CONFIG, client: { fetchImpl }, cacheTtlMs: 60_000 },
      env({}),
    );

    const warnings = await odata.repositories.coverage.listWarnings();
    expect(warnings[0]).toMatch(/missing-entity-set/);
    expect(warnings.some((w) => w.includes('IssueLinks'))).toBe(true);
  });

  it('exposes the read behind the repositories, not a second one', async () => {
    const { odata, calls } = repositories();

    await odata.repositories.items.list();
    const { read, adaptation } = await odata.ready();

    expect(read.payload.issues).toHaveLength(1);
    expect(adaptation.snapshot.items).toHaveLength(1);
    expect(calls.filter((url) => url.endsWith('/Issues'))).toHaveLength(1);
  });

  it('surfaces an unregistered issue type as a blocking error rather than dropping the row silently', async () => {
    const { fetchImpl } = stubFeed(LIVE_SETS, {
      Issues: [{ ...ISSUES[0]!, ISSUE_TYPE_ID: 999999, ISSUE_KEY: 'DDTGC-2' }],
    });
    const odata = createODataRepositories(
      { config: CONFIG, client: { fetchImpl }, cacheTtlMs: 60_000 },
      env({}),
    );

    const { adaptation } = await odata.ready();
    expect(adaptation.severity).toBe('error');
    expect(adaptation.tally['unknown-issue-type']).toBe(1);
    expect(await odata.repositories.items.list()).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// Source selection
// ---------------------------------------------------------------------------

describe('resolveSource', () => {
  it('defaults to the snapshot, because flipping the default is gated on governance', () => {
    expect(resolveSource(env({}))).toBe('snapshot');
    expect(resolveSource(env({ ROADMAP_SOURCE: '' }))).toBe('snapshot');
  });

  it('requires an explicit opt-in and never infers one from a credential being present', () => {
    expect(resolveSource(env({ ODATA_FEED_URL: FEED_URL }))).toBe('snapshot');
    expect(resolveSource(env({ ROADMAP_SOURCE: 'odata' }))).toBe('odata');
    expect(resolveSource(env({ ROADMAP_SOURCE: ' ODATA ' }))).toBe('odata');
  });

  it('treats an unrecognised value as the safe default rather than guessing', () => {
    expect(resolveSource(env({ ROADMAP_SOURCE: 'feed3' }))).toBe('snapshot');
  });
});
