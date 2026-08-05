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

/** The canonical delivery lifecycle, in order. */
export const CANONICAL_PHASES = [
  'demand',
  'initiate',
  'plan',
  'execute',
  'closeout',
  'complete',
  'cancelled',
] as const;

export type CanonicalPhase = (typeof CANONICAL_PHASES)[number];

/** Normalised status name -> canonical phase. Keys must be lowercase. */
export const STATUS_NAME_TO_PHASE: Readonly<Record<string, CanonicalPhase>> = {
  // intake
  demand: 'demand',
  'to do': 'demand',
  backlog: 'demand',
  new: 'demand',
  // initiation
  initiate: 'initiate',
  initiation: 'initiate',
  // planning
  plan: 'plan',
  planning: 'plan',
  // delivery
  execute: 'execute',
  'in progress': 'execute',
  'in development': 'execute',
  doing: 'execute',
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
} as const;

/** Phases treated as "not yet started" when deriving schedule risk. */
export const NOT_STARTED_PHASES: readonly CanonicalPhase[] = ['demand', 'initiate'] as const;

/**
 * Suffixes stripped before matching. DDTJG uses `To Do - Epic`, `In Progress - Epic`.
 */
export const STATUS_SUFFIXES_TO_STRIP: readonly string[] = ['epic', 'story', 'task'] as const;
