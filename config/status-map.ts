/**
 * Status normalisation.
 *
 * Every team-managed project has its OWN status IDs, so IDs are useless for
 * cross-project comparison -- discovery found `Execute` carrying ids 10320,
 * 18400, 18753, 18759, 18761, 18763, 18773 and 22746 across different projects.
 * Names overlap but are inconsistent (`In Progress` vs `In progress`), and DDTJG
 * suffixes its statuses (`To Do - Epic`).
 *
 * Resolution order: lowercase -> strip a trailing ` - <suffix>` -> exact match
 * here -> fall back to `statusCategory`. Unmatched names are ingested via the
 * category fallback and reported in `warnings[]`.
 */

/**
 * The canonical delivery lifecycle, in order.
 *
 * `hold` is the exception to "in order": it is a SUSPENSION of a lifecycle position
 * rather than a position of its own, so it sits after the sequence rather than
 * pretending to a place inside it. It earns a dedicated phase instead of collapsing
 * into `execute` because a held project and a running project need different
 * treatment -- see the hold floor in src/lib/risk.ts.
 *
 * Adding a member here is safe for existing snapshots: `canonicalPhaseSchema` is a
 * `z.enum` over this array, so widening the enum cannot invalidate data already
 * written.
 */
export const CANONICAL_PHASES = [
  'demand',
  'initiate',
  'plan',
  'execute',
  'closeout',
  'complete',
  'cancelled',
  'hold',
] as const;

export type CanonicalPhase = (typeof CANONICAL_PHASES)[number];

/** Normalised status name -> canonical phase. Keys must be lowercase. */
export const STATUS_NAME_TO_PHASE: Readonly<Record<string, CanonicalPhase>> = {
  // intake
  demand: 'demand',
  'to do': 'demand',
  backlog: 'demand',
  new: 'demand',
  open: 'demand',
  // initiation
  initiate: 'initiate',
  initiation: 'initiate',
  assessment: 'initiate',
  // planning
  plan: 'plan',
  planning: 'plan',
  define: 'plan',
  // delivery
  execute: 'execute',
  'in progress': 'execute',
  'in development': 'execute',
  doing: 'execute',
  // `In Review` is delivery, not wind-down: the work is still in flight and a
  // review can send it back. Mapping it to `closeout` would report it as nearly
  // finished.
  'in review': 'execute',
  // wind-down
  closeout: 'closeout',
  'close out': 'closeout',
  closing: 'closeout',
  // terminal
  done: 'complete',
  complete: 'complete',
  completed: 'complete',
  closed: 'complete',
  resolved: 'complete',
  // abandoned
  'will not do': 'cancelled',
  cancelled: 'cancelled',
  canceled: 'cancelled',
  "won't do": 'cancelled',
  rejected: 'cancelled',
  discarded: 'cancelled',
  // suspended. Both spellings observed; `ON HOLD` lowercases to `on hold`.
  hold: 'hold',
  'on hold': 'hold',
} as const;

/**
 * Fallback when the name is unrecognised. Jira `statusCategory.key` is one of
 * `new` | `indeterminate` | `done` and is always present.
 */
export const STATUS_CATEGORY_TO_PHASE: Readonly<Record<string, CanonicalPhase>> = {
  new: 'demand',
  indeterminate: 'execute',
  done: 'complete',
} as const;

/** Human labels for the UI. */
export const PHASE_LABELS: Readonly<Record<CanonicalPhase, string>> = {
  demand: 'Demand',
  initiate: 'Initiate',
  plan: 'Plan',
  execute: 'Execute',
  closeout: 'Closeout',
  complete: 'Complete',
  cancelled: 'Cancelled',
  hold: 'On Hold',
} as const;

/** Phases treated as "not yet started" when deriving schedule risk. */
export const NOT_STARTED_PHASES: readonly CanonicalPhase[] = ['demand', 'initiate'] as const;

/**
 * Phase -> workflow category, for grouping and legends where only a phase is to
 * hand.
 *
 * MUST NOT be used to decide whether work is finished. `cancelled` maps to `done`
 * here because Jira itself files "Will not do" under `statusCategory: done`, and
 * that is precisely the trap the pipeline guards against: terminality is resolved
 * from the phase, checking `cancelled` BEFORE `complete`, so abandoned work never
 * reports as delivered. Use `status.phase` for that decision, never this map.
 *
 * `hold` is `in-progress` because a held project is still open work -- it has not
 * been delivered and it has not been abandoned.
 */
export const PHASE_TO_CATEGORY: Readonly<Record<CanonicalPhase, 'todo' | 'in-progress' | 'done'>> = {
  demand: 'todo',
  initiate: 'in-progress',
  plan: 'in-progress',
  execute: 'in-progress',
  hold: 'in-progress',
  closeout: 'in-progress',
  complete: 'done',
  cancelled: 'done',
} as const;

/**
 * Suffixes stripped before matching. DDTJG uses `To Do - Epic`, `In Progress - Epic`.
 */
export const STATUS_SUFFIXES_TO_STRIP: readonly string[] = ['epic', 'story', 'task'] as const;
