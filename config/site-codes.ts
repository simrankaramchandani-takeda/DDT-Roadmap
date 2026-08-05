/**
 * 3-letter site code lookups.
 *
 * Codes come from the Power BI report, where they label the per-site go-live
 * markers on each Initiative row. They are DISPLAY ONLY -- the data model always
 * keys on the Jira project key.
 *
 * That distinction is load-bearing because of a collision hazard:
 *     SGP = Singapore     (Jira DDTSG)
 *     SNG = Singen        (Jira DDTSNG)
 * The codes and the Jira keys pair up in opposite directions, so any code-keyed
 * join would be one transposition away from silently attributing Singapore's
 * work to Singen. Codes are therefore never used as identifiers.
 *
 * Twelve codes were observed in the screenshots; nine are proposed by the plan
 * and flagged `codeObserved: false` in config/projects.ts pending an
 * authoritative list.
 */

import { SITES } from './projects.js';

const CODE_TO_KEY = new Map(SITES.map((s) => [s.code, s.key]));
const KEY_TO_CODE = new Map(SITES.map((s) => [s.key, s.code]));

export function siteKeyFromCode(code: string): string | undefined {
  return CODE_TO_KEY.get(code);
}

export function siteCodeFromKey(key: string): string | undefined {
  return KEY_TO_CODE.get(key);
}

/** Codes still awaiting confirmation against an authoritative list. */
export const UNCONFIRMED_SITE_CODES: readonly string[] = SITES.filter((s) => !s.codeObserved).map(
  (s) => s.code,
);

/**
 * Detects a duplicate code in config, which would make display ambiguous.
 * Called by verify-snapshot.
 */
export function findDuplicateSiteCodes(): string[] {
  const seen = new Set<string>();
  const dupes = new Set<string>();
  for (const site of SITES) {
    if (seen.has(site.code)) dupes.add(site.code);
    seen.add(site.code);
  }
  return [...dupes];
}
