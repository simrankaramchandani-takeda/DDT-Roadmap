# ADR-001: Data source — enterprise OData feed vs. direct Jira REST

- **Status:** Proposed, **pending governance sign-off**. E1/E2/E3/E5/E7 all pass against a
  **third feed discovered on 2026-08-07**, which is a strict superset of Feeds #1 and #2 and is
  now the **preferred OData source**. The two technical blockers recorded in the previous
  revision are both resolved or downgraded: the field gap was mostly a defect in
  `config/fields.ts` rather than in the feed, and hierarchy level is not required for initiative
  alignment. The remaining blocker is **governance, not technology** — E4, E6 and E8 are open.
  **No migration work has started; no OData client exists.**
- **Date:** 2026-08-06, revised 2026-08-07
- **Supersedes:** the implicit Phase 0 decision to integrate Jira REST directly; and, within this
  document, the 2026-08-06 decision to consume Feeds #1 and #2 as a union.
- **Recommendation:** keep Jira REST temporarily, then migrate to **Feed #3** as a single source.

## Context

Phase 1 shipped a working Jira REST v3 pipeline (`scripts/sync.ts` → `data/snapshot.json`,
147 tests, gated by `scripts/verify-snapshot.ts`). REST was chosen because the OData feed
behind the DDTRoadmap Power BI report was believed to be a summarised report export missing
fields the roadmap depends on.

**That premise was wrong.** The feed is not a report export. It exposes the underlying Jira
dataset, and the roadmap-relevant fields — issue identifiers, descriptions, `updated`
timestamps, issue links, status, ownership, custom fields and SPOT fields — are available
through it.

> **Correction, 2026-08-07.** An earlier revision of this document asserted that "field
> availability and fidelity are closed questions and are not revisited here." That was wrong and
> it was load-bearing: it was used to justify the two-feed union and to declare a 2-of-21 field
> gap. Field availability has since been re-opened twice and materially changed the decision both
> times. **Do not treat the field question as closed again without a census.** The probe now
> measures population per site per field rather than asserting availability.

Two design constraints frame everything below:

- The app is **intentionally read-only**. No writes, transitions, comments, edits or workflow
  actions.
- The app **never queries Jira at runtime**. A scheduled sync generates a snapshot; the
  application reads snapshots.

And one product constraint: **leadership will compare this application directly against the
existing Power BI roadmap**, so reconciliation and consistency are functional requirements.

## Decision

Treat the roadmap app as **another consumer of an existing enterprise data product**, not as a
new Jira integration, and adopt the OData feed as the strategic source. Jira REST is MVP
scaffolding with a scheduled removal date.

The reframe is the substance of this ADR, not just the transport choice:

| | As a Jira integration | As a data-product consumer |
|---|---|---|
| Approval path | New Jira access request, service account | Entitlement to an existing registered feed |
| Contract owner | This project | The feed's data owner |
| Failure mode to design for | API deprecation, token expiry, rate limits | Feed schema drift, refresh lag, entitlement scope |
| Reconciliation with Power BI | Best-effort; two independent paths | Structural; one source |
| Support escalation | This project | Existing feed support channel |

The right-hand column is the better position on every row.

## What Jira REST provides that OData cannot

Essentially nothing this application requires.

| REST capability | Applies here? |
|---|---|
| Writes, transitions, comments, workflow actions | **No** — out of scope by design. |
| Live request-time reads | **No** — the app reads snapshots. This removes REST's usual decisive advantage. |
| Arbitrary JQL | **No, and OData is likely better.** JQL cannot filter on `issuetype.hierarchyLevel`, which is why `sync.ts` fetches every issue across all projects and filters in code. `$filter` on a hierarchy-level column does server-side what JQL structurally cannot. |
| On-demand freshness | **Only if** the feed's refresh cadence is slower than the sync cadence. |

Jira REST is therefore an **MVP convenience, not a strategic architecture choice**. Its only
remaining advantage is that it is already built — a sunk-cost argument.

## Governance, security and operational complexity

OData reduces all three.

- **Security.** Removes the personal Atlassian API token *from this repository*. But see the
  probe evidence below: the feed advertises **`WWW-Authenticate: Basic` only**, so a credential
  still exists — it is a username/password pair, not a federated service identity. Whether this
  is a governance improvement depends entirely on whether that credential is a service account
  or a named individual. If the latter, the defect is relocated rather than removed.
  The underlying defect to fix either way: the snapshot's data scope is currently *one
  individual's Jira permissions*, and if that account's access changes the roadmap's contents
  change with no signal and no audit trail. Alpha Serve connectors typically export according
  to the permissions of the account that configured the data source, so this must be confirmed,
  not assumed.
- **Approval.** Reuses an existing grant rather than requesting a Jira service account —
  conditional on E4/E5 below.
- **Ownership.** The data contract belongs to the feed owner; schema changes arrive through a
  change-notification path instead of being discovered by a failing sync.
- **Operational.** Deletes ~182 lines of bespoke pagination, retry/backoff and 429 handling,
  and removes exposure to Atlassian API deprecation. The pipeline already had to migrate off
  the deprecated `/search` endpoint to `/search/jql`.

The one real cost: a new field becomes a request against the feed owner's queue rather than a
one-line edit to `SYNC_FIELDS`. Acceptable now that the field set is settled; it would not have
been during discovery.

## Enterprise alignment

Consuming the same source as Power BI is a strategic benefit, not tidiness. On one source, a
discrepancy is a definitional difference that can be explained. On two independent paths, every
discrepancy is first suspected to be a defect and the app carries the burden of proof each
time. Single-source reconciliation converts a recurring credibility risk into a one-time
definitional exercise.

## Migration effort

> **Superseded by [`design-001-odata-adapter.md`](design-001-odata-adapter.md), 2026-08-07.** That
> document is the authoritative technical design for the Feed #3 adapter: module structure, the
> full column mapping, the status-category and hierarchy-registry strategies, the wiki-markup
> parser, and the phased migration plan with its parity gate. The summary below is retained as the
> original sizing estimate; note that it omits the wiki-markup parser and the status-category
> work entirely.

**Changes** — confined to the ingestion layer:

| File | Change |
|---|---|
| `src/lib/jira-client.ts` | Replaced by an OData client. |
| `scripts/sync.ts` (fetch step only) | Fetch rows, shape to `{ key, fields }`. |
| `config/fields.ts` | `SYNC_FIELDS` becomes the `$select` list; candidate-list structure unchanged. |
| *new adapter* | Assemble `issuelinks` per issue — a navigation property in OData rather than a nested array. |

**Untouched** — the payoff of the Phase 1 design:

- The entire `src/lib/` transformation layer. It is pure and I/O-free, and `normalise.ts` types
  its input as `JiraFields = Record<string, unknown>` — an untyped bag, not a Jira-shaped type.
- `extractScalar` already accepts bare strings alongside `{value}`/`{displayName}` objects, so
  OData's flatter values make that layer's job easier, not harder.
- `src/types/domain.ts`, the `data/snapshot.json` contract, `verify-snapshot.ts`, and all 147
  tests.
- All Phase 2 UI work — it reads the snapshot and is indifferent to what filled it.

Two adapter behaviours that are easy to get wrong:

1. **Do not filter to hierarchy levels 1–2 at the feed.** Child tallies are computed from
   level-0 issues in the same pass; filtering them out silently drops `childCount`.
2. **Do not scope issue links to in-scope projects.** Matching requires *seeing* out-of-scope
   counterparts in order to reject them.

## Entitlement and authentication — the open risk

This is the only area with genuine uncertainty, and it concerns **identity, not data**. At the
data layer, app consumption and Power BI consumption are identical. At the identity and network
layers they may not be:

1. **Auth mode.** Power BI typically authenticates as an interactive user or via a stored
   gateway credential. A headless sync cannot do interactive auth. Whether the feed accepts a
   non-interactive principal is the single deciding technical fact.
2. **Entitlement scope under a service identity.** If row-level security keys on the requesting
   user, a service principal may see a different dataset — or none.
3. **Network reachability.** If the feed is reached through an on-premises data gateway or only
   from within the Power BI service, a standalone Node process may have no path to it
   regardless of credentials.

### Evidence required

Status as at 2026-08-07, against **Feed #3**:

| # | Evidence | Decides | Status |
|---|---|---|---|
| E1 | Feed accepts non-interactive auth | Whether a scheduled job can authenticate | **PASS with caveat** — Basic only, credential type unconfirmed |
| E2 | Endpoint reachable by a non-Power-BI client | Whether a scheduled job has a network path | **PASS** |
| E3 | All 19 in-scope projects return rows | Whether the identity sees the full scope | **PASS** — 19/19 in Feed #3 alone |
| E4 | Approved-use statement names *tools* or *data scope* | Whether a separate entitlement is needed | **Open — blocking** |
| E5 | Issue-link relationships usable | Whether initiative alignment can work | **PASS** — 509 GMPORT links, 17/18 sites, both directions |
| E6 | Named data owner / catalog registration | Support and change-notification path | **Open — blocking** |
| E7 | Refresh cadence and SLA | Whether it meets the sync cadence | **PASS** — same-day on Feed #3 |
| E8 | Precedent: any existing non-BI consumer | Collapses E1/E4 into a known-good pattern | **Open — blocking** |

The three open rows are all governance, all need the data owner and platform team, and none can be
resolved by further probing.

### Probe evidence, 2026-08-06

Feed: `https://powerbi-cloud-prod.alphaservesp.com/api/export/power-bi/<token>` — an Alpha Serve
Power BI Connector for Jira export endpoint, not a self-hosted Atlassian service.

- **E2 PASS — the decisive early result.** The host resolves, TLS completes, and the endpoint
  returns an HTTP response to a plain PowerShell/Node client from a normal workstation. There is
  **no on-premises data gateway and no Power-BI-service-only path**. This was the single most
  likely hard blocker and it is now retired.
- **E1 PARTIAL.** The server responds `401` with `WWW-Authenticate: Basic`. Basic auth *is*
  non-interactive, so a scheduled sync can authenticate unattended — the mechanical requirement
  is met. But **no OAuth client-credentials or service-principal flow is advertised**, so the
  "federated service identity" assumed earlier in this ADR is not available on this endpoint.
  The credential will be a username/password pair.
- **The URL token is not the credential.** A syntactically valid but non-existent token returns
  the same `401 Basic`, so authentication is enforced at the edge before token resolution.
  Possessing the URL alone grants nothing.
- **It is a genuine OData v4 service.** EDMX `$metadata` (25.7 KB) exposes four entity sets:
  `Issues`, `IssueStatuses`, `IssueTypes`, `IssueLinks` — a **normalised relational model**,
  where `normalise.ts` expects Jira's denormalised nested JSON. The adapter must join, not
  rename.

### Authenticated probe results, 2026-08-06

**E5 PASS.** `IssueLinks` carries `ISSUE_KEY`, `TYPE`, `DIRECTION`, `LINKED_ISSUE_KEY` — exactly
what `findInitiativeKey` (`src/lib/transform.ts:158-171`) needs, including the direction field
that undirected matching depends on.

**IssueStatuses PASS.** `ISSUE_STATUS_NAME` + `CATEGORY`. Both are required; category alone
reports `Will not do` as delivered.

**E7 — the feed lags ~33 hours.** Newest `UPDATED` in the feed was `2026-08-05T08:00:37Z` when
probed at `2026-08-06T17:32Z`. Acceptable for a daily executive roadmap, but it must be stated
on the UI, and it means the app can never be more current than the feed.

**E2 WARN — the feed switches off most of OData.** Declared in its own capability annotations:
`$count` unsupported, `$skip` unsupported, `$expand` unsupported, by-key access unsupported,
navigation `None`, and **68 properties non-filterable including `PROJECT_KEY` and `UPDATED`**.
Consequences: the adapter must pull everything and filter in code (which `sync.ts` already does,
so not a regression), paging is only via `@odata.nextLink`, and **incremental sync by `UPDATED`
is impossible** — every sync is a full pull. Current full pull is 1118 rows over 2 pages.

**E3 FAIL — six in-scope projects return zero rows.** `DDTGMPORT`, `DDTOSA`, `DDTHIK`, `DDTYAR`,
`DDTBA`, `DDTBEK`. `DDTGMPORT` is the portfolio project holding all 36 Initiatives, so
**initiative alignment is impossible today** — a core feature, not a nice-to-have. Meanwhile the
feed carries `DDTJG` (214 rows), which is *deferred* from MVP scope.

> **Superseded 2026-08-07.** This is a finding about **Feed #1**, and it remains accurate for that
> feed. E3 now passes against Feed #3, which carries all 19 projects. The reasoning below is
> retained because the four independent lines of evidence are a useful template for proving a
> project is genuinely absent rather than hiding under a business name.

This conclusion was challenged on the grounds that the feed might expose business-facing project
names (`DDT Osaka`) rather than Jira keys, and was re-tested against every available
representation. It survives on four independent lines of evidence:

1. **Structural.** The EDMX declares only `PROJECT_ID` and `PROJECT_KEY` on `Issues`. There is no
   `PROJECT_NAME` column anywhere, and only four entity sets — **no `Projects` dimension table**
   to carry a name-based representation.
2. **Value-level.** The 14 distinct `PROJECT_KEY` values are genuine Jira keys (`DDTGC`,
   `NEUCHDDT`, `DDTBP`, …), not display names.
3. **Independent encoding.** `ISSUE_KEY` prefixes yield *exactly the same 14 projects*. Jira
   derives issue keys from the project key and a BI connector cannot relabel them, so if `DDTOSA`
   work were present under any alias its issue keys would still read `DDTOSA-nnn`. They do not
   appear.
4. **Cardinality.** 14 distinct `PROJECT_ID` values — matching. No project is hiding under an
   unexpected label.

A name-based fallback comparing each missing project's configured display name against every
observed identifier also returned no matches. Note `NEUCHDDT` is present and does not fit the
`DDT*` pattern, confirming the tally is not pattern-blind.

**Verdict: truly absent — not present under business names, and not behind a lookup table.**
It is not a paging artifact either: the pull follows `@odata.nextLink` to exhaustion (1118 rows,
2 pages). The cause is the data source's configured project selection.

**Blocker — `IssueTypes` has no hierarchy level.** Its full type model is `ISSUE_TYPE_ID`,
`ISSUE_TYPE_NAME`, `DESCRIPTION`, `IS_SUBTASK`, `ICON_URL`, `SCOPE_TYPE`, `SCOPE_ID`. The string
`hierarchy` does not appear anywhere in the EDMX. `IS_SUBTASK` separates level -1 only; it
cannot distinguish level 0 (Story) from 1 (Epic) from 2 (Initiative). Selection would have to
regress to **type-name matching** — precisely the failure mode `config/hierarchy.ts` exists to
prevent.

**Custom-field coverage is a configured subset.** Of the DDT fields in `config/fields.ts`, the
EDMX contains `Start_date_10412` and `Overall_Status_24266`, but not `24265` (SPOT narrative),
`15784/15785` (Health), `23746` (fiscal year), `19886/10710` (SPOT ID), the seven owner fields,
`24406`, `11199`, or `10493/10494`. `labels` and `parent` are also absent — the latter is what
`childCount` is computed from.

### Feed #2, probed 2026-08-07

A second Alpha Serve data source exists on the same host, and the **same credential
authenticates against it**. It contains **exactly the six projects missing from Feed #1** and
nothing else — 246 issues, one page, no out-of-scope contamination:

| Project | Issues |
|---|---|
| `DDTGMPORT` | 37 |
| `DDTOSA` | 73 |
| `DDTHIK` | 69 |
| `DDTBEK` | 38 |
| `DDTYAR` | 17 |
| `DDTBA` | 12 |

`DDTGMPORT` returning 37 rows against a discovery baseline of 36 Initiatives is a strong
corroboration.

**Together the two feeds cover all 19 in-scope projects** — Feed #1 supplies 13 sites, Feed #2
supplies the remaining 5 plus the portfolio. E3 is therefore resolvable **without any project
reconfiguration**.

> **Superseded 2026-08-07 — do not implement the two-feed union.** Feed #3 covers all 19 projects
> on its own, with fresher data and a richer field set. One observation from Feed #2 is worth
> keeping: its `IssueLinks` table carries rows for issues that are *not* in its own `Issues`
> export (e.g. `DDTORA-1`, `NEUCHDDT-8`), because a link row is exported when either endpoint is in
> scope. That is how the link table behaves generally, and it is why link coverage must be counted
> per ordered pair rather than per link.

**Feed #2 has a richer schema:** 13 entity sets versus 4, and 82 columns versus 69. It adds
`Projects` (a real dimension table with `PROJECT_KEY`, `NAME`, `CATEGORY`, `LEAD_NAME`),
`Labels`, `Components`, `IssueComponents`, `Attachments`, `RemoteLinks` and three `Theme_*` sets.
Critically it also exposes `PARENT_ISSUE_ID` / `PARENT_ISSUE_KEY`, which is what `childCount`
is computed from and which Feed #1 lacks entirely.

`Issues`, `IssueStatuses`, `IssueTypes` and `IssueLinks` are present in both feeds with
**identical shapes**, so the shared core of an adapter would be common to both.

### Feed #3, probed 2026-08-07 — the preferred source

A third Alpha Serve data source exists on the same host and the **same credential authenticates
against it**. It is a **strict superset of Feeds #1 and #2 and supersedes both.** The two-feed
union above is retained only as history; it should not be implemented.

| | Feed #1 | Feed #2 | **Feed #3** |
|---|---|---|---|
| In-scope projects | 13 sites | 5 sites + portfolio | **all 19** |
| Issues rows | 1118 | 246 | **1371** |
| `Issues` columns | 69 | 82 | **119** |
| Entity sets | 4 | 13 | 11 |
| Newest `UPDATED` when probed | ~33h stale | ~1 day stale | **same-day** |

**Project coverage is exactly Feed #1 ∪ Feed #2** — 20 projects, being all 19 in scope plus
out-of-scope `DDTJG`. Row counts match per project with a **+7 total delta confined to five
Feed #1 projects** (`DDTTO` +3, `DDTBP` +4): 1118 + 246 = 1364, +7 = 1371. That delta is
**freshness, not scope**. `DDTGMPORT` returns 37 rows of which 36 are type `Initiative`, an exact
match to `DISCOVERY_BASELINE.initiatives`.

**Initiative alignment works within the single feed.** `IssueLinks`: 668 rows, 539
`Polaris work item link`, **509 touching `DDTGMPORT`** across **17 of 18 sites**, referencing 26
of the 36 Initiatives. Both directions are populated in near-equal numbers (`Outward` 254 /
`Inward` 255 — one row per ordered pair), independently re-confirming that undirected matching is
required.

**E7 improves from a warning to a pass.** Newest `UPDATED` was `2026-08-07T13:35:00Z`, same-day,
against Feed #1's measured ~33-hour lag.

### The field gap was mostly a defect in `config/fields.ts`, not in the feed

This is the most consequential finding in this revision, and it **applied equally to the Jira
REST pipeline**.

Feed #3 exposes **18 `Overall_Status_*` fields and 19 `SPOT_Description_*` fields — one per
site**, because each site's SPOT integration was provisioned separately. `config/fields.ts` knew
exactly one of each: Singapore's `24266` and `24265`. `SYNC_FIELDS` therefore never requested the
other seventeen, so **REST could not see them either**. The "2 of 21 fields" tally in the previous
revision counted the wrong thing: it compared the feed against a candidate list that was itself
incomplete.

Census over the 510 in-scope hierarchy-level-1 items, 2026-08-07:

| Attribute | Reachable with the old config | Actually populated |
|---|---|---|
| Authored RAG | 84 items (~11%) | **424 / 510 (83%)** — every site non-zero |
| SPOT narrative | 8 items (~1%) | **299 / 510 (59%)** — every site except `DDTYAR` |
| SPOT ID field | 8 items | **312 / 510 (61%)** |

Exactly one candidate is populated per item — zero items carry two populated `Overall Status`,
`Overall Status Description` or `SPOT ID` fields — so coalescing is unambiguous and candidate
order changes no resolved value. The mapping is recorded as `SITE_SPOT_FIELDS` in
`config/fields.ts`; `DDTLNZ` and `DDTSNG` break the otherwise-adjacent numbering, so the IDs are
transcribed from evidence and must not be derived from a pattern.

The README's headline finding — "only ~11% of items carry a site-authored status; ~1% carry a
narrative", described there as "the central finding, not a bug" — was therefore **largely a
config artifact**. Risk provenance and narrative coverage are far better than the project
believed, which changes the product's value proposition, not just its plumbing.

**Genuinely still absent from Feed #3:** `11199` (Initiative RAG), `15784`/`15785` (Health),
`23746` (fiscal year), `10710`, `18427`, `24406`, six of seven owner fields, `10493`/`10494`,
`10387`. Impact is small: fiscal year is already derived in `config/fiscal-year.ts`;
`10493`/`10494` are only fallbacks and Feed #3 carries `Start_date_10412` on 461/510 (90%) and
`DUE_DATE` on 478/510 (94%), better than discovery's 74%/83%; owners are covered by
`CURRENT_ASSIGNEE_NAME` (369/510) plus a `Business_Owner_10489` entity set.

### Three Feed #3 regressions, recorded so they are not rediscovered

1. **No `IssueStatuses` entity set, so no `statusCategory`.** Feeds #1 and #2 both have it.
   `Issues` carries `ISSUE_STATUS_ID`/`_NAME` and `STATUS_CATEGORY_CHANGE_DATE`, but not the
   category — which removes the fallback in `normaliseStatus`. Tractable: only **17 distinct
   status names occur in scope**, of which seven are unmapped today — `Assessment`, `Define`,
   `Discarded`, `Hold`, `ON HOLD`, `In Review`, `Open`. `Hold`/`ON HOLD` have no canonical phase
   and need a decision. Losing the category also weakens the "terminal status beats an authored
   RAG" rule, which is checked on category as well as name.
2. **No `PARENT_ISSUE_*` columns, so no `childCount`.** Feed #2 has them. Blast radius is one
   optional sentence in `summarise.ts` (`progressClause`) and one domain field — and it matters
   much less now that 59% of items carry a real narrative.
3. **The SPOT narrative is Jira wiki markup, not ADF.** Feed #3 returns pipe-delimited table text
   (`|Project Phase|Execute|`) where REST returns an ADF document, so **`src/lib/adf.ts` will not
   parse it**. A sibling parser is required. This is a real adapter cost that the migration table
   above does not account for.

### Hierarchy level: non-blocking for alignment, still required for selection

`hierarchy` appears **zero times** in Feed #3's 57 KB EDMX, and its `IssueTypes` is identical to
the other two feeds'. Three independently configured data sources exposing the same reduced type
model confirms this is an Alpha Serve **product limitation, not a setting**. Requesting
reconfiguration will not fix it.

But it is not the blocker the previous revision claimed, because it was being asked to do two
different jobs:

- **Alignment** — hierarchy level was never used for it. The Polaris work item link is the
  authoritative relationship, in the REST pipeline too (`findInitiativeKey`). Feed #3 satisfies
  this fully. **Hierarchy level is therefore non-blocking for initiative alignment.**
- **Selection** — hierarchy level is the only mechanism, and links cannot substitute. Only **249
  of 510** level-1 items carry a GMPORT link, so selecting on "has a link" would discard half the
  roadmap, and links also hang off level-0 issues.

**Agreed mitigation** (not yet built, and not to be built before the field work lands): an
explicit `ISSUE_TYPE_ID → hierarchyLevel` registry in `config/hierarchy.ts`, seeded once from
Jira REST — which does return `hierarchyLevel` — with **an unknown type ID as a hard
`verify-snapshot` failure**. The in-scope type set is small and closed (`Epic` 510, `Task` 401,
`Subtask` 202, `Story` 121, `Sub-task` 73, `Initiative` 36, `Digital Project` 18, `Bug` 9,
`Impediment` 1) and `IssueTypes` carries `SCOPE_TYPE`/`SCOPE_ID`, so project-local types are
visible. This is **strictly safer than the status quo**: today an unrecognised level-1 type causes
silent partial loss on a site that still has Epics, whereas an unknown ID fails loudly.

### Root cause of what remains

The out-of-scope projects and the genuinely missing fields have one common cause: **the Alpha
Serve data sources are configured for the Power BI report's requirements, not the roadmap's.**
`DDTJG`'s presence in all three feeds is the clearest evidence. Project and field selection are
both connector settings, so this is a request to the feed owner — but it also means the
configuration **can change without notifying us**, which is a governance question rather than a
technical one.

`DDTJG` is deferred and **must not drive architectural decisions**; see `NON_DRIVING_DEFERRED_KEYS`
in `config/projects.ts`. Its presence in a feed is noise the adapter filters, not a scope signal
and not a reason to prefer or reject a source.

### Governance is now the only hard blocker — E4, E6, E8

Every technical question has been answered or downgraded. What is left is **identity and
ownership**, and the position is weaker than the earlier revision implied, not stronger:

- **E4 — approved use.** No statement exists saying whether the existing entitlement covers
  consumption by an application, or only by Power BI. Unresolved.
- **E6 — data owner.** No named owner and no catalog registration for any of the three feeds.
  There is no change-notification path, so a reconfiguration would arrive as a failing sync.
- **E8 — precedent.** No known non-BI consumer of these feeds. A precedent would collapse E4 and
  E1 into a known-good pattern.
- **Credential type.** Authentication is Basic username/password. Whether it is a service account
  or a named individual is **still unconfirmed**, and it decides whether the OData move removes
  the key-person dependency or merely relocates it. A rotation owner is also unidentified.
- **Entitlement scope.** Alpha Serve connectors typically export according to the permissions of
  the account that configured the data source, so the snapshot's data scope may be one
  individual's Jira permissions. If that account's access changes, the roadmap's contents change
  with no signal and no audit trail.

We would be taking a dependency on a **third** undocumented feed from an unidentified owner. That
is the escalation, and it gates step 4 of the migration sequence.

**Asks for the feed owner.** Far smaller and more credible than the previous revision's 19-field
list, and two of the four are demonstrably configurable because another feed already has them:

1. Add `IssueStatuses` to Feed #3 — present in Feeds #1 and #2.
2. Add `PARENT_ISSUE_*` columns to Feed #3 — present in Feed #2.
3. Add `11199` (Initiative RAG) — in none of the three feeds.
4. Confirm whether out-of-scope `DDTJG` is intentional, and whether project or field selection
   can change without notice.

## Migration sequence

Strictly ordered. Nothing past step 3b begins without approval.

1. ~~**Obtain a credential** for the feed and complete the probe (E3, E5, E7).~~ **Done** — E3, E5
   and E7 all pass against Feed #3.
2. **Answer E4, E6, E8** with the data owner and platform team, and confirm the credential is a
   service account with a named rotation owner. ← **current gate, and the only hard blocker**
3. **Close the field-candidate gap on the existing REST pipeline first.** This is independent of
   the transport decision, verifiable today, and worth more than the migration: populate
   `SITE_SPOT_FIELDS` in `config/fields.ts` (**done**), then re-sync and re-measure the affected
   baselines. Requires a `JIRA_API_TOKEN`, which is not currently configured.
   3b. **Review findings and decide.**
4. Build `src/lib/odata-client.ts` plus a row-shaping adapter against **Feed #3 only**.
   `scripts/sync.ts` gains an alternate fetch path behind a flag; the existing REST path stays
   intact and default. Must include: the issue-type-ID registry for selection, a wiki-markup SPOT
   parser alongside `adf.ts`, and an explicit status-name map covering all 17 in-scope names since
   there is no `statusCategory` fallback.
5. Run both sources and diff the snapshots until they reconcile.
6. Make OData the default. Retire REST only after step 5 is clean for a full cycle — and keep a
   REST path for the one-time issue-type metadata capture.

The REST pipeline is the reference implementation and comparison baseline throughout. It is
not modified before step 4 and not removed before step 6.

## Consequences

**E1–E3 now pass**, so on governance sign-off: migrate the ingestion layer to Feed #3, run both
sources in parallel, diff the snapshots, then retire Jira REST.

**If E4/E6/E8 cannot be answered:** raise it as a platform gap. Do **not** accept Jira REST as the
permanent architecture by default — continue on REST as a documented interim with the governance
gap tracked as the blocker to the target state. Note that REST is now a *more* attractive interim
than before, because the field-candidate fix delivers most of the data-quality benefit without any
transport change.

**Initiative-level status resolves by rollup.** No feed exposes `11199`, and `DDTGMPORT` carries
zero authored RAG of any kind in Feed #3, so Initiative status is derived from its linked site
items via `rollUpRisk` with `provenance: 'inferred'`, and `11199` is requested in parallel so an
authored value can override it later. **Reconciliation risk to state on the UI:** the Power BI
report may show an authored Initiative RAG where this app shows a rolled-up one.

**Accepted now:** a dependency on the feed owner's release cadence for new fields, and
two-hop debugging when data looks wrong. Mitigated by keeping the per-site zero canary in
`verify-snapshot`, which catches the failure mode that actually matters.

## Related scope decision

Four projects (`DDTLA`, `DDTCOV`, `DDTJG`, `DDTLESS`) were deferred from MVP scope alongside
this review, reducing scope from 23 to 19 projects and the baseline from 645 to 429 expected
active items. All four are treated identically; no claim is made about which of them appear in
the current Power BI report, since that has not been established from the report itself. See
`DEFERRED_SITES` in `config/projects.ts`.
