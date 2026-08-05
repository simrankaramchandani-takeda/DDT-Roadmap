/**
 * Parses the informal taxonomy out of issue summary strings.
 *
 * Two jobs:
 *   1. Recover SPOT IDs. The dedicated field is populated on ~8 items, but IDs
 *      appear in summary text across much of the portfolio. This is what makes
 *      SPOT deep-linking viable.
 *   2. Produce a clean title. The Power BI report shows summaries raw, giving
 *      truncated labels like `1059740 - [FY26] - MBO - AUTO - Metasys capital
 *      improvements and archite...`. Stripping the metadata leaves a title that
 *      reads like a project name.
 *
 * Best-effort throughout: on no match, `cleanTitle` is the raw summary. Nothing
 * is ever lost -- `raw` is always retained.
 */

import {
  BRACKET_TAG_PATTERN,
  CAPACITY_CODE_PATTERN,
  FUNCTION_CODES,
  FY_TAG_PATTERN,
  INLINE_FY_TAG_PATTERN,
  INLINE_SPOT_ID_PATTERN,
  INLINE_SPOT_LABEL_PATTERN,
  SEGMENT_SEPARATOR,
  SITE_PREFIXES,
  SPOT_ID_LABELLED_PATTERN,
  SPOT_ID_PATTERN,
} from '@config/summary-taxonomy.js';
import type { ParsedSummary } from '@/types/domain.js';

const FUNCTION_CODE_LOOKUP = new Map(FUNCTION_CODES.map((c) => [c.toLowerCase(), c]));

/** Normalises a two- or four-digit fiscal year fragment to `FY26`. */
function normaliseFyTag(fragment: string): string {
  const digits = fragment.replace(/\D/g, '');
  const twoDigit = digits.length > 2 ? digits.slice(-2) : digits.padStart(2, '0');
  return `FY${twoDigit}`;
}

/**
 * Extracts the SPOT ID. A labelled reference (`SPOT 1024096`, `SPOT-1044760`)
 * is preferred over a bare 7-digit number, which is more likely coincidental.
 */
export function extractSpotId(summary: string): string | undefined {
  const labelled = SPOT_ID_LABELLED_PATTERN.exec(summary);
  if (labelled?.[1]) return labelled[1];

  const bare = SPOT_ID_PATTERN.exec(summary);
  return bare?.[1];
}

/** Extracts a fiscal year tag, normalised to `FYnn`. */
export function extractFyTag(summary: string): string | undefined {
  const match = FY_TAG_PATTERN.exec(summary);
  if (!match?.[1]) return undefined;

  const tag = normaliseFyTag(match[1]);
  // Guard against matching an unrelated number that happened to follow "FY".
  return /^FY\d{2}$/.test(tag) ? tag : undefined;
}

/**
 * Extracts a function code. Only matches against the known list -- inferring
 * codes from arbitrary uppercase tokens produced too many false positives from
 * site prefixes and product names (`IT`, `DS`, `SAP`, `PI`).
 */
export function extractFunctionCode(summary: string): string | undefined {
  // Bracketed tags first: `[OPEX]` is unambiguous.
  for (const match of summary.matchAll(BRACKET_TAG_PATTERN)) {
    const candidate = FUNCTION_CODE_LOOKUP.get((match[1] ?? '').toLowerCase());
    if (candidate) return candidate;
  }

  // Then delimited segments: `... - AUTO - ...`
  for (const segment of summary.split(SEGMENT_SEPARATOR)) {
    const candidate = FUNCTION_CODE_LOOKUP.get(segment.trim().toLowerCase());
    if (candidate) return candidate;
  }

  return undefined;
}

/** Extracts a leading site/programme prefix. Display noise only -- the
 *  authoritative site always comes from the Jira project key. */
export function extractSitePrefix(summary: string): string | undefined {
  const trimmed = summary.trim();

  // Longest first, so `IE BRAY` wins over a hypothetical `IE`.
  const ordered = [...SITE_PREFIXES].sort((a, b) => b.length - a.length);

  for (const prefix of ordered) {
    const lower = trimmed.toLowerCase();
    const p = prefix.toLowerCase();
    if (!lower.startsWith(p)) continue;

    // Must be followed by a boundary, so `TOOL...` does not match `TO`.
    const next = trimmed.charAt(prefix.length);
    if (next === '' || /[\s\-_:]/.test(next)) return prefix;
  }

  return undefined;
}

/** True when a segment is pure metadata and should not survive into the title. */
function isMetadataSegment(segment: string, spotId: string | undefined): boolean {
  const s = segment.trim();
  if (!s) return true;

  if (spotId && s === spotId) return true;
  if (/^SPOT[\s-]*\d{6,8}$/i.test(s)) return true;
  if (/^\d{6,8}$/.test(s)) return true;
  if (/^\[?FY\s?\d{2,4}(\s*-\s*\d{2,4})?\]?$/i.test(s)) return true;
  if (CAPACITY_CODE_PATTERN.test(s)) return true;
  if (FUNCTION_CODE_LOOKUP.has(s.toLowerCase())) return true;
  if (/^\[[A-Za-z0-9]+\]$/.test(s)) return true;

  return false;
}

/**
 * Builds a human title by dropping metadata segments.
 *
 * Guard: if every segment looks like metadata, keep the raw summary. A title is
 * always better than an empty label, and `SIMCA Local Server to Global Server
 * Migration` (no metadata at all) must survive untouched.
 */
export function buildCleanTitle(summary: string, spotId: string | undefined): string {
  const raw = summary.trim();

  const kept = raw
    .split(SEGMENT_SEPARATOR)
    .filter((segment) => !isMetadataSegment(segment, spotId));

  let title = kept.join(' - ').trim();

  if (!title) title = raw;

  // Clean up in-place metadata that was not its own segment, e.g.
  // `Hikari_Network Enhancement FY26_1060201` (underscore-delimited).
  title = title
    .replace(INLINE_SPOT_LABEL_PATTERN, '')
    .replace(INLINE_SPOT_ID_PATTERN, '')
    .replace(INLINE_FY_TAG_PATTERN, '')
    .replace(/\s{2,}/g, ' ')
    .replace(/[\s\-_]+$/, '')
    .replace(/^[\s\-_]+/, '')
    .trim();

  return title || raw;
}

/** Parses a Jira summary into its structured parts. */
export function parseSummary(summary: string): ParsedSummary {
  const raw = summary ?? '';
  const spotId = extractSpotId(raw);
  const fyTag = extractFyTag(raw);
  const functionCode = extractFunctionCode(raw);
  const sitePrefix = extractSitePrefix(raw);
  const cleanTitle = buildCleanTitle(raw, spotId);

  return {
    cleanTitle,
    raw,
    ...(spotId ? { spotId } : {}),
    ...(fyTag ? { fyTag } : {}),
    ...(functionCode ? { functionCode } : {}),
    ...(sitePrefix ? { sitePrefix } : {}),
  };
}
