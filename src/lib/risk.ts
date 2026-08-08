/**
 * Risk derivation. Pure.
 *
 * Precedence, per the approved decision:
 *   1. SPOT `Overall Status`            -> provenance 'spot'
 *   2. Other authored RAG (Health etc.) -> provenance 'reported'
 *   3. Derived from schedule and status -> provenance 'inferred'
 *
 * TWO APPROVED EXCEPTIONS override an authored RAG, both because a workflow
 * transition is a harder and more current fact than a status field nobody has
 * revisited:
 *   - A terminal status (`complete` / `cancelled`) wins outright.
 *   - A `hold` status imposes a FLOOR of `monitor`. See "THE HOLD FLOOR" below.
 *
 * Steps 1-2 cover only ~11% of items, so step 3 carries the portfolio. The
 * governing constraint: NEVER assert a cause the data does not evidence. There
 * is no field anywhere in the DDT schema that indicates a resource constraint or
 * a scope change, so `resource-constraint` and `scope-risk` are never inferred --
 * they are reachable only from an authored status. Inventing them would be the
 * fastest way to lose executive trust.
 */

import {
  AT_RISK_LEVELS,
  REASON_LABELS,
  RISK_THRESHOLDS,
  type ReasonCode,
  type RiskLevel,
} from '@config/narrative.js';
import { NOT_STARTED_PHASES } from '@config/status-map.js';
import { daysBetween } from './fiscal-year.js';
import type { AuthoredRag, Blocker, ItemStatus, RiskAssessment, RiskReason } from '@/types/domain.js';

export interface RiskInput {
  status: ItemStatus;
  start?: string | undefined;
  end?: string | undefined;
  /** Days since the issue was last touched. */
  daysSinceUpdate: number;
  blockers: readonly Blocker[];
  /** Resolved authored RAG, if any. */
  authoredRag?: { level: RiskLevel; authored: AuthoredRag; isSpot: boolean } | undefined;
  /** Snapshot date, `YYYY-MM-DD`. */
  asOf: string;
}

/** Severity order, worst last. Used to pick the dominant signal and to roll up. */
const SEVERITY: readonly RiskLevel[] = [
  'complete',
  'cancelled',
  'unreported',
  'on-track',
  'monitor',
  'blocked',
  'attention',
];

function severityOf(level: RiskLevel): number {
  const index = SEVERITY.indexOf(level);
  return index === -1 ? 0 : index;
}

/** The worse of two levels. */
export function worseRisk(a: RiskLevel, b: RiskLevel): RiskLevel {
  return severityOf(b) > severityOf(a) ? b : a;
}

/** Worst level across a set; `unreported` when the set is empty. */
export function worstRisk(levels: readonly RiskLevel[]): RiskLevel {
  if (levels.length === 0) return 'unreported';
  return levels.reduce((worst, level) => worseRisk(worst, level), SEVERITY[0]!);
}

export function isAtRisk(level: RiskLevel): boolean {
  return AT_RISK_LEVELS.includes(level);
}

function reason(code: ReasonCode, detail: string): RiskReason {
  return { code, label: REASON_LABELS[code], detail };
}

/** Formats a date as `31 Mar 2026` for reason text. */
export function formatDate(iso: string): string {
  const [y, m, d] = iso.split('-');
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const monthName = months[Number(m) - 1] ?? m;
  return `${Number(d)} ${monthName} ${y}`;
}

/**
 * Score used only to order the attention list. Deliberately not shown as a
 * number -- exposing it would invite debate about the arithmetic instead of the
 * project.
 */
function computeScore(level: RiskLevel, reasons: readonly RiskReason[], overdueDays: number): number {
  const base: Record<RiskLevel, number> = {
    attention: 70,
    blocked: 65,
    monitor: 40,
    unreported: 20,
    'on-track': 5,
    complete: 0,
    cancelled: 0,
  };

  let score = base[level];
  // Longer slips rank above shorter ones within the same level.
  if (overdueDays > 0) score += Math.min(25, Math.floor(overdueDays / 30) * 5);
  // Several concurrent problems rank above a single one.
  if (reasons.length > 1) score += Math.min(5, reasons.length - 1);

  return Math.max(0, Math.min(100, score));
}

/**
 * Derived signals when no authored status exists. Collects every applicable
 * reason -- the dominant one drives the level, the rest add context in the
 * detail panel.
 */
function deriveSignals(input: RiskInput): { level: RiskLevel; reasons: RiskReason[]; overdueDays: number } {
  const { status, start, end, daysSinceUpdate, blockers, asOf } = input;
  const reasons: RiskReason[] = [];

  // Terminal states short-circuit: a completed project is not "on track", and a
  // cancelled one must never appear in the attention list.
  //
  // Order matters. Jira gives "Will not do" a statusCategory of `done`, so
  // testing the category first would report abandoned work as DELIVERED and
  // inflate the completed count on the portfolio view. Phase is the more
  // specific signal and must win.
  if (status.phase === 'cancelled') {
    return { level: 'cancelled', reasons: [], overdueDays: 0 };
  }
  if (status.phase === 'complete' || status.category === 'done') {
    return { level: 'complete', reasons: [], overdueDays: 0 };
  }

  let level: RiskLevel = 'on-track';
  let overdueDays = 0;

  // --- suspended ------------------------------------------------------------
  // This is the case that makes a dedicated `hold` phase worth having. Without
  // this floor, a held project that was updated recently and whose go-live is
  // still in the future derives as ON TRACK -- the precise false reassurance this
  // application exists to prevent. Held work is not progressing, whatever its
  // dates say.
  //
  // A floor, never a cap: `worseRisk` cannot lower an overdue or blocked signal,
  // so a held project that is ALSO 200 days late still reads as attention.
  //
  // Placed first so `on-hold` leads the reason list -- being on hold is the
  // defining fact about the item, and the attention list shows the first reason.
  if (status.phase === 'hold') {
    level = worseRisk(level, 'monitor');
    reasons.push(
      reason('on-hold', `Work is on hold; Jira status is ${status.raw}. Progress is suspended.`),
    );
  }

  // --- schedule: overdue go-live -------------------------------------------
  if (end) {
    const daysLate = daysBetween(end, asOf);

    if (daysLate >= RISK_THRESHOLDS.overdueAttentionDays) {
      overdueDays = daysLate;
      level = worseRisk(level, 'attention');
      reasons.push(
        reason(
          'delayed-milestone',
          `Go-live was ${formatDate(end)}, now ${daysLate} days overdue.`,
        ),
      );
    } else if (daysLate >= RISK_THRESHOLDS.overdueMonitorDays) {
      overdueDays = daysLate;
      level = worseRisk(level, 'monitor');
      reasons.push(
        reason(
          'delayed-milestone',
          `Go-live was ${formatDate(end)}, now ${daysLate} day${daysLate === 1 ? '' : 's'} overdue.`,
        ),
      );
    } else {
      // --- go-live approaching while not started ---------------------------
      const daysUntil = -daysLate;
      if (
        daysUntil <= RISK_THRESHOLDS.goLiveHorizonDays &&
        NOT_STARTED_PHASES.includes(status.phase)
      ) {
        level = worseRisk(level, 'monitor');
        reasons.push(
          reason(
            'go-live-risk',
            `Go-live is ${formatDate(end)} (${daysUntil} days away) but the project has not started; it remains in ${status.raw}.`,
          ),
        );
      }
    }
  }

  // --- schedule: start date passed, not started ----------------------------
  if (start && NOT_STARTED_PHASES.includes(status.phase)) {
    const daysSinceStart = daysBetween(start, asOf);
    if (daysSinceStart > 0) {
      level = worseRisk(level, 'monitor');
      reasons.push(
        reason(
          'schedule-risk',
          `Planned start was ${formatDate(start)}, ${daysSinceStart} days ago, but the project remains in ${status.raw}.`,
        ),
      );
    }
  }

  // --- dependencies ---------------------------------------------------------
  const openBlockers = blockers.filter((b) => b.open);
  if (openBlockers.length > 0) {
    level = worseRisk(level, 'attention');
    const list = openBlockers
      .slice(0, 3)
      .map((b) => b.key)
      .join(', ');
    const more = openBlockers.length > 3 ? ` and ${openBlockers.length - 3} more` : '';
    reasons.push(
      reason(
        'dependency-risk',
        `Blocked by ${openBlockers.length} open item${openBlockers.length === 1 ? '' : 's'}: ${list}${more}.`,
      ),
    );
  }

  // --- staleness ------------------------------------------------------------
  if (daysSinceUpdate >= RISK_THRESHOLDS.staleDays) {
    level = worseRisk(level, 'monitor');
    reasons.push(
      reason(
        'reporting-gap',
        `No update in Jira for ${daysSinceUpdate} days, so current progress cannot be confirmed.`,
      ),
    );
  }

  // --- missing dates --------------------------------------------------------
  // Checked last, and only when nothing else fired: an item with a known problem
  // is better described by that problem than by its missing dates.
  if (!start || !end) {
    const missing = !start && !end ? 'start or go-live date' : !start ? 'start date' : 'go-live date';
    reasons.push(
      reason('reporting-gap', `No ${missing} recorded in Jira, so the schedule cannot be assessed.`),
    );
    if (reasons.length === 1) level = 'unreported';
  }

  if (reasons.length === 0) {
    reasons.push(
      reason('no-immediate-action', 'On schedule against the dates recorded in Jira.'),
    );
  }

  return { level, reasons, overdueDays };
}

/**
 * Full risk assessment for a roadmap item.
 *
 * An authored status wins outright and derivation is skipped: if a site says
 * amber, the app must not overrule them. Schedule facts still surface as
 * supporting reasons so the "why" is concrete even when the RAG is authored.
 */
export function assessRisk(input: RiskInput): RiskAssessment {
  // A terminal workflow status beats an authored RAG.
  //
  // Verified on DDTLESS-96: Jira status is `Done` while its Health field still
  // reads "Green" -- the site closed the work but never updated the RAG. Letting
  // the RAG win would keep finished projects in the active portfolio and on the
  // "On Track" KPI indefinitely. The workflow transition is the harder fact; a
  // stale RAG field is not evidence the work is still running.
  const terminal =
    input.status.phase === 'cancelled'
      ? ('cancelled' as const)
      : input.status.phase === 'complete' || input.status.category === 'done'
        ? ('complete' as const)
        : undefined;

  if (terminal) {
    return {
      level: terminal,
      provenance: input.authoredRag ? (input.authoredRag.isSpot ? 'spot' : 'reported') : 'inferred',
      atRisk: false,
      reasons: [],
      ...(input.authoredRag ? { authored: input.authoredRag.authored } : {}),
      score: 0,
    };
  }

  if (input.authoredRag) {
    const { level: authoredLevel, authored, isSpot } = input.authoredRag;

    // Recompute schedule facts for context, but do not let them change the level.
    const derived = deriveSignals(input);
    const supporting = derived.reasons.filter((r) => r.code !== 'no-immediate-action');

    // THE HOLD FLOOR -- an approved business rule, not an implementation detail.
    //
    // A project in a Hold status reports a MINIMUM health of Monitor, even when the
    // site has authored Green. This is the one derived signal permitted to move an
    // authored level, and it is deliberate:
    //
    //   - Workflow state is a stronger and more current signal than a RAG field
    //     that may not have been revisited since the work was suspended.
    //   - A project explicitly moved to Hold must never present as Green.
    //   - An authored Red still wins: `worseRisk` is a floor, never a cap.
    //   - Provenance is untouched, so the reader still sees that a site authored the
    //     status -- the floor changes the level, never the evidence trail.
    //
    // It is the same precedence the terminal rule above applies, for the same
    // reason. Without it, a held project that was updated yesterday and whose
    // go-live is still months away reports as ON TRACK, which is the precise false
    // reassurance this application exists to prevent.
    const level =
      input.status.phase === 'hold' ? worseRisk(authoredLevel, 'monitor') : authoredLevel;

    return {
      level,
      provenance: isSpot ? 'spot' : 'reported',
      atRisk: isAtRisk(level),
      reasons: supporting,
      authored,
      score: computeScore(level, supporting, derived.overdueDays),
    };
  }

  const { level, reasons, overdueDays } = deriveSignals(input);

  return {
    level,
    provenance: level === 'unreported' ? 'none' : 'inferred',
    atRisk: isAtRisk(level),
    reasons,
    score: computeScore(level, reasons, overdueDays),
  };
}

/**
 * Rolls a set of item-level risks up to a parent (an Initiative, site or region).
 * An authored parent RAG wins over the rollup for the same reason as above.
 */
export function rollUpRisk(
  childLevels: readonly RiskLevel[],
  authored?: { level: RiskLevel; authored: AuthoredRag; isSpot: boolean } | undefined,
): RiskAssessment {
  const atRiskCount = childLevels.filter(isAtRisk).length;
  const total = childLevels.length;

  const level = authored ? authored.level : worstRisk(childLevels);

  const reasons: RiskReason[] = [];
  if (atRiskCount > 0) {
    reasons.push(
      reason(
        atRiskCount === total ? 'delayed-milestone' : 'schedule-risk',
        `${atRiskCount} of ${total} linked project${total === 1 ? '' : 's'} ${atRiskCount === 1 ? 'needs' : 'need'} attention.`,
      ),
    );
  } else if (total > 0) {
    reasons.push(
      reason('no-immediate-action', `All ${total} linked project${total === 1 ? '' : 's'} on schedule.`),
    );
  }

  return {
    level,
    provenance: authored ? (authored.isSpot ? 'spot' : 'reported') : total > 0 ? 'inferred' : 'none',
    atRisk: isAtRisk(level),
    reasons,
    ...(authored ? { authored: authored.authored } : {}),
    score: computeScore(level, reasons, 0),
  };
}
