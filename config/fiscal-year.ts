/**
 * Takeda fiscal year configuration.
 *
 * VERIFIED against the current Power BI report, not assumed:
 *   - The Site page x-axis begins `4/1/2023` under a column labelled `2023 / Q1`.
 *   - The Global page shows `2022 / Q4` beginning `01-Jan-23`.
 * Therefore FY starts 1 April, is labelled by the calendar year in which it
 * STARTS, and Q1 = Apr-Jun. `FY26` = 1 Apr 2026 -> 31 Mar 2027.
 *
 * Corroborated by the data: `DDTGMPORT-12` lists Singen as "In Scope for FY26"
 * (current work as of Aug 2026), and DDTJG due dates cluster on 31 March.
 *
 * Nothing about this is hardcoded elsewhere -- all fiscal logic reads this object.
 */

export interface FiscalYearConfig {
  /** 1-12. April = 4. */
  startMonth: number;
  startDay: number;
  labelPrefix: string;
  /** 'start' -> FY26 begins in calendar 2026. 'end' -> FY26 ends in calendar 2026. */
  labelFrom: 'start' | 'end';
  /** 2 -> "FY26"; 4 -> "FY2026". */
  labelDigits: 2 | 4;
}

export const FISCAL_YEAR_CONFIG: FiscalYearConfig = {
  startMonth: 4,
  startDay: 1,
  labelPrefix: 'FY',
  labelFrom: 'start',
  labelDigits: 2,
};

/**
 * Groupings for the "FY Group -> Fiscal Year" selector preserved from the
 * report. Computed relative to the current fiscal year at render time rather
 * than enumerated, so this never needs maintenance.
 */
export const FISCAL_YEAR_GROUPS = {
  past: { label: 'Previous years', offsetFrom: -Infinity, offsetTo: -1 },
  current: { label: 'Current year', offsetFrom: 0, offsetTo: 0 },
  next: { label: 'Next year', offsetFrom: 1, offsetTo: 1 },
  future: { label: 'Future years', offsetFrom: 2, offsetTo: Infinity },
} as const;

export type FiscalYearGroupKey = keyof typeof FISCAL_YEAR_GROUPS;
