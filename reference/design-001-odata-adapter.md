# Design-001: OData adapter for Feed #3

> ## Implementation status after WP4 (2026-08-08)
>
> **Built — the transformation layer, no connection.** `src/lib/feed/` implements the
> Feed DTOs, three-state validation outcomes, centralised normalisation and the adapter
> that emits `JiraIssue[]` and then the canonical model. `src/lib/spot-wiki.ts` and the
> `parseSpotDescription` dispatcher (§4) are done, sharing one vocabulary with the ADF
> parser via `src/lib/spot-vocabulary.ts`. `PHASE_TO_CATEGORY`, the `hold` phase and the
> seven status names (§3) landed in WP2. `customfield_11209` is in `OWNER_FIELD_CANDIDATES`.
> `config/feed.ts` holds the column conventions and the level registry.
>
> **Deliberately not built.** `odata-client.ts`, `source.ts`, the `sync.ts` seam and
> `diff-snapshots.ts` — Phase B onward. Nothing reaches the network.
>
> **Two blockers carried forward, both stated in `config/feed.ts` and reported at runtime:**
>
> 1. **`ISSUE_TYPE_LEVELS` is incomplete.** Seeded from the probe samples (five projects
>    of nineteen); type IDs are per-project so it cannot be completed by reasoning. Until
>    `scripts/capture-issue-types.ts` runs against REST, an unregistered type is a blocking
>    diagnostic naming the ID, name and scope — by design (§3a), since the alternative is
>    silent loss.
> 2. **`BLOCKS_DIRECTION_MEANING` is `'unresolved'`** (§6). While it stays that way the
>    adapter attributes **no** blockers from the feed and says so once per run. One
>    observation against Jira settles it; `tests/feed-adapter.test.ts` already pins both
>    the unresolved and resolved behaviours.

- **Status:** Approved. Phase A is implemented (see above); Phases B–E are not.
- **Date:** 2026-08-07
- **Depends on:** [`adr-001-data-source.md`](adr-001-data-source.md) — Feed #3 is the target source.
- **Still gated by:** governance (E4/E6/E8, service-account confirmation). This design can be
  reviewed and Phase A can ship without that sign-off; Phase B onward cannot.

---

## 1. Adapter architecture

### The governing decision: adapt to the existing contract, don't change it

`scripts/sync.ts` step 1 produces `JiraIssue[]` — `{ id, key, fields: Record<string, unknown> }`.
Every consumer downstream (`classifyIssues`, `transformItem`, all of `src/lib/normalise.ts`) reads
that shape. `normalise.ts` types its input as `JiraFields = Record<string, unknown>`: an untyped
bag, not a Jira-shaped type.

**So the adapter's output type is `JiraIssue[]`.** It synthesises Jira-shaped issues from Feed #3's
relational model. The transformation layer does not learn that OData exists.

The alternative — introducing a neutral intermediate model and rewriting `transform.ts` and
`normalise.ts` against it — is rejected. It would put 147 passing tests and the only validated
business logic in the repo at risk in order to avoid one adapter module, and it would destroy the
snapshot-diff parity gate (§8) that is the entire safety net for this migration.

Consequence worth stating plainly: the adapter is **deliberately a shim that fakes a Jira
payload**. That is the point. It is a translation boundary, not a model.

### Modules

Flat, matching the existing `src/lib/*` convention.

| File | Responsibility |
|---|---|
| `src/lib/odata-client.ts` | HTTP only. Basic auth, `@odata.nextLink` paging, retry/backoff, entity-set reads. No domain knowledge. Mirrors the discipline of `jira-client.ts` and is likewise **read-only by construction** — no POST/PATCH/DELETE is exposed. |
| `src/lib/odata-adapter.ts` | Joins the entity sets and emits `JiraIssue[]` plus diagnostics. All Feed #3 knowledge lives here. |
| `src/lib/spot-wiki.ts` | Wiki-markup SPOT table parser (§4). |
| `config/odata.ts` | Feed identity, entity-set names, column conventions, capability facts. |

### The source seam

```ts
// src/lib/source.ts  (new, ~30 lines)
export interface SourceAdapter {
  readonly name: 'jira-rest' | 'odata';
  /** Used only to build `jiraUrl` links. Not a credentialed dependency. */
  readonly baseUrl: string;
  fetchIssues(onProgress?: (count: number) => void): Promise<FetchResult>;
}

export interface FetchResult {
  issues: JiraIssue[];
  /** Recorded in the snapshot so the UI can state how current the data is. */
  meta: {
    source: 'jira-rest' | 'odata';
    fetchedAt: string;
    /** Newest `UPDATED` in the payload — the true freshness bound. */
    newestUpdated?: string;
    rowCounts?: Record<string, number>;
  };
  /** Conditions that must abort the sync. Empty on a healthy run. */
  blocking: string[];
  warnings: string[];
}
```

`sync.ts` step 1 becomes adapter selection plus the existing call. That is the **only** change to
`sync.ts` in Phase B — roughly 15 lines, and the REST path stays the default.

`baseUrl` under OData: Feed #3 exposes no Jira browse URL (`ICON_URL` points at
`api.atlassian.com`, not the tenant). Keep `JIRA_BASE_URL` as a plain non-secret config value used
only for link construction. **No Jira token is required to run an OData sync.**

### Why the adapter cannot filter

Two constraints inherited from ADR-001, restated because they are easy to violate while
optimising:

1. **Do not filter to hierarchy levels 1–2 at the feed.** Level-0 rows are needed for link
   counterpart status, and for `childCount` if `PARENT_ISSUE_*` is ever added.
2. **Do not scope issue links to in-scope projects.** Alignment matching works by *seeing* an
   out-of-scope counterpart and rejecting it. Pre-filtering would silently convert a
   correctly-rejected link into no link at all — the same observable result for the wrong reason.

Both are cheap: the full pull is 1371 issue rows and 668 link rows.

### Paging and incrementality

Feed #3 declares `SkipSupported=false`, `IndexableByKey=false`, `NavigationType/None`, and 118
non-filterable properties **including `PROJECT_KEY` and `UPDATED`**. Therefore:

- `@odata.nextLink` is the only paging mechanism. Follow to exhaustion with a page-count backstop,
  as `jira-client.ts` does with `nextPageToken`.
- **Incremental sync is impossible.** Every sync is a full pull. At this volume that is a
  non-issue, and `sync.ts` already pulls everything.
- No server-side `$filter`, so all scoping happens in code — which `sync.ts` already does.

---

## 2. Feed #3 → snapshot contract mapping

### Entity sets consumed

| Entity set | Use |
|---|---|
| `Issues` | The row per issue. 119 columns. |
| `IssueTypes` | `ISSUE_TYPE_ID` → name/`IS_SUBTASK`/scope. Feeds the hierarchy registry check. |
| `IssueLinks` | Alignment and blockers (§6). |
| `Labels` | `fields.labels`, needed for the `FY\d{2}` fallback in `transform.ts`. |
| `Business_Owner_10489`, `Business_Application_Owner_11209` | Multi-user owner fields, exported as side tables keyed by `ISSUE_KEY`. |
| `Projects` | Optional cross-check of `PROJECT_KEY` → `NAME`. Not load-bearing. |

Not consumed: `Worklogs`, `Components`, `Versions`, `ProjectProperties`.

### System field mapping

| Synthesised `fields.*` | Feed #3 source | Notes |
|---|---|---|
| *(issue)* `id`, `key` | `ISSUE_ID`, `ISSUE_KEY` | |
| `summary` | `SUMMARY` | `extractScalar` accepts bare strings. |
| `description` | `DESCRIPTION` | Plain text, not ADF. `flattenToText` already handles strings. |
| `issuetype` | `{ id: ISSUE_TYPE_ID, name: ISSUE_TYPE_NAME, hierarchyLevel }` | `hierarchyLevel` from the registry (§3a). |
| `status` | `{ name: ISSUE_STATUS_NAME, statusCategory: { key } }` | `key` derived (§3). |
| `project` | `{ key: PROJECT_KEY }` | |
| `assignee` | `{ displayName: CURRENT_ASSIGNEE_NAME }` | 369/510 populated. |
| `updated`, `created`, `resolutiondate` | `UPDATED`, `CREATED`, `RESOLUTION_DATE` | |
| `duedate` | `DUE_DATE` | Go-live. 478/510. |
| `labels` | `Labels` rows joined on `ISSUE_KEY` | Array of strings. |
| `issuelinks` | `IssueLinks` rows grouped by `ISSUE_KEY` | §6. |
| `parent` | **unavailable** | See "known losses". |

### Custom fields: one general rule, not 18 special cases

Feed #3 names custom-field columns `<Sanitised_Label>_<fieldId>` — `Overall_Status_24266`,
`Start_date_10412`, `SPOT_Description_24265`. The numeric suffix **is** the Jira custom field ID,
confirmed by `10412`, `24265`, `24266` and `19886` all matching `config/fields.ts` exactly.

So the adapter applies a single rule:

> For every `Issues` column matching `/_(\d{4,6})$/`, set
> `fields['customfield_' + id] = <value>`.

This automatically covers all 18 per-site SPOT fields and any field added later, and it keeps
`config/fields.ts` the **only** place field IDs are declared. The adapter needs no per-site
knowledge and `SITE_SPOT_FIELDS` needs no OData-specific duplicate.

Two edge cases:

- `SPOT_Description__24271` has a doubled underscore. Matching on trailing digits is unaffected.
- **Suffix collision:** if two columns ever yield the same ID, the mapping is ambiguous. The
  adapter must detect this and treat it as **blocking**, not last-write-wins.

Owner side tables map to the same convention: `Business_Owner_10489` rows become
`fields['customfield_10489'] = [{ displayName: USER_NAME }, ...]`. `extractScalar` already walks
arrays and reads `displayName`, so `normaliseOwners` works unchanged. `customfield_11209` should be
added to `OWNER_FIELD_CANDIDATES` to pick up the second table.

### Known losses, and what each costs

| Lost | Cost | Handling |
|---|---|---|
| `parent` → `childCount` | One optional sentence in `summarise.ts` (`progressClause`). | `childCount` stays `{0,0}`. Materially cheaper now that 59% of items carry a real narrative. Request `PARENT_ISSUE_*` from the feed owner (it exists in Feed #2). |
| `customfield_10387` (`Flagged` canary) | The canary becomes **vacuous** — it reports 0 because the column is absent, not because the field is empty. | Must be stated in `verify-snapshot`, otherwise it silently changes from evidence to noise. |
| `customfield_11199` (Initiative RAG) | Initiative status has no authored source. | Roll up from linked items via `rollUpRisk` (already supported), `provenance: 'inferred'`. Per prior decision. |
| Real `statusCategory` | See §3. | Derived from phase. |
| ADF fidelity on `description` | None — `flattenToText` wanted plain text anyway. | — |

---

## 3. Status name → status category strategy

### The problem

Feed #3 has **no `IssueStatuses` entity set**, so no `statusCategory`. `normaliseStatus` uses the
category two ways: as the fallback phase when a name is unmapped (`normalise.ts:114`), and as the
`ItemStatus.category` written to the snapshot. And `risk.ts:120` checks `status.category === 'done'`
as a secondary terminal test.

### Decision: derive category from phase, and make an unmapped name fatal

**Category becomes a derived attribute, not an independent input.** Add to `config/status-map.ts`:

```ts
export const PHASE_TO_CATEGORY: Readonly<Record<CanonicalPhase, StatusCategory>> = {
  demand: 'todo', initiate: 'todo', plan: 'todo',
  execute: 'in-progress', closeout: 'in-progress', hold: 'in-progress',
  complete: 'done', cancelled: 'done',
};
```

This is safe because of the order in `risk.ts`: `phase === 'cancelled'` is tested **before**
`category === 'done'`. Deriving the category from the phase therefore preserves the "abandoned work
must not report as delivered" rule exactly — and is arguably more consistent than Jira, where
`Will not do` genuinely carries `statusCategory: done`.

The category fallback for unmapped names **disappears**, and that is the important consequence:

> Under OData, an unmapped status name has no safe default. `STATUS_CATEGORY_TO_PHASE`'s
> `?? 'execute'` would quietly file an unknown status as in-flight work. **An unmapped status name
> is therefore a blocking condition under OData, not a warning.** The adapter collects them and
> `sync.ts` aborts before writing.

That is a deliberate asymmetry with the REST path, which keeps its warn-and-fall-back behaviour
because it has a real category to fall back to.

Rejected alternatives: joining Feed #1/#2's `IssueStatuses` (reintroduces the multi-feed dependency
this migration exists to remove, and their coverage of Feed #3's statuses is unverified); waiting
for the feed owner to add the entity set (request it in parallel, but do not block on it).

### The 17 in-scope names

Ten already map. Seven need adding, with proposed phases:

| Name | Proposed phase | Rationale |
|---|---|---|
| `Open` | `demand` | Intake, consistent with `To Do`/`Backlog`. |
| `Assessment` | `initiate` | Evaluation precedes planning. |
| `Define` | `plan` | Scoping/definition. |
| `In Review` | `execute` | Work in flight under review, not wind-down. |
| `Discarded` | `cancelled` | Abandoned. Must not count as delivered. |
| `Hold` | `hold` | See below. |
| `ON HOLD` | `hold` | Matching is already lowercased, so one entry covers both. |

### `Hold` / `ON HOLD` needs a new phase, and this is the one real schema change

There is no honest existing target:

- `execute` reports held work as progressing. A recently-touched held item with a future go-live
  would render **on-track** — precisely the false reassurance this application exists to prevent.
- `plan` misstates the lifecycle position and still reads as healthy.
- Leaving it unmapped makes every held item abort the sync.

**Recommendation:** add `hold` to `CANONICAL_PHASES`, add `on-hold` to `REASON_CODES`, and in
`deriveSignals` treat `phase === 'hold'` as at least `monitor` carrying an `on-hold` reason.

Cost: two config enum additions (both flow into `canonicalPhaseSchema` / `reasonCodeSchema`, which
are `z.enum` over the config arrays, so the schemas update themselves), one branch in `risk.ts`, one
label in `PHASE_LABELS` and `REASON_LABELS`. Adding an enum member does not invalidate existing
snapshots.

**Open sizing question:** how many items are actually on hold is not yet known — the distinct-name
list was measured, the per-name counts were not. Confirm from the REST snapshot during Phase A
(not OData discovery; it is a count over data we already sync). If it is a handful of items the
recommendation stands anyway, because the failure mode is silent misreporting rather than volume.

### 3a. Hierarchy level: the issue-type-ID registry

No feed exposes `issuetype.hierarchyLevel`; `transform.ts:71` requires it, and an issue whose level
is `undefined` is **silently dropped** by `classifyIssues`. That is the worst available failure mode
and it must be made loud.

```ts
// config/hierarchy.ts
export const ISSUE_TYPE_LEVELS: Readonly<Record<string, number>> = {
  // Captured from Jira REST /rest/api/3/issuetype on <date>. Regenerate with
  // `npm run capture-issue-types`. IDs are stable; names are not.
  '10000': 1,  // Epic
  ...
};
```

- Seeded **once** from Jira REST, which does return `hierarchyLevel`. A small capture script keeps
  it reproducible; REST is retained for exactly this purpose after the migration.
- The adapter resolves `ISSUE_TYPE_ID` → level. **An unknown ID is blocking**, listed with its
  `ISSUE_TYPE_NAME`, `SCOPE_TYPE` and `SCOPE_ID` so a project-local type is immediately
  identifiable.
- This is **strictly safer than the status quo.** Today an unrecognised project-local level-1 type
  causes silent partial loss on a site that still has Epics — the per-site zero canary misses it
  because the count is non-zero. An unknown ID fails loudly.
- Selection stays on hierarchy level. `IssueLinks` cannot substitute (§6).

---

## 4. SPOT wiki-markup parsing strategy

### Observed format

Feed #3 returns Jira wiki markup, not ADF:

```
|Project Phase|Execute|
|Project State|Active|
|Project URL|[Project URL|https://tospot.azurewebsites.net/project-hub/8260bc2f-...]|
|Overall Status Description|27/07/2026:
-confirming next waves
\\
21/05/2026:
The Automation folder was migrated to SharePoint|
|Recent Accomplishments|Pilot migration wave is complete
meeting with Automation to discuss folders|
|Next Priorities|MAN Ops P1, Engineering folder would be next|
```

`parseSpotDescription` returns `undefined` for anything that isn't an object, so today these values
are silently ignored — which is why the coalescing loop added in `transform.ts` is currently inert
under OData and harmless under REST.

### Design: a sibling parser behind the same dispatcher

Three properties matter more than elegance here: **the same `SpotNarrative` output**, **one shared
row-label vocabulary**, and **never throwing**.

1. `src/lib/spot-wiki.ts` exports `parseSpotWikiTable(raw: string): SpotNarrative | undefined`.
2. `src/lib/adf.ts` exports the vocabulary it currently keeps private — `LABEL_TO_FIELD`,
   `labelKey`, and the placeholder regex `/^(n\/?a|none|tbd|-)$/i` — so both parsers match rows
   identically. A label added for one path must apply to both; duplicating the map guarantees
   eventual drift.
3. `parseSpotDescription` becomes the dispatcher: `typeof raw === 'string'` → delegate to
   `parseSpotWikiTable`; object → existing ADF path. **`transform.ts` does not change**, and the
   eight existing `adf.test.ts` tests keep passing unmodified.

### Parsing rules

- **Row extraction:** `/^\|([^|\n]+)\|([\s\S]*?)\|[ \t]*$/gm`. Values legitimately span lines, so
  line-based splitting is wrong. The lazy match anchored on a `|` at end-of-line also survives
  values containing internal pipes — which the `Project URL` row does
  (`[Project URL|https://...]`). Documented limitation: a value whose internal line happens to end
  in `|` would split early. Acceptable, and it degrades to a truncated narrative rather than a
  crash.
- **`\\` on its own line** is Jira wiki's forced break → newline. The date-separated entries in
  `Overall Status Description` depend on this; collapsing them would run distinct site updates
  together.
- **Links:** `[text|url]` → `url` for `sourceUrl`; for text fields render the `text` part only.
  Bare URLs pass through.
- **Whitespace:** trim, collapse 3+ newlines to 2 — mirroring `extractText` in `adf.ts` so both
  paths produce byte-identical strings for equivalent content.
- **Placeholders** rejected via the shared regex, so an empty SPOT row does not masquerade as
  content.
- **Unmapped labels** collected into `unmappedLabels`, surfacing as the existing warning.
- **Never throws.** No rows matched → `undefined` → "no narrative". A SPOT format change must
  degrade one field, not abort a sync of 1371 rows.

### Verification

`tests/spot-wiki.test.ts` with fixtures transcribed from real feed values, including: the
multi-line date-separated description above, the pipe-containing URL row, a `\\`-separated body, a
placeholder-only row, and a malformed body. Plus an **equivalence test**: the ADF and wiki fixtures
for the same underlying item must produce equal `SpotNarrative` objects. The Phase C snapshot diff
then checks this across the whole portfolio rather than per fixture.

---

## 5. Local-initiative handling: DDTYAR and future unlinked sites

### The rule

> An item is `alignment: 'local'` **iff** it has no `Polaris work item link` whose counterpart is
> in a configured portfolio project. This is a delivery model, not a data defect.

Corollaries, which are the parts that were previously implicit:

1. **A site with zero aligned items is valid.** `DDTYAR` is 17 of 17 local, confirmed across two
   feeds. It must never be reported as a link-matching regression, an empty site, or missing data.
2. **Local items are full portfolio members.** They keep their site, region, risk, narrative and
   dates, and they count in every site/regional/risk total. Only the initiative lane differs.
3. **The rule is data-driven and needs no configuration.** A future unlinked site requires no code
   or config change; it is classified by the same predicate. There is no allowlist to maintain, and
   deliberately so — an allowlist would need editing every time a site changed delivery model, and
   would fail closed in the wrong direction.
4. **Zero-alignment sites must be named, not merely counted.** Implemented: `verify-snapshot` prints
   the per-site aligned/local split and raises a WARN naming fully-local sites, explicitly labelled
   as expected. The WARN exists so a *regression* is still visible — if `DDTVAS` (currently 15/15
   aligned) ever appeared in that list, something broke.
5. **Alignment must reconcile.** `aligned + local === activeItems` is a FAIL. Implemented.

Measured distribution: 261 of 510 items (51%) are site-local — the largest single lane. Both
extremes are real: `DDTYAR` 100% local, `DDTVAS` 0% local.

### Lane structure: do not change it during the migration

Today all 261 local items share one synthetic lane (`__unaligned__`, labelled "Site-local
initiatives"), with per-site detail carried in its `siteRollup`. A 261-item shared lane is poor
executive UX, and per-site lanes (`__local__:<SITEKEY>`, "«Site» — site-led") would read far better
— `DDTYAR` in particular currently has no coherent representation of its own work.

**Recommendation: keep the single lane for the migration and treat per-site lanes as a separate,
independent change.**

The reason is not effort, it is diffability: Phase C validates the migration by diffing the REST and
OData snapshots. Changing lane structure in the same step changes the snapshot for a second,
unrelated reason and destroys the signal that proves the source swap was faithful. **Do not change
semantics and source in the same step.** Per-site lanes can ship before Phase B or after Phase D;
they must not ship *during*.

That change would also require a `sync.ts` edit (line 209 pushes exactly one lane) and a
`verify-snapshot` update, since `UNALIGNED_INITIATIVE_KEY` is currently a single literal.

---

## 6. How IssueLinks establish initiative alignment

### Row shape and semantics

`IssueLinks`: `ISSUE_ID`, `ISSUE_KEY`, `ISSUE_CREATED`, `TYPE`, `DIRECTION`, `LINKED_ISSUE_ID`,
`LINKED_ISSUE_KEY`.

**One row per ordered pair.** A link is exported once from each endpoint that is in the export's
scope, so an in-scope↔in-scope link yields two rows and an in-scope↔out-of-scope link yields one.
This is why Feed #3 shows 509 GMPORT-touching Polaris rows for ~255 distinct links, and why link
coverage must always be counted per ordered pair. Grouping by `ISSUE_KEY` — which is what the
adapter does — makes the duplication irrelevant: each issue sees only its own rows.

### Assembly

Group by `ISSUE_KEY`; for each row emit one `issuelinks` entry shaped as
`findInitiativeKey` and `findBlockers` expect:

```ts
{ type: { name: TYPE, inward?, outward? },
  inwardIssue?:  { key, fields: { summary, status } },
  outwardIssue?: { key, fields: { summary, status } } }
```

Counterpart `summary` and `status` come from joining `LINKED_ISSUE_ID` back into `Issues` — which is
why the adapter must not pre-filter rows. A counterpart outside the export has no row: emit the key
alone.

### Alignment is direction-independent, so it is safe

`findInitiativeKey` inspects both endpoint slots and accepts the first whose project key is in
`PORTFOLIO_KEYS`. Matching is **undirected** by design, re-confirmed against Feed #3 (`Outward` 254
/ `Inward` 255 on GMPORT-touching links — honouring direction would drop about half).

Therefore the adapter may place the counterpart in **either** slot for alignment purposes without
affecting the result, and:

- `type.name = TYPE` alone is sufficient — `findInitiativeKey` matches
  `type.name === 'Polaris work item link'` as well as `type.id === '10319'`, and the feed carries
  only the name.
- Alignment requires **no** new configuration. `INITIATIVE_LINK_TYPE_NAME` already matches the
  feed's `TYPE` string verbatim.

Expected result after migration: 249 of 510 items aligned across 17 sites, 26 distinct Initiatives
referenced. These are the numbers the Phase C diff checks against.

### Blockers DO depend on direction — and it is unresolved

`findBlockers` keys on `link.type.inward` containing `is blocked by`/`blocks`, and treats the
presence of `inwardIssue` as "**this** issue is blocked by that one". Feed #3 gives
`TYPE: 'Blocks'` plus `DIRECTION: Inward|Outward`, with no inward/outward description strings, so
the adapter must synthesise them.

**Which `DIRECTION` value means "this issue is the blocked one" is not established, and must not be
guessed** — inverting it would silently reverse every blocker attribution, making blocking items
look blocked and vice versa. Resolution before implementing: take one `Blocks` pair from the feed
and compare against the same link in Jira REST or the Jira UI. One observation settles it; a
regression test then pins it.

Sizing: 28 `Blocks` rows in Feed #3, so this affects few items — but blockers feed
`dependency-risk`, and a wrong direction produces confidently wrong executive output. `blocker.open`
derives from the counterpart's status category (§3); an unknown counterpart is treated as **open**,
which is the conservative direction.

Non-Polaris, non-blocking types (`Cloners` 61, `Relates` 18, `Dependency` 16, `Cause` 4,
`Duplicate` 2) are carried through and ignored by both matchers, as under REST.

---

## 7. Files that change

### New

| File | Purpose |
|---|---|
| `src/lib/odata-client.ts` | HTTP, auth, `@odata.nextLink` paging, retry. Read-only by construction. |
| `src/lib/odata-adapter.ts` | Entity-set joins → `JiraIssue[]` + diagnostics. |
| `src/lib/spot-wiki.ts` | Wiki-markup SPOT parser. |
| `src/lib/source.ts` | `SourceAdapter` / `FetchResult` interfaces + selection. |
| `config/odata.ts` | Feed identity, entity-set names, column conventions. |
| `scripts/capture-issue-types.ts` | One-off REST capture of `ISSUE_TYPE_ID → hierarchyLevel`. |
| `scripts/diff-snapshots.ts` | The Phase C parity gate. |
| `tests/odata-adapter.test.ts`, `tests/spot-wiki.test.ts`, `tests/fixtures/odata-rows.ts` | Coverage, with fixtures transcribed from real feed rows. |

### Changed

| File | Change | Size |
|---|---|---|
| `scripts/sync.ts` | Step 1 only: adapter selection, record `meta`, abort on `blocking[]`. REST stays default. | ~15 lines |
| `config/status-map.ts` | Add the 7 names; add `PHASE_TO_CATEGORY`; add `hold` to `CANONICAL_PHASES`. | small |
| `config/narrative.ts` | Add `on-hold` to `REASON_CODES` + label. | small |
| `config/hierarchy.ts` | Add `ISSUE_TYPE_LEVELS` registry + unknown-ID contract. | small |
| `config/fields.ts` | Add `customfield_11209` to `OWNER_FIELD_CANDIDATES`. | 1 line |
| `src/lib/adf.ts` | Export `LABEL_TO_FIELD`, `labelKey`, placeholder regex; add string-dispatch branch. | small |
| `src/lib/risk.ts` | Handle `phase === 'hold'` as ≥`monitor` with an `on-hold` reason. | small |
| `src/types/domain.ts` | Optional `source` block on the snapshot (freshness provenance). Phase enum updates itself from config. | small |
| `scripts/verify-snapshot.ts` | Source-aware canaries: unmapped status FAILs under OData; `Flagged` canary declared vacuous; freshness reported from `meta.newestUpdated`. | moderate |
| `.env.example` | `ODATA_*` variables, `ROADMAP_SOURCE`. | small |
| `reference/adr-001-data-source.md` | Link to this design. | small |

### Deliberately unchanged — the payoff of the Phase 1 design

`src/lib/transform.ts`, `normalise.ts`, `rollup.ts`, `summarise.ts`, `summary-parse.ts`,
`fiscal-year.ts`; the `data/snapshot.json` contract; all 147 existing tests; and
`src/lib/jira-client.ts`, which stays intact as the reference implementation and the issue-type
oracle.

---

## 8. Migration plan

Phases A–C change no default behaviour. Nothing past Phase A needs governance sign-off to *build*,
but Phase D must not ship without it.

### Phase A — parsers, maps and registry (no source switch)

Ships against the REST pipeline, fully verifiable today.

1. `spot-wiki.ts` + shared vocabulary extraction from `adf.ts` + dispatcher.
2. `config/status-map.ts`: 7 names, `PHASE_TO_CATEGORY`, `hold` phase; `risk.ts` hold handling.
3. `ISSUE_TYPE_LEVELS` registry + `capture-issue-types.ts`.
4. **Confirm the `hold` item count** from the REST snapshot.

**Exit:** 147 + new tests green, typecheck clean, `verify-snapshot` no worse than today. No
observable change to a REST snapshot except `hold` reclassification.

### Phase B — client and adapter behind a flag

5. `odata-client.ts`, `odata-adapter.ts`, `source.ts`; `sync.ts` seam.
6. `ROADMAP_SOURCE=jira-rest` remains the **default**.
7. **Resolve the `Blocks` direction semantics** (§6) before the adapter is considered complete.

**Exit:** `ROADMAP_SOURCE=odata npm run sync` produces a snapshot that passes `snapshotSchema` and
`verify-snapshot`, with zero blocking diagnostics.

### Phase C — parity gate

8. `diff-snapshots.ts` compares REST and OData snapshots per item and per initiative.
9. Divergence is classified, not merely counted:
   - **Expected:** `childCount` (always `{0,0}`), `Flagged` canary, `statusCategory` provenance,
     freshness/`updatedAt` skew, narrative whitespace from the two parser paths.
   - **Everything else must be zero.** Any unexplained divergence blocks the phase.
10. Cross-checks against measured values: 19/19 sites non-zero; 510 level-1 items; 249 aligned /
    261 local; 424 authored RAG; 299 narratives; 36 initiatives.

**Exit:** clean diff on a full cycle, plus re-measured baselines promoted from `INHERITED` in
`config/projects.ts`.

### Phase D — flip the default *(governance sign-off required)*

11. `ROADMAP_SOURCE` defaults to `odata`. REST path retained and runnable.
12. Run both for one full cycle, diffing daily.

### Phase E — retire the REST fetch

13. Remove the REST fetch path; **keep** `jira-client.ts` and `capture-issue-types.ts` for the
    issue-type oracle.

### Risks

| Risk | Mitigation |
|---|---|
| Unknown issue-type ID silently drops items | Blocking diagnostic, not a warning. The specific reason the registry exists. |
| `Blocks` direction inverted | Resolve empirically in Phase B; pin with a test. |
| Unmapped status has no safe default | Blocking under OData; 17 names enumerated in Phase A. |
| Feed reconfigured without notice (no E6 owner) | Per-site zero canary; per-site SPOT-field canary; entity-set presence check in the client. |
| Custom-field suffix collision | Blocking diagnostic. |
| Narrative parity between ADF and wiki paths | Fixture equivalence test plus the Phase C portfolio-wide diff. |
| Feed lag (same-day, not live) | `meta.newestUpdated` recorded in the snapshot and stated in the UI. |

### Open decisions for review

1. **`hold` as a canonical phase** — recommended; the alternative misreports held work as
   on-track. Needs sign-off because it touches the phase enum and the UI vocabulary.
2. **Per-site local lanes** — recommended, but as a separate change either side of the migration,
   never during it.
3. **Phase mapping for `Assessment`, `Define`, `In Review`** — proposed above; these are judgement
   calls about a site's lifecycle vocabulary and are cheap to change later.
4. **Feed-owner asks** — `IssueStatuses` and `PARENT_ISSUE_*` would each retire a workaround here;
   both demonstrably exist in other feeds. Worth requesting in parallel, not worth blocking on.
