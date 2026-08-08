# DDT Roadmap

Executive decision-support view of Digital Data & Technology initiatives across Takeda's global manufacturing sites.

**Status: Phase 1 (data pipeline) complete. Phase 2 application in progress — the MVP screens
render against a committed fixture.** All seven MVP screens exist (`/`, `/roadmap`, `/regions/[r]`,
`/sites/[k]`, `/initiatives/[k]`, `/projects/[k]`, `/data`); the Initiative-Project matrix is
deferred post-MVP by design.

The two Phase 2 tracks are decoupled by the snapshot contract, so application work needs no feed
access — see [`reference/design-002-application.md`](reference/design-002-application.md) (the
executive UI) and [`reference/plan-001-mvp-build.md`](reference/plan-001-mvp-build.md) (the build
plan). **Ingestion is designed but not started** and awaits explicit go-ahead:
[`reference/design-001-odata-adapter.md`](reference/design-001-odata-adapter.md).

`npm run dev` serves the application. When no `data/snapshot.json` is present the loader falls back
to the committed fixture and every screen carries a persistent "Sample data" chip, so fixture data
can never be mistaken for a real sync.

---

## What this is

A consolidated roadmap that lets leadership answer, in 30 seconds: what is on track, what is at risk, **why**, and what needs attention. It reads Jira; it never writes to it.

It replaces a four-page Power BI report (screenshots in the repo root) that shows a filtered Gantt with no aggregate numbers and no explanation of why anything is amber or red.

## Quick start

```bash
npm install
npm run dev                    # serves the app; falls back to the committed fixture
npm test                       # 254 tests, no credentials needed

cp .env.example .env.local     # then add your API token
npm run sync                   # Jira -> data/snapshot.json
npm run verify-snapshot        # the Phase 1 gate
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
Jira REST v3 ─> scripts/sync.ts ─> data/snapshot.json ─> src/lib/snapshot.ts ─┐
                      │                    │                                  │
                      └─ src/lib/*  pure, tested transformation               ▼
                                                            src/lib/repositories/ ─> view models ─> app/
                                                              (the only data seam)   (pure,       (Server
                                                                                      tested)     Components)
```

The layering is strictly one-directional and each rule prevents a known failure: **no component
computes an aggregate** (every number is unit-testable without rendering), **no component contains
leadership-facing prose** (`config/narrative.ts` owns all wording), and **`HealthMark` is the only
component permitted to render a health colour** — red and green sit at ΔE 4.1 under deuteranopia
against a floor of 8, so health is always colour *plus* glyph *plus* label.

> **Source under review.** The enterprise OData feed that already powers the DDTRoadmap
> Power BI report exposes the same underlying Jira dataset, and is the likely strategic
> source — see [`reference/adr-001-data-source.md`](reference/adr-001-data-source.md).
> E1–E3, E5 and E7 all now pass against a third feed that carries all 19 projects with
> same-day data. **The remaining blocker is governance, not technology** (E4/E6/E8: approved
> use, named data owner, and whether the credential is a service account). Jira REST remains
> the working source and the comparison baseline. The transformation layer is source-agnostic,
> so the migration is confined to the client and the fetch step of `scripts/sync.ts`.

The app never queries Jira at request time. A scheduled sync writes a validated snapshot; everything downstream reads that. This keeps page loads fast, works offline for demos, keeps credentials out of the browser, and makes the data layer a single seam to swap for a database later.

That seam is `src/lib/repositories/`. Pages ask six read-only contracts for initiatives, items, sites, regions, coverage and source freshness; a composition root assembles the snapshot shape the view models already accept. The contracts are async so that a feed-backed implementation is a wiring change rather than a contract break — nothing above the composition root knows whether the data came from a file or a network call.

Snapshots are written atomically (temp file + rename), so a failed sync never truncates a good snapshot. A stale-but-valid roadmap beats an empty one.

### Layout

| Path | Purpose |
|---|---|
| `config/` | Every decision that could change: projects, regions, field IDs, fiscal year, status map, taxonomy, wording |
| `src/types/domain.ts` | Domain model + Zod schemas (the sync/read contract) |
| `src/lib/` | Pure transformation logic — no I/O |
| `src/lib/repositories/` | The only data-access point. Read-only async contracts for initiatives, items, sites, regions, coverage and source freshness; one wiring module chooses the implementation |
| `src/lib/snapshot.ts` | Snapshot loading behind the repositories. Validates on read; reports `live` vs `fixture` |
| `src/lib/view-models/` | Pure snapshot → page props. All counting, grouping and geometry. Fully unit-tested |
| `src/components/` | Presentational only. No aggregation, no wording of their own |
| `src/fixtures/` | The committed fixture snapshot, covering the cases that break layouts |
| `app/` | Next.js App Router pages (Server Components) |
| `scripts/sync.ts` | Fetch, transform, validate, write |
| `scripts/verify-snapshot.ts` | The gate: baseline comparison + canaries |
| `tests/` | 271 tests, including fixtures transcribed from real Jira payloads |
| `data/` | Generated snapshot (gitignored) |

## Four things that are easy to get wrong

Read this before changing the pipeline.

### 1. Roadmap items are selected by hierarchy level, never by type name

A project-local level-1 type (discovery observed `Digital Project` on a site that is now deferred) makes any query filtering on `issuetype = Epic` return nothing for that site **and report no error** — the site simply renders as having no work.

Selection is therefore on `issuetype.hierarchyLevel === 1`. JQL cannot filter on hierarchy level, so the sync fetches all issues in scope and filters in code. An unrecognised level-1 type name is still ingested, and raises a warning. `verify-snapshot` **fails** if any configured site returns zero items.

Every level-1 type in the current 19-project scope is expected to be `Epic`, so this path is covered by tests rather than by production data. The rule stays: it costs nothing and a deferred project may return. See `config/hierarchy.ts`.

### 2. Initiative links are undirected

Site items connect to portfolio Initiatives through an issue link of type `Polaris work item link` (id `10319`), not a parent/child relationship. The direction is **not consistently curated**: for `DDTGMPORT-27`, most site items appear as `inwardIssue` but `DDTHIK-38` appears as `outwardIssue`. Matching honours either direction, and requires the counterpart to be in a configured portfolio project — items also link to each other and to out-of-scope projects, including the four deferred ones.

### 3. A terminal Jira status beats an authored RAG

Discovery found items with Jira status `Done` whose `Health` field still read "Green" — the site closed the work and never updated the RAG. If the RAG won, completed projects would stay in the active portfolio and on the "On Track" count forever. Terminal workflow state is checked first; the authored value is retained for context.

Similarly, `Will not do` carries `statusCategory: done` in Jira, so cancellation is checked *before* completion — otherwise abandoned work reports as delivered.

### 4. A `Hold` status floors health at Monitor, even against an authored Green

**Approved business rule.** A project in a Hold status (`Hold`, `ON HOLD`) reports a **minimum health of Monitor**, whatever else the record says. It is the second of the two exceptions to "an authored status wins outright", and it exists for the same reason as rule 3:

- **Workflow state is the stronger, more current signal.** A RAG field may not have been revisited since the work was suspended.
- **A project explicitly moved to Hold must never present as Green.** Without the floor, a held project updated yesterday with a go-live months away derives as *On Track* — the exact false reassurance this application exists to prevent.
- **It is a floor, never a cap.** An authored Red stays Red; softening it would be the opposite failure, the app overruling a site that is escalating.
- **Provenance is untouched.** The level changes; the evidence trail does not, so the reader still sees that a site authored the status and what value they authored.

Terminality is resolved *before* the floor, so completed or cancelled work is never dragged back into the at-risk population. The rule keys on the canonical `hold` **phase**, not on status names, so any new name mapped to `hold` in `config/status-map.ts` inherits it automatically. Implemented in `src/lib/risk.ts`; the three named cases (Hold+Green, Hold+derived Green, Hold+Red) are covered in `tests/risk.test.ts`.

## Data model notes

**Fiscal year** — April start, labelled by start year, Q1 = Apr–Jun. `FY26` = 1 Apr 2026 → 31 Mar 2027. This is *verified*, not assumed: the reference report's axis begins `4/1/2023` under a column labelled `2023 / Q1`. Configurable in `config/fiscal-year.ts`; nothing else hardcodes it.

**Go-live** is the item due date, per the report's own note: *"Milestones are tied to local go-live dates."* There is no dedicated go-live field anywhere in the schema.

**Risk** resolves in order: SPOT `Overall Status` → other authored RAG → derived from schedule, status, dependencies and staleness. Two workflow-state exceptions override an authored RAG: a terminal status wins outright, and a `Hold` status floors health at Monitor — see rules 3 and 4 above. Provenance is recorded on every item and always shown, so nobody mistakes an inferred status for a reported one. Thresholds are in `config/narrative.ts`.

**The SPOT field ID varies by site.** `Overall Status`, `Overall Status Description` and `SPOT ID` are one business attribute each, but each site's SPOT integration was provisioned with its own custom field — 18 different `Overall Status` fields across 18 sites. `SITE_SPOT_FIELDS` in `config/fields.ts` maps them, and the candidate lists coalesce to a single normalised value carrying the source `fieldId` for audit. Exactly one candidate is ever populated per item. `DDTLNZ` and `DDTSNG` break the otherwise-adjacent ID numbering, so the table is transcribed from evidence, never derived — and `verify-snapshot` fails if a site's RAG starts resolving through an unexpected field.

`resource-constraint` and `scope-risk` exist in the vocabulary but are **never inferred** — no field in the DDT schema evidences either. They are reachable only from an authored status.

**Executive summaries** resolve in order: SPOT status description → Jira description → generated. Generation is deterministic template composition, **not an LLM call**: it must be reproducible per snapshot, auditable (every generated summary carries a `summaryBasis` listing the facts used), free, offline, and incapable of inventing a cause.

**SPOT IDs** — the dedicated field is populated on ~8 items, but IDs appear in summary strings across much of the portfolio (`TO MES Elaprase DS - SPOT 1024096`). `src/lib/summary-parse.ts` recovers them, along with FY tags and function codes, and produces a clean title. The parse is best-effort; the raw summary is always retained.

## The gate

`npm run verify-snapshot` compares the snapshot to the discovery baseline in `config/projects.ts` (measured 2026-08-05) and runs canaries. It exits non-zero on any failure.

Checks include: schema validity, project/initiative/item counts, **no site with zero items**, **no deferred site present**, level-1 type distribution, timeline coverage, status provenance distribution, risk distribution, executive-summary source distribution, SPOT ID recovery rate, regional totals with no `Unassigned`, initiative linkage, and config hygiene including duplicate site codes.

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
| SSO | All data access is server-side behind `src/lib/repositories/`; no client secrets. Additive. |
| Row-level authorisation | Region and site are first-class on every item, so scoping is a repository filter, not a schema change. |
| Hosting | Stateless, no request-time filesystem writes. |
| Scale | The repository layer is the seam for a database or a feed; rollups are pure functions over arrays. |
| Multiple portfolios | `config/projects.ts` holds a `portfolios[]` array. `DDT Bio Portfolio` was investigated and no longer exists, but a future one is a single config entry. |

## Known gaps

- ~~**Only ~11% of items carry a site-authored status; ~1% carry a narrative.**~~ **Corrected 2026-08-07.** This was mostly a defect in `config/fields.ts`, not a data-quality finding. Every site authors its RAG and narrative in its *own* custom field, and config knew only Singapore's pair — so `SYNC_FIELDS` never requested the other seventeen and the pipeline could not see them. A census over the OData feed measured an authored RAG on **424 of 510 in-scope items (83%)** and a narrative on **299 (59%)**, every site non-zero. `SITE_SPOT_FIELDS` in `config/fields.ts` now carries the full mapping. The app still derives a signal for the remainder and always labels provenance. **The measured coverage figures pend a re-synced snapshot** — see the baseline note below.
- **No milestone issue type, no `fixVersions`, no go-live field.** Go-live is the due date.
- **`Flagged` (customfield_10387) is populated on zero items**, so blockers can only come from issue links. `verify-snapshot` reports if that changes.
- **`customfield_11199` holds portfolio RAG but its name renders as "Asset ID".** Accepted by decision; worth raising with Jira admins, since the field silently becoming an actual asset ID would produce garbage.
- **`SGP` = Singapore, `SNG` = Singen.** Codes are display-only; the model keys on Jira project key.
- Six of 18 site codes are proposed rather than observed in the reference report.
- **Six baseline metrics still carry pre-rebaseline values.** `itemsWithBothDates`, `itemsWithAnyRag`, `itemsWithSpotNarrative`, `itemsWithSpotIdField`, `overdueActive` and `staleActive90d` are cross-cutting counts that cannot be derived by subtraction, so they were carried over unchanged and will report drift until re-measured from a 19-project sync. Drift is a `WARN`, so the gate still passes. See `INHERITED_BASELINE_KEYS` in `config/projects.ts`. Three of them — `itemsWithAnyRag`, `itemsWithSpotNarrative` and `itemsWithSpotIdField` — now **under-report by a wide margin**, because they were measured before `SITE_SPOT_FIELDS` existed. They were deliberately not overwritten with the OData census figures, which count a different basis.
- **Four sites are deferred from MVP scope** — `DDTLA`, `DDTCOV`, `DDTJG`, `DDTLESS`. See `DEFERRED_SITES` in `config/projects.ts`. Which of them appear in the current Power BI report has not been established from the report itself, so no reconciliation claim is made either way.
