/**
 * Rules for parsing structure out of issue summary strings.
 *
 * The reference screenshots show that summaries carry an informal taxonomy which
 * the Power BI report displays raw -- producing unreadable truncated labels like
 * `1059740 - [FY26] - MBO - AUTO - Metasys capital improvements and archite...`.
 *
 * Parsing it out matters for more than cosmetics: the `SPOT ID` custom field is
 * populated on only 8 items, but SPOT IDs appear in summary text across a large
 * share of the portfolio. Recovering them here is what makes SPOT deep-linking
 * viable at all.
 *
 * The convention is CONVENTIONAL, NOT ENFORCED. Every rule is best-effort: on no
 * match the clean title falls back to the raw summary and nothing is lost. An
 * open question asks whether the convention is documented anywhere so these
 * rules can follow a spec rather than inference.
 *
 * Observed forms (all from the reference screenshots and discovery samples):
 *   1030954 - MBO - AUTO - PI EG & Batch Context & PI Vision
 *   1059740 - [FY26] - MBO - AUTO - Metasys capital improvements and archite...
 *   1059652 - [OPEX] - WOF - Warehouse of the Future Program
 *   TO MES Elaprase DS - SPOT 1024096
 *   TILGC - Remediation of Satellite Communications Cabinets - SPOT-1044760
 *   W34 - Decommissioning Historian IP.21 - 1032397
 *   Hikari_Network Enhancement FY26_1060201
 *   SIMCA Local Server to Global Server Migration          (no SPOT ID)
 *   MBO CIM - NinjaOne Rollout (Tanium Replacement)        (no SPOT ID)
 */

/**
 * SPOT project IDs are 7 digits. Observed values run 1024096-1062568, i.e. all
 * begin with `10`. Anchoring on `10` plus 5 digits avoids matching years,
 * quantities, or equipment numbers such as `IP.21` or `BRX-2300`.
 */
/**
 * Digit-boundary lookarounds, NOT `\b`. Underscore is a word character, so `\b`
 * does not match between `FY26` and `_1060201` -- which silently failed to parse
 * the real summary `Hikari_Network Enhancement FY26_1060201`. Delimiting on
 * "not a digit" is what this actually needs.
 */
export const SPOT_ID_PATTERN = /(?<![0-9])(10\d{5})(?![0-9])/;

/**
 * Explicitly-labelled SPOT references take precedence over a bare number, since
 * a bare 7-digit match is more likely to be coincidental.
 */
export const SPOT_ID_LABELLED_PATTERN = /SPOT[\s\-_]*(10\d{5})(?![0-9])/i;

/** `[FY26]`, `FY26`, `FY2026`, and ranges like `FY2025-2026` (first year wins). */
export const FY_TAG_PATTERN =
  /\[?\bFY\s?((?:19|20)?\d{2})(?:\s*-\s*(?:19|20)?\d{2})?(?![0-9])\]?/i;

/** In-place metadata removal for summaries that are not `-`-delimited. */
export const INLINE_SPOT_LABEL_PATTERN = /[_\s]*SPOT[\s\-_]*(?<![0-9])\d{6,8}(?![0-9])/gi;
export const INLINE_SPOT_ID_PATTERN = /[_\s]*(?<![0-9])10\d{5}(?![0-9])/g;
export const INLINE_FY_TAG_PATTERN =
  /[_\s]*\[?\bFY\s?\d{2,4}(?:\s*-\s*\d{2,4})?(?![0-9])\]?/gi;

/**
 * Function / workstream codes seen as delimited segments. Matched case-sensitively
 * against this list only -- inferring codes from arbitrary uppercase tokens
 * produced too many false positives (site prefixes, product names, `IT`, `DS`).
 */
export const FUNCTION_CODES: readonly string[] = [
  'AUTO', // Automation
  'QUAL', // Quality
  'DDT',  // Digital Data & Technology
  'AGILE',
  'WOF',  // Warehouse of the Future
  'MSci', // Manufacturing Science
  'OSP',
  'TxN',  // Transformation
  'CIM',  // Critical Infrastructure Modernisation
  'MES',  // Manufacturing Execution System
  'OPEX',
] as const;

/**
 * Bracketed tags that are categories rather than fiscal years, e.g. `[OPEX]`.
 * Captured as the function code when they match FUNCTION_CODES.
 */
export const BRACKET_TAG_PATTERN = /\[([A-Za-z0-9]+)\]/g;

/**
 * Leading site/programme prefixes observed. Used only to strip noise from the
 * front of a clean title -- the authoritative site always comes from the Jira
 * project key, never from this.
 */
export const SITE_PREFIXES: readonly string[] = [
  'TO',    // Thousand Oaks
  'MBO',   // Lexington / MA Bio Ops
  'BP',    // Brooklyn Park
  'TILGC', // Grange Castle
  'IE BRAY',
  'SIN',   // Singen
  'BEK',   // Bekasi
  'MA Bio Ops',
] as const;

/** Segment separators used by the convention. */
export const SEGMENT_SEPARATOR = /\s+-\s+/;

/**
 * Capacity-planning codes such as `400SW`, `300SW`, `200SW`, `W34`. Stripped from
 * clean titles; not currently surfaced.
 */
export const CAPACITY_CODE_PATTERN = /^\d{3}SW$|^W\d{1,2}$/i;

/** Longest a clean title may be before the UI truncates it on a word boundary. */
export const CLEAN_TITLE_MAX_LENGTH = 120;
