import { describe, expect, it } from 'vitest';
import {
  currentFiscalYear,
  daysBetween,
  fiscalQuarterOf,
  fiscalQuartersOf,
  fiscalYearGroups,
  fiscalYearOf,
  fiscalYearRange,
  fiscalYearsSpanned,
  offsetFiscalYear,
  startCalendarYearFromLabel,
} from '@/lib/fiscal-year.js';

describe('fiscalYearOf', () => {
  it('places 1 April in the fiscal year named for that calendar year', () => {
    expect(fiscalYearOf('2026-04-01')).toBe('FY26');
  });

  it('places 31 March in the PREVIOUS fiscal year', () => {
    // The boundary that breaks naive implementations.
    expect(fiscalYearOf('2026-03-31')).toBe('FY25');
    expect(fiscalYearOf('2027-03-31')).toBe('FY26');
  });

  it('places mid-year dates correctly', () => {
    // Discovery ran on 2026-08-05, which the Power BI today-marker showed in FY26 Q2.
    expect(fiscalYearOf('2026-08-05')).toBe('FY26');
    expect(fiscalYearOf('2027-01-15')).toBe('FY26');
    expect(fiscalYearOf('2026-12-31')).toBe('FY26');
  });

  it('handles a leap day', () => {
    expect(fiscalYearOf('2028-02-29')).toBe('FY27');
  });

  it('matches the axis observed in the reference Power BI report', () => {
    // The Site page x-axis begins 4/1/2023 under a column labelled "2023 / Q1".
    expect(fiscalYearOf('2023-04-01')).toBe('FY23');
    expect(fiscalQuarterOf('2023-04-01')).toEqual({ fy: 'FY23', quarter: 1 });

    // The Global page shows "2022 / Q4" beginning 01-Jan-23.
    expect(fiscalYearOf('2023-01-01')).toBe('FY22');
    expect(fiscalQuarterOf('2023-01-01')).toEqual({ fy: 'FY22', quarter: 4 });
  });
});

describe('fiscalYearRange', () => {
  it('spans 1 April to 31 March', () => {
    expect(fiscalYearRange('FY26')).toEqual({
      label: 'FY26',
      startCalendarYear: 2026,
      start: '2026-04-01',
      end: '2027-03-31',
    });
  });

  it('is correct across a leap year', () => {
    // FY27 contains 29 Feb 2028.
    expect(fiscalYearRange('FY27')).toEqual({
      label: 'FY27',
      startCalendarYear: 2027,
      start: '2027-04-01',
      end: '2028-03-31',
    });
  });

  it('accepts four-digit labels', () => {
    expect(fiscalYearRange('FY2026').start).toBe('2026-04-01');
  });
});

describe('fiscalQuartersOf', () => {
  it('starts Q1 in April and ends Q4 in March', () => {
    const quarters = fiscalQuartersOf('FY26');
    expect(quarters.map((q) => [q.label, q.start, q.end])).toEqual([
      ['Q1', '2026-04-01', '2026-06-30'],
      ['Q2', '2026-07-01', '2026-09-30'],
      ['Q3', '2026-10-01', '2026-12-31'],
      ['Q4', '2027-01-01', '2027-03-31'],
    ]);
  });

  it('tiles the fiscal year with no gaps or overlaps', () => {
    const quarters = fiscalQuartersOf('FY27');
    const { start, end } = fiscalYearRange('FY27');
    expect(quarters[0]!.start).toBe(start);
    expect(quarters[3]!.end).toBe(end);
    for (let i = 1; i < quarters.length; i++) {
      expect(daysBetween(quarters[i - 1]!.end, quarters[i]!.start)).toBe(1);
    }
  });
});

describe('fiscalQuarterOf', () => {
  it('places the discovery date in FY26 Q2, matching the report today-marker', () => {
    expect(fiscalQuarterOf('2026-08-05')).toEqual({ fy: 'FY26', quarter: 2 });
  });

  it('places January in Q4 of the previous fiscal year', () => {
    expect(fiscalQuarterOf('2027-02-15')).toEqual({ fy: 'FY26', quarter: 4 });
  });
});

describe('fiscalYearsSpanned', () => {
  it('returns a single year for a within-year span', () => {
    expect(fiscalYearsSpanned('2026-05-01', '2026-09-01')).toEqual(['FY26']);
  });

  it('returns every year a multi-year programme touches', () => {
    // DDTSG-55 (Phoenix, Singapore): start 2026-06-30, go-live 2028-04-01.
    expect(fiscalYearsSpanned('2026-06-30', '2028-04-01')).toEqual(['FY26', 'FY27', 'FY28']);
  });

  it('returns empty when either endpoint is missing', () => {
    // This is what puts an item in the "no plotted dates" bucket.
    expect(fiscalYearsSpanned(undefined, '2026-09-01')).toEqual([]);
    expect(fiscalYearsSpanned('2026-09-01', undefined)).toEqual([]);
    expect(fiscalYearsSpanned(undefined, undefined)).toEqual([]);
  });

  it('tolerates an inverted range rather than dropping the item', () => {
    expect(fiscalYearsSpanned('2028-04-01', '2026-06-30')).toEqual(['FY26', 'FY27', 'FY28']);
  });

  it('handles a span that ends exactly on a fiscal year boundary', () => {
    expect(fiscalYearsSpanned('2026-04-01', '2027-03-31')).toEqual(['FY26']);
    expect(fiscalYearsSpanned('2026-04-01', '2027-04-01')).toEqual(['FY26', 'FY27']);
  });
});

describe('label round-tripping', () => {
  it('parses labels back to their start year', () => {
    expect(startCalendarYearFromLabel('FY26')).toBe(2026);
    expect(startCalendarYearFromLabel('FY2026')).toBe(2026);
  });

  it('offsets by whole years', () => {
    expect(offsetFiscalYear('FY26', -1)).toBe('FY25');
    expect(offsetFiscalYear('FY26', 2)).toBe('FY28');
    expect(offsetFiscalYear('FY99', 1)).toBe('FY00');
  });
});

describe('currentFiscalYear', () => {
  it('resolves the fiscal year containing today', () => {
    expect(currentFiscalYear('2026-08-05')).toBe('FY26');
    expect(currentFiscalYear('2026-03-31')).toBe('FY25');
  });
});

describe('fiscalYearGroups', () => {
  it('groups relative to the current fiscal year', () => {
    const groups = fiscalYearGroups(
      ['FY24', 'FY25', 'FY26', 'FY27', 'FY28', 'FY29'],
      '2026-08-05',
    );
    const byKey = Object.fromEntries(groups.map((g) => [g.key, g.fiscalYears]));

    expect(byKey['past']).toEqual(['FY24', 'FY25']);
    expect(byKey['current']).toEqual(['FY26']);
    expect(byKey['next']).toEqual(['FY27']);
    expect(byKey['future']).toEqual(['FY28', 'FY29']);
  });

  it('omits empty groups', () => {
    const groups = fiscalYearGroups(['FY26'], '2026-08-05');
    expect(groups.map((g) => g.key)).toEqual(['current']);
  });

  it('de-duplicates and sorts chronologically', () => {
    const groups = fiscalYearGroups(['FY28', 'FY26', 'FY28', 'FY27'], '2026-08-05');
    expect(groups.flatMap((g) => g.fiscalYears)).toEqual(['FY26', 'FY27', 'FY28']);
  });
});

describe('daysBetween', () => {
  it('counts whole days forward and backward', () => {
    expect(daysBetween('2026-08-05', '2026-08-06')).toBe(1);
    expect(daysBetween('2026-08-06', '2026-08-05')).toBe(-1);
    expect(daysBetween('2026-08-05', '2026-08-05')).toBe(0);
  });

  it('is unaffected by a leap day', () => {
    expect(daysBetween('2028-02-28', '2028-03-01')).toBe(2);
  });

  it('computes the overdue figure used in the plan example', () => {
    // Grange Castle: go-live 31 Mar 2026, snapshot 5 Aug 2026.
    expect(daysBetween('2026-03-31', '2026-08-05')).toBe(127);
  });
});
