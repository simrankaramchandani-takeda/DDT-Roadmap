/**
 * Portfolio completeness: the checks that a per-row diagnostic cannot make.
 *
 * The adapter reports what it refuses, row by row. It cannot tell you that a whole site
 * vanished, that an initiative nothing links to appeared, or that 1371 rows became 400
 * items for reasons nobody accounted for. These tests pin those whole-dataset properties.
 *
 * THE BASIS TRAP IS TESTED EXPLICITLY. `buildCoverage` measures over ACTIVE items, so a
 * yield computed over all level-1 rows divides by the wrong denominator and manufactures a
 * parser regression out of completed work. That mistake was made once during WP6 and is
 * pinned here so it cannot come back.
 */

import { describe, expect, it } from 'vitest';

import { assessCompleteness } from '@/lib/feed/completeness.js';
import { adaptFeedSnapshot } from '@/lib/feed/adapter.js';
import {
  FEED3_FIXTURE,
  FEED3_FIXTURE_AS_OF,
  FIXTURE_ISSUE_TYPE_LEVELS,
} from '@/fixtures/feed3.fixture.js';
import type { Feed3Payload } from '@/lib/feed/dto.js';
import { UNALIGNED_INITIATIVE_KEY } from '@/types/domain.js';

const OPTIONS = {
  asOf: FEED3_FIXTURE_AS_OF,
  baseUrl: 'https://takeda.atlassian.net',
  issueTypeLevels: FIXTURE_ISSUE_TYPE_LEVELS,
} as const;

function assess(payload: Feed3Payload = FEED3_FIXTURE) {
  const adaptation = adaptFeedSnapshot(payload, OPTIONS);
  return { report: assessCompleteness(payload, adaptation.snapshot), adaptation };
}

describe('reconciliation', () => {
  it('accounts for every level-1 row the registry recognises', () => {
    const { report } = assess();
    // The fixture deliberately contains rows that must NOT reconcile as items -- an
    // unmapped status and an unregistered type -- so the interesting assertion is that
    // the arithmetic is reported, not that it is zero.
    expect(report.reconciliation.items).toBe(
      report.reconciliation.level1Rows - report.reconciliation.unaccounted,
    );
  });

  it('reports unaccounted level-1 rows as missing rather than absorbing them', () => {
    const { report } = assess();
    const unaccountedProjects = report.projects.filter((p) => p.unaccounted !== 0);
    for (const project of unaccountedProjects) {
      expect(
        report.findings.some((f) => f.kind === 'missing' && f.subject === project.key),
        `${project.key} has ${project.unaccounted} unaccounted rows but no finding`,
      ).toBe(true);
    }
  });

  it('counts rows, levels and items per project without double-counting', () => {
    const { report } = assess();
    const totalRows = report.projects.reduce((sum, p) => sum + p.rows, 0);
    expect(totalRows).toBe(FEED3_FIXTURE.issues.length);
  });

  it('does not blame a site for rows in a project that returned none', () => {
    const { report } = assess();
    for (const project of report.projects) {
      expect(project.items).toBeLessThanOrEqual(project.rows);
    }
  });
});

describe('classification', () => {
  it('separates a deferred project from an unregistered one', () => {
    const { report } = assess();
    const deferred = report.projects.find((p) => p.key === 'DDTLA');
    const unknown = report.projects.find((p) => p.key === 'DDTZZZ');

    expect(deferred?.classification).toBe('deferred');
    expect(unknown?.classification).toBe('unknown');
    expect(report.findings.some((f) => f.kind === 'excluded' && f.subject === 'DDTLA')).toBe(true);
    expect(report.findings.some((f) => f.kind === 'orphaned' && f.subject === 'DDTZZZ')).toBe(true);
  });

  it('does not report an unregistered issue type in an OUT-OF-SCOPE project as missing', () => {
    // The adapter skips out-of-scope rows before resolving a level, so those types are
    // never looked up. Reporting them would keep the gate permanently red over rows the
    // application deliberately never reads -- and a gate that is always red is ignored.
    const payload: Feed3Payload = {
      ...FEED3_FIXTURE,
      issues: [
        ...FEED3_FIXTURE.issues,
        { ISSUE_KEY: 'DDTLA-999', PROJECT_KEY: 'DDTLA', ISSUE_TYPE_ID: 999999, ISSUE_STATUS_NAME: 'Execute' },
      ],
    };
    const { report } = assess(payload);
    const deferred = report.projects.find((p) => p.key === 'DDTLA');

    expect(deferred?.unregisteredRows).toBeGreaterThan(0);
    expect(report.findings.some((f) => f.kind === 'missing' && f.subject === 'DDTLA')).toBe(false);
  });

  it('DOES report an unregistered issue type in an in-scope project as missing', () => {
    const { report } = assess();
    const withUnregistered = report.projects.filter(
      (p) => (p.classification === 'site' || p.classification === 'portfolio') && p.unregisteredRows > 0,
    );
    expect(withUnregistered.length).toBeGreaterThan(0);
    for (const project of withUnregistered) {
      expect(report.findings.some((f) => f.kind === 'missing' && f.subject === project.key)).toBe(true);
    }
  });
});

describe('duplicates', () => {
  it('names a repeated ISSUE_KEY in the export', () => {
    const { report } = assess();
    // DDTBP-1 is duplicated in the fixture on purpose.
    expect(report.findings.some((f) => f.kind === 'duplicate' && f.subject === 'DDTBP-1')).toBe(true);
  });

  it('blocks on a duplicate, because every downstream total would double-count it', () => {
    const { report } = assess();
    expect(report.ok).toBe(false);
  });
});

describe('initiatives', () => {
  it('excludes the synthetic site-local lane from the real initiative count', () => {
    const { report, adaptation } = assess();
    const hasLane = adaptation.snapshot.initiatives.some((i) => i.key === UNALIGNED_INITIATIVE_KEY);

    expect(hasLane).toBe(true);
    expect(report.initiatives.inSnapshot).toBe(adaptation.snapshot.initiatives.length - 1);
  });

  it('names an initiative that items reference but the feed did not return', () => {
    const payload: Feed3Payload = {
      ...FEED3_FIXTURE,
      issueLinks: [
        ...(FEED3_FIXTURE.issueLinks ?? []),
        // DDTYAR-1 deliberately: it is site-local, so it carries no existing Polaris
        // link. Attaching this to an already-aligned item would prove nothing, because
        // `findInitiativeKey` takes the FIRST portfolio counterpart and never reaches it.
        {
          ISSUE_KEY: 'DDTYAR-1',
          TYPE: 'Polaris work item link',
          DIRECTION: 'Outward',
          LINKED_ISSUE_KEY: 'DDTGMPORT-999',
        },
      ],
    };
    const { report } = assess(payload);
    expect(report.initiatives.dangling).toContain('DDTGMPORT-999');
    expect(report.findings.some((f) => f.kind === 'orphaned' && f.subject === 'DDTGMPORT-999')).toBe(true);
  });

  it('names an initiative with no items without treating it as a failure', () => {
    const { report } = assess();
    // Valid: a programme may not have started. It must be visible, not blocking.
    for (const key of report.initiatives.withNoItems) {
      const finding = report.findings.find((f) => f.subject === key);
      expect(finding?.kind).toBe('orphaned');
    }
  });
});

describe('sites', () => {
  it('names a configured site carrying no items', () => {
    const { report } = assess();
    expect(report.sites.configured).toBeGreaterThan(0);
    for (const key of report.sites.withoutItems) {
      expect(report.findings.some((f) => f.kind === 'missing' && f.subject === key)).toBe(true);
    }
  });

  it('distinguishes a site with no rows from one whose rows were all dropped', () => {
    const { report } = assess();
    const noRows = report.findings.filter(
      (f) => f.kind === 'missing' && f.detail.includes('no rows and no items'),
    );
    const droppedRows = report.findings.filter(
      (f) => f.kind === 'missing' && f.detail.includes('produced no roadmap items'),
    );
    // Different causes need different fixes: export scope versus the type registry.
    expect(noRows.length + droppedRows.length).toBe(report.sites.withoutItems.length);
  });
});

describe('field yield', () => {
  it('measures every stage over active items, never over all level-1 rows', () => {
    const { report, adaptation } = assess();
    const active = adaptation.snapshot.items.filter(
      (i) => i.risk.level !== 'complete' && i.risk.level !== 'cancelled',
    );

    for (const y of report.yields) {
      // A denominator above the active population means the wrong basis was used, which
      // is exactly how a healthy parser gets reported as failing.
      expect(y.populatedInFeed, `${y.field} denominator exceeds the active population`).toBeLessThanOrEqual(
        active.length,
      );
    }
  });

  it('nests each stage inside the one above it', () => {
    const { report } = assess();
    for (const y of report.yields) {
      expect(y.resolvedInModel, `${y.field} resolved more than were populated`).toBeLessThanOrEqual(
        y.populatedInFeed,
      );
      expect(y.yield).toBeGreaterThanOrEqual(0);
      expect(y.yield).toBeLessThanOrEqual(1);
    }
  });

  it('reports a full yield when nothing is populated, rather than dividing by zero', () => {
    const stripped: Feed3Payload = {
      ...FEED3_FIXTURE,
      issues: FEED3_FIXTURE.issues.map((row) => {
        const copy: Record<string, unknown> = {};
        for (const [column, value] of Object.entries(row)) {
          if (!/_\d{4,6}$/.test(column)) copy[column] = value;
        }
        return copy as typeof row;
      }),
    };
    const { report } = assess(stripped);
    for (const y of report.yields) {
      if (y.populatedInFeed === 0) expect(y.yield).toBe(1);
      expect(Number.isNaN(y.yield)).toBe(false);
    }
  });
});

describe('the verdict', () => {
  it('does not let an expected exclusion or a childless initiative block', () => {
    const { report } = assess();
    const blocking = report.findings.filter((f) => f.kind === 'missing' || f.kind === 'duplicate');
    const nonBlocking = report.findings.filter((f) => f.kind === 'excluded');

    expect(nonBlocking.length).toBeGreaterThan(0);
    // ok is false here only because of the fixture's deliberate defects.
    expect(report.ok).toBe(blocking.length === 0 && report.reconciliation.unaccounted === 0);
  });
});
