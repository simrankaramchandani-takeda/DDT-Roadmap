import { describe, expect, it } from 'vitest';
import { assessRisk, isAtRisk, rollUpRisk, worseRisk, worstRisk, type RiskInput } from '@/lib/risk.js';
import type { AuthoredRag, Blocker, ItemStatus } from '@/types/domain.js';

const ASOF = '2026-08-05';

function status(raw: string, phase: ItemStatus['phase'], category: ItemStatus['category']): ItemStatus {
  return { raw, phase, category };
}

function input(overrides: Partial<RiskInput> = {}): RiskInput {
  return {
    status: status('Execute', 'execute', 'in-progress'),
    daysSinceUpdate: 5,
    blockers: [],
    asOf: ASOF,
    ...overrides,
  };
}

const spotGreen: { level: 'on-track'; authored: AuthoredRag; isSpot: true } = {
  level: 'on-track',
  isSpot: true,
  authored: { value: 'Green', fieldId: 'customfield_24266', sourceLabel: 'Overall Status (SPOT)' },
};

const healthAmber: { level: 'monitor'; authored: AuthoredRag; isSpot: false } = {
  level: 'monitor',
  isSpot: false,
  authored: { value: 'Amber', fieldId: 'customfield_15784', sourceLabel: 'Health' },
};

describe('authored status takes precedence', () => {
  it('uses SPOT status and reports provenance "spot"', () => {
    const result = assessRisk(input({ authoredRag: spotGreen, start: '2026-06-30', end: '2028-04-01' }));
    expect(result.level).toBe('on-track');
    expect(result.provenance).toBe('spot');
    expect(result.authored?.fieldId).toBe('customfield_24266');
  });

  it('reports provenance "reported" for non-SPOT authored RAG', () => {
    const result = assessRisk(input({ authoredRag: healthAmber }));
    expect(result.provenance).toBe('reported');
    expect(result.level).toBe('monitor');
  });

  it('does NOT let derived signals override a site-authored green', () => {
    // The site says green while the go-live is 127 days overdue. The app must not
    // overrule them -- but must still surface the schedule fact as context.
    const result = assessRisk(
      input({ authoredRag: spotGreen, end: '2026-03-31', start: '2025-01-01' }),
    );
    expect(result.level).toBe('on-track');
    expect(result.provenance).toBe('spot');
    expect(result.reasons.some((r) => r.code === 'delayed-milestone')).toBe(true);
    expect(result.reasons.some((r) => r.detail.includes('127 days overdue'))).toBe(true);
  });

  it('lets a terminal Jira status beat a stale authored RAG', () => {
    // Verified on DDTLESS-96: status Done, Health still "Green". If the RAG won,
    // finished work would stay in the active portfolio and on the On Track KPI
    // forever, because nobody goes back to set Health to "Complete".
    const result = assessRisk(
      input({ status: status('Done', 'complete', 'done'), authoredRag: spotGreen }),
    );
    expect(result.level).toBe('complete');
    expect(result.atRisk).toBe(false);
    // The authored value is retained for context, not discarded.
    expect(result.authored?.value).toBe('Green');
  });

  it('lets "Will not do" beat an authored RAG', () => {
    const result = assessRisk(
      input({ status: status('Will not do', 'cancelled', 'done'), authoredRag: healthAmber }),
    );
    expect(result.level).toBe('cancelled');
    expect(result.atRisk).toBe(false);
  });

  it('does not let a stale amber RAG on completed work reach the attention list', () => {
    const result = assessRisk(
      input({ status: status('Closeout', 'complete', 'done'), authoredRag: healthAmber, end: '2026-01-01' }),
    );
    expect(result.atRisk).toBe(false);
    expect(result.score).toBe(0);
  });

  it('omits the filler reason when a status is authored and nothing is wrong', () => {
    const result = assessRisk(input({ authoredRag: spotGreen, start: '2026-06-30', end: '2028-04-01' }));
    expect(result.reasons.some((r) => r.code === 'no-immediate-action')).toBe(false);
  });
});

describe('derived: overdue go-live', () => {
  it('flags attention beyond 90 days overdue', () => {
    // Grange Castle in the plan example.
    const result = assessRisk(input({ start: '2025-06-01', end: '2026-03-31' }));
    expect(result.level).toBe('attention');
    expect(result.provenance).toBe('inferred');
    expect(result.atRisk).toBe(true);
    const reason = result.reasons.find((r) => r.code === 'delayed-milestone');
    expect(reason?.detail).toBe('Go-live was 31 Mar 2026, now 127 days overdue.');
  });

  it('flags monitor between 1 and 90 days overdue', () => {
    const result = assessRisk(input({ start: '2026-01-01', end: '2026-07-20' }));
    expect(result.level).toBe('monitor');
    expect(result.reasons[0]?.detail).toContain('16 days overdue');
  });

  it('uses singular wording at exactly one day overdue', () => {
    const result = assessRisk(input({ start: '2026-01-01', end: '2026-08-04' }));
    expect(result.reasons[0]?.detail).toContain('1 day overdue');
  });

  it('is on track when the go-live is in the future', () => {
    const result = assessRisk(input({ start: '2026-06-30', end: '2028-04-01' }));
    expect(result.level).toBe('on-track');
    expect(result.atRisk).toBe(false);
    expect(result.reasons[0]?.code).toBe('no-immediate-action');
  });

  it('treats the boundary at exactly 90 days as attention', () => {
    const result = assessRisk(input({ start: '2026-01-01', end: '2026-05-07' }));
    expect(result.level).toBe('attention');
  });
});

describe('derived: go-live risk', () => {
  it('flags an imminent go-live on a project that has not started', () => {
    const result = assessRisk(
      input({
        status: status('Initiate', 'initiate', 'todo'),
        start: '2026-09-01',
        end: '2026-09-15',
      }),
    );
    expect(result.level).toBe('monitor');
    const reason = result.reasons.find((r) => r.code === 'go-live-risk');
    expect(reason?.detail).toContain('41 days away');
  });

  it('does not flag an imminent go-live on a project already in flight', () => {
    const result = assessRisk(
      input({ status: status('Execute', 'execute', 'in-progress'), start: '2026-01-01', end: '2026-09-15' }),
    );
    expect(result.reasons.some((r) => r.code === 'go-live-risk')).toBe(false);
    expect(result.level).toBe('on-track');
  });
});

describe('derived: schedule risk', () => {
  it('flags a passed start date on a not-started project', () => {
    const result = assessRisk(
      input({ status: status('Demand', 'demand', 'todo'), start: '2026-05-01', end: '2027-05-01' }),
    );
    expect(result.level).toBe('monitor');
    const reason = result.reasons.find((r) => r.code === 'schedule-risk');
    expect(reason?.detail).toContain('96 days ago');
    expect(reason?.detail).toContain('Demand');
  });
});

describe('derived: dependency risk', () => {
  const openBlocker: Blocker = { key: 'DDTGC-99', summary: 'Network upgrade', type: 'is blocked by', open: true };
  const closedBlocker: Blocker = { key: 'DDTGC-98', summary: 'Old work', type: 'is blocked by', open: false };

  it('flags attention for an open blocker', () => {
    const result = assessRisk(input({ start: '2026-01-01', end: '2027-01-01', blockers: [openBlocker] }));
    expect(result.level).toBe('attention');
    expect(result.reasons.find((r) => r.code === 'dependency-risk')?.detail).toContain('DDTGC-99');
  });

  it('ignores resolved blockers', () => {
    const result = assessRisk(input({ start: '2026-01-01', end: '2027-01-01', blockers: [closedBlocker] }));
    expect(result.reasons.some((r) => r.code === 'dependency-risk')).toBe(false);
    expect(result.level).toBe('on-track');
  });

  it('summarises beyond three blockers rather than listing them all', () => {
    const many: Blocker[] = Array.from({ length: 5 }, (_, i) => ({
      key: `DDTGC-${i}`,
      summary: 's',
      type: 'is blocked by',
      open: true,
    }));
    const result = assessRisk(input({ start: '2026-01-01', end: '2027-01-01', blockers: many }));
    expect(result.reasons.find((r) => r.code === 'dependency-risk')?.detail).toContain('and 2 more');
  });
});

describe('derived: reporting gap', () => {
  it('flags staleness beyond 90 days', () => {
    const result = assessRisk(input({ start: '2026-01-01', end: '2027-01-01', daysSinceUpdate: 120 }));
    expect(result.level).toBe('monitor');
    expect(result.reasons.find((r) => r.code === 'reporting-gap')?.detail).toContain('120 days');
  });

  it('marks an item with no dates as unreported, not on track', () => {
    // This is the 173-item case. Reporting it as green would be the single most
    // misleading thing the app could do.
    const result = assessRisk(input({}));
    expect(result.level).toBe('unreported');
    expect(result.provenance).toBe('none');
    expect(result.atRisk).toBe(false);
    expect(result.reasons[0]?.detail).toContain('No start or go-live date');
  });

  it('describes a missing go-live specifically', () => {
    const result = assessRisk(input({ start: '2026-01-01' }));
    expect(result.level).toBe('unreported');
    expect(result.reasons[0]?.detail).toContain('No go-live date');
  });

  it('prefers a real problem over the missing-date note', () => {
    // Missing start, but the go-live is badly overdue: the overdue fact is the
    // more useful headline.
    const result = assessRisk(input({ end: '2026-03-31' }));
    expect(result.level).toBe('attention');
    expect(result.reasons[0]?.code).toBe('delayed-milestone');
    expect(result.reasons.some((r) => r.code === 'reporting-gap')).toBe(true);
  });
});

describe('terminal states', () => {
  it('reports complete without risk reasons', () => {
    const result = assessRisk(
      input({ status: status('Done', 'complete', 'done'), end: '2026-01-01' }),
    );
    expect(result.level).toBe('complete');
    expect(result.atRisk).toBe(false);
    expect(result.reasons).toHaveLength(0);
  });

  it('does not flag a completed item as overdue', () => {
    const result = assessRisk(
      input({ status: status('Closeout', 'complete', 'done'), end: '2020-01-01' }),
    );
    expect(result.level).toBe('complete');
  });

  it('reports cancelled for "Will not do"', () => {
    const result = assessRisk(input({ status: status('Will not do', 'cancelled', 'done') }));
    expect(result.level).toBe('cancelled');
    expect(result.atRisk).toBe(false);
  });
});

describe('never infers unevidenced causes', () => {
  it('does not produce resource-constraint or scope-risk from derivation', () => {
    // No field in the DDT schema evidences either. They must only ever come from
    // an authored status.
    const cases: RiskInput[] = [
      input({ end: '2026-03-31' }),
      input({ status: status('Demand', 'demand', 'todo'), start: '2026-01-01', end: '2026-09-01' }),
      input({ daysSinceUpdate: 400 }),
      input({}),
    ];
    for (const c of cases) {
      const codes = assessRisk(c).reasons.map((r) => r.code);
      expect(codes).not.toContain('resource-constraint');
      expect(codes).not.toContain('scope-risk');
    }
  });
});

describe('atRisk boolean', () => {
  it('covers monitor, attention and blocked only', () => {
    expect(isAtRisk('monitor')).toBe(true);
    expect(isAtRisk('attention')).toBe(true);
    expect(isAtRisk('blocked')).toBe(true);
    expect(isAtRisk('on-track')).toBe(false);
    expect(isAtRisk('complete')).toBe(false);
    expect(isAtRisk('cancelled')).toBe(false);
    // Unknown is not the same as at risk -- conflating them would inflate the
    // attention list with 248 items nobody has assessed.
    expect(isAtRisk('unreported')).toBe(false);
  });
});

describe('severity ordering', () => {
  it('ranks attention worst', () => {
    expect(worseRisk('monitor', 'attention')).toBe('attention');
    expect(worseRisk('attention', 'monitor')).toBe('attention');
    expect(worseRisk('on-track', 'unreported')).toBe('on-track');
    expect(worstRisk(['complete', 'on-track', 'monitor'])).toBe('monitor');
  });

  it('returns unreported for an empty set', () => {
    expect(worstRisk([])).toBe('unreported');
  });
});

describe('score', () => {
  it('ranks a longer slip above a shorter one', () => {
    const short = assessRisk(input({ start: '2026-01-01', end: '2026-07-20' }));
    const long = assessRisk(input({ start: '2025-01-01', end: '2025-07-20' }));
    expect(long.score).toBeGreaterThan(short.score);
  });

  it('ranks attention above monitor above unreported', () => {
    const attention = assessRisk(input({ start: '2025-06-01', end: '2026-03-31' })).score;
    const monitor = assessRisk(input({ start: '2026-01-01', end: '2026-07-20' })).score;
    const unreported = assessRisk(input({})).score;
    expect(attention).toBeGreaterThan(monitor);
    expect(monitor).toBeGreaterThan(unreported);
  });

  it('stays within bounds', () => {
    const extreme = assessRisk(input({ start: '2010-01-01', end: '2010-01-02', daysSinceUpdate: 5000 }));
    expect(extreme.score).toBeGreaterThanOrEqual(0);
    expect(extreme.score).toBeLessThanOrEqual(100);
  });
});

describe('rollUpRisk', () => {
  it('takes the worst child level', () => {
    const result = rollUpRisk(['on-track', 'on-track', 'attention']);
    expect(result.level).toBe('attention');
    expect(result.provenance).toBe('inferred');
    // "1 of 3 ... needs" -- the subject is "1", so the verb is singular.
    expect(result.reasons[0]?.detail).toBe('1 of 3 linked projects needs attention.');
  });

  it('reports all-clear when no child is at risk', () => {
    const result = rollUpRisk(['on-track', 'complete']);
    expect(result.level).toBe('on-track');
    expect(result.reasons[0]?.code).toBe('no-immediate-action');
  });

  it('lets an authored parent RAG win over the rollup', () => {
    const result = rollUpRisk(['attention', 'attention'], spotGreen);
    expect(result.level).toBe('on-track');
    expect(result.provenance).toBe('spot');
    // The child problems are still stated.
    expect(result.reasons[0]?.detail).toContain('2 of 2');
  });

  it('reports none provenance for an initiative with no linked items', () => {
    const result = rollUpRisk([]);
    expect(result.level).toBe('unreported');
    expect(result.provenance).toBe('none');
  });

  it('uses singular wording for a single linked project', () => {
    expect(rollUpRisk(['attention']).reasons[0]?.detail).toBe('1 of 1 linked project needs attention.');
  });
});
