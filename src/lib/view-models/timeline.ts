/**
 * The Gantt scale. Every pixel offset the timeline renders is computed here, never
 * in a component.
 *
 * GEOMETRY IS IN PERCENTAGES, not pixels. The chart is a CSS grid whose width is
 * unknown at render time on the server, and percentages let the browser handle
 * responsiveness without measuring. It also means the scale is trivially testable:
 * a quarter is a number between 0 and 100, not a function of a DOM node.
 *
 * FISCAL QUARTERS, NEVER CALENDAR ONES. Q1 begins 1 April (config/fiscal-year.ts).
 * The reference report's own range slider reads 1 Apr -> 31 Mar, so this is
 * verified rather than assumed.
 *
 * DOMAIN CLAMPING is the reason this module exists rather than a one-liner. One
 * item running to 2035 would otherwise compress the entire portfolio into a few
 * percent of the width. The domain is therefore bounded to a window around the
 * current fiscal year, and anything outside it is clipped to the edge and marked
 * as clipped so the UI can show that the bar continues.
 */

import {
  currentFiscalYear,
  daysBetween,
  fiscalQuartersOf,
  fiscalYearOf,
  fiscalYearRange,
  offsetFiscalYear,
  startCalendarYearFromLabel,
} from '@/lib/fiscal-year.js';

export interface TimelineQuarter {
  fy: string;
  quarter: 1 | 2 | 3 | 4;
  label: string;
  start: string;
  end: string;
  xPct: number;
  wPct: number;
}

export interface TimelineYear {
  fy: string;
  label: string;
  xPct: number;
  wPct: number;
}

export interface BarGeometry {
  xPct: number;
  wPct: number;
  /** True when the real span extends past the left/right edge of the domain. */
  clippedStart: boolean;
  clippedEnd: boolean;
}

export interface TimelineScale {
  domainStart: string;
  domainEnd: string;
  quarters: TimelineQuarter[];
  years: TimelineYear[];
  /** Position of `asOf`, or undefined when it falls outside the domain. */
  todayPct?: number;
  /** Bar geometry for a span. Undefined when the span cannot be plotted at all. */
  barFor(start: string | undefined, end: string | undefined): BarGeometry | undefined;
  /** Position of a single date (a milestone). Undefined when outside the domain. */
  pointFor(date: string | undefined): number | undefined;
}

export interface TimelineScaleOptions {
  /** Fiscal years to include before the current one. */
  yearsBefore?: number;
  /** Fiscal years to include after the current one. */
  yearsAfter?: number;
}

const DEFAULTS: Required<TimelineScaleOptions> = { yearsBefore: 2, yearsAfter: 4 };

export interface DatedSpan {
  start?: string | undefined;
  end?: string | undefined;
}

/**
 * Builds a scale covering the data, bounded by the clamp window.
 *
 * The window is intersected with the data's own range, so a portfolio that happens
 * to span only two years does not render four empty years of grid.
 */
export function buildTimelineScale(
  spans: readonly DatedSpan[],
  asOf: string,
  options: TimelineScaleOptions = {},
): TimelineScale {
  const { yearsBefore, yearsAfter } = { ...DEFAULTS, ...options };

  const current = currentFiscalYear(asOf);
  const windowFirst = startCalendarYearFromLabel(offsetFiscalYear(current, -yearsBefore));
  const windowLast = startCalendarYearFromLabel(offsetFiscalYear(current, yearsAfter));

  // Data range, in fiscal-year start years.
  let dataFirst = Number.POSITIVE_INFINITY;
  let dataLast = Number.NEGATIVE_INFINITY;
  for (const span of spans) {
    for (const date of [span.start, span.end]) {
      if (!date) continue;
      const y = startCalendarYearFromLabel(fiscalYearOf(date));
      if (y < dataFirst) dataFirst = y;
      if (y > dataLast) dataLast = y;
    }
  }

  // No dated spans at all: show the current fiscal year alone rather than nothing,
  // so the header and today marker still render.
  if (!Number.isFinite(dataFirst) || !Number.isFinite(dataLast)) {
    dataFirst = startCalendarYearFromLabel(current);
    dataLast = dataFirst;
  }

  const firstYear = Math.max(windowFirst, dataFirst);
  const lastYear = Math.min(windowLast, Math.max(dataLast, firstYear));

  // Labels are derived by OFFSET from the current fiscal year, never by string
  // construction. `FY${y % 100}` would hardcode a 2-digit, label-from-start format
  // and silently break if config/fiscal-year.ts changed either -- exactly the kind
  // of assumption that file exists to own.
  const currentStartYear = startCalendarYearFromLabel(current);
  const fyLabels: string[] = [];
  for (let y = firstYear; y <= lastYear; y++) {
    fyLabels.push(offsetFiscalYear(current, y - currentStartYear));
  }

  const quarters: TimelineQuarter[] = [];
  const years: TimelineYear[] = [];

  for (const fy of fyLabels) {
    for (const q of fiscalQuartersOf(fy)) {
      quarters.push({ fy, quarter: q.quarter, label: q.label, start: q.start, end: q.end, xPct: 0, wPct: 0 });
    }
  }

  const domainStart = quarters[0]!.start;
  const domainEnd = quarters[quarters.length - 1]!.end;
  const totalDays = daysBetween(domainStart, domainEnd) + 1;

  const pct = (date: string): number => (daysBetween(domainStart, date) / totalDays) * 100;

  for (const q of quarters) {
    q.xPct = pct(q.start);
    q.wPct = (daysBetween(q.start, q.end) + 1) / totalDays * 100;
  }

  for (const fy of fyLabels) {
    const own = quarters.filter((q) => q.fy === fy);
    const firstQ = own[0]!;
    const lastQ = own[own.length - 1]!;
    years.push({ fy, label: fy, xPct: firstQ.xPct, wPct: lastQ.xPct + lastQ.wPct - firstQ.xPct });
  }

  const inDomain = (date: string): boolean =>
    daysBetween(domainStart, date) >= 0 && daysBetween(date, domainEnd) >= 0;

  return {
    domainStart,
    domainEnd,
    quarters,
    years,
    ...(inDomain(asOf) ? { todayPct: pct(asOf) } : {}),

    barFor(start, end) {
      // A span needs both endpoints to be a bar. One endpoint is a milestone,
      // handled by `pointFor`, and neither is the "no dates" group.
      if (!start || !end) return undefined;

      // Tolerate inverted ranges: bad data should still appear, and the inversion
      // is reported separately as a warning by the pipeline.
      const [from, to] = daysBetween(start, end) < 0 ? [end, start] : [start, end];

      // No overlap with the visible window at all.
      if (daysBetween(to, domainStart) > 0 || daysBetween(domainEnd, from) > 0) return undefined;

      const clippedStart = daysBetween(domainStart, from) < 0;
      const clippedEnd = daysBetween(to, domainEnd) < 0;
      const clampedFrom = clippedStart ? domainStart : from;
      const clampedTo = clippedEnd ? domainEnd : to;

      const xPct = pct(clampedFrom);
      const wPct = ((daysBetween(clampedFrom, clampedTo) + 1) / totalDays) * 100;

      return { xPct, wPct, clippedStart, clippedEnd };
    },

    pointFor(date) {
      if (!date || !inDomain(date)) return undefined;
      return pct(date);
    },
  };
}
