/**
 * The Gantt renderer. Pure presentation: every offset arrives pre-computed as a
 * percentage from src/lib/view-models/timeline.ts.
 *
 * Deliberate differences from the reference Power BI report, each with a reason:
 *   - Thin 10px bars with 4px rounded ends and a recessive hairline grid, instead
 *     of thick saturated blocks. Saturated fills belong on small marks and accents.
 *   - Health carried by a HealthMark in the row label as well as the bar fill, so
 *     the encoding is never colour-only.
 *   - Colliding milestones collapse to a marker with a COUNT rather than an
 *     undifferentiated glyph.
 *   - A named "No dates reported" footer instead of silently empty lanes.
 *   - A solid ink today marker rather than a red dotted rule: red is a reserved
 *     status hue here, and a red line beside red bars invites misreading it as data.
 */

import type { ReactElement, ReactNode } from 'react';

import { HEALTH_DISPLAY } from '@/lib/view-models/health.js';
import type { BarGeometry, TimelineScale } from '@/lib/view-models/timeline.js';
import type { RiskLevel } from '@/types/domain.js';
import { HealthMark } from './HealthMark.js';

export function TimelineHeader({ scale }: { scale: TimelineScale }): ReactElement {
  return (
    <>
      <div className="tl-head-label">Timeline</div>
      <div className="tl-head-scale">
        <div className="tl-band tl-band-year">
          {scale.years.map((year) => (
            <div key={year.fy} className="tl-year" style={{ left: `${year.xPct}%`, width: `${year.wPct}%` }}>
              {year.label}
            </div>
          ))}
        </div>
        <div className="tl-band">
          {scale.quarters.map((q) => (
            <div
              key={`${q.fy}-${q.quarter}`}
              className="tl-quarter"
              style={{ left: `${q.xPct}%`, width: `${q.wPct}%` }}
            >
              {q.label}
            </div>
          ))}
        </div>
      </div>
    </>
  );
}

/** Quarter rules and the today marker. Rendered inside every plot cell. */
export function PlotBackground({ scale, showToday = true }: { scale: TimelineScale; showToday?: boolean }): ReactElement {
  return (
    <>
      {scale.quarters.map((q) => (
        <span key={`${q.fy}-${q.quarter}`} className="tl-rule" style={{ left: `${q.xPct}%` }} aria-hidden="true" />
      ))}
      {showToday && scale.todayPct !== undefined ? (
        <span className="tl-today" style={{ left: `${scale.todayPct}%` }} aria-hidden="true" />
      ) : undefined}
    </>
  );
}

export interface SpanBarProps {
  bar: BarGeometry;
  level: RiskLevel;
  derived?: boolean;
  title: string;
}

export function SpanBar({ bar, level, derived, title }: SpanBarProps): ReactElement {
  const display = HEALTH_DISPLAY[level];
  const classes = ['tl-bar'];
  if (derived) classes.push('tl-bar-derived');
  if (bar.clippedStart) classes.push('tl-bar-clip-start');
  if (bar.clippedEnd) classes.push('tl-bar-clip-end');
  if (display.hatched) classes.push('tl-hatch');

  return (
    <span
      className={classes.join(' ')}
      style={{ left: `${bar.xPct}%`, width: `${bar.wPct}%`, background: display.cssVar }}
      title={title}
    />
  );
}

export interface MarkerProps {
  xPct: number;
  level: RiskLevel;
  code?: string;
  count?: number;
  title: string;
}

export function MilestoneMarker({ xPct, level, code, count = 1, title }: MarkerProps): ReactElement {
  const display = HEALTH_DISPLAY[level];
  return (
    <span className="tl-marker" style={{ left: `${xPct}%` }} title={title}>
      <span className="tl-marker-glyph" style={{ color: display.cssVar }} aria-hidden="true">
        {display.glyph}
      </span>
      {code || count > 1 ? (
        <span className="tl-marker-code">
          {count > 1 ? <span className="tl-marker-count">{count}</span> : undefined}
          {count > 1 && code ? ' ' : undefined}
          {code}
        </span>
      ) : undefined}
      <span
        style={{ position: 'absolute', width: 1, height: 1, overflow: 'hidden', clipPath: 'inset(50%)' }}
      >
        {title}
      </span>
    </span>
  );
}

export function TimelineRow({
  label,
  level,
  href,
  meta,
  sub,
  children,
  scale,
}: {
  label: string;
  level: RiskLevel;
  href?: string;
  meta?: string;
  sub?: boolean;
  children: ReactNode;
  scale: TimelineScale;
}): ReactElement {
  return (
    <div className={sub ? 'tl-sub' : undefined} style={{ display: 'grid', gridTemplateColumns: '15rem 1fr' }}>
      <div className="tl-row-label" title={label}>
        <HealthMark level={level} labelled={false} context={label} />
        <span>{href ? <a href={href}>{label}</a> : label}</span>
        {meta ? <span className="muted" style={{ flex: '0 0 auto' }}>{meta}</span> : undefined}
      </div>
      <div className="tl-row-plot">
        <PlotBackground scale={scale} />
        {children}
      </div>
    </div>
  );
}

export function TimelineGroupHeader({
  label,
  itemCount,
  level,
  href,
  scale,
  note,
}: {
  label: string;
  itemCount: number;
  level: RiskLevel;
  href?: string;
  scale: TimelineScale;
  note?: string;
}): ReactElement {
  return (
    <div className="tl-group">
      <div>
        <HealthMark level={level} labelled={false} context={label} />
        {href ? <a href={href}>{label}</a> : <span>{label}</span>}
        <span className="muted">({itemCount} {itemCount === 1 ? 'item' : 'items'})</span>
      </div>
      <div>
        <PlotBackground scale={scale} />
        {note ? (
          <span className="muted" style={{ position: 'absolute', right: '0.5rem', top: '0.2rem', fontSize: '0.6875rem' }}>
            {note}
          </span>
        ) : undefined}
      </div>
    </div>
  );
}

/**
 * Frame plus the today chip. `min-width` on the inner element means the chart
 * scrolls horizontally on narrow screens rather than compressing quarters to
 * illegibility.
 */
export function TimelineFrame({
  scale,
  children,
  footer,
}: {
  scale: TimelineScale;
  children: ReactNode;
  footer?: ReactNode;
}): ReactElement {
  return (
    <div className="tl">
      <div className="tl-scroll">
        <div className="tl-inner">
          <div className="tl-grid" style={{ position: 'relative' }}>
            <TimelineHeader scale={scale} />
          </div>
          {scale.todayPct !== undefined ? (
            <div className="tl-grid" style={{ position: 'relative', height: 0 }}>
              <div />
              <div style={{ position: 'relative' }}>
                <span className="tl-today-chip" style={{ left: `${scale.todayPct}%` }}>
                  Today
                </span>
              </div>
            </div>
          ) : undefined}
          {children}
        </div>
      </div>
      {footer ? <div className="tl-footer">{footer}</div> : undefined}
    </div>
  );
}
