# DDT Roadmap

Executive decision-support view of Digital Data & Technology initiatives across Takeda's global manufacturing sites.

**Status: Phase 1 (data pipeline) complete. No UI yet — by design.** The approved plan gates UI work behind the pipeline reproducing the discovery metrics. See [The gate](#the-gate).

---

## What this is

A consolidated roadmap that lets leadership answer, in 30 seconds: what is on track, what is at risk, **why**, and what needs attention. It reads Jira; it never writes to it.

It replaces a four-page Power BI report (screenshots in the repo root) that shows a filtered Gantt with no aggregate numbers and no explanation of why anything is amber or red.

## Quick start

```bash
npm install
cp .env.example .env.local     # then add your API token
npm run sync                   # Jira -> data/snapshot.json
npm run verify-snapshot        # the Phase 1 gate
npm test                       # 147 tests, no credentials needed
```

### Credentials

`npm run sync` needs an Atlassian API token — create one at
[id.atlassian.com/manage-profile/security/api-tokens](https://id.atlassian.com/manage-profile/security/api-tokens).
Read access to the DDT projects is sufficient. Put it in `.env.local`:

```
JIRA_BASE_URL=https://onetakeda.atlassian.net
JIRA_EMAIL=you@takeda.com
JIRA_API_TOKEN=...
```

`.env.local` is gitignored. The token is only ever used server-side by the sync script; nothing reaches a browser.

Set `SNAPSHOT_AS_OF=YYYY-MM-DD` to pin the date risk is evaluated against, for reproducible runs.

## Architecture

```
Jira REST v3  ──>  scripts/sync.ts  ──>  data/snapshot.json  ──>  (future UI)
                         │
                         └─ src/lib/*  pure, tested transformation
```

The app never queries Jira at request time. A scheduled sync writes a validated snapshot; everything downstream reads that. This keeps page loads fast, works offline for demos, keeps credentials out of the browser, and makes the data layer a single seam to swap for a database later.

Snapshots are written atomically (temp file + rename), so a failed sync never truncates a good snapshot. A stale-but-valid roadmap beats an empty one.

### Layout

| Path | Purpose |
|---|---|
| `config/` | Every decision that could change: projects, regions, field IDs, fiscal year, status map, taxonomy, wording |
| `src/types/domain.ts` | Domain model + Zod schemas (the sync/read contract) |
| `src/lib/` | Pure transformation logic — no I/O |
| `scripts/sync.ts` | Fetch, transform, validate, write |
| `scripts/verify-snapshot.ts` | The gate: baseline comparison + canaries |
| `tests/` | 147 tests, including fixtures transcribed from real Jira payloads |
| `data/` | Generated snapshot (gitignored) |

## Three things that are easy to get wrong

Read this before changing the pipeline.

### 1. Roadmap items are selected by hierarchy level, never by type name

`DDTJG` (Jaguariuna) contains **zero issues of type `Epic`**. It uses a project-local level-1 type called `Digital Project`. Any query filtering on `issuetype = Epic` returns nothing for that site **and reports no error** — the site simply renders as having no work.

Selection is therefore on `issuetype.hierarchyLevel === 1`. JQL cannot filter on hierarchy level, so the sync fetches all issues in scope and filters in code. An unrecognised level-1 type name is still ingested, and raises a warning. `verify-snapshot` **fails** if any configured site returns zero items.

See `config/hierarchy.ts`.

### 2. Initiative links are undirected

Site items connect to portfolio Initiatives through an issue link of type `Polaris work item link` (id `10319`), not a parent/child relationship. The direction is **not consistently curated**: for `DDTGMPORT-27`, most site items appear as `inwardIssue` but `DDTHIK-38` appears as `outwardIssue`. Matching honours either direction, and requires the counterpart to be in a configured portfolio project — items also link to each other and to out-of-scope projects.

### 3. A terminal Jira status beats an authored RAG

`DDTLESS-96` has Jira status `Done` while its `Health` field still reads "Green" — the site closed the work and never updated the RAG. If the RAG won, completed projects would stay in the active portfolio and on the "On Track" count forever. Terminal workflow state is checked first; the authored value is retained for context.

Similarly, `Will not do` carries `statusCategory: done` in Jira, so cancellation is checked *before* completion — otherwise abandoned work reports as delivered.

## Data model notes

**Fiscal year** — April start, labelled by start year, Q1 = Apr–Jun. `FY26` = 1 Apr 2026 → 31 Mar 2027. This is *verified*, not assumed: the reference report's axis begins `4/1/2023` under a column labelled `2023 / Q1`. Configurable in `config/fiscal-year.ts`; nothing else hardcodes it.

**Go-live** is the item due date, per the report's own note: *"Milestones are tied to local go-live dates."* There is no dedicated go-live field anywhere in the schema.

**Risk** resolves in order: SPOT `Overall Status` → other authored RAG → derived from schedule, status, dependencies and staleness. Provenance is recorded on every item and always shown, so nobody mistakes an inferred status for a reported one. Thresholds are in `config/narrative.ts`.

`resource-constraint` and `scope-risk` exist in the vocabulary but are **never inferred** — no field in the DDT schema evidences either. They are reachable only from an authored status.

**Executive summaries** resolve in order: SPOT status description → Jira description → generated. Generation is deterministic template composition, **not an LLM call**: it must be reproducible per snapshot, auditable (every generated summary carries a `summaryBasis` listing the facts used), free, offline, and incapable of inventing a cause.

**SPOT IDs** — the dedicated field is populated on ~8 items, but IDs appear in summary strings across much of the portfolio (`TO MES Elaprase DS - SPOT 1024096`). `src/lib/summary-parse.ts` recovers them, along with FY tags and function codes, and produces a clean title. The parse is best-effort; the raw summary is always retained.

## The gate

`npm run verify-snapshot` compares the snapshot to the discovery baseline in `config/projects.ts` (measured 2026-08-05) and runs canaries. It exits non-zero on any failure.

Checks include: schema validity, project/initiative/item counts, **no site with zero items**, DDTJG returning items via `Digital Project`, timeline coverage, status provenance distribution, risk distribution, executive-summary source distribution, SPOT ID recovery rate, regional totals with no `Unassigned`, initiative linkage (cross-checked against Project Phoenix resolving ~16 items across ~11 sites), and config hygiene including duplicate site codes.

Warnings are expected findings — data-quality gaps and open questions — not defects. Only failures block.

## Common changes

**Add a site** — add an entry to `SITES` in `config/projects.ts` (key, display name, 3-letter code, expected item count) and make sure the display name resolves in `config/regions.ts`.

**Change the fiscal year** — edit `config/fiscal-year.ts`. Set `labelFrom: 'end'` if FY should be named for its ending year.

**Map a new status** — add the lowercased name to `STATUS_NAME_TO_PHASE` in `config/status-map.ts`. Unmapped names fall back to `statusCategory` and appear in `warnings[]`.

**Change executive wording** — `config/narrative.ts` owns every leadership-facing string. Nothing is phrased in components.

**Adjust risk thresholds** — `RISK_THRESHOLDS` in `config/narrative.ts`.

## Enterprise readiness

Out of MVP scope, but nothing here precludes it:

| Concern | Path |
|---|---|
| SSO | All data access is server-side behind `src/lib/snapshot.ts`; no client secrets. Additive. |
| Row-level authorisation | Region and site are first-class on every item, so scoping is a loader filter, not a schema change. |
| Hosting | Stateless, no request-time filesystem writes. |
| Scale | The snapshot loader is the seam for a database; rollups are pure functions over arrays. |
| Multiple portfolios | `config/projects.ts` holds a `portfolios[]` array. `DDT Bio Portfolio` was investigated and no longer exists, but a future one is a single config entry. |

## Known gaps

- **Only ~11% of items carry a site-authored status; ~1% carry a narrative.** This is the central finding, not a bug. The app derives a signal for the rest and labels provenance, and the coverage numbers are surfaced rather than hidden.
- **No milestone issue type, no `fixVersions`, no go-live field.** Go-live is the due date.
- **`Flagged` (customfield_10387) is populated on zero items**, so blockers can only come from issue links. `verify-snapshot` reports if that changes.
- **`customfield_11199` holds portfolio RAG but its name renders as "Asset ID".** Accepted by decision; worth raising with Jira admins, since the field silently becoming an actual asset ID would produce garbage.
- **`SGP` = Singapore, `SNG` = Singen.** Codes are display-only; the model keys on Jira project key.
- Nine of 22 site codes are proposed rather than observed in the reference report.
- Regions for LA, Covington, Jaguariuna and Lessines are provisional — they are not named in the authoritative region map.
