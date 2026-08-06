# ADR-001: Data source — enterprise OData feed vs. direct Jira REST

- **Status:** Proposed. OData is the recommended strategic target, conditional on E1–E3.
- **Date:** 2026-08-06
- **Supersedes:** the implicit Phase 0 decision to integrate Jira REST directly.

## Context

Phase 1 shipped a working Jira REST v3 pipeline (`scripts/sync.ts` → `data/snapshot.json`,
147 tests, gated by `scripts/verify-snapshot.ts`). REST was chosen because the OData feed
behind the DDTRoadmap Power BI report was believed to be a summarised report export missing
fields the roadmap depends on.

**That premise was wrong.** The feed is not a report export. It exposes the underlying Jira
dataset, and the roadmap-relevant fields — hierarchy, issue identifiers, descriptions,
`updated` timestamps, issue links, status, ownership, custom fields and SPOT fields — are
available through it. Field availability and fidelity are closed questions and are not
revisited here.

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

- **Security.** Eliminates a personal Atlassian API token. The deeper defect it removes: the
  snapshot's data scope is currently *one individual's Jira permissions*. If that account's
  project access changes, the roadmap's contents change with no signal and no audit trail.
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

| # | Evidence | Decides |
|---|---|---|
| E1 | Feed accepts OAuth client credentials / a service principal | Whether a scheduled job can authenticate at all |
| E2 | `$metadata` retrieved by a non-Power-BI client | Auth **and** reachability in one call |
| E3 | All 19 in-scope projects return rows under the service identity | Whether RLS scopes the dataset |
| E4 | Approved-use statement names *tools* or *data scope* | Whether a separate entitlement is needed |
| E5 | RLS model and the identity it keys on | Same as E3, from the platform side |
| E6 | Named data owner / catalog registration | Support and change-notification path |
| E7 | Refresh cadence and SLA | Whether it meets the sync cadence |
| E8 | Precedent: any existing non-BI consumer | Collapses E1/E4 into a known-good pattern |

E1–E3 are answered by `npm run probe-odata`. E4–E8 require the data owner and platform team.

## Consequences

**If E1–E3 pass:** migrate the ingestion layer, run both sources in parallel, diff the
snapshots, then retire Jira REST.

**If E1 or E3 fails:** raise it as a platform gap. Do **not** accept Jira REST as the permanent
architecture by default — continue on REST as a documented interim with the gap tracked as the
blocker to the target state.

**Accepted now:** a dependency on the feed owner's release cadence for new fields, and
two-hop debugging when data looks wrong. Mitigated by keeping the per-site zero canary in
`verify-snapshot`, which catches the failure mode that actually matters.

## Related scope decision

Four projects (`DDTLA`, `DDTCOV`, `DDTJG`, `DDTLESS`) were deferred from MVP scope alongside
this review, reducing scope from 23 to 19 projects and the baseline from 645 to 429 expected
active items. `DDTLESS` is the reconciliation exception: it is the only one of the four present
in the current Power BI report, so the app now shows 18 sites where the incumbent shows 19.
That difference needs a communicated rationale or Lessines returns to scope. See
`DEFERRED_SITES` in `config/projects.ts`.
