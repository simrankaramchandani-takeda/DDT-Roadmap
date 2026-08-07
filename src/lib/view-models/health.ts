/**
 * The presentation vocabulary for health and provenance.
 *
 * WHY A GLYPH IS NOT DECORATION
 * -----------------------------
 * The validated status palette puts red (`#d03b3b`) and green (`#0ca30c`) at
 * ΔE 4.1 under deuteranopia, against a floor of 8. Red/green RAG coding is the
 * canonical colour-vision failure, and the reference Power BI report encodes health
 * by colour ALONE -- coloured bars, coloured triangles, a legend of coloured dots.
 * For roughly 8% of male viewers its green and red bars are not distinguishable.
 *
 * So every health mark carries THREE channels: colour, glyph and text label. The
 * glyph is load-bearing accessibility, not ornament. `HealthMark` is the only
 * component allowed to render a health colour, which makes this structural rather
 * than a convention someone has to remember.
 *
 * The token column is not invented here: `RISK_LEVEL_PALETTE_TOKEN` in
 * config/narrative.ts already maps all seven levels onto the five tokens the
 * reference report established, including `attention` and `blocked` both being red.
 * This module binds those tokens to CSS custom properties and adds the glyph.
 */

import { RISK_LEVEL_LABELS, RISK_LEVEL_PALETTE_TOKEN } from '@config/narrative.js';
import { PROVENANCE_LABELS } from '@config/narrative.js';
import type { RiskLevel, RiskProvenance } from '@/types/domain.js';

export interface HealthDisplay {
  level: RiskLevel;
  label: string;
  /** Non-colour channel. Required wherever health is shown. */
  glyph: string;
  /** The five-token vocabulary carried over from the reference report. */
  token: 'green' | 'amber' | 'red' | 'blue' | 'grey';
  /** CSS custom property holding the validated hex for this token. */
  cssVar: string;
  /**
   * `cancelled` and `unreported` share the grey token, so cancelled work adds a
   * hatch. Without it, abandoned work could read as merely unreported -- or worse,
   * as delivered.
   */
  hatched: boolean;
}

const GLYPHS: Readonly<Record<RiskLevel, string>> = {
  'on-track': '●',
  monitor: '▲',
  attention: '◆',
  blocked: '⬣',
  complete: '✓',
  cancelled: '✕',
  unreported: '○',
};

function displayFor(level: RiskLevel): HealthDisplay {
  const token = RISK_LEVEL_PALETTE_TOKEN[level];
  return {
    level,
    label: RISK_LEVEL_LABELS[level],
    glyph: GLYPHS[level],
    token,
    cssVar: `var(--health-${token})`,
    hatched: level === 'cancelled',
  };
}

export const HEALTH_DISPLAY: Readonly<Record<RiskLevel, HealthDisplay>> = {
  'on-track': displayFor('on-track'),
  monitor: displayFor('monitor'),
  attention: displayFor('attention'),
  blocked: displayFor('blocked'),
  complete: displayFor('complete'),
  cancelled: displayFor('cancelled'),
  unreported: displayFor('unreported'),
};

/**
 * Severity order, worst first. Used for the legend, the stacked distribution bar
 * and any sort. Deliberately NOT the declaration order in config/narrative.ts,
 * which is lifecycle order.
 */
export const HEALTH_SEVERITY_ORDER: readonly RiskLevel[] = [
  'blocked',
  'attention',
  'monitor',
  'on-track',
  'complete',
  'cancelled',
  'unreported',
] as const;

/** Reading order for the distribution bar: best first, so it reads left-to-right. */
export const HEALTH_DISTRIBUTION_ORDER: readonly RiskLevel[] = [
  'on-track',
  'monitor',
  'attention',
  'blocked',
  'unreported',
  'complete',
  'cancelled',
] as const;

export interface ProvenanceDisplay {
  provenance: RiskProvenance;
  label: string;
  glyph: string;
  cssVar: string;
}

/**
 * Provenance is an ORDINAL scale, not a categorical one -- these are ordered by how
 * much trust the number deserves, so darker means better-evidenced. The blue ramp
 * used here passes the ordinal checks (monotone lightness, ΔL >= 0.06, light end
 * clears the surface).
 */
export const PROVENANCE_DISPLAY: Readonly<Record<RiskProvenance, ProvenanceDisplay>> = {
  spot: { provenance: 'spot', label: PROVENANCE_LABELS.spot, glyph: '⬤', cssVar: 'var(--prov-spot)' },
  reported: { provenance: 'reported', label: PROVENANCE_LABELS.reported, glyph: '◕', cssVar: 'var(--prov-reported)' },
  inferred: { provenance: 'inferred', label: PROVENANCE_LABELS.inferred, glyph: '◐', cssVar: 'var(--prov-inferred)' },
  none: { provenance: 'none', label: PROVENANCE_LABELS.none, glyph: '○', cssVar: 'var(--prov-none)' },
};
