/**
 * The only component permitted to render a health colour.
 *
 * That restriction is the enforcement mechanism for "never colour alone". Red and
 * green sit at ΔE 4.1 under deuteranopia against a floor of 8, so any surface that
 * encodes health by colour alone is unreadable for roughly 8% of male viewers --
 * which is exactly what the reference Power BI report does. Routing every health
 * colour through here makes the glyph and the label impossible to omit by accident.
 *
 * `labelled={false}` hides the text VISUALLY only; the accessible name is always
 * present, so a screen reader and a colourblind reader both still get it.
 */

import type { ReactElement } from 'react';

import { HEALTH_DISPLAY } from '@/lib/view-models/health.js';
import type { RiskLevel } from '@/types/domain.js';

export interface HealthMarkProps {
  level: RiskLevel;
  /** Show the text label beside the glyph. */
  labelled?: boolean;
  /** Extra context appended to the accessible name, e.g. a site name. */
  context?: string;
}

export function HealthMark({ level, labelled = true, context }: HealthMarkProps): ReactElement {
  const display = HEALTH_DISPLAY[level];
  const accessibleName = context ? `${display.label} — ${context}` : display.label;

  return (
    <span className="hm" title={accessibleName}>
      <span className="hm-glyph" style={{ color: display.cssVar }} aria-hidden="true">
        {display.glyph}
      </span>
      {labelled ? (
        <span>{display.label}</span>
      ) : (
        <span
          style={{
            position: 'absolute',
            width: 1,
            height: 1,
            overflow: 'hidden',
            clipPath: 'inset(50%)',
            whiteSpace: 'nowrap',
          }}
        >
          {accessibleName}
        </span>
      )}
    </span>
  );
}

/**
 * Full legend. Always rendered next to a health-encoded chart, because identity
 * must never rest on colour alone -- and because a reader coming from the Power BI
 * report needs to map its five tokens onto these seven levels.
 */
export function HealthLegend({ levels }: { levels: readonly RiskLevel[] }): ReactElement {
  return (
    <div className="legend">
      {levels.map((level) => {
        const display = HEALTH_DISPLAY[level];
        return (
          <span className="legend-item" key={level}>
            <span aria-hidden="true" style={{ color: display.cssVar }}>
              {display.glyph}
            </span>
            {display.label}
          </span>
        );
      })}
    </div>
  );
}
