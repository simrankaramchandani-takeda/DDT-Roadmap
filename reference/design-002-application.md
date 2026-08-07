# Design-002: Executive roadmap application

- **Status:** Proposed, for review. **Nothing here is implemented.**
- **Date:** 2026-08-07
- **Companion:** [`design-001-odata-adapter.md`](design-001-odata-adapter.md) — the Feed #3 ingestion
  design. This document covers everything downstream of `data/snapshot.json`.
- **Source of truth for design:** Feed #3, per direction. Governance questions are recorded in
  §11 as **deployment considerations**, not development blockers.

---

## 1. What this application must beat

The reference report is four Power BI pages, all captured in the repo root. Read them before
designing anything, because leadership will compare screen to screen:

| Page | Lanes are | Bars coloured by | Grouping |
|---|---|---|---|
| Global Roadmap | Initiative | neutral purple (health only on milestone triangles) | — |
| Initiative-Project | Initiative → Site code → Project | health | 3-level expandable matrix |
| Region (e.g. Americas) | Project | health | by site code, with `(36 items)` counts |
| Site (e.g. Lexington) | Project | health | by initiative, **including a `Local (26 items)` group** |

Three observations drive this design:

1. **There is not one aggregate number anywhere in the reference report.** Four Gantt charts, no
   counts, no distribution, no "what changed". An executive cannot answer "how much is at risk"
   without counting bars by eye. **That gap is the product.**
2. **Nothing explains *why* anything is amber or red.** We now have a real narrative on 59% of
   items and an authored RAG on 83% (see `SITE_SPOT_FIELDS`), plus derived reasons with provenance
   for the rest. This is the single biggest content advantage we have.
3. **`Local (26 items)` already exists on the site page.** Site-local work is not an invention of
   ours — the report already groups it. That is a strong reconciliation argument for the
   site-local lane design in §9, and it means the concept needs no explaining to leadership.

Also inherited as verified fact: the note *"Milestones are tied to local go-live dates"*, and the
range sliders reading `4/1/2023 → 3/31/2030`, which independently confirm the 1 April fiscal-year
start already encoded in `config/fiscal-year.ts`.

---

## 2. Sequencing: how UI and adapter proceed in parallel

The two tracks are **fully decoupled by the snapshot contract**, which is already frozen and
Zod-validated. This is the payoff of the Phase 1 design and it is what makes parallel work safe.

```
Track A (ingestion)   Feed #3 ──> odata-adapter ──> snapshot.json ─┐
                                                                    ├─> UI reads ONLY this
Track B (application)  fixture snapshot ─────────> snapshot.json ─┘
```

**Track B needs no OData access, no credential, and no governance sign-off.** It builds against a
committed fixture snapshot that satisfies `snapshotSchema`. Everything in §§3–10 is implementable
today.

| Step | Track | Depends on |
|---|---|---|
| A1 | Phase A of design-001: wiki parser, status map, type registry | — |
| A2 | `odata-client.ts` + `odata-adapter.ts` behind `ROADMAP_SOURCE` | A1 |
| A3 | First Feed #3 snapshot; parity diff vs REST | A2, `JIRA_API_TOKEN` for the REST baseline |
| B1 | `src/lib/snapshot.ts` loader + fixture snapshot + view-model layer (§5) | — |
| B2 | Design tokens, shell, filter bar, timeline primitives | B1 |
| B3 | Screens in the §10 order | B2 |

Only A3 needs a Jira token, and only to produce the *comparison baseline* — not to run the app.

**Fixture snapshot:** generate one deterministic `tests/fixtures/snapshot.fixture.ts` covering the
cases that break layouts — a 100%-site-local site (DDTYAR), an initiative with no dates, an item
with no dates, a 7-year span, a 1-day span, an unreported status, a cancelled item, an item with
five owners and a 180-character summary, and a stacked-milestone collision. Build against it from
day one; every screen then has a regression fixture for free.

---

## 3. UI architecture

### Stack

| Choice | Rationale |
|---|---|
| **Next.js (App Router) + React + TypeScript** | Server Components read the snapshot server-side, so the loader stays the single data seam README already describes. Row-level authorisation later becomes a loader filter, not a schema change. Statically renderable — no request-time filesystem writes, matching the stated hosting constraint. |
| **CSS custom properties + CSS Modules** | The palette must be defined once as role tokens and referenced by role. A single reviewable token file mirrors how `config/narrative.ts` owns wording. Tailwind is an acceptable substitute; the token file is not. |
| **No charting library** | The Gantt is a custom quarter-grid — no library renders it well. The dashboard charts are a stacked bar, a meter and a small bar list, all plain SVG/HTML. Keeps the dependency list near-empty (currently just `zod`) and keeps full control of the mark specs in §7. |
| **Vitest** (already present) | View models are pure functions; they test without a DOM. |

### Layers, strictly one-directional

```
data/snapshot.json
   │  (validated on read — a snapshot that does not parse is never served)
   ▼
src/lib/snapshot.ts          loadSnapshot(), cached per process. THE only data access point.
   │
   ▼
src/lib/view-models/*.ts     PURE snapshot -> page props. No React, no I/O. Fully unit-tested.
   │
   ▼
app/**/page.tsx              Server Components. Compose view models, render.
   │
   ▼
components/**                Presentational. Receive props. NO aggregation, NO wording.
```

**Non-negotiables in this layering** — each one prevents a specific known failure:

- **No component computes an aggregate.** All counting, grouping and sorting lives in
  `src/lib/view-models/`, so every number on screen is unit-testable without rendering. `rollup.ts`
  already contains `buildPortfolioHealth`, `buildRegionRollup`, `upcomingGoLives` and
  `leadershipAttentionItems` — four exported functions that **nothing currently calls**. They were
  written for this UI. Use them; do not reimplement them in a component.
- **No component contains leadership-facing prose.** Every label comes from `config/narrative.ts`
  (`RISK_LEVEL_LABELS`, `REASON_LABELS`, `PROVENANCE_LABELS`, `SUMMARY_SOURCE_LABELS`,
  `NOT_REPORTED_PLACEHOLDER`). A hardcoded string in a component is a review defect.
- **No component reads `config/fields.ts` or anything Jira-shaped.** The snapshot is the contract.
- **Filters live in one row above everything they scope** — never inside a chart card, never
  per-chart.

### Routes

```
/                                Portfolio Overview
/roadmap                         Global Roadmap            (≡ PBI page 1)
/roadmap/initiatives             Initiative-Project        (≡ PBI page 2)
/regions/[region]                Region view               (≡ PBI page 3)
/sites/[siteKey]                 Site view                 (≡ PBI page 4)
/initiatives/[key]               Initiative drill-down     (new)
/projects/[key]                  Project drill-down        (new)
/data                            Data & coverage           (new)
```

Filter state lives in the URL query (`?risk=at-risk&fy=FY26&region=Europe&site=DDTGC`) so any view
is shareable and bookmarkable — a hard requirement for executive use, and something the Power BI
report cannot do.

---

## 4. Component hierarchy

```
AppShell
├─ SiteHeader              product name, as-of date, feed freshness chip (§11)
├─ PrimaryNav              Overview · Roadmap · Regions · Sites · Data
└─ main
   └─ FilterBar            ONE instance, above all content it scopes
      ├─ RiskToggle              All · At Risk · Not At Risk   (mirrors PBI "Risk Indicator")
      ├─ FiscalYearSelect        from item.fiscalYears
      ├─ RegionSelect
      ├─ SiteSelect
      ├─ StatusScopeToggle       Ongoing · Completed           (mirrors PBI toggle)
      └─ ClearFilters                                          (mirrors PBI "Clear all slicers")

── Shared primitives ──────────────────────────────────────────────
HealthMark            color + glyph + accessible label. THE atom of §8. Never color alone.
HealthLegend          all levels present, glyph + swatch + label
ProvenanceChip        PROVENANCE_LABELS + ordinal-blue dot
StatTile              label, value, optional delta, optional meter
HeroFigure            the one number a page leads with (>=48px, system sans, proportional figures)
CoverageMeter         known vs unknown, same-ramp track
TableViewToggle       every chart has a table twin (accessibility requirement, not optional)
EmptyState            named, never a blank panel

── Timeline (the Gantt engine) ────────────────────────────────────
TimelineProvider          owns scale: domain, px/day, FY-quarter ticks, today offset
├─ TimelineHeader          year band + quarter band (matches PBI)
├─ TimelineGrid            solid hairline quarter rules
├─ TodayMarker             2px solid ink rule + "Today" chip  (NOT dashed, NOT red — see §7)
├─ TimelineRow
│  ├─ RowLabel             sticky left column
│  ├─ SpanBar              10px, 4px rounded ends, health fill + leading HealthMark
│  └─ MilestoneMarker      >=8px glyph, site-code label, 2px surface ring, count badge if stacked
├─ LaneGroup               collapsible; header carries name + "(n items)" + rolled-up HealthMark
├─ NoDatesGroup            explicit section for hasDates === false
└─ TimelineBrush           range selector (mirrors PBI slider)

── Composites ─────────────────────────────────────────────────────
AttentionList         ranked at-risk items: HealthMark + title + why + ProvenanceChip
RiskReasonList        REASON_LABELS + the concrete detail string
NarrativePanel        SPOT phase/state/status/accomplishments/priorities + SUMMARY_SOURCE_LABELS
SiteRollupStrip       per-site go-live glyphs for a collapsed initiative lane
GoLiveList            upcoming go-lives, chronological
AlignmentSplit        aligned vs site-local, as a first-class figure (§9)
```

---

## 5. Data contracts per page

Each page gets one view-model function returning one typed object. Existing `rollup.ts` functions
are named where they apply; **nothing new is needed in the domain model.**

### `/` Portfolio Overview → `buildOverviewModel(snapshot, filters)`

| Prop | Source |
|---|---|
| `atRiskCount`, `activeCount` | `coverage.itemsActive`, `items[].risk.atRisk` |
| `healthDistribution` | `coverage.byRiskLevel` |
| `initiativeHealth` | `buildPortfolioHealth(initiatives)` |
| `attention[]` | `leadershipAttentionItems(items, 8)` |
| `upcomingGoLives[]` | `upcomingGoLives(items, asOf, 2)` |
| `regions[]` | `buildRegionRollup(items)` |
| `alignment` | counts of `items[].alignment` |
| `coverage` | `coverage.withAnyRag`, `withNarrative`, `withBothDates`, `byProvenance` |
| `asOf`, `syncedAt`, `source` | snapshot root |

### `/roadmap` Global Roadmap → `buildGlobalRoadmapModel(snapshot, filters)`

`lanes[]` — one per `initiative`, each `{ key, summary, start, end, hasDates, datesDerived, risk, siteRollup[], itemCount }`.
`siteRollup` is already on the initiative and is exactly what `SiteRollupStrip` needs: earliest
go-live per site, worst risk per site, chronologically sorted. Site-local lane per §9.
`noDates[]` — initiatives with `hasDates === false` (the reference report renders these as
silently empty lanes; we name them).

### `/roadmap/initiatives` Initiative-Project → `buildInitiativeProjectModel(...)`

Three-level tree: `initiative → siteCode → items[]`, from `items[].initiativeKey` + `siteCode`.
Mirrors the reference matrix. Collapsed to level 2 by default.

### `/regions/[region]` → `buildRegionModel(snapshot, region, filters)`

`groups[]` keyed by `siteCode` with `itemCount`; `items[]` per group. Plus region-level stat tiles —
the aggregate layer the reference page lacks.

### `/sites/[siteKey]` → `buildSiteModel(snapshot, siteKey, filters)`

`groups[]` keyed by `initiativeKey` **plus a site-led group** (§9), each with `(n items)`.
Site-level tiles: at-risk count, authored-status coverage, next go-live.
`site` from `sites[]` — including `expectedActiveCount` and `regionProvisional`, both of which are
honest-reporting signals worth surfacing on the page rather than only in the gate.

### `/initiatives/[key]` → `buildInitiativeModel(...)`

Initiative + its `itemKeys` resolved to items + `siteRollup` + `datesDerived` +
`authoredRag`. **`risk.provenance` will be `inferred` for every initiative** (no feed exposes
`customfield_11199`), so the rollup must be labelled as such wherever the RAG appears — see §8.

### `/projects/[key]` → `buildProjectModel(...)`

The full `RoadmapItem`: `narrative` (all SPOT fields), `risk.reasons[]`, `risk.authored`,
`blockers[]`, `owners[]`, `spotId`/`spotUrl`, `fiscalYears`, `declaredFiscalYear`, `childCount`,
`jiraUrl`, `summary.raw` vs `summary.cleanTitle`.

### `/data` Data & coverage → `buildDataModel(snapshot)`

`coverage` in full, `warnings[]`, `sites[]` actual-vs-expected, `source` freshness, and the
per-site authored-status coverage that `verify-snapshot` now reports. This page is where the
project's honesty about its own data lives.

---

## 6. Wireframes

### `/` Portfolio Overview — the screen the reference report has no equivalent of

```
┌────────────────────────────────────────────────────────────────────────────────────────┐
│ DD&T Roadmap          As of 7 Aug 2026 · Feed data to 7 Aug 13:35 UTC          [Data]  │
├────────────────────────────────────────────────────────────────────────────────────────┤
│ Overview │ Roadmap │ Regions │ Sites │ Data                                            │
├────────────────────────────────────────────────────────────────────────────────────────┤
│ Risk: [ All ][•At Risk][ Not At Risk ]   FY:[All▾] Region:[All▾] Site:[All▾]  Clear     │
├────────────────────────────────────────────────────────────────────────────────────────┤
│                                                                                        │
│   84                            ┌─ Portfolio health ─────────────────────────────────┐ │
│   projects need attention       │ ●On Track 231 │▲Monitor 52│◆Attn 28│⬣Blk 4│○No … │ │
│   of 429 active                 │ ▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓░░░░░░▒▒▒▒▒▓▓░░░░░░░░░░░░░░░ │ │
│                                 └───────────────────────────── [Table view] ─────────┘ │
│                                                                                        │
│ ┌ Aligned to a programme ┐ ┌ Site-led ──────┐ ┌ Next go-live ─┐ ┌ Authored status ───┐ │
│ │ 249            49%     │ │ 261       51%  │ │ 12 in Q3 FY26 │ │ 83%  ▓▓▓▓▓▓▓▓░░    │ │
│ └────────────────────────┘ └────────────────┘ └───────────────┘ └────────────────────┘ │
│                                                                                        │
│ ┌ Needs leadership attention ────────────────────────────────────────────────────────┐ │
│ │ ◆ TO MES Filling Line — SPOT 1039506          Thousand Oaks · Americas             │ │
│ │   Delayed Milestone · go-live was 31 Mar 26, 129 days ago                           │ │
│ │   ⬤ Reported by site (SPOT)                                          [Open →]      │ │
│ │ ─────────────────────────────────────────────────────────────────────────────────  │ │
│ │ ⬣ BP MES Platform Upgrade                     Brooklyn Park · Americas             │ │
│ │   Blocked Pending Dependency · blocked by DDTBP-118 (open)                          │ │
│ │   ◐ Inferred from schedule                                           [Open →]      │ │
│ │                                                            Show all 84 at risk →   │ │
│ └────────────────────────────────────────────────────────────────────────────────────┘ │
│                                                                                        │
│ ┌ By region ──────────────────────┐ ┌ Go-lives next two quarters ───────────────────┐ │
│ │ Americas       137  ▓▓▓▓▓▓▓ 31 │ │ 12 Aug  ● GRA  TILGC MES MBR Migration        │ │
│ │ Europe         189  ▓▓▓▓▓ 24   │ │ 30 Sep  ▲ LEX  Knowledge Management at MBO     │ │
│ │ Asia-Pacific   103  ▓▓▓ 12     │ │ 31 Oct  ◆ THO  MES Filling Line               │ │
│ │              at risk ▓         │ │                                    Full list → │ │
│ └─────────────────────────────────┘ └───────────────────────────────────────────────┘ │
└────────────────────────────────────────────────────────────────────────────────────────┘
```

### `/roadmap` Global Roadmap — reconciles with reference page 1, adds a header row of totals

```
│ Risk:[All][•At Risk][Not At Risk]  FY:[All▾] Region:[All▾] Site:[All▾]  Clear          │
│ 36 initiatives · 510 projects · 84 at risk        Zoom:[FY][Qtr][Month]  [Table view]  │
├───────────────────────────┬────────────────────────────────────────────────────────────┤
│ Legend  ●On Track ▲Monitor ◆Attention ⬣Blocked ✓Complete ✕Cancelled ○No status reported│
├───────────────────────────┼─────────────────── FY2026 ──────────┬───── FY2027 ─────────┤
│ Initiative                │  Q1    Q2    Q3    Q4               │  Q1    Q2   Q3   Q4  │
│                           │             │Today                  │                      │
├───────────────────────────┼─────────────┼───────────────────────┼──────────────────────┤
│ ▸ MES              (47) ◆ │ ▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬  │                      │
│                           │   ▲BRY ◆THO  ●LIN ③BRP  ●NEU        │        ●BRP          │
│ ▸ CIM Project Phoenix (16)│      ▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬            │                     │
│                           │   ●TJN ▲SNG ◆BRY ●GRA               │  ●SGP                │
│ ▸ SAIL             (12) ● │ ▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬ │
│                           │   ○THO ▲BRY  ●BRP ●THO ○SNG         │                      │
│ ▾ Site-led         (261)▲ │ ← collapsed by default; expands to one sub-lane per site   │
│    ├ Grange Castle   (70)▲│      ▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬                            │
│    ├ Lexington       (32)●│   ▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬                                       │
│    └ Yaroslavl       (17)▲│         ▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬                                   │
├───────────────────────────┴────────────────────────────────────────────────────────────┤
│ No dates reported (3):  MetrIQ · Electronic Lab Notebook (ELN) · OpenLab Support       │
├────────────────────────────────────────────────────────────────────────────────────────┤
│ ├──────────────────────────────[ brush ]──────────────────────────────────────────────┤ │
│ 1 Apr 2023                                                              31 Mar 2031    │
└────────────────────────────────────────────────────────────────────────────────────────┘
```

`③` is a stacked-milestone badge — the reference report uses an undifferentiated `✳`; a count is
strictly more informative for the same pixels.

### `/sites/DDTYAR` Site view — the 100%-site-led case that must not look broken

```
│ Yaroslavl (Russia)                                    Asia-Pacific · region provisional │
│ 17 active projects · 16 authored a status · 1 at risk · next go-live 30 Nov 26          │
├────────────────────────────────────────────────────────────────────────────────────────┤
│ ⓘ All 17 projects at this site are site-led. Yaroslavl has no work linked to a global   │
│   programme — an expected delivery model, not missing data.               [Why? →]      │
├───────────────────────────┬─────────────── FY2026 ───────────┬────── FY2027 ───────────┤
│ Project                   │  Q1    Q2    Q3    Q4            │  Q1    Q2    Q3    Q4   │
├───────────────────────────┼──────────────┼───────────────────┼─────────────────────────┤
│ ▾ Site-led        (17 items) ▲                                                          │
│   ● YAR OT Network Segment.│    ▬▬▬▬▬▬▬▬▬▬▬▬▬▬                │                        │
│   ▲ YAR SAP Interface Opt. │        ▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬        │                        │
│   ○ YAR Warehouse Scanning │              ▬▬▬▬▬▬▬▬▬           │                        │
└────────────────────────────────────────────────────────────────────────────────────────┘
```

For a normal site the same page shows one group per initiative plus the site-led group — matching
the reference report's `Local (26 items)` structure exactly.

### `/projects/[key]` Project drill-down — where the "why" lives

```
│ ‹ Thousand Oaks     TO MES Filling Line — SPOT 1039506              [Jira ↗] [SPOT ↗]  │
├────────────────────────────────────────────────────────────────────────────────────────┤
│ ◆ Leadership Attention Required        ⬤ Reported by site (SPOT) · authored "Red"       │
│                                          as at 5 Aug 2026                              │
├────────────────────────────────────────────────────────────────────────────────────────┤
│ ┌ Why ─────────────────────────────────────────────────────────────────────────────┐   │
│ │ ◆ Delayed Milestone   Go-live was 31 Mar 2026, 129 days ago                       │   │
│ │ ▲ Reporting Gap       No update in Jira for 94 days                               │   │
│ └──────────────────────────────────────────────────────────────────────────────────┘   │
│                                                                                        │
│ ┌ Site-authored status (SPOT) ──────────────────────────────────────────────────────┐  │
│ │ Phase Execute · State Active                                                       │  │
│ │ Status  27/07/2026: confirming next waves                                          │  │
│ │         21/05/2026: The Automation folder was migrated to SharePoint               │  │
│ │ Recent  Pilot migration wave complete · meetings with MANOPS P1 completed          │  │
│ │ Next    MAN Ops P1, Engineering and EHS folders to be migrated                     │  │
│ └──────────────────────────────────────────────────────────────────────────────────┘   │
│                                                                                        │
│ ┌ Timeline ────────────────────┐ ┌ Detail ──────────────────────────────────────────┐  │
│ │ Start    1 Oct 2024          │ │ Programme    MES  (initiative) →                 │  │
│ │ Go-live 31 Mar 2026 (overdue)│ │ Phase        Execute  (Jira: "Execute")          │  │
│ │ FY       FY24 · FY25 · FY26  │ │ Owners       A. Patel (IT Lead) · J. Wu (Sponsor) │  │
│ │ ▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬│            │ │ Blockers     none open                           │  │
│ └──────────────────────────────┘ │ Updated      5 Aug 2026 (94 days)                │  │
│                                  └──────────────────────────────────────────────────┘  │
└────────────────────────────────────────────────────────────────────────────────────────┘
```

---

## 7. Gantt experience design

The Gantt is the component leadership already knows, so it must be recognisably the same chart —
and quietly better built.

**Scale.** Fiscal quarters, 1 April start, from `config/fiscal-year.ts` — never calendar quarters.
Two header bands (year, quarter), matching the reference. Zoom presets FY / Quarter / Month plus a
brush, mirroring the reference slider. Default domain: earliest start → latest end across the
filtered set, clamped to `[FY-2, FY+4]` so one 2035 outlier cannot compress everything else into
40px.

**Marks** (per the mark specs, and deliberately unlike the reference report's heavy blocks):

- **Span bars 10px**, 4px rounded ends, health fill, **2px surface gap** between adjacent bars — a
  gap, never a border. The reference report's thick saturated blocks read loud at scale; thin marks
  with a recessive grid read as a professional instrument.
- **Milestone markers ≥8px**, glyph by health (§8), site-code label above, **2px surface ring**
  where markers overlap. Stacked collisions collapse to a single marker with a **count badge**.
- **Grid**: solid hairlines at quarter boundaries, one shade off the surface. **Never dashed** —
  dashing reads as projection or threshold when it is just a grid.
- **Today marker**: 2px **solid** line in primary ink with a `Today` chip. Deliberately *not* the
  reference report's red dotted line: red is a reserved status hue here, and a red rule beside red
  bars invites misreading it as data.
- **Derived spans** (`datesDerived === true`) render with open/ticked ends, because a rolled-up
  span is not a commitment and must not look like one.

**Rows and grouping.** Fixed row height; `LaneGroup` headers carry name, `(n items)` and a
rolled-up `HealthMark`. Collapsed initiative lanes show the `SiteRollupStrip` — the single most
effective device in the reference report, and the reason a collapsed view can still communicate
rollout sequencing.

**No-dates handling.** `hasDates === false` items and initiatives go to a named `NoDatesGroup`
below the chart, with a count. The reference report renders them as silently empty lanes; a named
group turns an invisible data gap into a visible one. Items with only a go-live render as a
milestone diamond with no bar — `verify-snapshot` already tracks how many that is.

**Performance.** 510 rows × ~32 quarters. Virtualise rows only (columns are few), keep the label
column sticky, and render bars as absolutely-positioned divs rather than SVG rects so text stays
selectable. Precompute all pixel offsets in the view model — no layout maths in render.

**Interaction.** Hover/focus tooltip per bar and marker showing title, site, dates, health, and
provenance. Keyboard focus shows the same content as hover. Tooltips **enhance, never gate** — every
value is also reachable from the row label, the drill-down, or the table view. `[Table view]`
toggles every timeline to a WCAG-clean table.

---

## 8. Risk visualization design

### The computed finding that shapes this section

Running the reserved status palette through the validator returns, for the two colours this
domain leans on hardest:

```
CVD separation: worst pair #d03b3b (red) ↔ #0ca30c (green)  ΔE 4.1 (deuteranopia)
```

**Red and green are 4.1 apart under deuteranopia, against a floor of 8.** The reference Power BI
report encodes health by **colour alone** — coloured bars, coloured triangles, and a legend of
coloured dots. For roughly 8% of male viewers its green and red bars are not reliably
distinguishable. This is not a matter of taste and it is not fixable by choosing prettier reds.

**Therefore health is encoded on three channels, always, everywhere:**

| Risk level | `RISK_LEVEL_PALETTE_TOKEN` | Hex (light / dark) | Glyph | Label (`RISK_LEVEL_LABELS`) |
|---|---|---|---|---|
| `on-track` | green | `#0ca30c` | ● filled circle | On Track |
| `monitor` | amber | `#fab219` | ▲ triangle | Monitor Closely |
| `attention` | red | `#d03b3b` | ◆ diamond | Leadership Attention Required |
| `blocked` | red | `#d03b3b` | ⬣ barred hex | Blocked Pending Dependency |
| `complete` | blue | `#2a78d6` | ✓ check | Complete |
| `cancelled` | grey | `#898781` + 135° hatch | ✕ cross | Cancelled |
| `unreported` | grey | `#898781` | ○ hollow circle | No Status Reported |

The token column is **not new** — `config/narrative.ts` already maps all seven levels onto the
reference report's five-token vocabulary, including `attention` and `blocked` both being red. This
design binds those existing tokens to validated hex and adds the glyph channel. `HealthMark` is the
only component permitted to render a health colour, which is how "never colour alone" is enforced
structurally rather than by review discipline.

Notes: `warning` (#fab219) is below 3:1 on the light surface by design — the glyph-plus-label
pairing is the documented mitigation, and it is present unconditionally here. The status palette's
`serious` step is deliberately left unused rather than forced onto `blocked`, because an orange
"worse than red" inverts the severity reading. `cancelled` and `unreported` share grey and are
separated by glyph and hatch, so cancelled work can never read as delivered.

### Provenance is co-equal with status

Every status display carries a `ProvenanceChip`, on an **ordinal blue ramp** (validated: monotone
lightness, ΔL ≥ 0.06, light end 2.06:1 on light / 2.15:1 on dark, single hue):

| Provenance | Hex light / dark | Glyph |
|---|---|---|
| `spot` — Reported by site (SPOT) | `#104281` / `#9ec5f4` | ⬤ |
| `reported` — Reported in Jira | `#2a78d6` / `#3987e5` | ◕ |
| `inferred` — Inferred from schedule | `#86b6ef` / `#184f95` | ◐ |
| `none` — Not reported | `#898781` | ○ |

Ordinal, not categorical, because these *are* ordered — by how much trust the number deserves.
Darker means better-evidenced.

**Two consequences that must not be softened:**

- Every **initiative** RAG is `inferred`, because no feed exposes `customfield_11199`. The
  initiative drill-down must say the status is rolled up from linked projects, not authored. If the
  Power BI report shows an authored initiative RAG, this will visibly differ — surface the reason
  rather than let it look like a defect.
- `risk.score` is **never displayed as a number.** It orders the attention list and nothing else.
  A false-precision score invites arguments about the arithmetic instead of the project.

### Distribution charts

- **Health distribution**: horizontal stacked bar, 2px surface gaps between segments, severity
  order, direct labels where they fit and otherwise outside the segment — never clipped. Seven
  classes is at the readability ceiling, so the table twin is mandatory, not optional.
- **Coverage / authored-status**: a `CoverageMeter` on one same-hue track. A ratio against a limit
  is a meter, not a two-slice pie.
- **Region rollup**: one series → one hue (slot-1 blue), with **emphasis** on the worst region
  rather than eight competing colours. Never a value-ramp across regions: they have no natural
  order, and colouring bars darker-where-bigger would double-encode length as hue.
- Both dashboard bar forms show at most one series, so no categorical palette is needed anywhere in
  the MVP. That is deliberate — it sidesteps the 8-slot cap and every ordering question with it.

---

## 9. Local-initiative visualization (DDTYAR and future unlinked sites)

The rule is settled in `transform.ts` and `verify-snapshot.ts`. What remains is presentation, and
the governing principle is: **site-led is a delivery model, so it must look like a lane, not like a
leftovers bucket.** 261 of 510 items (51%) are site-led — the largest single lane in the portfolio.
Presenting the majority of the portfolio as "unaligned" would misrepresent it.

Precedent matters here: the reference report's site page already has a `Local (26 items)` group, so
the concept needs no introduction to leadership.

| Surface | Treatment |
|---|---|
| **Global Roadmap** | One `Site-led` lane, **collapsed by default**, expanding to one sub-lane per site. A flat 261-row lane is unreadable; per-site sub-lanes are the same grouping the site pages use. |
| **Site view** | A `Site-led (n items)` group alongside the initiative groups — reference-report parity. |
| **Region view** | Site-led items appear in their site's group like any other item. No separate treatment; at this grain alignment is not the question being asked. |
| **Portfolio Overview** | An `AlignmentSplit` pair of stat tiles — `Aligned 249 / 49%` and `Site-led 261 / 51%`. First-class, not hidden in a lane. |
| **Project drill-down** | Programme row reads `Site-led — not linked to a global programme`, using `NOT_REPORTED_PLACEHOLDER` conventions rather than an empty field. |
| **100%-site-led site (DDTYAR)** | An explanatory banner (wireframe in §6) stating this is expected, with a link to the explanation. **The page must never render as "no programmes found".** |

Wording for the banner and the programme row belongs in `config/narrative.ts` with the rest of the
leadership vocabulary — not in the component.

Future unlinked sites need **no code or config change**: the rule is a predicate over links, the
banner is conditional on `alignedCount === 0`, and per-site sub-lanes are generated from the data.

**Deferred, deliberately:** replacing the single synthetic lane with true per-site local
initiatives in the *snapshot* (rather than only in the view) is a `sync.ts` change and must not
ship during the source migration — it would change the snapshot for a second reason and destroy the
parity diff that validates the migration. The per-site *presentation* above needs no such change.

---

## 10. MVP screen inventory

Build order. Each row is independently demonstrable.

| # | Screen | Route | Reference parity | New capability | Priority |
|---|---|---|---|---|---|
| 1 | Portfolio Overview | `/` | — | The entire aggregate layer | **MVP** |
| 2 | Global Roadmap | `/roadmap` | PBI 1 | Named no-dates group; per-site sub-lanes; totals header | **MVP** |
| 3 | Site view | `/sites/[k]` | PBI 4 | Site tiles; site-led banner | **MVP** |
| 4 | Project drill-down | `/projects/[k]` | — | SPOT narrative; the "why"; provenance | **MVP** |
| 5 | Region view | `/regions/[r]` | PBI 3 | Region tiles | MVP |
| 6 | Initiative drill-down | `/initiatives/[k]` | — | Site rollup; rolled-up-status labelling | MVP |
| 7 | Initiative-Project | `/roadmap/initiatives` | PBI 2 | Filter/URL state | Post-MVP |
| 8 | Data & coverage | `/data` | — | Coverage, warnings, freshness, provenance | MVP |

Screens 1–6 and 8 are the MVP. Screen 7 is the most complex Gantt (three-level matrix) and the
least decision-support value — every question it answers is answerable from 2, 3 and 6 — so it is
sequenced last deliberately.

**Cross-cutting, required before screen 1 is "done":** the filter bar with URL state, the health
legend, `HealthMark`, table-view twins, empty states, dark mode stepped from the same ramps (a
*selected* set of dark values, never an automatic inversion), and keyboard parity with hover.

---

## 11. Deployment considerations (not development blockers)

Recorded here per direction: these gate **deployment and the source cutover**, not application
development. None of them blocks any work in §§3–10.

| # | Consideration | Status | Affects |
|---|---|---|---|
| D1 | E4 — approved-use statement for non-BI consumption of the feed | Open | Production cutover to Feed #3 |
| D2 | E6 — named data owner / catalog registration; no change-notification path | Open | Operational support; a feed reconfiguration would arrive as a failing sync |
| D3 | Credential is Basic auth; service account vs named individual unconfirmed | Open | Whether the key-person dependency is removed or relocated |
| D4 | Entitlement scope may follow the configuring account's Jira permissions | Open | Whether snapshot contents can change silently |
| D5 | E8 — no precedent non-BI consumer | Open | Would collapse D1/D3 into a known-good pattern |
| D6 | Feed is same-day, not live | **Known and quantified** | Mitigated in-product: `source.newestUpdated` is displayed in the header on every screen |
| D7 | SSO / row-level authorisation | Out of MVP scope | Additive — a filter in `src/lib/snapshot.ts`, not a schema change |
| D8 | `JIRA_API_TOKEN` absent from `.env.local` | Blocks only the REST parity baseline (A3) | Not needed to run the app on Feed #3 |

D6 is the only one with a user-visible consequence, and it is handled by design: the freshness chip
in `SiteHeader` states the data's actual age on every screen, so the app can never imply it is more
current than the feed.

---

## 12. Open decisions for review

1. **Stack** — Next.js App Router + CSS custom properties. The loader-as-single-seam and
   static-rendering properties are what recommend it; if there is an existing Takeda front-end
   standard, it should win over this recommendation.
2. **Glyph set** — the specific glyphs in §8 are proposed, not derived. The *requirement* is a
   non-colour channel; the shapes themselves are open to a designer's judgement.
3. **Screen 7 deferral** — the three-level matrix is the most faithful reference-parity view and
   the least decision-support value. If parity for its own sake matters more than sequencing, it
   moves into the MVP.
4. **`hold` phase** (from design-001) — affects the phase vocabulary and therefore the timeline
   grouping and legend. Still needs sign-off.
5. **Per-site local initiatives in the snapshot** — recommended eventually, must not ship during
   the migration.
