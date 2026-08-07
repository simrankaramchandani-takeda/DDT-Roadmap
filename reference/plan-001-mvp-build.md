# Plan-001: MVP build plan

- **Status:** Proposed, for review. **Nothing here is implemented.**
- **Date:** 2026-08-07
- **Designs:** [`design-001-odata-adapter.md`](design-001-odata-adapter.md) (ingestion, approved,
  **not to be touched yet**) · [`design-002-application.md`](design-002-application.md) (application)
- **Scope of this plan:** the application build only. It runs entirely against the existing
  snapshot contract or a committed fixture. **No OData work, no `sync.ts` change, no credential
  change, no REST retirement.**

## Approved decisions this plan implements

Feed #3 is the strategic target; REST is a temporary reference baseline only; adapter outputs
`JiraIssue[]`; generic custom-field suffix mapping; local initiatives are valid, not errors; DDTYAR
retained as site-led; a dedicated `hold` phase for `Hold`/`ON HOLD`; `Assessment` → `initiate`;
`Define` → `plan`; `In Review` → `execute`; single shared local lane during migration; per-site
local lanes deferred; Initiative-Project matrix deferred past MVP.

Two of these land in this plan (the `hold` phase and the status-name mappings, because they are
config-only and change what the UI must render). The rest are ingestion-side and wait.

---

## 0. The premise, verified

Track B depends on one assumption: **a hand-authored fixture can satisfy `snapshotSchema` without
schema changes.** I verified this rather than assuming it — constructing a two-item snapshot
including the awkward cases and parsing it:

```
PASS — hand-authored fixture satisfies snapshotSchema
  items: 2 · initiatives: 2
  local item alignment: local · initiativeKey: undefined
```

The fixture covered an item with an authored SPOT RAG and reasons, the **DDTYAR 100%-site-led case**
(`alignment: 'local'`, no `initiativeKey`, `provenance: 'none'`, `regionProvisional: true`), a real
initiative with a derived span, and the `__unaligned__` synthetic lane with `hasDates: false`.

**So the UI build is unblocked today.** It needs no feed, no credential, and no governance
sign-off.

---

## 1. Work packages

Strictly ordered. WP0–WP2 are the foundation and carry almost all the risk; WP3 onward is
comparatively mechanical.

| WP | Deliverable | Blocks | Size |
|---|---|---|---|
| WP0 | Build tooling and repo prep | everything | S |
| WP1 | Snapshot loader + committed fixture | WP2+ | S |
| WP2 | View-model layer (pure, tested) | all screens | **L** |
| WP3 | Design tokens + app shell + filter bar | all screens | M |
| WP4 | Shared primitives (`HealthMark` et al.) | all screens | M |
| WP5 | Timeline engine | screens 2, 3, 5, 6 | **L** |
| WP6 | Screen 1 — Portfolio Overview | — | M |
| WP7 | Screen 2 — Global Roadmap | WP5 | M |
| WP8 | Screen 3 — Site view | WP5 | M |
| WP9 | Screen 4 — Project drill-down | WP4 | S |
| WP10 | Screen 5 — Region view | WP5, WP8 | S |
| WP11 | Screen 6 — Initiative drill-down | WP5, WP9 | S |
| WP12 | Screen 8 — Data & coverage | WP4 | S |
| WP13 | Config: `hold` phase + 7 status names | WP6+ (legend/grouping) | S |

Indicative sizing only: S ≈ ≤1 day, M ≈ 2–3 days, L ≈ 4–6 days. WP2 and WP5 are where estimates
will move.

---

## WP0 — Build tooling and repo prep

Add React + Next.js and make the new directories visible to the existing quality gates.

**Dependencies:** `next`, `react`, `react-dom`, `@types/react`, `@types/react-dom`. Node ≥22 is
already declared. No charting library, no CSS framework — per design-002.

**`tsconfig.json` — three changes, one of which is a trap:**

```jsonc
"lib": ["ES2023", "DOM", "DOM.Iterable"],   // was ["ES2023"]
"jsx": "preserve",
"include": ["src/**/*.ts", "src/**/*.tsx", "config/**/*.ts", "scripts/**/*.ts",
            "tests/**/*.ts", "app/**/*.tsx", "app/**/*.ts",
            "components/**/*.tsx", "vitest.config.ts"]
```

> **The trap:** `include` is an explicit allowlist. Adding `app/` and `components/` without
> extending it means `npm run typecheck` silently ignores every new file — the gate would report
> clean over untypechecked code. Extend `include` in the same commit that creates the directories.

Existing settings that shape the code and should not be relaxed:
`noUncheckedIndexedAccess: true` (array access needs guards — affects view-model style),
`verbatimModuleSyntax: true` (React type imports must be `import type`), `strict: true`.

**`.gitignore`:** add `.next/`.

**`package.json` scripts:** add `dev`, `build`, `start`. Keep `sync`, `verify-snapshot`,
`probe-odata`, `test`, `typecheck` untouched.

**Testing strategy:** vitest stays `environment: 'node'`. The view-model layer carries the test
weight because it is pure; no jsdom and no component-render tests in the MVP. Screen-level
verification is manual against the fixture until there is a reason to add Playwright. This keeps
the suite fast and avoids testing React instead of testing the logic.

**Acceptance:** `npm run typecheck` and `npm test` pass; `npm run dev` serves a page; a deliberate
type error inside `app/` **fails** typecheck (proves the `include` fix).

---

## WP1 — Snapshot loader and committed fixture

**`src/lib/snapshot.ts`** — the single data-access seam named in the README.

```ts
export type SnapshotSource = 'live' | 'fixture';
export interface LoadedSnapshot { snapshot: Snapshot; source: SnapshotSource }
export function loadSnapshot(): LoadedSnapshot   // cached per process
```

Behaviour:
1. Read `data/snapshot.json` if present; **validate with `snapshotSchema`** and return
   `source: 'live'`. A snapshot that does not parse is never served — it throws with the Zod
   issues, matching how `sync.ts` refuses to write one.
2. Otherwise fall back to the committed fixture and return `source: 'fixture'`.
3. Cache per process. No request-time filesystem writes.

> **`source` is not a convenience — it is a safety requirement.** A demo running on fixture data
> must never be mistakable for real data. `SiteHeader` renders a persistent "Sample data" chip
> whenever `source === 'fixture'`, alongside the freshness chip. This is the same honesty principle
> the snapshot applies to provenance.

**`tests/fixtures/snapshot.fixture.ts`** — committed, deterministic, hand-authored. Must cover the
cases that break layouts, each chosen because it *will* break something:

| Case | What it breaks |
|---|---|
| Site with 100% site-led work (DDTYAR, 17 items) | "no programmes found" empty state |
| Initiative with `hasDates: false` | timeline lane with no bar |
| Item with go-live but no start | milestone-only rendering |
| 7-year span and a 1-day span in one view | scale clamping, minimum bar width |
| `unreported` and `cancelled` items | grey-on-grey; cancelled must not read as delivered |
| Item with 5 owners and a 180-char summary | label truncation, row height |
| Three milestones in one quarter at one site | stacked-marker count badge |
| Initiative with `datesDerived: true` | open-ended span treatment |
| `regionProvisional: true` site | provisional-region disclosure |
| A `warnings[]` entry | Data & coverage page |

Target ~25 items across ~6 sites and ~4 initiatives plus the `__unaligned__` lane — small enough to
read, broad enough to exercise every branch.

**Acceptance:** `tests/snapshot-loader.test.ts` proves the fixture parses, that a malformed live
snapshot throws rather than being served, and that `source` reports correctly in both modes.

---

## WP2 — View-model layer

The heart of the build. Pure functions, no React, no I/O, fully unit-tested.

```
src/lib/view-models/
  filters.ts        parse/serialise URL filter state; applyFilters(items, filters)
  timeline-scale.ts domain -> px; FY quarter ticks; today offset; bar geometry
  overview.ts       buildOverviewModel
  roadmap.ts        buildGlobalRoadmapModel
  site.ts           buildSiteModel
  region.ts         buildRegionModel
  initiative.ts     buildInitiativeModel
  project.ts        buildProjectModel
  data.ts           buildDataModel
```

**Reuse, do not reimplement.** `src/lib/rollup.ts` already exports four functions that nothing
currently calls — `buildPortfolioHealth`, `buildRegionRollup`, `upcomingGoLives`,
`leadershipAttentionItems`. They were written for this UI. Also reuse `buildSiteRollup`,
`earliest`/`latest`, and `config/fiscal-year.ts` for all quarter maths. A new date helper in a view
model is a review defect.

**`timeline-scale.ts` deserves its own attention.** Every pixel offset is computed here, never in
render: `{ domainStart, domainEnd, pxPerDay, quarters[], todayOffset, barFor(item) }`. Domain is
clamped to `[FY-2, FY+4]` so one 2035 outlier cannot compress everything else. This is the module
most likely to harbour off-by-one quarter bugs, so it gets the densest tests — FY boundaries
(31 Mar / 1 Apr), items entirely outside the domain, zero-length spans.

**The anti-drift test.** One test asserts that the Overview model's headline numbers equal the
values `buildCoverage` produces for the same snapshot. This makes it structurally impossible for a
number on screen to disagree with what `verify-snapshot` reports — the two would fail together
rather than diverge quietly. Worth writing first.

**Acceptance:** every view model has tests over the fixture; the anti-drift test passes; `applyFilters`
is verified for each filter and every combination that changes a count.

---

## WP3 — Design tokens, shell, filter bar

**`app/tokens.css`** — the validated palette as CSS custom properties **by role**, declared once.
Light values plus dark values under both the `prefers-color-scheme` media query and the
`[data-theme="dark"]` scope, so an explicit toggle beats the OS setting either way. Values are
already validated (design-002 §8); transcribe them, do not re-pick them.

Health tokens bind to the existing `RISK_LEVEL_PALETTE_TOKEN` map — the config already decides
which of the five report tokens each risk level uses, including `attention` and `blocked` both
being red.

**Components:** `AppShell`, `SiteHeader` (as-of date, feed-freshness chip, sample-data chip),
`PrimaryNav`, `FilterBar`.

`FilterBar` owns URL query state (`?risk=&fy=&region=&site=&scope=`) — one instance, above all
content it scopes, never inside a chart card. Every view is then shareable and bookmarkable, which
the Power BI report cannot do.

**Acceptance:** filters round-trip through the URL; a deep link reproduces a filtered view exactly;
dark mode toggles and honours the OS default; the sample-data chip appears on fixture data.

---

## WP4 — Shared primitives

`HealthMark` first, because it is the enforcement point for the accessibility requirement:

> **`HealthMark` is the only component permitted to render a health colour.** Colour + glyph +
> accessible label, always, from `RISK_LEVEL_LABELS`. This is structural, not a review convention —
> red and green measure ΔE 4.1 under deuteranopia (against a floor of 8), so any surface that
> encodes health by colour alone is unreadable for roughly 8% of male viewers. The reference Power
> BI report does exactly that; we must not.

Then `HealthLegend`, `ProvenanceChip` (ordinal blue ramp, validated), `StatTile`, `HeroFigure`
(≥48px, system sans, proportional figures — never `tabular-nums`), `CoverageMeter`,
`TableViewToggle`, `EmptyState`.

All wording comes from `config/narrative.ts`. A hardcoded leadership-facing string is a review
defect.

**Acceptance:** no component outside `HealthMark` references a health colour token; every primitive
renders from the fixture; `TableViewToggle` has a working twin for each chart it is attached to.

---

## WP5 — Timeline engine

Built once, used by four screens. Consumes `timeline-scale.ts` and renders only.

`TimelineProvider` · `TimelineHeader` (year + quarter bands) · `TimelineGrid` (solid hairlines) ·
`TodayMarker` (2px solid ink + chip — **not** dashed, **not** red, since red is a reserved status
hue) · `TimelineRow` / `RowLabel` / `SpanBar` (10px, 4px rounded ends, 2px surface gap) ·
`MilestoneMarker` (≥8px, glyph, site-code label, 2px surface ring, count badge on collision) ·
`LaneGroup` (collapsible, `(n items)`, rolled-up `HealthMark`) · `NoDatesGroup` · `TimelineBrush`.

Rows virtualise; the label column is sticky; bars are absolutely-positioned elements rather than
SVG rects so text stays selectable.

**Acceptance:** renders 510 fixture-scaled rows without jank; FY quarters align to 1 April;
`hasDates: false` items appear in the named `NoDatesGroup` rather than vanishing; derived spans
render open-ended; keyboard focus shows the same tooltip content as hover.

---

## WP6–WP12 — Screens

Build order and per-screen contracts are in design-002 §5 and §10. Definition of done, applied to
every screen:

1. Data comes from one view-model function; the component computes nothing.
2. All wording from `config/narrative.ts`.
3. Health rendered only via `HealthMark`; provenance shown wherever a status is.
4. Table-view twin present for every chart.
5. Keyboard parity with hover; focus visible.
6. Dark mode correct (selected values, not an inversion).
7. Named empty state — never a blank panel.
8. Renders correctly against every awkward fixture case in WP1.

Screen-specific notes:

- **WP6 Overview** — the screen with no reference equivalent. Leads with a hero figure (count needing
  attention), then the health distribution, the `AlignmentSplit` tiles (249 aligned / 261 site-led),
  the attention list, region rollup and go-lives.
- **WP8 Site view** — must include the DDTYAR banner path, conditional on `alignedCount === 0`.
- **WP9 Project drill-down** — the highest-content-value screen: SPOT narrative, the "why" from
  `risk.reasons[]`, provenance, blockers. `risk.score` is **never** displayed as a number.
- **WP11 Initiative drill-down** — must label the RAG as rolled up from linked projects, because
  every initiative's provenance is `inferred` (no feed exposes `customfield_11199`). If Power BI
  shows an authored initiative RAG, this will visibly differ and the reason must be on screen.
- **WP12 Data & coverage** — coverage, provenance distribution, per-site authored-status coverage,
  `warnings[]`, sites actual-vs-expected, feed freshness. Where the project's honesty about its own
  data lives.

---

## WP13 — Config: `hold` phase and status-name mappings

Approved and config-only, but it changes what the UI renders, so it lands before WP6.

- `config/status-map.ts`: add `hold` to `CANONICAL_PHASES`; add `PHASE_LABELS['hold']`; map the
  seven names — `Open` → `demand`, `Assessment` → `initiate`, `Define` → `plan`, `In Review` →
  `execute`, `Discarded` → `cancelled`, `Hold`/`ON HOLD` → `hold`. Add `PHASE_TO_CATEGORY`.
- `config/narrative.ts`: add `on-hold` to `REASON_CODES` + `REASON_LABELS`.
- `src/lib/risk.ts`: `phase === 'hold'` yields at least `monitor` with an `on-hold` reason —
  otherwise a recently-updated held item with a future go-live renders **on-track**, which is the
  precise false reassurance this application exists to prevent.
- Confirm the held-item count from the REST snapshot when a token is available. Not a blocker: the
  mapping is right regardless of volume.

`canonicalPhaseSchema` and `reasonCodeSchema` are `z.enum` over these config arrays, so the
schemas update themselves. Adding an enum member does not invalidate existing snapshots.

**Acceptance:** 147 existing tests still pass; new tests cover the hold path in `risk.ts` and each
new status-name mapping.

---

## 2. Sequencing against the ingestion track

```
WP0 ─ WP1 ─ WP2 ─┬─ WP3 ─ WP4 ─┬─ WP6 ── WP9 ── WP12
                 │             └─ WP5 ─┬─ WP7 ── WP8 ── WP10 ── WP11
                 └─ WP13 ─────────────┘

Ingestion (NOT started, awaiting explicit approval):  A1 ─ A2 ─ A3
```

The tracks meet only at `data/snapshot.json`. When ingestion eventually lands, the UI changes in
exactly one way: `loadSnapshot()` starts returning `source: 'live'` and the sample-data chip
disappears. No component and no view model changes.

---

## 3. Risks

| Risk | Likelihood | Mitigation |
|---|---|---|
| `tsconfig.include` not extended → new code untypechecked | High if unnoticed | WP0 acceptance test deliberately introduces a type error under `app/` |
| Quarter/FY off-by-one in `timeline-scale.ts` | Medium | Densest test coverage in the plan; FY-boundary cases explicit |
| UI numbers drift from `verify-snapshot` | Medium | The anti-drift test in WP2, written first |
| Fixture stops representing real data shape | Medium | Regenerate from the first real Feed #3 snapshot once A3 lands, keeping the awkward cases |
| Scope creep into the deferred matrix screen | Medium | Explicitly out; revisit only if reference parity becomes a priority |
| Gantt performance at 510 rows | Low | Row virtualisation; geometry precomputed in the view model |
| Fixture data mistaken for real data | Low but severe | `source` + persistent sample-data chip |

---

## 4. What this plan deliberately does not do

- No `src/lib/odata-client.ts`, `odata-adapter.ts` or `spot-wiki.ts` — the ingestion track is
  approved in design but **awaits explicit go-ahead**.
- No change to `scripts/sync.ts` or `src/lib/jira-client.ts`.
- No credential or `.env.local` change.
- No REST retirement.
- No per-site local lanes in the snapshot (deferred until after the source migration).
- No Initiative-Project matrix screen (deferred past MVP).

## 5. First executable step

WP0 + WP1 together: build tooling with the `tsconfig.include` fix, the snapshot loader with
fixture fallback, and the committed fixture. That is a self-contained, reviewable change that ends
with `npm run dev` serving a page backed by validated fixture data, and the whole view-model layer
unblocked behind it.
