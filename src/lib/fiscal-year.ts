/**
 * Fiscal year arithmetic. Pure, and the only place fiscal logic lives.
 *
 * All dates are handled as `YYYY-MM-DD` strings with UTC-based Date construction.
 * Using local-time Date parsing here would shift dates by a day for anyone west
 * of UTC, which silently moves items across fiscal-year and quarter boundaries --
 * the kind of bug that makes an executive dashboard quietly wrong rather than
 * obviously broken.
 */

import {
  FISCAL_YEAR_CONFIG,
  FISCAL_YEAR_GROUPS,
  type FiscalYearConfig,
  type FiscalYearGroupKey,
} from '@config/fiscal-year.js';

export interface FiscalQuarter {
  /** 1-4, where Q1 begins on the fiscal year start. */
  quarter: 1 | 2 | 3 | 4;
  label: string;
  start: string;
  end: string;
}

export interface FiscalYearRange {
  label: string;
  /** Calendar year in which the fiscal year starts. */
  startCalendarYear: number;
  start: string;
  end: string;
}

// ---------------------------------------------------------------------------
// Date helpers (UTC-safe, string-in/string-out)
// ---------------------------------------------------------------------------

const DATE_RE = /^(\d{4})-(\d{2})-(\d{2})/;

/** Parses `YYYY-MM-DD` (or an ISO timestamp) to a UTC Date at midnight. */
export function parseIsoDate(value: string): Date {
  const m = DATE_RE.exec(value);
  if (!m) throw new Error(`Invalid date: ${value}`);
  const [, y, mo, d] = m;
  return new Date(Date.UTC(Number(y), Number(mo) - 1, Number(d)));
}

export function toIsoDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}

export function addDaysUtc(date: Date, days: number): Date {
  return new Date(date.getTime() + days * 86_400_000);
}

/** Whole days from `a` to `b`. Positive when `b` is later. */
export function daysBetween(a: string, b: string): number {
  return Math.round((parseIsoDate(b).getTime() - parseIsoDate(a).getTime()) / 86_400_000);
}

// ---------------------------------------------------------------------------
// Fiscal year core
// ---------------------------------------------------------------------------

function label(startCalendarYear: number, config: FiscalYearConfig): string {
  const year = config.labelFrom === 'start' ? startCalendarYear : startCalendarYear + 1;
  const digits =
    config.labelDigits === 2 ? String(year % 100).padStart(2, '0') : String(year);
  return `${config.labelPrefix}${digits}`;
}

/**
 * Calendar year in which the fiscal year containing `date` begins.
 * A date before the fiscal start month belongs to the previous fiscal year --
 * e.g. 15 Feb 2027 falls in the FY that began 1 Apr 2026.
 */
function startCalendarYearOf(date: Date, config: FiscalYearConfig): number {
  const y = date.getUTCFullYear();
  const month = date.getUTCMonth() + 1;
  const day = date.getUTCDate();

  const beforeStart =
    month < config.startMonth || (month === config.startMonth && day < config.startDay);

  return beforeStart ? y - 1 : y;
}

/** Fiscal year label for a date, e.g. "FY26". */
export function fiscalYearOf(
  date: string,
  config: FiscalYearConfig = FISCAL_YEAR_CONFIG,
): string {
  return label(startCalendarYearOf(parseIsoDate(date), config), config);
}

/** Parses a label such as "FY26" or "FY2026" back to its start calendar year. */
export function startCalendarYearFromLabel(
  fyLabel: string,
  config: FiscalYearConfig = FISCAL_YEAR_CONFIG,
): number {
  const digits = fyLabel.replace(/\D/g, '');
  if (!digits) throw new Error(`Invalid fiscal year label: ${fyLabel}`);

  // Two-digit labels are assumed to be 2000-2099; the portfolio's horizon
  // (2020-2036 in the reference report) sits comfortably inside that.
  const year = digits.length <= 2 ? 2000 + Number(digits) : Number(digits);
  return config.labelFrom === 'start' ? year : year - 1;
}

/** Start and end dates of a fiscal year. */
export function fiscalYearRange(
  fyLabel: string,
  config: FiscalYearConfig = FISCAL_YEAR_CONFIG,
): FiscalYearRange {
  const startCalendarYear = startCalendarYearFromLabel(fyLabel, config);
  const start = new Date(
    Date.UTC(startCalendarYear, config.startMonth - 1, config.startDay),
  );
  // One day before the same point next year -- correct across leap years.
  const end = addDaysUtc(
    new Date(Date.UTC(startCalendarYear + 1, config.startMonth - 1, config.startDay)),
    -1,
  );

  return {
    label: label(startCalendarYear, config),
    startCalendarYear,
    start: toIsoDate(start),
    end: toIsoDate(end),
  };
}

/** The four fiscal quarters of a year. Q1 begins on the fiscal year start. */
export function fiscalQuartersOf(
  fyLabel: string,
  config: FiscalYearConfig = FISCAL_YEAR_CONFIG,
): FiscalQuarter[] {
  const { startCalendarYear } = fiscalYearRange(fyLabel, config);
  const quarters: FiscalQuarter[] = [];

  for (let i = 0; i < 4; i++) {
    const start = new Date(
      Date.UTC(startCalendarYear, config.startMonth - 1 + i * 3, config.startDay),
    );
    const end = addDaysUtc(
      new Date(Date.UTC(startCalendarYear, config.startMonth - 1 + (i + 1) * 3, config.startDay)),
      -1,
    );
    quarters.push({
      quarter: (i + 1) as 1 | 2 | 3 | 4,
      label: `Q${i + 1}`,
      start: toIsoDate(start),
      end: toIsoDate(end),
    });
  }

  return quarters;
}

/** Fiscal quarter containing a date, e.g. { fy: "FY26", quarter: 2 }. */
export function fiscalQuarterOf(
  date: string,
  config: FiscalYearConfig = FISCAL_YEAR_CONFIG,
): { fy: string; quarter: 1 | 2 | 3 | 4 } {
  const fy = fiscalYearOf(date, config);
  const quarters = fiscalQuartersOf(fy, config);
  const target = parseIsoDate(date).getTime();

  for (const q of quarters) {
    if (target >= parseIsoDate(q.start).getTime() && target <= parseIsoDate(q.end).getTime()) {
      return { fy, quarter: q.quarter };
    }
  }
  // Unreachable: the four quarters tile the year exactly.
  throw new Error(`Could not place ${date} in a quarter of ${fy}`);
}

/**
 * Every fiscal year a date span touches, inclusive. Used to decide which FY
 * filters an item appears under -- a multi-year programme belongs to all of them.
 * Returns an empty array when either endpoint is missing, which is what puts an
 * item in the "no plotted dates" bucket.
 */
export function fiscalYearsSpanned(
  start: string | undefined,
  end: string | undefined,
  config: FiscalYearConfig = FISCAL_YEAR_CONFIG,
): string[] {
  if (!start || !end) return [];

  // Tolerate inverted ranges rather than returning nothing; bad data should
  // still appear on the roadmap, and the inversion is reported separately.
  const [from, to] = daysBetween(start, end) < 0 ? [end, start] : [start, end];

  const firstYear = startCalendarYearOf(parseIsoDate(from), config);
  const lastYear = startCalendarYearOf(parseIsoDate(to), config);

  const out: string[] = [];
  for (let y = firstYear; y <= lastYear; y++) out.push(label(y, config));
  return out;
}

/** Fiscal year containing `today`. */
export function currentFiscalYear(
  today: string,
  config: FiscalYearConfig = FISCAL_YEAR_CONFIG,
): string {
  return fiscalYearOf(today, config);
}

/** Shifts a fiscal year label by whole years. `offsetFiscalYear('FY26', -1)` -> 'FY25'. */
export function offsetFiscalYear(
  fyLabel: string,
  offset: number,
  config: FiscalYearConfig = FISCAL_YEAR_CONFIG,
): string {
  return label(startCalendarYearFromLabel(fyLabel, config) + offset, config);
}

/** True when a date falls inside a fiscal year. */
export function isInFiscalYear(
  date: string,
  fyLabel: string,
  config: FiscalYearConfig = FISCAL_YEAR_CONFIG,
): boolean {
  return fiscalYearOf(date, config) === fyLabel;
}

/**
 * Fiscal years present in the data, grouped for the "FY Group -> Fiscal Year"
 * selector preserved from the report. Groups are relative to the current fiscal
 * year, so this needs no maintenance as years roll over.
 */
export function fiscalYearGroups(
  fiscalYearsInData: readonly string[],
  today: string,
  config: FiscalYearConfig = FISCAL_YEAR_CONFIG,
): { key: FiscalYearGroupKey; label: string; fiscalYears: string[] }[] {
  const currentStart = startCalendarYearFromLabel(currentFiscalYear(today, config), config);

  const unique = [...new Set(fiscalYearsInData)].sort(
    (a, b) => startCalendarYearFromLabel(a, config) - startCalendarYearFromLabel(b, config),
  );

  return (Object.keys(FISCAL_YEAR_GROUPS) as FiscalYearGroupKey[])
    .map((key) => {
      const { label: groupLabel, offsetFrom, offsetTo } = FISCAL_YEAR_GROUPS[key];
      const fiscalYears = unique.filter((fy) => {
        const offset = startCalendarYearFromLabel(fy, config) - currentStart;
        return offset >= offsetFrom && offset <= offsetTo;
      });
      return { key, label: groupLabel, fiscalYears };
    })
    .filter((g) => g.fiscalYears.length > 0);
}
